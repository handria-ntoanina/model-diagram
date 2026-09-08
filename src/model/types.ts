export type RelationshipType =
  | "association"
  | "aggregation"
  | "composition"
  | "inheritance"
  | "dependency";

export interface DiagramModel {
  classes: DiagramClass[];
  relationships: DiagramRelationship[];
}

export interface DiagramClass {
  id: string;
  name: string;
  note?: string;
  stereotype?: string;
  attributes?: DiagramAttribute[];
}

export interface DiagramAttribute {
  name: string;
  type?: string;
  required?: boolean;
  multiplicity?: string;
  description?: string;
}

export interface DiagramRelationship {
  id: string;
  from: string;
  to: string;
  type: RelationshipType;
  label?: string;
  role?: string;
  fromMultiplicity?: string;
  toMultiplicity?: string;
}

export interface DiagramRelationshipChanges {
  label?: string | undefined;
}

export interface DiagramLayout {
  classes?: Record<string, Position>;
  notes?: Record<string, Position>;
  relationships?: Record<string, RelationshipLayout>;
}

export interface Position {
  x: number;
  y: number;
}

export interface RelationshipLayout {
  waypoints?: Position[];
}
