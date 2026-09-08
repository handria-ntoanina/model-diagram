import type {
  DiagramLayout,
  DiagramModel,
  Position,
  RelationshipType,
} from "./types.js";

const RELATIONSHIP_TYPES = new Set<RelationshipType>([
  "association",
  "aggregation",
  "composition",
  "inheritance",
  "dependency",
]);

export class DiagramValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid diagram data:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "DiagramValidationError";
    this.issues = issues;
  }
}

function isFinitePosition(value: Position): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

export function validateDiagramModel(model: DiagramModel): void {
  const issues: string[] = [];
  const classIds = new Set<string>();
  const relationshipIds = new Set<string>();

  for (const [index, diagramClass] of model.classes.entries()) {
    if (diagramClass.id.trim() === "") {
      issues.push(`classes[${index}].id must not be empty`);
    } else if (classIds.has(diagramClass.id)) {
      issues.push(`duplicate class id "${diagramClass.id}"`);
    }
    classIds.add(diagramClass.id);

    if (diagramClass.name.trim() === "") {
      issues.push(`class "${diagramClass.id}" must have a name`);
    }
  }

  for (const [index, relationship] of model.relationships.entries()) {
    if (relationship.id.trim() === "") {
      issues.push(`relationships[${index}].id must not be empty`);
    } else if (relationshipIds.has(relationship.id)) {
      issues.push(`duplicate relationship id "${relationship.id}"`);
    }
    relationshipIds.add(relationship.id);

    if (!classIds.has(relationship.from)) {
      issues.push(
        `relationship "${relationship.id}" has unknown source class "${relationship.from}"`,
      );
    }
    if (!classIds.has(relationship.to)) {
      issues.push(
        `relationship "${relationship.id}" has unknown target class "${relationship.to}"`,
      );
    }
    if (!RELATIONSHIP_TYPES.has(relationship.type)) {
      issues.push(
        `relationship "${relationship.id}" has unsupported type "${String(relationship.type)}"`,
      );
    }
  }

  if (issues.length > 0) {
    throw new DiagramValidationError(issues);
  }
}

export function validateDiagramLayout(
  layout: DiagramLayout,
  model?: DiagramModel,
): void {
  const issues: string[] = [];
  const classIds = model
    ? new Set(model.classes.map((diagramClass) => diagramClass.id))
    : undefined;
  const relationshipIds = model
    ? new Set(model.relationships.map((relationship) => relationship.id))
    : undefined;

  for (const [id, position] of Object.entries(layout.classes ?? {})) {
    if (!isFinitePosition(position)) {
      issues.push(`class layout "${id}" must contain finite x and y coordinates`);
    }
    if (classIds && !classIds.has(id)) {
      issues.push(`class layout refers to unknown class "${id}"`);
    }
  }

  for (const [id, position] of Object.entries(layout.notes ?? {})) {
    if (!isFinitePosition(position)) {
      issues.push(`note layout "${id}" must contain finite x and y coordinates`);
    }
    if (classIds && !classIds.has(id)) {
      issues.push(`note layout refers to unknown class "${id}"`);
    }
  }

  for (const [id, relationshipLayout] of Object.entries(
    layout.relationships ?? {},
  )) {
    if (relationshipIds && !relationshipIds.has(id)) {
      issues.push(`relationship layout refers to unknown relationship "${id}"`);
    }
    for (const [index, waypoint] of (
      relationshipLayout.waypoints ?? []
    ).entries()) {
      if (!isFinitePosition(waypoint)) {
        issues.push(
          `relationship layout "${id}" waypoint ${index} must contain finite x and y coordinates`,
        );
      }
    }
  }

  if (issues.length > 0) {
    throw new DiagramValidationError(issues);
  }
}
