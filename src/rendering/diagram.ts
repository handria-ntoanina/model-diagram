import { TypedEventEmitter } from "../events/emitter.js";
import type {
  DiagramEventListener,
  DiagramEventMap,
  DiagramEventType,
  DiagramSelection,
  Unsubscribe,
} from "../events/types.js";
import { JointJsAdapter } from "../jointjs/adapter.js";
import {
  ElkLayoutEngine,
  type AutoLayoutOptions,
  type LayoutEngine,
} from "../layout/elk-layout.js";
import type {
  DiagramLayout,
  DiagramModel,
  DiagramRelationshipChanges,
  Position,
} from "../model/types.js";
import { normalizeRelationshipEndpoint } from "../model/relationship-endpoint.js";
import { positionsEqual } from "./geometry.js";
import { DiagramStore } from "./store.js";

export interface CreateDiagramOptions {
  model: DiagramModel;
  layout?: DiagramLayout;
  editable?: boolean;
  /** Controls the semantic prefix rendered before every attribute. */
  attributeMarkerMode?: AttributeMarkerMode;
  autoLayout?: boolean;
  /** Primarily useful for deterministic tests or a custom ELK worker setup. */
  layoutEngine?: LayoutEngine;
}

export type AttributeMarkerMode = "requiredness" | "visibility" | "none";

function validateAttributeMarkerMode(value: unknown): AttributeMarkerMode {
  if (value === "requiredness" || value === "visibility" || value === "none") {
    return value;
  }
  throw new TypeError(`Unsupported attribute marker mode "${String(value)}"`);
}

export type DiagramFocusTarget =
  | {
      type: "class";
      id: string;
      /** Select the class using the diagram's existing semantic selection. */
      select?: boolean;
    }
  | {
      type: "attribute";
      classId: string;
      /** Matches the attribute's `name` in the owning class. */
      attributeId: string;
      /** Select the owning class using the existing semantic selection. */
      select?: boolean;
    };

export interface Diagram {
  on<K extends DiagramEventType>(
    type: K,
    listener: DiagramEventListener<K>,
  ): Unsubscribe;
  getModel(): DiagramModel;
  setModel(model: DiagramModel): void;
  setLayout(layout: DiagramLayout): void;
  setEditable(editable: boolean): void;
  setAttributeMarkerMode(mode: AttributeMarkerMode): void;
  getLayout(): DiagramLayout;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
  clearHistory(): void;
  autoLayout(options?: AutoLayoutOptions): Promise<DiagramLayout>;
  whenReady(): Promise<void>;
  updateRelationship(
    relationshipId: string,
    changes: DiagramRelationshipChanges,
  ): void;
  addRelationshipWaypoint(
    relationshipId: string,
    position: Position,
    index?: number,
  ): void;
  moveRelationshipWaypoint(
    relationshipId: string,
    index: number,
    position: Position,
  ): void;
  removeRelationshipWaypoint(relationshipId: string, index: number): void;
  resetRelationshipRoute(relationshipId: string): void;
  focusElement(target: DiagramFocusTarget): boolean;
  fitToContent(padding?: number): void;
  setZoom(scale: number): void;
  zoomIn(): void;
  zoomOut(): void;
  panBy(dx: number, dy: number): void;
  destroy(): void;
}

interface ClassPositionHistoryEntry {
  kind: "class-position";
  classId: string;
  before: Position;
  after: Position;
}

interface NotePositionHistoryEntry {
  kind: "note-position";
  classId: string;
  before: Position;
  after: Position;
  beforeWasManual: boolean;
}

interface RelationshipWaypointsHistoryEntry {
  kind: "relationship-waypoints";
  operation: "add" | "move" | "remove" | "reset";
  relationshipId: string;
  index?: number;
  before: Position[];
  after: Position[];
}

interface RelationshipPropertiesHistoryEntry {
  kind: "relationship-properties";
  relationshipId: string;
  before: DiagramRelationshipChanges;
  after: DiagramRelationshipChanges;
}

interface LayoutTransactionHistoryEntry {
  kind: "layout-transaction";
  before: Record<string, Position>;
  after: Record<string, Position>;
}

