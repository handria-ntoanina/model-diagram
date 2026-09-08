import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  type Diagram,
  type DiagramModel,
  type Position,
  type RelationshipType,
} from "../../src/index.js";

const diagrams: Diagram[] = [];

function associationClassModel(
  type: Extract<RelationshipType, "association" | "directed-association">,
): DiagramModel {
  return {
    classes: [
      { id: "student", name: "Student" },
      { id: "course", name: "Course" },
      {
        id: "enrollment",
        name: "Enrollment",
        attributes: [
          { name: "enrolledAt", type: "date" },
          { name: "grade", type: "string" },
        ],
      },
    ],
    relationships: [
      {
        id: "student-course",
        type,
        from: "student",
        to: "course",
        associationClass: "enrollment",
        label: "takes",
        role: "student / course",
        fromMultiplicity: "*",
        toMultiplicity: "*",
      },
    ],
  };
}

const initialPositions = {
  student: { x: 150, y: 160 },
  course: { x: 750, y: 160 },
  enrollment: { x: 450, y: 440 },
};

function createAssociationClassDiagram(
  type: Extract<RelationshipType, "association" | "directed-association"> =
    "association",
): { host: HTMLDivElement; diagram: Diagram } {
  const host = document.createElement("div");
  host.style.width = "1000px";
  host.style.height = "700px";
  document.body.append(host);
  const diagram = createDiagram(host, {
    model: associationClassModel(type),
    layout: { classes: initialPositions },
    editable: true,
    autoLayout: false,
  });
  diagrams.push(diagram);
  return { host, diagram };
}

function relationshipPath(host: HTMLElement): SVGPathElement {
  const path = host.querySelector<SVGPathElement>(
    '[data-type="model-diagram.Relationship"] [joint-selector="line"]',
  );
  if (!path) throw new Error("Expected semantic relationship path");
  return path;
}

function connectorPath(host: HTMLElement): SVGPathElement {
  const path = host.querySelector<SVGPathElement>(
    '[data-type="model-diagram.AssociationClassConnector"] [joint-selector="line"]',
  );
  if (!path) throw new Error("Expected association-class connector path");
  return path;
}

function classGroup(host: HTMLElement, name: string): SVGGElement {
  const group = [
    ...host.querySelectorAll<SVGGElement>('[data-type="model-diagram.Class"]'),
  ].find((candidate) => candidate.textContent?.includes(name));
  if (!group) throw new Error(`Expected class ${name}`);
  return group;
}

