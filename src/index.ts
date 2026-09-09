export { createDiagram, ModelDiagram } from "./rendering/diagram.js";
export type {
  CreateDiagramOptions,
  AttributeMarkerMode,
  Diagram,
  DiagramFocusTarget,
} from "./rendering/diagram.js";
export type {
  AutoLayoutOptions,
  LayoutEngine,
} from "./layout/elk-layout.js";
export { DiagramValidationError } from "./model/validation.js";
export {
  validateDiagramLayout,
  validateDiagramModel,
} from "./model/validation.js";
export type {
  AttributeRelationshipEndpoint,
  ClassId,
  ClassRelationshipEndpoint,
  DiagramAttribute,
  DiagramAttributeVisibility,
  DiagramClass,
  DiagramLayout,
  DiagramModel,
  DiagramRelationship,
  DiagramRelationshipChanges,
  Position,
  RelationshipEndpoint,
  RelationshipEndpointInput,
  RelationshipLayout,
  RelationshipRouting,
  RelationshipType,
} from "./model/types.js";
export type {
  DiagramEvent,
  DiagramEventListener,
  DiagramEventMap,
  DiagramEventType,
  DiagramSelection,
  Unsubscribe,
} from "./events/types.js";
