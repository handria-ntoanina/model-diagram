import * as joint from "@joint/core";
import type { DiagramSelection } from "../events/types.js";
import { normalizeRelationshipEndpoint } from "../model/relationship-endpoint.js";
import type {
  DiagramRelationship,
  Position,
  RelationshipEndpoint,
  RelationshipRouting,
} from "../model/types.js";
import { getRelationshipAppearance } from "../routing/relationship-style.js";
import {
  CLASS_HEADER_HEIGHT,
  ATTRIBUTE_LINE_HEIGHT,
  NOTE_HEIGHT,
  NOTE_WIDTH,
  attributeRowCenter,
  attributeRowTop,
  clientToDiagramPosition,
  classSize,
  positionsEqual,
} from "../rendering/geometry.js";
import type { DiagramStore } from "../rendering/store.js";

type MovableKind = "class" | "note";

export interface JointJsAdapterCallbacks {
  onSelectionChanged(selection: DiagramSelection | null): void;
  onPositionDragStarted(kind: MovableKind, id: string): void;
  onPositionPreview(kind: MovableKind, id: string, position: Position): void;
  onPositionCommitted(
    kind: MovableKind,
    id: string,
    before: Position,
    after: Position,
  ): void;
  onWaypointsPreview(relationshipId: string, waypoints: Position[]): void;
  onWaypointsCommitted(
    relationshipId: string,
    before: Position[],
    after: Position[],
  ): void;
  onWaypointAddRequested(
    relationshipId: string,
    position: Position,
    index: number,
  ): void;
  onDeleteSelectedWaypoint(): void;
}

interface SemanticMetadata {
  kind:
    | "class"
    | "note"
    | "relationship"
    | "note-connector"
    | "association-class-connector";
  id: string;
}

interface DragState {
  cell: joint.dia.Element;
  kind: MovableKind;
  id: string;
  start: Position;
}

