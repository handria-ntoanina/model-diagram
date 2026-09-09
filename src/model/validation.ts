import type {
  DiagramAttributeVisibility,
  DiagramClass,
  DiagramLayout,
  DiagramModel,
  Position,
  RelationshipType,
} from "./types.js";

const ATTRIBUTE_VISIBILITY_VALUES = new Set<DiagramAttributeVisibility>([
  "public",
  "private",
  "protected",
  "package",
]);

const RELATIONSHIP_TYPES = new Set<RelationshipType>([
  "association",
  "directed-association",
  "aggregation",
  "composition",
  "inheritance",
  "dependency",
]);

const ASSOCIATION_CLASS_RELATIONSHIP_TYPES = new Set<RelationshipType>([
  "association",
  "directed-association",
]);

const RELATIONSHIP_ROUTING_VALUES = new Set(["auto", "straight"]);

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

function validateRelationshipEndpoint(
  relationshipId: string,
  end: "source" | "target",
  endpoint: unknown,
  classes: ReadonlyMap<string, DiagramClass>,
  issues: string[],
): void {
  if (typeof endpoint === "string") {
    if (!classes.has(endpoint)) {
      issues.push(
        `relationship "${relationshipId}" has unknown ${end} class "${endpoint}"`,
      );
    }
    return;
  }
  if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) {
    issues.push(`relationship "${relationshipId}" has malformed ${end} endpoint`);
    return;
  }

  const value = endpoint as Record<string, unknown>;
  if (value.type !== "class" && value.type !== "attribute") {
    const detail = Object.hasOwn(value, "type")
      ? `unsupported ${end} endpoint type "${String(value.type)}"`
      : `malformed ${end} endpoint`;
    issues.push(`relationship "${relationshipId}" has ${detail}`);
    return;
  }
  if (typeof value.classId !== "string" || value.classId.trim() === "") {
    issues.push(
      `relationship "${relationshipId}" ${end} endpoint classId must be a non-empty string`,
    );
    return;
  }

  const diagramClass = classes.get(value.classId);
  if (!diagramClass) {
    issues.push(
      `relationship "${relationshipId}" has unknown ${end} class "${value.classId}"`,
    );
    return;
  }
  if (value.type === "class") return;
  if (typeof value.attributeId !== "string" || value.attributeId.trim() === "") {
    issues.push(
      `relationship "${relationshipId}" ${end} attributeId must be a non-empty string`,
    );
    return;
  }

  const matches =
    diagramClass.attributes?.filter(
      (attribute) => attribute.name === value.attributeId,
    ) ?? [];
  if (matches.length === 0) {
    issues.push(
      `relationship "${relationshipId}" has unknown ${end} attribute "${value.attributeId}" on class "${value.classId}"`,
    );
  } else if (matches.length > 1) {
    issues.push(
      `relationship "${relationshipId}" has ambiguous ${end} attribute "${value.attributeId}" on class "${value.classId}"`,
    );
  }
}

export function validateDiagramModel(model: DiagramModel): void {
  const issues: string[] = [];
  const classIds = new Set<string>();
  const classes = new Map<string, DiagramClass>();
  const relationshipIds = new Set<string>();

  for (const [index, diagramClass] of model.classes.entries()) {
    if (diagramClass.id.trim() === "") {
      issues.push(`classes[${index}].id must not be empty`);
    } else if (classIds.has(diagramClass.id)) {
      issues.push(`duplicate class id "${diagramClass.id}"`);
    }
    classIds.add(diagramClass.id);
    classes.set(diagramClass.id, diagramClass);

    if (diagramClass.name.trim() === "") {
      issues.push(`class "${diagramClass.id}" must have a name`);
    }
    for (const [attributeIndex, attribute] of (
      diagramClass.attributes ?? []
    ).entries()) {
      if (
        attribute.visibility !== undefined &&
        !ATTRIBUTE_VISIBILITY_VALUES.has(attribute.visibility)
      ) {
        issues.push(
          `classes[${index}].attributes[${attributeIndex}] has unsupported visibility "${String(attribute.visibility)}"`,
        );
      }
    }
  }

  for (const [index, relationship] of model.relationships.entries()) {
    if (relationship.id.trim() === "") {
      issues.push(`relationships[${index}].id must not be empty`);
    } else if (relationshipIds.has(relationship.id)) {
      issues.push(`duplicate relationship id "${relationship.id}"`);
    }
    relationshipIds.add(relationship.id);

    validateRelationshipEndpoint(
      relationship.id,
      "source",
      relationship.from,
      classes,
      issues,
    );
    validateRelationshipEndpoint(
      relationship.id,
      "target",
      relationship.to,
      classes,
      issues,
    );
    if (!RELATIONSHIP_TYPES.has(relationship.type)) {
      issues.push(
        `relationship "${relationship.id}" has unsupported type "${String(relationship.type)}"`,
      );
    }
    if (
      relationship.routing !== undefined &&
      !RELATIONSHIP_ROUTING_VALUES.has(relationship.routing)
    ) {
      issues.push(
        `relationship "${relationship.id}" has unsupported routing "${String(relationship.routing)}"`,
      );
    }
    if (relationship.associationClass !== undefined) {
      if (relationship.associationClass.trim() === "") {
        issues.push(
          `relationship "${relationship.id}" associationClass must not be empty`,
        );
      } else if (!classIds.has(relationship.associationClass)) {
        issues.push(
          `relationship "${relationship.id}" has unknown association class "${relationship.associationClass}"`,
        );
      }
      if (!ASSOCIATION_CLASS_RELATIONSHIP_TYPES.has(relationship.type)) {
        issues.push(
          `relationship "${relationship.id}" type "${String(relationship.type)}" does not support associationClass`,
        );
      }
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
