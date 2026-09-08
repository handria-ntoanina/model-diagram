import { afterEach, describe, expect, it } from "vitest";
import {
  createDiagram,
  type Diagram,
  type DiagramModel,
  type LayoutEngine,
  type Position,
  type RelationshipType,
} from "../../src/index.js";

const relationshipTypes: RelationshipType[] = [
  "association",
  "aggregation",
  "composition",
  "inheritance",
  "dependency",
];

const diagrams: Diagram[] = [];

class FixedLayoutEngine implements LayoutEngine {
  layout(model: DiagramModel): Promise<Map<string, Position>> {
    return Promise.resolve(
      new Map(
        model.classes.map(({ id }, index) => [
          id,
          { x: 100 + (index % 2) * 360, y: 100 + Math.floor(index / 2) * 180 },
        ]),
      ),
    );
  }
}

function relationshipModel(): DiagramModel {
  return {
    classes: relationshipTypes.flatMap((type) => [
      { id: `${type}-source`, name: `${type} source` },
      { id: `${type}-target`, name: `${type} target` },
    ]),
    relationships: relationshipTypes.map((type) => ({
      id: `relationship-${type}`,
      from: `${type}-source`,
      to: `${type}-target`,
      type,
      role: `role-${type}`,
      fromMultiplicity: "0..n",
      toMultiplicity: "1..n",
    })),
  };
}

function relationshipForRole(host: HTMLElement, role: string): SVGElement {
  const relationship = [
    ...host.querySelectorAll<SVGElement>(
      '[data-type="model-diagram.Relationship"]',
    ),
  ].find((candidate) =>
    [...candidate.querySelectorAll("[label-idx]")].some(
      (label) => label.textContent === role,
    ),
  );
  if (!relationship) throw new Error(`Expected relationship for ${role}`);
  return relationship;
}

function labelRoots(relationship: SVGElement): Element[] {
  return [...relationship.querySelectorAll("[label-idx]")];
}

function lineFor(relationship: SVGElement): SVGPathElement {
  const line = relationship.querySelector<SVGPathElement>(
    '[joint-selector="line"]',
  );
  if (!line) throw new Error("Expected relationship line");
  return line;
}

interface MarkerDescriptor {
  d: string | null;
  fill: string | null;
  stroke: string | null;
}

function markerDescriptor(
  host: HTMLElement,
  line: SVGPathElement,
  endpoint: "start" | "end",
): MarkerDescriptor {
  const reference = line.getAttribute(`marker-${endpoint}`);
  const markerId = reference?.match(/^url\(#(.+)\)$/)?.[1];
  if (!markerId) throw new Error(`Expected ${endpoint} marker reference`);
  const path = host.querySelector<SVGPathElement>(
    `marker[id="${markerId}"] path`,
  );
  if (!path) throw new Error(`Expected ${endpoint} marker path`);
  return {
    d: path.getAttribute("d"),
    fill: path.getAttribute("fill"),
    stroke: path.getAttribute("stroke"),
  };
}

function renderSnapshot(host: HTMLElement, type: RelationshipType) {
  const relationship = relationshipForRole(host, `role-${type}`);
  const roots = labelRoots(relationship);
  const role = roots.find((label) => label.textContent === `role-${type}`);
  const multiplicities = relationship.querySelectorAll<SVGTextElement>(
    ".model-diagram-multiplicity-label",
  );
  if (!role) throw new Error(`Expected role label for ${type}`);
  const line = lineFor(relationship);
  return {
    labelText: roots.map((label) => label.textContent),
    multiplicityTags: [...multiplicities].map((label) =>
      label.tagName.toLowerCase(),
    ),
    multiplicityRects: [...multiplicities].map((label) =>
      label.querySelector("rect"),
    ),
    roleRect: {
      fill: role.querySelector("rect")?.getAttribute("fill"),
      stroke: role.querySelector("rect")?.getAttribute("stroke"),
      rx: role.querySelector("rect")?.getAttribute("rx"),
    },
    markerStart: markerDescriptor(host, line, "start"),
    markerEnd: markerDescriptor(host, line, "end"),
    strokeDasharray: line.getAttribute("stroke-dasharray"),
  };
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("relationship endpoint multiplicity labels", () => {
  it("renders plain text for every relationship type across layout and route changes", async () => {
    const host = document.createElement("div");
    host.style.width = "1000px";
    host.style.height = "1000px";
    document.body.append(host);

    const diagram = createDiagram(host, {
      model: relationshipModel(),
      editable: true,
      autoLayout: false,
      layoutEngine: new FixedLayoutEngine(),
    });
    diagrams.push(diagram);

    const initial = Object.fromEntries(
      relationshipTypes.map((type) => [type, renderSnapshot(host, type)]),
    ) as Record<RelationshipType, ReturnType<typeof renderSnapshot>>;

    for (const type of relationshipTypes) {
      const snapshot = initial[type];
      expect(snapshot.labelText).toEqual([`role-${type}`, "0..n", "1..n"]);
      expect(snapshot.multiplicityTags).toEqual(["text", "text"]);
      expect(snapshot.multiplicityRects).toEqual([null, null]);
      expect(snapshot.roleRect).toEqual({
        fill: "#f8fafc",
        stroke: "#cbd5e1",
        rx: "3",
      });
    }

    expect(initial.association.markerEnd).toEqual({
      d: "M 10 -5 0 0 10 5",
      fill: "none",
      stroke: "#334155",
    });
    expect(initial.aggregation.markerStart).toEqual({
      d: "M 20 0 10 -6 0 0 10 6 Z",
      fill: "#ffffff",
      stroke: "#334155",
    });
    expect(initial.composition.markerStart).toEqual({
      d: "M 20 0 10 -6 0 0 10 6 Z",
      fill: "#334155",
      stroke: "#334155",
    });
    expect(initial.inheritance.markerEnd).toEqual({
      d: "M 14 -7 0 0 14 7 Z",
      fill: "#ffffff",
      stroke: "#334155",
    });
    expect(initial.dependency.markerEnd).toEqual(
      initial.association.markerEnd,
    );
    expect(initial.dependency.strokeDasharray).toBe("7 5");

    diagram.addRelationshipWaypoint("relationship-association", {
      x: 280,
      y: 220,
    });
    expect(renderSnapshot(host, "association")).toEqual(initial.association);

    await diagram.autoLayout();
    for (const type of relationshipTypes) {
      expect(renderSnapshot(host, type)).toEqual(initial[type]);
    }
  });
});
