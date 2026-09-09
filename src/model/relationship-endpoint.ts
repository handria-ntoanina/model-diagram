import type {
  RelationshipEndpoint,
  RelationshipEndpointInput,
} from "./types.js";

export function normalizeRelationshipEndpoint(
  endpoint: RelationshipEndpointInput,
): RelationshipEndpoint {
  return typeof endpoint === "string"
    ? { type: "class", classId: endpoint }
    : { ...endpoint };
}

export function relationshipEndpointClassId(
  endpoint: RelationshipEndpointInput,
): string {
  return typeof endpoint === "string" ? endpoint : endpoint.classId;
}

export function cloneRelationshipEndpoint(
  endpoint: RelationshipEndpointInput,
): RelationshipEndpointInput {
  return typeof endpoint === "string" ? endpoint : { ...endpoint };
}