function markerIsInvisible(
  host: HTMLElement,
  path: SVGPathElement,
  endpoint: "start" | "end",
): boolean {
  const reference = path.getAttribute(`marker-${endpoint}`);
  const id = reference?.match(/^url\(#(.+)\)$/)?.[1];
  if (!id) return true;
  const marker = host.querySelector<SVGPathElement>(`marker[id="${id}"] path`);
  return marker?.getAttribute("stroke") === "none";
}

function expectPointsClose(actual: DOMPoint, expected: DOMPoint): void {
  expect(actual.x).toBeCloseTo(expected.x, 1);
  expect(actual.y).toBeCloseTo(expected.y, 1);
}

function dragClass(
  host: HTMLElement,
  name: string,
  positions: Position[],
): void {
  const group = classGroup(host, name);
  const body = group.querySelector<SVGElement>('[joint-selector="body"]');
  if (!body) throw new Error(`Expected ${name} class body`);
  const bodyBounds = body.getBoundingClientRect();
  const hostBounds = host.getBoundingClientRect();
  body.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: bodyBounds.left + bodyBounds.width / 2,
      clientY: bodyBounds.top + bodyBounds.height / 2,
    }),
  );
  for (const position of positions) {
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: hostBounds.left + position.x,
        clientY: hostBounds.top + position.y,
      }),
    );
  }
  const last = positions.at(-1);
  if (!last) throw new Error("Expected a drag target");
  document.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: hostBounds.left + last.x,
      clientY: hostBounds.top + last.y,
    }),
  );
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("UML association classes", () => {
  it.each(["association", "directed-association"] as const)(
    "renders a derived markerless connector for %s",
    (type) => {
      const { host, diagram } = createAssociationClassDiagram(type);
      const relationship = relationshipPath(host);
      const connector = connectorPath(host);

      expect(host.querySelectorAll('[data-type="model-diagram.Relationship"]')).toHaveLength(1);
      expect(
        host.querySelectorAll(
          '[data-type="model-diagram.AssociationClassConnector"]',
        ),
      ).toHaveLength(1);
      expect(classGroup(host, "Enrollment").textContent).toContain(
        "enrolledAt: date",
      );
      const relationshipGroup = relationship.closest<SVGGElement>(
        '[data-type="model-diagram.Relationship"]',
      );
      expect(relationshipGroup?.textContent).toContain("takes");
      expect(relationshipGroup?.textContent).toContain("student / course");
      expect(
        relationshipGroup?.querySelectorAll(
          ".model-diagram-multiplicity-label",
        ),
      ).toHaveLength(2);
      expect(connector.getAttribute("stroke-dasharray")).toBe("5 4");
      expect(markerIsInvisible(host, connector, "start")).toBe(true);
      expect(markerIsInvisible(host, connector, "end")).toBe(true);
      expect(diagram.getModel().relationships[0]).toMatchObject({
        type,
        associationClass: "enrollment",
      });

      const associationLength = relationship.getTotalLength();
      const connectorLength = connector.getTotalLength();
      expectPointsClose(
        connector.getPointAtLength(connectorLength),
        relationship.getPointAtLength(associationLength / 2),
      );
    },
  );

  it("updates the connector for endpoint movement and relationship rerouting", () => {
    const { host, diagram } = createAssociationClassDiagram();
    const connector = connectorPath(host);
    const initial = connector.getAttribute("d");

    diagram.setLayout({
      classes: {
        ...initialPositions,
        student: { x: 100, y: 280 },
      },
    });
    const afterSourceMove = connector.getAttribute("d");
    expect(afterSourceMove).not.toBe(initial);

    diagram.setLayout({
      classes: {
        ...initialPositions,
        student: { x: 100, y: 280 },
        course: { x: 820, y: 300 },
      },
    });
    const afterTargetMove = connector.getAttribute("d");
    expect(afterTargetMove).not.toBe(afterSourceMove);

    diagram.addRelationshipWaypoint("student-course", { x: 520, y: 40 });
    const afterWaypoint = connector.getAttribute("d");
    expect(afterWaypoint).not.toBe(afterTargetMove);
    expect(diagram.getModel().relationships[0]?.associationClass).toBe(
      "enrollment",
    );

    diagram.undo();
    expect(connector.getAttribute("d")).toBe(afterTargetMove);
    expect(diagram.getModel().relationships[0]?.associationClass).toBe(
      "enrollment",
    );
    diagram.redo();
    expect(connector.getAttribute("d")).toBe(afterWaypoint);
  });

  it("moves and selects the association class with ordinary semantic behavior", () => {
    const { host, diagram } = createAssociationClassDiagram();
    const connector = connectorPath(host);
    const initial = connector.getAttribute("d");
    const classChanged = vi.fn();
    const selectionChanged = vi.fn();
    const relationshipChanged = vi.fn();
    diagram.on("class-position-changed", classChanged);
    diagram.on("selection-changed", selectionChanged);
    diagram.on("relationship-changed", relationshipChanged);

    dragClass(host, "Enrollment", [
      { x: 500, y: 470 },
      { x: 560, y: 500 },
    ]);
    const moved = connector.getAttribute("d");
    expect(moved).not.toBe(initial);
    const classEvent = classChanged.mock.lastCall?.[0] as
      | ({ type: string; classId: string } & Position)
      | undefined;
    expect(classEvent?.type).toBe("class-position-changed");
    expect(classEvent?.classId).toBe("enrollment");
    expect(Math.abs((classEvent?.x ?? Number.NaN) - 560)).toBeLessThanOrEqual(2);
    expect(Math.abs((classEvent?.y ?? Number.NaN) - 500)).toBeLessThanOrEqual(2);

    diagram.undo();
    expect(connector.getAttribute("d")).toBe(initial);
    diagram.redo();
    expect(connector.getAttribute("d")).toBe(moved);
    expect(diagram.getModel().relationships[0]?.associationClass).toBe(
      "enrollment",
    );

    const wrapper = connector
      .closest<SVGGElement>('[data-type="model-diagram.AssociationClassConnector"]')
      ?.querySelector<SVGElement>('[joint-selector="wrapper"]');
    if (!wrapper) throw new Error("Expected connector wrapper");
    wrapper.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    wrapper.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, button: 0 }),
    );
    expect(selectionChanged).toHaveBeenLastCalledWith({
      type: "selection-changed",
      selection: { kind: "relationship", id: "student-course" },
    });
    expect(relationshipChanged).not.toHaveBeenCalled();
  });

  it("rejects dangling references and removes the derived connector with its relationship", () => {
    const { host, diagram } = createAssociationClassDiagram();
    const dangling = associationClassModel("association");
    dangling.classes = dangling.classes.filter(({ id }) => id !== "enrollment");
    expect(() => diagram.setModel(dangling)).toThrowError(
      /unknown association class "enrollment"/,
    );
    expect(connectorPath(host)).toBeDefined();

    const withoutRelationship = associationClassModel("association");
    withoutRelationship.relationships = [];
    diagram.setModel(withoutRelationship);
    expect(
      host.querySelector('[data-type="model-diagram.AssociationClassConnector"]'),
    ).toBeNull();
    expect(diagram.getModel().relationships).toEqual([]);
  });
});
