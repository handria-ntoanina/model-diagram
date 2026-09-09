import type { DiagramClass, Position } from "../model/types.js";
import type { ClassContentMode } from "./config.js";

export interface Size {
  width: number;
  height: number;
}

export const CLASS_WIDTH = 260;
export const CLASS_HEADER_HEIGHT = 58;
export const ATTRIBUTE_LINE_HEIGHT = 23;
export const CLASS_BODY_PADDING = 14;
export const NOTE_WIDTH = 220;
export const NOTE_HEIGHT = 116;
export const NOTE_GAP = 44;

export function attributeRowTop(attributeIndex: number): number {
  return CLASS_HEADER_HEIGHT + attributeIndex * ATTRIBUTE_LINE_HEIGHT;
}

export function attributeRowCenter(attributeIndex: number): number {
  return attributeRowTop(attributeIndex) + ATTRIBUTE_LINE_HEIGHT / 2;
}

export function classSize(
  diagramClass: DiagramClass,
  classContentMode: ClassContentMode = "full",
): Size {
  if (classContentMode === "name-only") {
    return { width: CLASS_WIDTH, height: CLASS_HEADER_HEIGHT };
  }
  const attributesHeight =
    (diagramClass.attributes?.length ?? 0) * ATTRIBUTE_LINE_HEIGHT;
  return {
    width: CLASS_WIDTH,
    height:
      CLASS_HEADER_HEIGHT +
      Math.max(ATTRIBUTE_LINE_HEIGHT, attributesHeight) +
      CLASS_BODY_PADDING,
  };
}

export function defaultNotePosition(
  classPosition: Position,
  diagramClass: DiagramClass,
  classContentMode: ClassContentMode = "full",
): Position {
  const size = classSize(diagramClass, classContentMode);
  return {
    x: classPosition.x,
    y: classPosition.y + size.height / 2 + NOTE_GAP + NOTE_HEIGHT / 2,
  };
}

export function fallbackClassPosition(index: number): Position {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return { x: 180 + column * 390, y: 140 + row * 260 };
}

export function positionsEqual(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Convert browser client coordinates into the diagram coordinate system. */
export function clientToDiagramPosition(
  clientPosition: Position,
  viewportOrigin: Position,
  scale: number,
  translation: Position,
): Position {
  return {
    x: (clientPosition.x - viewportOrigin.x - translation.x) / scale,
    y: (clientPosition.y - viewportOrigin.y - translation.y) / scale,
  };
}

export function copyPosition(position: Position): Position {
  return { x: position.x, y: position.y };
}
