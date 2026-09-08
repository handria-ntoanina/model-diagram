import type {
  DiagramLayout,
  DiagramRelationshipChanges,
} from "../model/types.js";

export type DiagramSelection =
  | { kind: "class"; id: string }
  | { kind: "relationship"; id: string }
  | { kind: "note"; id: string }
  | {
      kind: "relationship-waypoint";
      relationshipId: string;
      index: number;
    };

export interface DiagramEventMap {
  "selection-changed": {
    type: "selection-changed";
    selection: DiagramSelection | null;
  };
  "class-position-preview": {
    type: "class-position-preview";
    classId: string;
    x: number;
    y: number;
  };
  "class-position-changed": {
    type: "class-position-changed";
    classId: string;
    x: number;
    y: number;
  };
  "note-position-preview": {
    type: "note-position-preview";
    classId: string;
    x: number;
    y: number;
  };
  "note-position-changed": {
    type: "note-position-changed";
    classId: string;
    x: number;
    y: number;
  };
  "relationship-waypoint-added": {
    type: "relationship-waypoint-added";
    relationshipId: string;
    index: number;
    x: number;
    y: number;
  };
  "relationship-waypoint-preview": {
    type: "relationship-waypoint-preview";
    relationshipId: string;
    index: number;
    x: number;
    y: number;
  };
  "relationship-waypoint-changed": {
    type: "relationship-waypoint-changed";
    relationshipId: string;
    index: number;
    x: number;
    y: number;
  };
  "relationship-waypoint-removed": {
    type: "relationship-waypoint-removed";
    relationshipId: string;
    index: number;
  };
  "relationship-route-reset": {
    type: "relationship-route-reset";
    relationshipId: string;
  };
  "relationship-changed": {
    type: "relationship-changed";
    relationshipId: string;
    changes: DiagramRelationshipChanges;
  };
  "auto-layout-completed": {
    type: "auto-layout-completed";
    layout: DiagramLayout;
  };
  "history-changed": {
    type: "history-changed";
    canUndo: boolean;
    canRedo: boolean;
  };
}

export type DiagramEventType = keyof DiagramEventMap;
export type DiagramEvent = DiagramEventMap[DiagramEventType];
export type DiagramEventListener<K extends DiagramEventType> = (
  event: DiagramEventMap[K],
) => void;
export type Unsubscribe = () => void;