type HistoryEntry =
  | ClassPositionHistoryEntry
  | NotePositionHistoryEntry
  | RelationshipWaypointsHistoryEntry
  | RelationshipPropertiesHistoryEntry
  | LayoutTransactionHistoryEntry;

interface ElementDragState {
  kind: "class" | "note";
  id: string;
  noteWasManual?: boolean;
}

function copyPosition(position: Position): Position {
  return { x: position.x, y: position.y };
}

function copyWaypoints(waypoints: Position[]): Position[] {
  return waypoints.map(copyPosition);
}

function positionsRecord(layout: DiagramLayout): Record<string, Position> {
  return Object.fromEntries(
    Object.entries(layout.classes ?? {}).map(([id, position]) => [
      id,
      copyPosition(position),
    ]),
  );
}

function positionRecordsEqual(
  first: Record<string, Position>,
  second: Record<string, Position>,
): boolean {
  const firstIds = Object.keys(first);
  const secondIds = Object.keys(second);
  return (
    firstIds.length === secondIds.length &&
    firstIds.every((id) => {
      const firstPosition = first[id];
      const secondPosition = second[id];
      return Boolean(
        firstPosition &&
          secondPosition &&
          positionsEqual(firstPosition, secondPosition),
      );
    })
  );
}

function waypointListsEqual(first: Position[], second: Position[]): boolean {
  return (
    first.length === second.length &&
    first.every((position, index) => {
      const other = second[index];
      return Boolean(other && positionsEqual(position, other));
    })
  );
}

function changedWaypointIndex(before: Position[], after: Position[]): number {
  const commonLength = Math.min(before.length, after.length);
  for (let index = 0; index < commonLength; index += 1) {
    const previous = before[index];
    const next = after[index];
    if (previous && next && !positionsEqual(previous, next)) return index;
  }
  return commonLength;
}

function selectionsEqual(
  first: DiagramSelection | null,
  second: DiagramSelection | null,
): boolean {
  if (first === null || second === null) return first === second;
  if (first.kind !== second.kind) return false;
  if (first.kind === "relationship-waypoint") {
    return (
      second.kind === "relationship-waypoint" &&
      first.relationshipId === second.relationshipId &&
      first.index === second.index
    );
  }
  return second.kind !== "relationship-waypoint" && first.id === second.id;
}

export class ModelDiagram implements Diagram {
  private readonly events = new TypedEventEmitter();
  private readonly store: DiagramStore;
  private readonly renderer: JointJsAdapter;
  private readonly layoutEngine: LayoutEngine;
  private editable: boolean;
  private attributeMarkerMode: AttributeMarkerMode;
  private selection: DiagramSelection | null = null;
  private readyPromise: Promise<void> = Promise.resolve();
  private destroyed = false;
  private layoutGeneration = 0;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private elementDragState?: ElementDragState;

  constructor(container: HTMLElement, options: CreateDiagramOptions) {
    if (!(container instanceof HTMLElement)) {
      throw new TypeError("createDiagram requires an HTMLElement container");
    }
    this.editable = options.editable ?? false;
    this.attributeMarkerMode = validateAttributeMarkerMode(
      options.attributeMarkerMode ?? "requiredness",
    );
    this.store = new DiagramStore(options.model, options.layout);
    this.layoutEngine = options.layoutEngine ?? new ElkLayoutEngine();
    this.renderer = new JointJsAdapter(
      container,
      this.editable,
      this.attributeMarkerMode,
      {
      onSelectionChanged: (selection) => this.changeSelection(selection),
      onPositionDragStarted: (kind, id) => this.beginElementDrag(kind, id),
      onPositionPreview: (kind, id, position) =>
        this.previewElementPosition(kind, id, position),
      onPositionCommitted: (kind, id, before, after) =>
        this.commitElementPosition(kind, id, before, after),
      onWaypointsPreview: (id, waypoints) =>
        this.previewWaypoints(id, waypoints),
      onWaypointsCommitted: (id, before, after) =>
        this.commitWaypoints(id, before, after),
      onWaypointAddRequested: (id, position, index) =>
        this.addRelationshipWaypoint(id, position, index),
      onDeleteSelectedWaypoint: () => this.deleteSelectedWaypoint(),
      },
    );
    this.renderer.render(this.store);

    const missingStoredPosition = options.model.classes.some(
      ({ id }) => !options.layout?.classes?.[id],
    );
    if ((options.autoLayout ?? true) && missingStoredPosition) {
      this.readyPromise = this.performAutoLayout(options.layout ?? {}, {
        preserveStoredPositions: true,
      }, false).then(() => undefined);
    }
  }

