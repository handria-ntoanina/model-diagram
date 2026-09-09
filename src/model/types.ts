export type ClassId = string;

export type RelationshipType =
  | "association"
  | "directed-association"
  | "aggregation"
  | "composition"
  | "inheritance"
  | "dependency";

export type RelationshipRouting = "auto" | "straight";

export interface ClassRelationshipEndpoint {
  type: "class";
  classId: ClassId;
}

export interface AttributeRelationshipEndpoint {
  type: "attribute";
  classId: ClassId;
  /** Matches the stable `name` of an attribute in the owning class. */
  attributeId: string;
}

export type RelationshipEndpoint =
  | ClassRelationshipEndpoint
  | AttributeRelationshipEndpoint;

/** A class ID remains supported as shorthand for a class endpoint. */
export type RelationshipEndpointInput = ClassId | RelationshipEndpoint;

export interface DiagramModel {
  classes: DiagramClass[];
  relationships: DiagramRelationship[];
}

export interface DiagramClass {
  id: ClassId;
  name: string;
  note?: string;
  stereotype?: string;
  attributes?: DiagramAttribute[];
}

export interface DiagramAttribute {
  name: string;
  type?: string;
  required?: boolean;
  /** UML visibility semantics, independent of whether the attribute is required. */
  visibility?: DiagramAttributeVisibility;
  multiplicity?: string;
  description?: string;
}

export type DiagramAttributeVisibility =
  | "public"
  | "private"
  | "protected"
  | "package";

export interface DiagramRelationship {
  id: string;
  from: RelationshipEndpointInput;
  to: RelationshipEndpointInput;
  type: RelationshipType;
  routing?: RelationshipRouting;
  associationClass?: ClassId;
  label?: string;
  role?: string;
  fromMultiplicity?: string;
  toMultiplicity?: string;
}

export interface DiagramRelationshipChanges {
  label?: string | undefined;
  routing?: RelationshipRouting | undefined;
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
