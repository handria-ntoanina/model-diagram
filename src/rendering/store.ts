import type {
  DiagramClass,
  DiagramLayout,
  DiagramModel,
  DiagramRelationship,
  DiagramRelationshipChanges,
  Position,
} from "../model/types.js";
import { cloneRelationshipEndpoint } from "../model/relationship-endpoint.js";
import {
  validateDiagramLayout,
  validateDiagramModel,
} from "../model/validation.js";
import {
  copyPosition,
  defaultNotePosition,
  fallbackClassPosition,
} from "./geometry.js";
import type { ClassContentMode } from "./config.js";

function normalizeOptionalText(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function cloneRelationship(
  relationship: DiagramRelationship,
): DiagramRelationship {
  const cloned = { ...relationship } as DiagramRelationship & {
    description?: unknown;
  };
  delete cloned.description;
  cloned.from = cloneRelationshipEndpoint(relationship.from);
  cloned.to = cloneRelationshipEndpoint(relationship.to);
  const normalizedLabel = normalizeOptionalText(cloned.label);
  if (normalizedLabel === undefined) delete cloned.label;
  else cloned.label = normalizedLabel;
  return cloned;
}

function cloneModel(model: DiagramModel): DiagramModel {
  return {
    classes: model.classes.map((diagramClass) => {
      const cloned = {
        ...diagramClass,
        attributes: diagramClass.attributes?.map((attribute) => ({
          ...attribute,
        })),
      } as DiagramClass & { description?: unknown };
      delete cloned.description;
      return cloned;
    }),
    relationships: model.relationships.map(cloneRelationship),
  };
}

export class DiagramStore {
  private modelValue: DiagramModel;
  private readonly classPositions = new Map<string, Position>();
  private readonly notePositions = new Map<string, Position>();
  private readonly relationshipWaypoints = new Map<string, Position[]>();

  constructor(model: DiagramModel, layout: DiagramLayout = {}) {
    validateDiagramModel(model);
    validateDiagramLayout(layout, model);
    this.modelValue = cloneModel(model);
    this.initialize(model, layout);
  }

  get model(): DiagramModel {
    return cloneModel(this.modelValue);
  }

  setModel(model: DiagramModel): void {
    validateDiagramModel(model);
    const nextClassIds = new Set(model.classes.map(({ id }) => id));
    const nextRelationshipIds = new Set(
      model.relationships.map(({ id }) => id),
    );

    for (const id of this.classPositions.keys()) {
      if (!nextClassIds.has(id)) this.classPositions.delete(id);
    }
    for (const id of this.notePositions.keys()) {
      const diagramClass = model.classes.find((item) => item.id === id);
      if (!diagramClass?.note) this.notePositions.delete(id);
    }
    for (const id of this.relationshipWaypoints.keys()) {
      if (!nextRelationshipIds.has(id)) this.relationshipWaypoints.delete(id);
    }

    for (const [index, diagramClass] of model.classes.entries()) {
      if (!this.classPositions.has(diagramClass.id)) {
        this.classPositions.set(diagramClass.id, fallbackClassPosition(index));
      }
    }
    for (const relationship of model.relationships) {
      if (!this.relationshipWaypoints.has(relationship.id)) {
        this.relationshipWaypoints.set(relationship.id, []);
      }
    }
    this.modelValue = cloneModel(model);
  }

  setLayout(layout: DiagramLayout): void {
    validateDiagramLayout(layout, this.modelValue);

    for (const [id, position] of Object.entries(layout.classes ?? {})) {
      this.classPositions.set(id, copyPosition(position));
    }

    this.notePositions.clear();
    for (const [id, position] of Object.entries(layout.notes ?? {})) {
      this.notePositions.set(id, copyPosition(position));
    }

    this.relationshipWaypoints.clear();
    for (const relationship of this.modelValue.relationships) {
      const waypoints = layout.relationships?.[relationship.id]?.waypoints ?? [];
      this.relationshipWaypoints.set(
        relationship.id,
        waypoints.map(copyPosition),
      );
    }
  }

  getClass(id: string): DiagramClass {
    const diagramClass = this.modelValue.classes.find((item) => item.id === id);
    if (!diagramClass) throw new Error(`Unknown class "${id}"`);
    return diagramClass;
  }

  getRelationship(id: string): DiagramRelationship {
    const relationship = this.modelValue.relationships.find(
      (item) => item.id === id,
    );
    if (!relationship) throw new Error(`Unknown relationship "${id}"`);
    return cloneRelationship(relationship);
  }

  updateRelationship(
    id: string,
    changes: DiagramRelationshipChanges,
  ): void {
    const index = this.modelValue.relationships.findIndex(
      (relationship) => relationship.id === id,
    );
    const relationship = this.modelValue.relationships[index];
    if (!relationship) throw new Error(`Unknown relationship "${id}"`);

    const next = { ...relationship };
    if (Object.hasOwn(changes, "label")) {
      const label = normalizeOptionalText(changes.label);
      if (label === undefined) delete next.label;
      else next.label = label;
    }
    if (Object.hasOwn(changes, "routing")) {
      if (
        changes.routing !== undefined &&
        changes.routing !== "auto" &&
        changes.routing !== "straight"
      ) {
        throw new TypeError(
          `Unsupported relationship routing "${String(changes.routing)}"`,
        );
      }
      if (changes.routing === undefined) delete next.routing;
      else next.routing = changes.routing;
    }
    this.modelValue.relationships[index] = next;
  }

  getClassPosition(id: string): Position {
    const position = this.classPositions.get(id);
    if (!position) throw new Error(`Unknown class "${id}"`);
    return copyPosition(position);
  }

  setClassPosition(id: string, position: Position): void {
    this.getClass(id);
    this.classPositions.set(id, copyPosition(position));
  }

  getNotePosition(
    classId: string,
    classContentMode: ClassContentMode = "full",
  ): Position {
    const manualPosition = this.notePositions.get(classId);
    if (manualPosition) return copyPosition(manualPosition);
    const diagramClass = this.getClass(classId);
    return defaultNotePosition(
      this.getClassPosition(classId),
      diagramClass,
      classContentMode,
    );
  }

  hasManualNotePosition(classId: string): boolean {
    return this.notePositions.has(classId);
  }

  setNotePosition(classId: string, position: Position): void {
    const diagramClass = this.getClass(classId);
    if (!diagramClass.note) {
      throw new Error(`Class "${classId}" does not have a note`);
    }
    this.notePositions.set(classId, copyPosition(position));
  }

  clearNotePosition(classId: string): void {
    const diagramClass = this.getClass(classId);
    if (!diagramClass.note) {
      throw new Error(`Class "${classId}" does not have a note`);
    }
    this.notePositions.delete(classId);
  }

  getWaypoints(relationshipId: string): Position[] {
    const waypoints = this.relationshipWaypoints.get(relationshipId);
    if (!waypoints) throw new Error(`Unknown relationship "${relationshipId}"`);
    return waypoints.map(copyPosition);
  }

  replaceWaypoints(relationshipId: string, waypoints: Position[]): void {
    this.getWaypoints(relationshipId);
    this.relationshipWaypoints.set(relationshipId, waypoints.map(copyPosition));
  }

  addWaypoint(
    relationshipId: string,
    position: Position,
    index = this.getWaypoints(relationshipId).length,
  ): number {
    const waypoints = this.getWaypoints(relationshipId);
    if (!Number.isInteger(index) || index < 0 || index > waypoints.length) {
      throw new RangeError(`Waypoint index ${index} is out of range`);
    }
    waypoints.splice(index, 0, copyPosition(position));
    this.relationshipWaypoints.set(relationshipId, waypoints);
    return index;
  }

  moveWaypoint(
    relationshipId: string,
    index: number,
    position: Position,
  ): void {
    const waypoints = this.getWaypoints(relationshipId);
    if (!waypoints[index]) {
      throw new RangeError(`Waypoint index ${index} is out of range`);
    }
    waypoints[index] = copyPosition(position);
    this.relationshipWaypoints.set(relationshipId, waypoints);
  }

  removeWaypoint(relationshipId: string, index: number): void {
    const waypoints = this.getWaypoints(relationshipId);
    if (!waypoints[index]) {
      throw new RangeError(`Waypoint index ${index} is out of range`);
    }
    waypoints.splice(index, 1);
    this.relationshipWaypoints.set(relationshipId, waypoints);
  }

  resetRoute(relationshipId: string): void {
    this.getWaypoints(relationshipId);
    this.relationshipWaypoints.set(relationshipId, []);
  }

  applyClassPositions(positions: ReadonlyMap<string, Position>): void {
    for (const [id, position] of positions) {
      if (this.classPositions.has(id)) {
        this.classPositions.set(id, copyPosition(position));
      }
    }
  }

  getLayout(): DiagramLayout {
    const classes = Object.fromEntries(
      [...this.classPositions].map(([id, position]) => [
        id,
        copyPosition(position),
      ]),
    );
    const notes = Object.fromEntries(
      [...this.notePositions].map(([id, position]) => [
        id,
        copyPosition(position),
      ]),
    );
    const relationships = Object.fromEntries(
      [...this.relationshipWaypoints]
        .filter(([, waypoints]) => waypoints.length > 0)
        .map(([id, waypoints]) => [
          id,
          { waypoints: waypoints.map(copyPosition) },
        ]),
    );

    return {
      classes,
      ...(Object.keys(notes).length > 0 ? { notes } : {}),
      ...(Object.keys(relationships).length > 0 ? { relationships } : {}),
    };
  }

  private initialize(model: DiagramModel, layout: DiagramLayout): void {
    for (const [index, diagramClass] of model.classes.entries()) {
      this.classPositions.set(
        diagramClass.id,
        copyPosition(
          layout.classes?.[diagramClass.id] ?? fallbackClassPosition(index),
        ),
      );
      const notePosition = layout.notes?.[diagramClass.id];
      if (notePosition) {
        this.notePositions.set(diagramClass.id, copyPosition(notePosition));
      }
    }
    for (const relationship of model.relationships) {
      const waypoints = layout.relationships?.[relationship.id]?.waypoints ?? [];
      this.relationshipWaypoints.set(
        relationship.id,
        waypoints.map(copyPosition),
      );
    }
  }
}