  on<K extends DiagramEventType>(
    type: K,
    listener: DiagramEventListener<K>,
  ): Unsubscribe {
    this.assertAlive();
    return this.events.on(type, listener);
  }

  getModel(): DiagramModel {
    this.assertAlive();
    return this.store.model;
  }

  setModel(model: DiagramModel): void {
    this.assertAlive();
    const previousLayout = this.store.getLayout();
    const previousIds = new Set(this.store.model.classes.map(({ id }) => id));
    this.store.setModel(model);
    this.layoutGeneration += 1;
    this.renderer.render(this.store);
    this.resetHistory();
    if (model.classes.some(({ id }) => !previousIds.has(id))) {
      this.readyPromise = this.performAutoLayout(previousLayout, {
        preserveStoredPositions: true,
      }, false).then(() => undefined);
    }
  }

  setLayout(layout: DiagramLayout): void {
    this.assertAlive();
    this.store.setLayout(layout);
    this.layoutGeneration += 1;
    this.renderer.syncAllPositions(this.store);
    this.resetHistory();
    if (this.store.model.classes.some(({ id }) => !layout.classes?.[id])) {
      this.readyPromise = this.performAutoLayout(layout, {
        preserveStoredPositions: true,
      }, false).then(() => undefined);
    }
  }

  setEditable(editable: boolean): void {
    this.assertAlive();
    const previous = this.historyAvailability();
    this.editable = editable;
    this.renderer.setEditable(editable);
    const next = this.historyAvailability();
    if (
      previous.canUndo !== next.canUndo ||
      previous.canRedo !== next.canRedo
    ) {
      this.emitHistoryChanged();
    }
  }

  setAttributeMarkerMode(mode: AttributeMarkerMode): void {
    this.assertAlive();
    const nextMode = validateAttributeMarkerMode(mode);
    if (nextMode === this.attributeMarkerMode) return;
    this.attributeMarkerMode = nextMode;
    this.renderer.setAttributeMarkerMode(nextMode, this.store);
  }

  getLayout(): DiagramLayout {
    this.assertAlive();
    return this.store.getLayout();
  }

  canUndo(): boolean {
    this.assertAlive();
    return this.historyAvailability().canUndo;
  }

  canRedo(): boolean {
    this.assertAlive();
    return this.historyAvailability().canRedo;
  }

  undo(): void {
    this.assertEditable();
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(entry);
    this.layoutGeneration += 1;
    this.applyHistoryEntry(entry, false);
    this.emitHistoryChanged();
  }

  redo(): void {
    this.assertEditable();
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(entry);
    this.layoutGeneration += 1;
    this.applyHistoryEntry(entry, true);
    this.emitHistoryChanged();
  }

  clearHistory(): void {
    this.assertAlive();
    this.resetHistory();
  }

