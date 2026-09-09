import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
} from "elkjs/lib/elk.bundled.js";
import type { DiagramLayout, DiagramModel, Position } from "../model/types.js";
import { relationshipEndpointClassId } from "../model/relationship-endpoint.js";
import {
  NOTE_GAP,
  NOTE_HEIGHT,
  NOTE_WIDTH,
  classSize,
  type Size,
} from "../rendering/geometry.js";

export interface AutoLayoutOptions {
  direction?: "RIGHT" | "DOWN" | "LEFT" | "UP";
  layerSpacing?: number;
  nodeSpacing?: number;
  preserveStoredPositions?: boolean;
}

export interface LayoutEngine {
  layout(
    model: DiagramModel,
    storedLayout?: DiagramLayout,
    options?: AutoLayoutOptions,
  ): Promise<Map<string, Position>>;
}

interface PlacedNode {
  position: Position;
  size: Size;
}

const ASSOCIATION_CLASS_ROUTE_GAP = 90;

function layoutSize(
  diagramClass: DiagramModel["classes"][number],
): Size {
  const size = classSize(diagramClass);
  return diagramClass.note
    ? { width: size.width, height: size.height + NOTE_GAP + NOTE_HEIGHT }
    : size;
}

function classToLayoutCenter(
  classPosition: Position,
  diagramClass: DiagramModel["classes"][number],
): Position {
  const classDimensions = classSize(diagramClass);
  const footprint = layoutSize(diagramClass);
  return {
    x: classPosition.x,
    y: classPosition.y + (footprint.height - classDimensions.height) / 2,
  };
}

function layoutCenterToClass(
  center: Position,
  diagramClass: DiagramModel["classes"][number],
): Position {
  const classDimensions = classSize(diagramClass);
  const footprint = layoutSize(diagramClass);
  return {
    x: center.x,
    y: center.y - (footprint.height - classDimensions.height) / 2,
  };
}

function overlaps(a: PlacedNode, b: PlacedNode, padding: number): boolean {
  return (
    Math.abs(a.position.x - b.position.x) <
      (a.size.width + b.size.width) / 2 + padding &&
    Math.abs(a.position.y - b.position.y) <
      (a.size.height + b.size.height) / 2 + padding
  );
}

function findFreePosition(
  desired: Position,
  size: Size,
  occupied: PlacedNode[],
): Position {
  const candidate = { ...desired };
  const step = 80;
  for (let ring = 0; ring < 40; ring += 1) {
    const attempts = ring === 0 ? 1 : ring * 8;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const angle = (Math.PI * 2 * attempt) / attempts;
      candidate.x = desired.x + Math.cos(angle) * ring * step;
      candidate.y = desired.y + Math.sin(angle) * ring * step;
      if (
        occupied.every(
          (placed) => !overlaps({ position: candidate, size }, placed, 40),
        )
      ) {
        return { ...candidate };
      }
    }
  }
  return { ...desired };
}

export class ElkLayoutEngine implements LayoutEngine {
  private readonly elk = new ELK();

  async layout(
    model: DiagramModel,
    storedLayout: DiagramLayout = {},
    options: AutoLayoutOptions = {},
  ): Promise<Map<string, Position>> {
    const children: ElkNode[] = model.classes.map((diagramClass) => {
      const size = layoutSize(diagramClass);
      return { id: diagramClass.id, width: size.width, height: size.height };
    });
    const edges: ElkExtendedEdge[] = model.relationships.map((relationship) => ({
      id: relationship.id,
      sources: [relationshipEndpointClassId(relationship.from)],
      targets: [relationshipEndpointClassId(relationship.to)],
    }));
    const graph: ElkNode = {
      id: "model-diagram-root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": options.direction ?? "RIGHT",
        "elk.spacing.nodeNode": String(options.nodeSpacing ?? 70),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(
          options.layerSpacing ?? 130,
        ),
        "elk.padding": "[top=40,left=40,bottom=40,right=40]",
      },
      children,
      edges,
    };

    const result = await this.elk.layout(graph);
    const positions = new Map<string, Position>();
    const occupied: PlacedNode[] = [];
    const preserveStored = options.preserveStoredPositions ?? true;
    const associationClassIds = new Set(
      model.relationships.flatMap(({ associationClass }) =>
        associationClass ? [associationClass] : [],
      ),
    );
    const layoutNodes = new Map(
      (result.children ?? []).map((node) => [node.id, node]),
    );

    if (preserveStored) {
      for (const diagramClass of model.classes) {
        const position = storedLayout.classes?.[diagramClass.id];
        if (!position) continue;
        positions.set(diagramClass.id, { ...position });
        occupied.push({
          position: classToLayoutCenter(position, diagramClass),
          size: layoutSize(diagramClass),
        });
        const manualNote = storedLayout.notes?.[diagramClass.id];
        if (manualNote) {
          occupied.push({
            position: { ...manualNote },
            size: { width: NOTE_WIDTH, height: NOTE_HEIGHT },
          });
        }
      }
    }

    for (const node of result.children ?? []) {
      if (positions.has(node.id)) continue;
      const diagramClass = model.classes.find(({ id }) => id === node.id);
      if (!diagramClass) continue;
      if (associationClassIds.has(node.id)) continue;
      const size = layoutSize(diagramClass);
      const desiredCenter = {
        x: (node.x ?? 0) + size.width / 2,
        y: (node.y ?? 0) + size.height / 2,
      };
      const center = findFreePosition(desiredCenter, size, occupied);
      positions.set(node.id, layoutCenterToClass(center, diagramClass));
      occupied.push({ position: center, size });
    }

    for (const diagramClass of model.classes) {
      if (
        positions.has(diagramClass.id) ||
        !associationClassIds.has(diagramClass.id)
      ) {
        continue;
      }
      const bindings = model.relationships.filter(
        ({ associationClass }) => associationClass === diagramClass.id,
      );
      const midpoints = bindings.flatMap((relationship) => {
        const source = positions.get(
          relationshipEndpointClassId(relationship.from),
        );
        const target = positions.get(
          relationshipEndpointClassId(relationship.to),
        );
        return source && target
          ? [{ x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }]
          : [];
      });
      const node = layoutNodes.get(diagramClass.id);
      const size = layoutSize(diagramClass);
      const fallbackCenter = {
        x: (node?.x ?? 0) + size.width / 2,
        y: (node?.y ?? 0) + size.height / 2,
      };
      const relationshipMidpoint =
        midpoints.length > 0
          ? {
              x:
                midpoints.reduce((total, point) => total + point.x, 0) /
                midpoints.length,
              y:
                midpoints.reduce((total, point) => total + point.y, 0) /
                midpoints.length,
            }
          : layoutCenterToClass(fallbackCenter, diagramClass);
      const direction = options.direction ?? "RIGHT";
      const desiredClassPosition =
        direction === "RIGHT" || direction === "LEFT"
          ? {
              x: relationshipMidpoint.x,
              y:
                relationshipMidpoint.y +
                classSize(diagramClass).height / 2 +
                ASSOCIATION_CLASS_ROUTE_GAP,
            }
          : {
              x:
                relationshipMidpoint.x +
                classSize(diagramClass).width / 2 +
                ASSOCIATION_CLASS_ROUTE_GAP,
              y: relationshipMidpoint.y,
            };
      const desiredCenter = classToLayoutCenter(
        desiredClassPosition,
        diagramClass,
      );
      const center = findFreePosition(desiredCenter, size, occupied);
      positions.set(
        diagramClass.id,
        layoutCenterToClass(center, diagramClass),
      );
      occupied.push({ position: center, size });
    }

    return positions;
  }
}