interface PanState {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

interface WaypointDragState {
  pointerId: number;
  relationshipId: string;
  index: number;
  before: Position[];
}

const INTERNAL = { modelDiagramInternal: true };
const LINE_COLOR = "#334155";
const SELECTED_COLOR = "#2563eb";
const WAYPOINT_HIT_RADIUS = 14;
const FOCUS_PADDING = 48;
const MIN_READABLE_SCALE = 0.75;
const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const NO_MARKER = {
  type: "path",
  d: "M 0 0",
  fill: "none",
  stroke: "none",
};

type WaypointHandleView = joint.linkTools.Vertices.VertexHandle & {
  el: SVGGElement;
  options: { index: number };
};

function relationshipEndpointAnchor(
  endView: joint.dia.CellView,
  _magnet: SVGElement,
  _reference: joint.g.Point | SVGElement,
  _options: Record<string, unknown>,
  endType: joint.dia.LinkEnd,
  linkView: joint.dia.LinkView,
): joint.g.Point {
  const endpoint = linkView.model.get(endType) as {
    modelDiagramAttributeIndex?: unknown;
  };
  const attributeIndex = endpoint.modelDiagramAttributeIndex;
  const bounds = endView.model.getBBox();
  if (typeof attributeIndex !== "number" || !Number.isInteger(attributeIndex)) {
    return bounds.center();
  }

  const opposite =
    endType === "source"
      ? linkView.model.getTargetCell()
      : linkView.model.getSourceCell();
  const center = bounds.center();
  const pointReference = _reference as { x?: unknown; y?: unknown };
  const referenceX =
    typeof pointReference.x === "number" &&
    typeof pointReference.y === "number"
      ? pointReference.x
      : opposite instanceof joint.dia.Element
        ? opposite.getBBox().center().x
        : center.x;
  const useLeft =
    opposite === endView.model
      ? endType === "source"
      : referenceX < center.x;
  return new joint.g.Point(
    useLeft ? bounds.x : bounds.x + bounds.width,
    bounds.y + attributeRowCenter(attributeIndex),
  );
}

// JointJS's stock vertex handle is a 12 px circle. Keep that visual size while
// giving pointer input a forgiving, transparent 28 px target. Pointer movement
// is handled by the adapter below so mouse, pen, and touch use one code path.
const WaypointHandle = joint.linkTools.Vertices.VertexHandle.extend({
  tagName: "g",
  events: {},
  documentEvents: {},
  attributes: { cursor: "move" },
  render(this: WaypointHandleView): WaypointHandleView {
    const hitTarget = this.el.ownerDocument.createElementNS(
      SVG_NAMESPACE,
      "circle",
    );
    hitTarget.classList.add("model-diagram-waypoint-hit");
    hitTarget.setAttribute("r", String(WAYPOINT_HIT_RADIUS));
    hitTarget.setAttribute("fill", "transparent");
    hitTarget.setAttribute("stroke", "transparent");
    hitTarget.setAttribute("pointer-events", "all");

    const marker = this.el.ownerDocument.createElementNS(
      SVG_NAMESPACE,
      "circle",
    );
    marker.classList.add("model-diagram-waypoint-marker");
    marker.setAttribute("r", "6");
    marker.setAttribute("fill", "#33334f");
    marker.setAttribute("stroke", "#ffffff");
    marker.setAttribute("stroke-width", "2");
    marker.setAttribute("pointer-events", "none");

    this.el.setAttribute("data-waypoint-index", String(this.options.index));
    this.el.replaceChildren(hitTarget, marker);
    return this;
  },
}) as typeof joint.linkTools.Vertices.VertexHandle;

function positionFromElement(element: joint.dia.Element): Position {
  const position = element.position();
  const size = element.size();
  return { x: position.x + size.width / 2, y: position.y + size.height / 2 };
}

function metadata(cell: joint.dia.Cell): SemanticMetadata | undefined {
  const kind = cell.get("semanticKind") as SemanticMetadata["kind"] | undefined;
  const id = cell.get("semanticId") as string | undefined;
  return kind && id ? { kind, id } : undefined;
}

function formatAttributes(
  attributes: ReturnType<DiagramStore["getClass"]>["attributes"],
): string {
  if (!attributes || attributes.length === 0) return "(no attributes)";
  return attributes
    .map((attribute) => {
      const indicator = attribute.required ? "●" : "○";
      const type = attribute.type ? `: ${attribute.type}` : "";
      const multiplicity = attribute.multiplicity
        ? ` [${attribute.multiplicity}]`
        : "";
      return `${indicator} ${attribute.name}${type}${multiplicity}`;
    })
    .join("\n");
}

function classMarkup(): joint.dia.MarkupJSON {
  return [
    { tagName: "rect", selector: "body" },
    { tagName: "rect", selector: "header" },
    { tagName: "text", selector: "stereotype" },
    { tagName: "text", selector: "className" },
    { tagName: "text", selector: "attributes" },
  ];
}

function noteMarkup(): joint.dia.MarkupJSON {
  return [
    { tagName: "path", selector: "body" },
    { tagName: "path", selector: "fold" },
    { tagName: "text", selector: "note" },
  ];
}

function closestSegmentIndex(
  point: Position,
  points: Position[],
): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.y - start.y) * dy) /
                lengthSquared,
            ),
          );
    const projection = { x: start.x + ratio * dx, y: start.y + ratio * dy };
    const distance = Math.hypot(point.x - projection.x, point.y - projection.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export class JointJsAdapter {
  private readonly graph = new joint.dia.Graph();
  private readonly surface: HTMLDivElement;
  private readonly paper: joint.dia.Paper;
  private readonly classCells = new Map<string, joint.dia.Element>();
  private readonly noteCells = new Map<string, joint.dia.Element>();
  private readonly relationshipCells = new Map<string, joint.dia.Link>();
  private readonly noteConnectorCells = new Map<string, joint.dia.Link>();
  private readonly associationClassConnectorCells = new Map<
    string,
    joint.dia.Link
  >();
  private readonly nativeListeners: Array<() => void> = [];
  private readonly originalContainerStyle: {
    position: string;
    overflow: string;
    touchAction: string;
  };
  private readonly hadContainerClass: boolean;
  private readonly resizeObserver?: ResizeObserver;
  private dragState?: DragState;
  private panState?: PanState;
  private waypointDragState?: WaypointDragState;
  private selection: DiagramSelection | null = null;
  private editable: boolean;
  private scaleValue = 1;
  private translation = { x: 0, y: 0 };
  private destroyed = false;

  constructor(
    private readonly container: HTMLElement,
    editable: boolean,
    private readonly callbacks: JointJsAdapterCallbacks,
  ) {
    this.editable = editable;
    this.originalContainerStyle = {
      position: container.style.position,
      overflow: container.style.overflow,
      touchAction: container.style.touchAction,
    };
    this.hadContainerClass = container.classList.contains("model-diagram");
    this.prepareContainer();
    this.surface = document.createElement("div");
    this.surface.classList.add("model-diagram-surface");
    container.append(this.surface);
    this.paper = new joint.dia.Paper({
      el: this.surface,
      model: this.graph,
      width: Math.max(container.clientWidth, 1),
      height: Math.max(container.clientHeight, 1),
      gridSize: 10,
      drawGrid: { name: "mesh", args: { color: "#e2e8f0", thickness: 1 } },
      background: { color: "#f8fafc" },
      async: false,
      sorting: joint.dia.Paper.sorting.APPROX,
      interactive: (cellView) => {
        const info = metadata(cellView.model);
        return Boolean(
          this.editable && (info?.kind === "class" || info?.kind === "note"),
        );
      },
      defaultConnectionPoint: { name: "boundary", args: { offset: 2 } },
      defaultAnchor: relationshipEndpointAnchor,
    });
    // Paper.render() sets its element to position: relative. The paper element
    // is library-owned and must not participate in sizing the consumer host.
    this.surface.style.position = "absolute";
    this.surface.style.left = "0";
    this.surface.style.top = "0";
    this.bindJointEvents();
    this.bindNativeEvents();

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
  }

  render(store: DiagramStore): void {
    this.assertAlive();
    const model = store.model;
    const classIds = new Set(model.classes.map(({ id }) => id));
    const relationshipIds = new Set(model.relationships.map(({ id }) => id));
    const associationClassRelationshipIds = new Set(
      model.relationships
        .filter(({ associationClass }) => associationClass !== undefined)
        .map(({ id }) => id),
    );
    const noteIds = new Set(
      model.classes.filter(({ note }) => note).map(({ id }) => id),
    );

    this.removeMissing(
      this.associationClassConnectorCells,
      associationClassRelationshipIds,
    );
    this.removeMissing(this.noteConnectorCells, noteIds);
    this.removeMissing(this.relationshipCells, relationshipIds);
    this.removeMissing(this.noteCells, noteIds);
    this.removeMissing(this.classCells, classIds);

    for (const diagramClass of model.classes) {
      let cell = this.classCells.get(diagramClass.id);
      if (!cell) {
        cell = this.createClassCell(diagramClass.id);
        this.classCells.set(diagramClass.id, cell);
        this.graph.addCell(cell, INTERNAL);
      }
      const size = classSize(diagramClass);
      cell.resize(size.width, size.height, INTERNAL);
      cell.position(
        store.getClassPosition(diagramClass.id).x - size.width / 2,
        store.getClassPosition(diagramClass.id).y - size.height / 2,
        INTERNAL,
      );
      cell.attr(
        {
          body: { width: size.width, height: size.height },
          header: { width: size.width, height: CLASS_HEADER_HEIGHT },
          stereotype: {
            text: diagramClass.stereotype ? `«${diagramClass.stereotype}»` : "",
            x: size.width / 2,
            y: 18,
          },
          className: {
            text: diagramClass.name,
            x: size.width / 2,
            y: diagramClass.stereotype ? 41 : 31,
          },
          attributes: {
            text: formatAttributes(diagramClass.attributes),
            x: 14,
            y: CLASS_HEADER_HEIGHT + 18,
          },
        },
        INTERNAL,
      );

      if (diagramClass.note) {
        this.upsertNote(diagramClass.id, diagramClass.note, store);
      }
    }

    for (const relationship of model.relationships) {
      this.upsertRelationship(relationship, store);
    }
    for (const relationship of model.relationships) {
      if (relationship.associationClass) {
        this.upsertAssociationClassConnector(relationship);
      }
    }

    this.applySelectionAppearance();
  }

  syncAllPositions(store: DiagramStore): void {
    for (const diagramClass of store.model.classes) {
      this.syncClassPosition(diagramClass.id, store);
      if (diagramClass.note) this.syncNotePosition(diagramClass.id, store);
    }
    for (const relationship of store.model.relationships) {
      this.syncWaypoints(relationship.id, store);
    }
  }

  syncClassPosition(classId: string, store: DiagramStore): void {
    const cell = this.classCells.get(classId);
    if (!cell) return;
    const position = store.getClassPosition(classId);
    const size = cell.size();
    cell.position(position.x - size.width / 2, position.y - size.height / 2, INTERNAL);
  }

  syncNotePosition(classId: string, store: DiagramStore): void {
    const cell = this.noteCells.get(classId);
    if (!cell) return;
    const position = store.getNotePosition(classId);
    cell.position(
      position.x - NOTE_WIDTH / 2,
      position.y - NOTE_HEIGHT / 2,
      INTERNAL,
    );
  }

  syncWaypoints(relationshipId: string, store: DiagramStore): void {
    const link = this.relationshipCells.get(relationshipId);
    if (!link) return;
    const waypoints = store.getWaypoints(relationshipId);
    link.vertices(waypoints, INTERNAL);
    this.applyRouter(
      link,
      store.getRelationship(relationshipId).routing ?? "auto",
      waypoints.length > 0,
    );
  }

  syncRelationship(relationshipId: string, store: DiagramStore): void {
    this.upsertRelationship(store.getRelationship(relationshipId), store);
    this.applySelectionAppearance();
  }

  setEditable(editable: boolean): void {
    this.editable = editable;
    this.paper.setInteractivity((cellView: joint.dia.CellView) => {
      const info = metadata(cellView.model);
      return Boolean(
        this.editable && (info?.kind === "class" || info?.kind === "note"),
      );
    });
    if (!editable) this.removeTools();
    else this.showRelationshipTools();
  }

  setSelection(selection: DiagramSelection | null): void {
    const previousRelationshipId = this.selectedRelationshipId();
    this.selection = selection;
    this.applySelectionAppearance();
    if (previousRelationshipId !== this.selectedRelationshipId()) {
      this.showRelationshipTools();
    }
  }

  focusClass(classId: string, attributeIndex?: number): boolean {
    this.assertAlive();
    const cell = this.classCells.get(classId);
    if (!cell) return false;

    const classBounds = cell.getBBox();
    const attributeBounds =
      attributeIndex === undefined
        ? undefined
        : new joint.g.Rect(
            classBounds.x,
            classBounds.y + attributeRowTop(attributeIndex),
            classBounds.width,
            ATTRIBUTE_LINE_HEIGHT,
          );
    const classReadableScale = this.scaleToFit(classBounds);
    const focusBounds =
      attributeBounds && classReadableScale < MIN_READABLE_SCALE
        ? attributeBounds
        : classBounds;

    if (
      this.scaleValue >= MIN_READABLE_SCALE &&
      this.isComfortablyVisible(focusBounds, this.scaleValue)
    ) {
      return true;
    }

    const fittingScale = this.scaleToFit(focusBounds);
    let nextScale = this.scaleValue;
    if (nextScale > fittingScale) nextScale = fittingScale;
    if (nextScale < MIN_READABLE_SCALE) {
      nextScale = Math.min(MIN_READABLE_SCALE, fittingScale);
    }
    nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));

    this.scaleValue = nextScale;
    this.translation = {
      x:
        this.container.clientWidth / 2 -
        (focusBounds.x + focusBounds.width / 2) * nextScale,
      y:
        this.container.clientHeight / 2 -
        (focusBounds.y + focusBounds.height / 2) * nextScale,
    };
    this.applyTransform();
    this.showRelationshipTools();
    return true;
  }

  fitToContent(padding = 48): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    const bbox = this.paper.getContentBBox();
    if (bbox.width === 0 || bbox.height === 0) return;
    const scale = Math.max(
      0.1,
      Math.min(2, (width - padding * 2) / bbox.width, (height - padding * 2) / bbox.height),
    );
    this.scaleValue = scale;
    this.translation = {
      x: (width - bbox.width * scale) / 2 - bbox.x * scale,
      y: (height - bbox.height * scale) / 2 - bbox.y * scale,
    };
    this.applyTransform();
    this.showRelationshipTools();
  }

  setZoom(scale: number, center?: Position): void {
    const nextScale = Math.max(0.1, Math.min(4, scale));
    const viewportCenter = center ?? {
      x: this.container.clientWidth / 2,
      y: this.container.clientHeight / 2,
    };
    const local = {
      x: (viewportCenter.x - this.translation.x) / this.scaleValue,
      y: (viewportCenter.y - this.translation.y) / this.scaleValue,
    };
    this.scaleValue = nextScale;
    this.translation = {
      x: viewportCenter.x - local.x * nextScale,
      y: viewportCenter.y - local.y * nextScale,
    };
    this.applyTransform();
    this.showRelationshipTools();
  }

  getZoom(): number {
    return this.scaleValue;
  }

  panBy(dx: number, dy: number): void {
    this.translation.x += dx;
    this.translation.y += dy;
    this.applyTransform();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    for (const removeListener of this.nativeListeners.splice(0)) removeListener();
    this.paper.remove();
    this.surface.remove();
    this.graph.clear({ silent: true });
    this.classCells.clear();
    this.noteCells.clear();
    this.relationshipCells.clear();
    this.noteConnectorCells.clear();
    this.associationClassConnectorCells.clear();
    this.container.style.position = this.originalContainerStyle.position;
    this.container.style.overflow = this.originalContainerStyle.overflow;
    this.container.style.touchAction = this.originalContainerStyle.touchAction;
    if (!this.hadContainerClass) {
      this.container.classList.remove("model-diagram");
    }
  }

  private prepareContainer(): void {
    if (getComputedStyle(this.container).position === "static") {
      this.container.style.position = "relative";
    }
    this.container.style.overflow = "hidden";
    this.container.style.touchAction = "none";
    this.container.classList.add("model-diagram");
  }

  private createClassCell(id: string): joint.dia.Element {
    const cell = new joint.dia.Element();
    cell.set({
      type: "model-diagram.Class",
      semanticKind: "class",
      semanticId: id,
      z: 20,
      markup: classMarkup(),
      attrs: {
        body: {
          rx: 7,
          ry: 7,
          fill: "#ffffff",
          stroke: LINE_COLOR,
          strokeWidth: 1.5,
        },
        header: {
          rx: 7,
          ry: 7,
          fill: "#e2e8f0",
          stroke: LINE_COLOR,
          strokeWidth: 1.5,
        },
        stereotype: {
          textAnchor: "middle",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 12,
          fill: "#475569",
        },
        className: {
          textAnchor: "middle",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 15,
          fontWeight: 700,
          fill: "#0f172a",
        },
        attributes: {
          textAnchor: "start",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          lineHeight: "1.9em",
          fill: "#1e293b",
        },
      },
    });
    return cell;
  }

  private upsertNote(
    classId: string,
    text: string,
    store: DiagramStore,
  ): void {
    let note = this.noteCells.get(classId);
    if (!note) {
      const createdNote = new joint.dia.Element();
      createdNote.set({
        type: "model-diagram.Note",
        semanticKind: "note",
        semanticId: classId,
        z: 20,
        markup: noteMarkup(),
        attrs: {
          body: {
            d: `M 0 0 H ${NOTE_WIDTH - 20} L ${NOTE_WIDTH} 20 V ${NOTE_HEIGHT} H 0 Z`,
            fill: "#fef3c7",
            stroke: "#b45309",
            strokeWidth: 1.25,
          },
          fold: {
            d: `M ${NOTE_WIDTH - 20} 0 V 20 H ${NOTE_WIDTH}`,
            fill: "none",
            stroke: "#b45309",
            strokeWidth: 1.25,
          },
          note: {
            x: 12,
            y: 16,
            width: NOTE_WIDTH - 28,
            height: NOTE_HEIGHT - 28,
            textAnchor: "start",
            textVerticalAnchor: "top",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 12,
            lineHeight: "1.35em",
            fill: "#78350f",
            textWrap: { width: NOTE_WIDTH - 28, height: NOTE_HEIGHT - 28 },
          },
        },
      });
      createdNote.resize(NOTE_WIDTH, NOTE_HEIGHT, INTERNAL);
      this.noteCells.set(classId, createdNote);
      this.graph.addCell(createdNote, INTERNAL);
      note = createdNote;
    }
    note.attr("note/text", text, INTERNAL);
    this.syncNotePosition(classId, store);

    let connector = this.noteConnectorCells.get(classId);
    if (!connector) {
      connector = new joint.shapes.standard.Link({
        type: "model-diagram.NoteConnector",
        semanticKind: "note-connector",
        semanticId: classId,
        z: 5,
        attrs: {
          line: {
            stroke: "#b45309",
            strokeWidth: 1,
            strokeDasharray: "4 4",
            sourceMarker: NO_MARKER,
            targetMarker: NO_MARKER,
          },
        },
      });
      this.noteConnectorCells.set(classId, connector);
      this.graph.addCell(connector, INTERNAL);
    }
    const classCell = this.classCells.get(classId);
    if (classCell) {
      connector.source(classCell, INTERNAL);
      connector.target(note, INTERNAL);
      connector.router("normal", {}, INTERNAL);
      connector.connector("straight", {}, INTERNAL);
    }
  }

  private upsertRelationship(
    relationship: DiagramRelationship,
    store: DiagramStore,
  ): void {
    let link = this.relationshipCells.get(relationship.id);
    if (!link) {
      link = new joint.shapes.standard.Link({
        type: "model-diagram.Relationship",
        semanticKind: "relationship",
        semanticId: relationship.id,
        z: 10,
      });
      this.relationshipCells.set(relationship.id, link);
      this.graph.addCell(link, INTERNAL);
    }
    const sourceEndpoint = normalizeRelationshipEndpoint(relationship.from);
    const targetEndpoint = normalizeRelationshipEndpoint(relationship.to);
    const source = this.classCells.get(sourceEndpoint.classId);
    const target = this.classCells.get(targetEndpoint.classId);
    if (!source || !target) return;
    this.setRelationshipEnd(link, "source", source, sourceEndpoint, store);
    this.setRelationshipEnd(link, "target", target, targetEndpoint, store);
    link.set(
      "relationshipRouting",
      relationship.routing ?? "auto",
      INTERNAL,
    );

    const appearance = getRelationshipAppearance(relationship.type);
    link.attr(
      "line",
      {
        stroke: LINE_COLOR,
        strokeWidth: 1.6,
        strokeDasharray: appearance.strokeDasharray ?? "none",
        sourceMarker: appearance.sourceMarker ?? NO_MARKER,
        targetMarker: appearance.targetMarker ?? NO_MARKER,
      },
      INTERNAL,
    );
    const labels: joint.dia.Link.Label[] = [];
    if (relationship.label?.trim()) {
      labels.push(this.makeRelationshipLabel(relationship.label));
    }
    if (relationship.role) {
      labels.push(this.makeRoleLabel(relationship.role));
    }
    if (relationship.fromMultiplicity) {
      labels.push(
        this.makeMultiplicityLabel(relationship.fromMultiplicity, 0.12),
      );
    }
    if (relationship.toMultiplicity) {
      labels.push(
        this.makeMultiplicityLabel(relationship.toMultiplicity, 0.88),
      );
    }
    link.labels(labels, INTERNAL);
    this.syncWaypoints(relationship.id, store);
  }

  private upsertAssociationClassConnector(
    relationship: DiagramRelationship,
  ): void {
    if (!relationship.associationClass) return;
    const associationClass = this.classCells.get(relationship.associationClass);
    const association = this.relationshipCells.get(relationship.id);
    if (!associationClass || !association) return;

    let connector = this.associationClassConnectorCells.get(relationship.id);
    if (!connector) {
      connector = new joint.shapes.standard.Link({
        type: "model-diagram.AssociationClassConnector",
        semanticKind: "association-class-connector",
        semanticId: relationship.id,
        z: 6,
        attrs: {
          line: {
            class: "model-diagram-association-class-connector",
            stroke: "#64748b",
            strokeWidth: 1.25,
            strokeDasharray: "5 4",
            sourceMarker: NO_MARKER,
            targetMarker: NO_MARKER,
          },
        },
      });
      this.associationClassConnectorCells.set(relationship.id, connector);
      this.graph.addCell(connector, INTERNAL);
    }
    connector.source(associationClass, INTERNAL);
    connector.target(
      association,
      { anchor: { name: "connectionRatio", args: { ratio: 0.5 } } },
      INTERNAL,
    );
    connector.router("normal", {}, INTERNAL);
    connector.connector("straight", {}, INTERNAL);
  }

  private makeRelationshipLabel(text: string): joint.dia.Link.Label {
    return {
      markup: [
        {
          tagName: "text",
          selector: "text",
          className: "model-diagram-relationship-label",
        },
      ],
      position: { distance: 0.5, offset: 14, args: { keepGradient: false } },
      attrs: {
        text: {
          text,
          fill: "#0f172a",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 12,
          fontWeight: 600,
          textAnchor: "middle",
          textVerticalAnchor: "middle",
          pointerEvents: "none",
        },
      },
    };
  }

  private makeRoleLabel(text: string): joint.dia.Link.Label {
    return {
      position: { distance: 0.5, offset: -13, args: { keepGradient: false } },
      attrs: {
        rect: {
          fill: "#f8fafc",
          stroke: "#cbd5e1",
          strokeWidth: 0.75,
          rx: 3,
          ry: 3,
          ref: "text",
          refWidth: "120%",
          refHeight: "140%",
          refX: "-10%",
          refY: "-20%",
        },
        text: {
          text,
          fill: "#334155",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          textAnchor: "middle",
          textVerticalAnchor: "middle",
        },
      },
    };
  }

  private makeMultiplicityLabel(
    text: string,
    distance: number,
  ): joint.dia.Link.Label {
    return {
      markup: [
        {
          tagName: "text",
          selector: "text",
          className: "model-diagram-multiplicity-label",
        },
      ],
      position: { distance, offset: 13, args: { keepGradient: false } },
      attrs: {
        text: {
          text,
          fill: "#334155",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 11,
          fontWeight: 500,
          textAnchor: "middle",
          textVerticalAnchor: "middle",
          pointerEvents: "none",
        },
      },
    };
  }

  private setRelationshipEnd(
    link: joint.dia.Link,
    end: "source" | "target",
    cell: joint.dia.Element,
    endpoint: RelationshipEndpoint,
    store: DiagramStore,
  ): void {
    const attributeIndex =
      endpoint.type === "attribute"
        ? store
            .getClass(endpoint.classId)
            .attributes?.findIndex(
              (attribute) => attribute.name === endpoint.attributeId,
            )
        : undefined;
    if (attributeIndex === undefined || attributeIndex < 0) {
      link.set(end, { id: cell.id }, INTERNAL);
      return;
    }
    link.set(
      end,
      {
        id: cell.id,
        connectionPoint: { name: "anchor" },
        modelDiagramAttributeIndex: attributeIndex,
      },
      INTERNAL,
    );
  }

  private applyRouter(
    link: joint.dia.Link,
    routing: RelationshipRouting,
    hasWaypoints: boolean,
  ): void {
    if (routing === "straight") {
      link.router("normal", {}, INTERNAL);
      link.connector("straight", {}, INTERNAL);
      return;
    }
    if (hasWaypoints) {
      link.router("normal", {}, INTERNAL);
      link.connector("rounded", { radius: 10 }, INTERNAL);
    } else {
      link.router("manhattan", { padding: 28, step: 10 }, INTERNAL);
      link.connector("rounded", { radius: 10 }, INTERNAL);
    }
  }

  private bindJointEvents(): void {
    this.paper.on(
      "element:pointerdown",
      (view: joint.dia.ElementView, event: joint.dia.Event) => {
        const info = metadata(view.model);
        if (!info || (info.kind !== "class" && info.kind !== "note")) return;
        this.select({ kind: info.kind, id: info.id });
        if (!this.editable || event.button !== 0) return;
        this.callbacks.onPositionDragStarted(info.kind, info.id);
        this.dragState = {
          cell: view.model,
          kind: info.kind,
          id: info.id,
          start: positionFromElement(view.model),
        };
      },
    );
    this.paper.on(
      "element:pointerup",
      (view: joint.dia.ElementView) => {
        if (!this.dragState || this.dragState.cell !== view.model) return;
        const completed = this.dragState;
        this.dragState = undefined;
        const position = positionFromElement(completed.cell);
        if (!positionsEqual(completed.start, position)) {
          this.callbacks.onPositionCommitted(
            completed.kind,
            completed.id,
            completed.start,
            position,
          );
        }
      },
    );
    this.paper.on("link:pointerclick", (view: joint.dia.LinkView) => {
      const info = metadata(view.model);
      if (
        info?.kind === "relationship" ||
        info?.kind === "association-class-connector"
      ) {
        this.select({ kind: "relationship", id: info.id });
      }
    });
    this.paper.on("blank:pointerclick", () => this.select(null));
    this.paper.on(
      "blank:pointerdown",
      (event: joint.dia.Event) => {
        if (event.button !== 0) return;
        this.panState = {
          x: event.clientX ?? 0,
          y: event.clientY ?? 0,
          tx: this.translation.x,
          ty: this.translation.y,
        };
      },
    );
    this.graph.on(
      "change:position",
      (cell: joint.dia.Element, _position: Position, options: Record<string, unknown>) => {
        if (options.modelDiagramInternal) return;
        const info = metadata(cell);
        if (!info || (info.kind !== "class" && info.kind !== "note")) return;
        this.callbacks.onPositionPreview(info.kind, info.id, positionFromElement(cell));
      },
    );
    this.graph.on(
      "change:vertices",
      (
        link: joint.dia.Link,
        vertices: joint.dia.Point[],
        options: Record<string, unknown>,
      ) => {
        if (options.modelDiagramInternal) return;
        const info = metadata(link);
        if (info?.kind !== "relationship") return;
        this.callbacks.onWaypointsPreview(
          info.id,
          vertices.map(({ x, y }) => ({ x, y })),
        );
      },
    );
  }

  private bindNativeEvents(): void {
    const onPointerDown = (event: PointerEvent): void => {
      if (!this.editable) return;
      if (event.button !== 0) return;
      const waypoint = this.waypointFromTarget(event.target);
      if (!waypoint) return;
      const link = this.relationshipCells.get(waypoint.relationshipId);
      if (!link) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      this.panState = undefined;
      this.waypointDragState = {
        pointerId: event.pointerId,
        relationshipId: waypoint.relationshipId,
        index: waypoint.index,
        before: link.vertices().map(({ x, y }) => ({ x, y })),
      };
      this.paper.el.setPointerCapture?.(event.pointerId);
      this.select({
        kind: "relationship-waypoint",
        relationshipId: waypoint.relationshipId,
        index: waypoint.index,
      });
    };
    const onPointerMove = (event: PointerEvent): void => {
      const waypointDrag = this.waypointDragState;
      if (waypointDrag && event.pointerId === waypointDrag.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const link = this.relationshipCells.get(waypointDrag.relationshipId);
        const vertices = link?.vertices().map(({ x, y }) => ({ x, y }));
        const currentPosition = vertices?.[waypointDrag.index];
        if (!link || !vertices || !currentPosition) return;
        const bounds = this.surface.getBoundingClientRect();
        const position = clientToDiagramPosition(
          { x: event.clientX, y: event.clientY },
          { x: bounds.left, y: bounds.top },
          this.scaleValue,
          this.translation,
        );
        if (positionsEqual(currentPosition, position)) return;
        vertices[waypointDrag.index] = position;
        link.vertices(vertices, { modelDiagramWaypointDrag: true });
        return;
      }
      if (!this.panState) return;
      this.translation = {
        x: this.panState.tx + event.clientX - this.panState.x,
        y: this.panState.ty + event.clientY - this.panState.y,
      };
      this.applyTransform();
    };
    const finishWaypointDrag = (event: PointerEvent): boolean => {
      const waypointDrag = this.waypointDragState;
      if (!waypointDrag || event.pointerId !== waypointDrag.pointerId) {
        return false;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      this.waypointDragState = undefined;
      if (this.paper.el.hasPointerCapture?.(event.pointerId)) {
        this.paper.el.releasePointerCapture(event.pointerId);
      }
      const after = this.relationshipCells
        .get(waypointDrag.relationshipId)
        ?.vertices()
        .map(({ x, y }) => ({ x, y }));
      const previous = waypointDrag.before[waypointDrag.index];
      const position = after?.[waypointDrag.index];
      if (
        after &&
        previous &&
        position &&
        after.length === waypointDrag.before.length &&
        !positionsEqual(previous, position)
      ) {
        this.callbacks.onWaypointsCommitted(
          waypointDrag.relationshipId,
          waypointDrag.before,
          after,
        );
      }
      return true;
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (finishWaypointDrag(event)) return;
      this.panState = undefined;
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const bounds = this.surface.getBoundingClientRect();
      const center = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      this.setZoom(this.scaleValue * (event.deltaY < 0 ? 1.12 : 1 / 1.12), center);
    };
    const onDoubleClick = (event: MouseEvent): void => {
      if (!this.editable || !(event.target instanceof Element)) return;
      const waypoint = this.waypointFromTarget(event.target);
      if (waypoint) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.select({
          kind: "relationship-waypoint",
          relationshipId: waypoint.relationshipId,
          index: waypoint.index,
        });
        this.callbacks.onDeleteSelectedWaypoint();
        return;
      }
      if (event.target.closest(".joint-tool")) return;
      const linkNode = event.target.closest<SVGGElement>(".joint-link");
      const modelId = linkNode?.getAttribute("model-id");
      const link = modelId ? this.graph.getCell(modelId) : undefined;
      if (!(link instanceof joint.dia.Link)) return;
      const semanticLink = link as joint.dia.Link;
      const info = metadata(semanticLink);
      if (info?.kind !== "relationship") return;
      event.preventDefault();
      const localPoint = this.paper.clientToLocalPoint(
        event.clientX,
        event.clientY,
      );
      const point = { x: localPoint.x, y: localPoint.y };
      const source = this.linkEndpointCenter(semanticLink, "source");
      const target = this.linkEndpointCenter(semanticLink, "target");
      const vertices = semanticLink.vertices().map(({ x, y }) => ({ x, y }));
      const index = closestSegmentIndex(point, [source, ...vertices, target]);
      this.callbacks.onWaypointAddRequested(info.id, point, index);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        this.editable &&
        (event.key === "Delete" || event.key === "Backspace") &&
        this.selection?.kind === "relationship-waypoint"
      ) {
        event.preventDefault();
        this.callbacks.onDeleteSelectedWaypoint();
      }
    };

    this.addNativeListener(this.paper.el, "pointerdown", onPointerDown, true);
    this.addNativeListener(document, "pointermove", onPointerMove);
    this.addNativeListener(document, "pointerup", onPointerUp);
    this.addNativeListener(document, "pointercancel", onPointerUp);
    this.addNativeListener(this.paper.el, "wheel", onWheel, { passive: false });
    this.addNativeListener(this.paper.el, "dblclick", onDoubleClick);
    this.addNativeListener(document, "keydown", onKeyDown);
  }

  private addNativeListener<K extends keyof DocumentEventMap>(
    target: Document | HTMLElement,
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener as EventListener, options);
    this.nativeListeners.push(() =>
      target.removeEventListener(type, listener as EventListener, options),
    );
  }

  private select(selection: DiagramSelection | null): void {
    this.setSelection(selection);
    this.callbacks.onSelectionChanged(selection);
  }

  private showRelationshipTools(): void {
    this.removeTools();
    if (!this.editable || !this.selection) return;
    const relationshipId =
      this.selection.kind === "relationship"
        ? this.selection.id
        : this.selection.kind === "relationship-waypoint"
          ? this.selection.relationshipId
          : undefined;
    if (!relationshipId) return;
    const link = this.relationshipCells.get(relationshipId);
    if (!link) return;
    const view = this.paper.requireView<joint.dia.LinkView>(link);
    view.addTools(
      new joint.dia.ToolsView({
        tools: [
          new joint.linkTools.Vertices({
            handleClass: WaypointHandle,
            scale: 1 / this.scaleValue,
            vertexAdding: false,
            vertexRemoving: false,
            vertexMoving: false,
            redundancyRemoval: false,
            snapRadius: 5,
          }),
        ],
      }),
    );
  }

  private removeTools(): void {
    for (const link of this.relationshipCells.values()) {
      this.paper.findViewByModel<joint.dia.LinkView>(link)?.removeTools();
    }
  }

  private selectedRelationshipId(): string | undefined {
    return this.selection?.kind === "relationship"
      ? this.selection.id
      : this.selection?.kind === "relationship-waypoint"
        ? this.selection.relationshipId
        : undefined;
  }

  private waypointFromTarget(
    target: EventTarget | null,
  ): { relationshipId: string; index: number } | undefined {
    if (!(target instanceof Element)) return undefined;
    const handle = target.closest<SVGGElement>(".joint-marker-vertex");
    const tool = handle?.closest<SVGGElement>(".joint-tool");
    const modelId = tool?.getAttribute("model-id");
    const link = modelId ? this.graph.getCell(modelId) : undefined;
    const info = link ? metadata(link) : undefined;
    const index = Number(handle?.getAttribute("data-waypoint-index"));
    if (
      !handle ||
      !tool ||
      info?.kind !== "relationship" ||
      !Number.isInteger(index) ||
      index < 0
    ) {
      return undefined;
    }
    return { relationshipId: info.id, index };
  }

  private applySelectionAppearance(): void {
    for (const [id, cell] of this.classCells) {
      cell.attr("body/stroke", this.selection?.kind === "class" && this.selection.id === id ? SELECTED_COLOR : LINE_COLOR, INTERNAL);
      cell.attr("body/strokeWidth", this.selection?.kind === "class" && this.selection.id === id ? 2.5 : 1.5, INTERNAL);
    }
    for (const [id, cell] of this.noteCells) {
      cell.attr("body/stroke", this.selection?.kind === "note" && this.selection.id === id ? SELECTED_COLOR : "#b45309", INTERNAL);
      cell.attr("body/strokeWidth", this.selection?.kind === "note" && this.selection.id === id ? 2.5 : 1.25, INTERNAL);
    }
    for (const [id, link] of this.relationshipCells) {
      const selected =
        (this.selection?.kind === "relationship" && this.selection.id === id) ||
        (this.selection?.kind === "relationship-waypoint" &&
          this.selection.relationshipId === id);
      link.attr("line/stroke", selected ? SELECTED_COLOR : LINE_COLOR, INTERNAL);
    }
  }

  private linkEndpointCenter(
    link: joint.dia.Link,
    end: "source" | "target",
  ): Position {
    const view = this.paper.findViewByModel<joint.dia.LinkView>(link);
    const connectionPoint =
      end === "source" ? view?.sourcePoint : view?.targetPoint;
    if (connectionPoint) {
      return { x: connectionPoint.x, y: connectionPoint.y };
    }
    const endpoint = end === "source" ? link.getSourceCell() : link.getTargetCell();
    return endpoint instanceof joint.dia.Element
      ? positionFromElement(endpoint as joint.dia.Element)
      : { x: 0, y: 0 };
  }

  private applyTransform(): void {
    this.paper.scale(this.scaleValue, this.scaleValue, INTERNAL);
    this.paper.translate(this.translation.x, this.translation.y, INTERNAL);
  }

  private scaleToFit(bounds: joint.g.Rect): number {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    const horizontalPadding = Math.min(FOCUS_PADDING, width / 4);
    const verticalPadding = Math.min(FOCUS_PADDING, height / 4);
    return Math.max(
      MIN_SCALE,
      Math.min(
        MAX_SCALE,
        (width - horizontalPadding * 2) / Math.max(bounds.width, 1),
        (height - verticalPadding * 2) / Math.max(bounds.height, 1),
      ),
    );
  }

  private isComfortablyVisible(bounds: joint.g.Rect, scale: number): boolean {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    const horizontalPadding = Math.min(FOCUS_PADDING, width / 4);
    const verticalPadding = Math.min(FOCUS_PADDING, height / 4);
    const left = bounds.x * scale + this.translation.x;
    const top = bounds.y * scale + this.translation.y;
    const right = (bounds.x + bounds.width) * scale + this.translation.x;
    const bottom = (bounds.y + bounds.height) * scale + this.translation.y;
    return (
      left >= horizontalPadding &&
      top >= verticalPadding &&
      right <= width - horizontalPadding &&
      bottom <= height - verticalPadding
    );
  }

  private resize(): void {
    if (this.destroyed) return;
    this.paper.setDimensions(
      Math.max(this.container.clientWidth, 1),
      Math.max(this.container.clientHeight, 1),
    );
  }

  private removeMissing<T extends joint.dia.Cell>(
    cells: Map<string, T>,
    wanted: Set<string>,
  ): void {
    for (const [id, cell] of cells) {
      if (wanted.has(id)) continue;
      cell.remove(INTERNAL);
      cells.delete(id);
    }
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("Diagram has been destroyed");
  }
}