  autoLayout(options: AutoLayoutOptions = {}): Promise<DiagramLayout> {
    this.assertAlive();
    const operation = this.performAutoLayout(this.store.getLayout(), {
      ...options,
      preserveStoredPositions: options.preserveStoredPositions ?? false,
    }, true);
    this.readyPromise = operation.then(() => undefined);
    return operation;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  updateRelationship(
    relationshipId: string,
    changes: DiagramRelationshipChanges,
  ): void {
    this.assertEditable();
    const previous = this.store.getRelationship(relationshipId);
    this.store.updateRelationship(relationshipId, changes);
    const next = this.store.getRelationship(relationshipId);
    const before: DiagramRelationshipChanges = {};
    const after: DiagramRelationshipChanges = {};

    if (Object.hasOwn(changes, "label") && previous.label !== next.label) {
      before.label = previous.label;
      after.label = next.label;
    }
    if (
      Object.hasOwn(changes, "routing") &&
      previous.routing !== next.routing
    ) {
      before.routing = previous.routing;
      after.routing = next.routing;
    }
    if (Object.keys(after).length === 0) return;

    this.recordHistory({
      kind: "relationship-properties",
      relationshipId,
      before,
      after,
    });
    this.renderer.syncRelationship(relationshipId, this.store);
    this.emitRelationshipChanged(relationshipId, after);
    this.emitHistoryChanged();
  }

  addRelationshipWaypoint(
    relationshipId: string,
    position: Position,
    index?: number,
  ): void {
    this.assertEditable();
    const before = this.store.getWaypoints(relationshipId);
    const insertedIndex = this.store.addWaypoint(
      relationshipId,
      position,
      index,
    );
    const after = this.store.getWaypoints(relationshipId);
    this.recordHistory({
      kind: "relationship-waypoints",
      operation: "add",
      relationshipId,
      index: insertedIndex,
      before,
      after,
    });
    this.renderer.syncWaypoints(relationshipId, this.store);
    this.changeSelection({
      kind: "relationship-waypoint",
      relationshipId,
      index: insertedIndex,
    });
    this.emit("relationship-waypoint-added", {
      type: "relationship-waypoint-added",
      relationshipId,
      index: insertedIndex,
      ...position,
    });
    this.emitHistoryChanged();
  }

  moveRelationshipWaypoint(
    relationshipId: string,
    index: number,
    position: Position,
  ): void {
    this.assertEditable();
    const before = this.store.getWaypoints(relationshipId);
    this.store.moveWaypoint(relationshipId, index, position);
    const after = this.store.getWaypoints(relationshipId);
    const recorded = !waypointListsEqual(before, after);
    if (recorded) {
      this.recordHistory({
        kind: "relationship-waypoints",
        operation: "move",
        relationshipId,
        index,
        before,
        after,
      });
    }
    this.renderer.syncWaypoints(relationshipId, this.store);
    this.changeSelection({
      kind: "relationship-waypoint",
      relationshipId,
      index,
    });
    this.emit("relationship-waypoint-changed", {
      type: "relationship-waypoint-changed",
      relationshipId,
      index,
      ...position,
    });
    if (recorded) this.emitHistoryChanged();
  }

  removeRelationshipWaypoint(relationshipId: string, index: number): void {
    this.assertEditable();
    const before = this.store.getWaypoints(relationshipId);
    this.store.removeWaypoint(relationshipId, index);
    const after = this.store.getWaypoints(relationshipId);
    this.recordHistory({
      kind: "relationship-waypoints",
      operation: "remove",
      relationshipId,
      index,
      before,
      after,
    });
    this.renderer.syncWaypoints(relationshipId, this.store);
    this.changeSelection({ kind: "relationship", id: relationshipId });
    this.emit("relationship-waypoint-removed", {
      type: "relationship-waypoint-removed",
      relationshipId,
      index,
    });
    this.emitHistoryChanged();
  }

  resetRelationshipRoute(relationshipId: string): void {
    this.assertEditable();
    const before = this.store.getWaypoints(relationshipId);
    this.store.resetRoute(relationshipId);
    const after = this.store.getWaypoints(relationshipId);
    const recorded = !waypointListsEqual(before, after);
    if (recorded) {
      this.recordHistory({
        kind: "relationship-waypoints",
        operation: "reset",
        relationshipId,
        before,
        after,
      });
    }
    this.renderer.syncWaypoints(relationshipId, this.store);
    this.changeSelection({ kind: "relationship", id: relationshipId });
    this.emit("relationship-route-reset", {
      type: "relationship-route-reset",
      relationshipId,
    });
    if (recorded) this.emitHistoryChanged();
  }

  focusElement(target: DiagramFocusTarget): boolean {
    this.assertAlive();
    const classId = target.type === "class" ? target.id : target.classId;
    const diagramClass = this.store.model.classes.find(
      (item) => item.id === classId,
    );
    if (!diagramClass) return false;

    let attributeIndex: number | undefined;
    if (target.type === "attribute") {
      attributeIndex =
        diagramClass.attributes?.findIndex(
          (attribute) => attribute.name === target.attributeId,
        ) ?? -1;
      if (attributeIndex < 0) return false;
    }

    if (!this.renderer.focusClass(classId, attributeIndex)) return false;
    if (target.select) this.changeSelection({ kind: "class", id: classId });
    return true;
  }

  fitToContent(padding?: number): void {
    this.assertAlive();
    this.renderer.fitToContent(padding);
  }

  setZoom(scale: number): void {
    this.assertAlive();
    this.renderer.setZoom(scale);
  }

  zoomIn(): void {
    this.setZoom(this.renderer.getZoom() * 1.2);
  }

  zoomOut(): void {
    this.setZoom(this.renderer.getZoom() / 1.2);
  }

  panBy(dx: number, dy: number): void {
    this.assertAlive();
    this.renderer.panBy(dx, dy);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.destroy();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.elementDragState = undefined;
    this.events.clear();
    this.selection = null;
  }

  private async performAutoLayout(
    storedLayout: DiagramLayout,
    options: AutoLayoutOptions,
    addToHistory: boolean,
  ): Promise<DiagramLayout> {
    const generation = ++this.layoutGeneration;
    const before = positionsRecord(this.store.getLayout());
    const model = this.store.model;
    const positions = await this.layoutEngine.layout(
      model,
      storedLayout,
      options,
    );
    if (this.destroyed || generation !== this.layoutGeneration) {
      return this.store.getLayout();
    }
    this.store.applyClassPositions(positions);
    this.renderer.syncAllPositions(this.store);
    const layout = this.store.getLayout();
    const after = positionsRecord(layout);
    const recorded = addToHistory && !positionRecordsEqual(before, after);
    if (recorded) {
      this.recordHistory({
        kind: "layout-transaction",
        before,
        after,
      });
    }
    this.emit("auto-layout-completed", {
      type: "auto-layout-completed",
      layout,
    });
    if (recorded) this.emitHistoryChanged();
    return layout;
  }

  private beginElementDrag(kind: "class" | "note", id: string): void {
    this.elementDragState = {
      kind,
      id,
      ...(kind === "note"
        ? { noteWasManual: this.store.hasManualNotePosition(id) }
        : {}),
    };
  }

  private previewElementPosition(
    kind: "class" | "note",
    id: string,
    position: Position,
  ): void {
    if (!this.editable) return;
    if (kind === "class") {
      this.layoutGeneration += 1;
      this.store.setClassPosition(id, position);
      if (!this.store.hasManualNotePosition(id)) {
        this.renderer.syncNotePosition(id, this.store);
      }
      this.emit("class-position-preview", {
        type: "class-position-preview",
        classId: id,
        ...position,
      });
    } else {
      this.store.setNotePosition(id, position);
      this.emit("note-position-preview", {
        type: "note-position-preview",
        classId: id,
        ...position,
      });
    }
  }

  private commitElementPosition(
    kind: "class" | "note",
    id: string,
    before: Position,
    position: Position,
  ): void {
    if (!this.editable) return;
    const dragState = this.elementDragState;
    this.elementDragState = undefined;
    if (kind === "class") {
      this.store.setClassPosition(id, position);
      this.recordHistory({
        kind: "class-position",
        classId: id,
        before: copyPosition(before),
        after: copyPosition(position),
      });
      this.emit("class-position-changed", {
        type: "class-position-changed",
        classId: id,
        ...position,
      });
    } else {
      this.store.setNotePosition(id, position);
      this.recordHistory({
        kind: "note-position",
        classId: id,
        before: copyPosition(before),
        after: copyPosition(position),
        beforeWasManual:
          dragState?.kind === "note" && dragState.id === id
            ? Boolean(dragState.noteWasManual)
            : true,
      });
      this.emit("note-position-changed", {
        type: "note-position-changed",
        classId: id,
        ...position,
      });
    }
    this.emitHistoryChanged();
  }

  private previewWaypoints(
    relationshipId: string,
    waypoints: Position[],
  ): void {
    if (!this.editable) return;
    const before = this.store.getWaypoints(relationshipId);
    const index = changedWaypointIndex(before, waypoints);
    this.store.replaceWaypoints(relationshipId, waypoints);

    if (waypoints.length < before.length) {
      this.changeSelection({ kind: "relationship", id: relationshipId });
      this.emit("relationship-waypoint-removed", {
        type: "relationship-waypoint-removed",
        relationshipId,
        index,
      });
      return;
    }
    if (waypoints.length > before.length) {
      const added = waypoints[index];
      if (!added) return;
      this.changeSelection({
        kind: "relationship-waypoint",
        relationshipId,
        index,
      });
      this.emit("relationship-waypoint-added", {
        type: "relationship-waypoint-added",
        relationshipId,
        index,
        ...added,
      });
      return;
    }
    const changed = waypoints[index];
    if (!changed) return;
    this.changeSelection({
      kind: "relationship-waypoint",
      relationshipId,
      index,
    });
    this.emit("relationship-waypoint-preview", {
      type: "relationship-waypoint-preview",
      relationshipId,
      index,
      ...changed,
    });
  }

  private commitWaypoints(
    relationshipId: string,
    before: Position[],
    after: Position[],
  ): void {
    if (!this.editable || before.length !== after.length) return;
    this.store.replaceWaypoints(relationshipId, after);
    const recorded = !waypointListsEqual(before, after);
    if (recorded) {
      this.recordHistory({
        kind: "relationship-waypoints",
        operation: "move",
        relationshipId,
        index: changedWaypointIndex(before, after),
        before: copyWaypoints(before),
        after: copyWaypoints(after),
      });
    }
    for (let index = 0; index < after.length; index += 1) {
      const previous = before[index];
      const position = after[index];
      if (!previous || !position || positionsEqual(previous, position)) continue;
      this.changeSelection({
        kind: "relationship-waypoint",
        relationshipId,
        index,
      });
      this.emit("relationship-waypoint-changed", {
        type: "relationship-waypoint-changed",
        relationshipId,
        index,
        ...position,
      });
    }
    if (recorded) this.emitHistoryChanged();
  }

  private recordHistory(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    this.redoStack.length = 0;
  }

  private resetHistory(): void {
    if (this.undoStack.length === 0 && this.redoStack.length === 0) return;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emitHistoryChanged();
  }

  private historyAvailability(): { canUndo: boolean; canRedo: boolean } {
    return {
      canUndo: this.editable && this.undoStack.length > 0,
      canRedo: this.editable && this.redoStack.length > 0,
    };
  }

  private emitHistoryChanged(): void {
    this.emit("history-changed", {
      type: "history-changed",
      ...this.historyAvailability(),
    });
  }

  private applyHistoryEntry(entry: HistoryEntry, forward: boolean): void {
    switch (entry.kind) {
      case "class-position": {
        const position = forward ? entry.after : entry.before;
        this.store.setClassPosition(entry.classId, position);
        this.renderer.syncClassPosition(entry.classId, this.store);
        if (!this.store.hasManualNotePosition(entry.classId)) {
          this.renderer.syncNotePosition(entry.classId, this.store);
        }
        this.emit("class-position-changed", {
          type: "class-position-changed",
          classId: entry.classId,
          ...position,
        });
        return;
      }
      case "note-position": {
        const position = forward ? entry.after : entry.before;
        if (forward || entry.beforeWasManual) {
          this.store.setNotePosition(entry.classId, position);
        } else {
          this.store.clearNotePosition(entry.classId);
        }
        this.renderer.syncNotePosition(entry.classId, this.store);
        this.emit("note-position-changed", {
          type: "note-position-changed",
          classId: entry.classId,
          ...this.store.getNotePosition(entry.classId),
        });
        return;
      }
      case "relationship-waypoints": {
        const waypoints = forward ? entry.after : entry.before;
        this.store.replaceWaypoints(entry.relationshipId, waypoints);
        this.renderer.syncWaypoints(entry.relationshipId, this.store);
        this.ensureValidWaypointSelection(entry.relationshipId, waypoints.length);
        this.emitWaypointTransition(entry, forward);
        return;
      }
      case "relationship-properties": {
        const changes = forward ? entry.after : entry.before;
        this.store.updateRelationship(entry.relationshipId, changes);
        this.renderer.syncRelationship(entry.relationshipId, this.store);
        this.emitRelationshipChanged(entry.relationshipId, changes);
        return;
      }
      case "layout-transaction": {
        const positions = forward ? entry.after : entry.before;
        this.store.applyClassPositions(new Map(Object.entries(positions)));
        this.renderer.syncAllPositions(this.store);
        this.emit("auto-layout-completed", {
          type: "auto-layout-completed",
          layout: this.store.getLayout(),
        });
      }
    }
  }

  private emitWaypointTransition(
    entry: RelationshipWaypointsHistoryEntry,
    forward: boolean,
  ): void {
    const before = forward ? entry.before : entry.after;
    const after = forward ? entry.after : entry.before;
    const index = entry.index ?? changedWaypointIndex(before, after);

    if (entry.operation === "add") {
      if (forward) {
        const position = after[index];
        if (position) {
          this.emit("relationship-waypoint-added", {
            type: "relationship-waypoint-added",
            relationshipId: entry.relationshipId,
            index,
            ...position,
          });
        }
      } else {
        this.emit("relationship-waypoint-removed", {
          type: "relationship-waypoint-removed",
          relationshipId: entry.relationshipId,
          index,
        });
      }
      return;
    }

    if (entry.operation === "remove") {
      if (forward) {
        this.emit("relationship-waypoint-removed", {
          type: "relationship-waypoint-removed",
          relationshipId: entry.relationshipId,
          index,
        });
      } else {
        const position = after[index];
        if (position) {
          this.emit("relationship-waypoint-added", {
            type: "relationship-waypoint-added",
            relationshipId: entry.relationshipId,
            index,
            ...position,
          });
        }
      }
      return;
    }

    if (entry.operation === "reset") {
      if (forward) {
        this.emit("relationship-route-reset", {
          type: "relationship-route-reset",
          relationshipId: entry.relationshipId,
        });
      } else {
        for (const [restoredIndex, position] of after.entries()) {
          this.emit("relationship-waypoint-added", {
            type: "relationship-waypoint-added",
            relationshipId: entry.relationshipId,
            index: restoredIndex,
            ...position,
          });
        }
      }
      return;
    }

    for (let changedIndex = 0; changedIndex < after.length; changedIndex += 1) {
      const previous = before[changedIndex];
      const position = after[changedIndex];
      if (!previous || !position || positionsEqual(previous, position)) continue;
      this.emit("relationship-waypoint-changed", {
        type: "relationship-waypoint-changed",
        relationshipId: entry.relationshipId,
        index: changedIndex,
        ...position,
      });
    }
  }

  private ensureValidWaypointSelection(
    relationshipId: string,
    waypointCount: number,
  ): void {
    if (
      this.selection?.kind === "relationship-waypoint" &&
      this.selection.relationshipId === relationshipId &&
      this.selection.index >= waypointCount
    ) {
      this.changeSelection({ kind: "relationship", id: relationshipId });
    }
  }

  private deleteSelectedWaypoint(): void {
    if (this.selection?.kind !== "relationship-waypoint") return;
    this.removeRelationshipWaypoint(
      this.selection.relationshipId,
      this.selection.index,
    );
  }

  private changeSelection(selection: DiagramSelection | null): void {
    if (selectionsEqual(this.selection, selection)) return;
    this.selection = selection;
    this.renderer.setSelection(selection);
    this.emit("selection-changed", { type: "selection-changed", selection });
  }

  private emitRelationshipChanged(
    relationshipId: string,
    changes: DiagramRelationshipChanges,
  ): void {
    const relationship = this.store.getRelationship(relationshipId);
    this.emit("relationship-changed", {
      type: "relationship-changed",
      relationshipId,
      source: normalizeRelationshipEndpoint(relationship.from),
      target: normalizeRelationshipEndpoint(relationship.to),
      changes: { ...changes },
    });
  }

  private emit<K extends DiagramEventType>(
    type: K,
    event: DiagramEventMap[K],
  ): void {
    this.events.emit(type, event);
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("Diagram has been destroyed");
  }

  private assertEditable(): void {
    this.assertAlive();
    if (!this.editable) {
      throw new Error("Diagram is read-only");
    }
  }
}

export function createDiagram(
  container: HTMLElement,
  options: CreateDiagramOptions,
): Diagram {
  return new ModelDiagram(container, options);
}
