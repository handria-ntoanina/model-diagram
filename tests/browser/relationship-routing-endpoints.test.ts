import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  type Diagram,
  type DiagramModel,
} from "../../src/index.js";

const diagrams: Diagram[] = [];
const HEADER_HEIGHT = 58;
const ROW_HEIGHT = 23;

function relationshipModel(): DiagramModel {
  return {
    classes: [
      {
        id: "order",
        name: "Order",
        attributes: [
          { name: "number", type: "string" },
          { name: "total", type: "decimal" },
        ],
      },
      {
        id: "customer",
        name: "Customer",
        attributes: [
          { name: "code", type: "string" },
          { name: "email", type: "string" },
        ],
      },
      {
        id: "membership",
        name: "Membership",
        attributes: [{ name: "since", type: "date" }],
      },
    ],
    relationships: [
      {
        id: "straight-directed",
        type: "directed-association",
        routing: "straight",
        from: "order",
        to: {
          type: "attribute",
          classId: "customer",
          attributeId: "code",
        },
        label: "places",
        role: "straight directed",
        fromMultiplicity: "0..*",
        toMultiplicity: "1",
      },
      {
        id: "straight-composition",
        type: "composition",
        routing: "straight",
        from: {
          type: "attribute",
          classId: "customer",
          attributeId: "email",
        },
        to: "order",
        role: "straight composition",
      },
      {
        id: "auto-class-attribute",
        type: "association",
        from: "order",
        to: {
          type: "attribute",
          classId: "customer",
          attributeId: "email",
        },
        role: "auto class attribute",
      },
      {
        id: "auto-attribute-class",
        type: "dependency",
        from: {
          type: "attribute",
          classId: "order",
          attributeId: "total",
        },
        to: "customer",
        role: "auto attribute class",
      },
      {
        id: "auto-attribute-attribute",
        type: "association",
        from: {
          type: "attribute",
          classId: "order",
          attributeId: "number",
        },
        to: {
          type: "attribute",
          classId: "customer",
          attributeId: "code",
        },
        associationClass: "membership",
        role: "auto attribute attribute",
      },
    ],
  };
}

function createRelationshipDiagram(): {
  diagram: Diagram;
  host: HTMLDivElement;
} {
  const host = document.createElement("div");
  host.style.width = "1000px";
  host.style.height = "700px";
  document.body.append(host);
  const diagram = createDiagram(host, {
    model: relationshipModel(),
    editable: true,
    autoLayout: false,
    layout: {
      classes: {
        order: { x: 180, y: 220 },
        customer: { x: 820, y: 220 },
        membership: { x: 500, y: 520 },
      },
    },
  });
  diagrams.push(diagram);
  return { diagram, host };
}

function relationshipGroup(host: HTMLElement, role: string): SVGGElement {
  const group = [
    ...host.querySelectorAll<SVGGElement>(
      '[data-type="model-diagram.Relationship"]',
    ),
  ].find((candidate) => candidate.textContent?.includes(role));
  if (!group) throw new Error(`Expected relationship ${role}`);
  return group;
}

function relationshipPath(host: HTMLElement, role: string): SVGPathElement {
  const path = relationshipGroup(host, role).querySelector<SVGPathElement>(
    '[joint-selector="line"]',
  );
  if (!path) throw new Error(`Expected relationship path ${role}`);
  return path;
}

function classBody(host: HTMLElement, name: string): SVGElement {
  const group = [
    ...host.querySelectorAll<SVGGElement>('[data-type="model-diagram.Class"]'),
  ].find((candidate) => candidate.textContent?.includes(name));
  const body = group?.querySelector<SVGElement>('[joint-selector="body"]');
  if (!body) throw new Error(`Expected class body ${name}`);
  return body;
}

function endpoint(path: SVGPathElement, end: "source" | "target"): DOMPoint {
  return path.getPointAtLength(end === "source" ? 0 : path.getTotalLength());
}

function expectedRowY(
  diagram: Diagram,
  classId: string,
  index: number,
): number {
  const diagramClass = diagram.getModel().classes.find(({ id }) => id === classId);
  const center = diagram.getLayout().classes?.[classId];
  if (!diagramClass || !center) throw new Error(`Expected class ${classId}`);
  const attributeHeight = (diagramClass.attributes?.length ?? 0) * ROW_HEIGHT;
  const classHeight = HEADER_HEIGHT + Math.max(ROW_HEIGHT, attributeHeight) + 14;
  return center.y - classHeight / 2 + HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function markerPath(
  host: HTMLElement,
  path: SVGPathElement,
  end: "start" | "end",
): SVGPathElement | null {
  const reference = path.getAttribute(`marker-${end}`);
  const id = reference?.match(/^url\(#(.+)\)$/)?.[1];
  return id
    ? host.querySelector<SVGPathElement>(`marker[id="${id}"] path`)
    : null;
}

function pathCommandCount(path: SVGPathElement): number {
  return path.getAttribute("d")?.match(/[MLCQ]/g)?.length ?? 0;
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("straight routing and semantic attribute endpoints", () => {
  it("renders straight semantic types as direct segments with markers and metadata", () => {
    const { host } = createRelationshipDiagram();
    const directed = relationshipPath(host, "straight directed");
    const composition = relationshipPath(host, "straight composition");
    const automatic = relationshipPath(host, "auto class attribute");

    expect(pathCommandCount(directed)).toBe(2);
    expect(pathCommandCount(composition)).toBe(2);
    expect(pathCommandCount(automatic)).toBeGreaterThan(2);
    expect(endpoint(directed, "source").x).toBeLessThan(
      endpoint(directed, "target").x,
    );
    expect(markerPath(host, directed, "end")?.getAttribute("fill")).toBe("none");
    expect(markerPath(host, composition, "start")?.getAttribute("fill")).toBe(
      "#334155",
    );
    const group = relationshipGroup(host, "straight directed");
    expect(group.textContent).toContain("places");
    expect(group.textContent).toContain("0..*");
    expect(group.textContent).toContain("1");

    const wrapper = group.querySelector<SVGElement>('[joint-selector="wrapper"]');
    if (!wrapper) throw new Error("Expected straight relationship wrapper");
    wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    wrapper.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    expect(host.querySelectorAll(".joint-marker-vertex")).toHaveLength(0);
  });

  it("keeps a straight connector straight after source and target movement", async () => {
    const { diagram, host } = createRelationshipDiagram();
    const path = relationshipPath(host, "straight directed");
    const initial = path.getAttribute("d");
    const orderBody = classBody(host, "Order");

    await userEvent.dragAndDrop(orderBody, host, {
      force: true,
      targetPosition: { x: 300, y: 380 },
    });
    expect(path.getAttribute("d")).not.toBe(initial);
    expect(pathCommandCount(path)).toBe(2);
    const afterSource = path.getAttribute("d");

    diagram.setLayout({
      classes: {
        order: diagram.getLayout().classes!.order!,
        customer: { x: 760, y: 420 },
        membership: { x: 500, y: 560 },
      },
    });
    expect(path.getAttribute("d")).not.toBe(afterSource);
    expect(pathCommandCount(path)).toBe(2);
    expect(endpoint(path, "target").y).toBeCloseTo(
      expectedRowY(diagram, "customer", 0),
      1,
    );
  });

  it("switches routing style through undo and redo without changing semantics", () => {
    const { diagram, host } = createRelationshipDiagram();
    const path = relationshipPath(host, "auto class attribute");
    expect(pathCommandCount(path)).toBeGreaterThan(2);

    diagram.updateRelationship("auto-class-attribute", {
      routing: "straight",
    });
    expect(pathCommandCount(path)).toBe(2);
    expect(diagram.getModel().relationships[2]?.type).toBe("association");

    diagram.undo();
    expect(pathCommandCount(path)).toBeGreaterThan(2);
    expect(diagram.getModel().relationships[2]).not.toHaveProperty("routing");

    diagram.redo();
    expect(pathCommandCount(path)).toBe(2);
    expect(diagram.getModel().relationships[2]?.routing).toBe("straight");
  });

  it("attaches every endpoint combination to the intended semantic row", () => {
    const { diagram, host } = createRelationshipDiagram();
    const classToAttribute = relationshipPath(host, "auto class attribute");
    const attributeToClass = relationshipPath(host, "auto attribute class");
    const attributeToAttribute = relationshipPath(
      host,
      "auto attribute attribute",
    );

    expect(endpoint(classToAttribute, "target").y).toBeCloseTo(
      expectedRowY(diagram, "customer", 1),
      1,
    );
    expect(endpoint(attributeToClass, "source").y).toBeCloseTo(
      expectedRowY(diagram, "order", 1),
      1,
    );
    expect(endpoint(attributeToAttribute, "source").y).toBeCloseTo(
      expectedRowY(diagram, "order", 0),
      1,
    );
    expect(endpoint(attributeToAttribute, "target").y).toBeCloseTo(
      expectedRowY(diagram, "customer", 0),
      1,
    );
    expect(endpoint(classToAttribute, "target").y).not.toBeCloseTo(
      endpoint(attributeToAttribute, "target").y,
      1,
    );
  });

  it("recomputes row attachment after attribute reorder and model replacement", () => {
    const { diagram, host } = createRelationshipDiagram();
    const path = relationshipPath(host, "straight directed");
    const before = endpoint(path, "target").y;
    const model = diagram.getModel();
    const customer = model.classes.find(({ id }) => id === "customer");
    if (!customer?.attributes) throw new Error("Expected customer attributes");
    customer.attributes = [customer.attributes[1]!, customer.attributes[0]!];

    diagram.setModel(model);

    expect(endpoint(path, "target").y).toBeCloseTo(
      expectedRowY(diagram, "customer", 1),
      1,
    );
    expect(endpoint(path, "target").y - before).toBeCloseTo(ROW_HEIGHT, 1);
  });

  it("keeps routing semantic through zoom, resize, setLayout, and auto-layout", async () => {
    const { diagram, host } = createRelationshipDiagram();
    const straight = relationshipPath(host, "straight directed");
    diagram.setZoom(1.4);
    host.style.width = "760px";
    host.style.height = "520px";
    await expect
      .poll(() => Math.round(host.querySelector("svg")?.getBoundingClientRect().width ?? 0))
      .toBe(760);
    expect(pathCommandCount(straight)).toBe(2);

    diagram.setLayout({
      classes: {
        order: { x: -300, y: 300 },
        customer: { x: 900, y: 500 },
        membership: { x: 400, y: 800 },
      },
    });
    expect(pathCommandCount(straight)).toBe(2);
    await diagram.autoLayout();
    expect(pathCommandCount(straight)).toBe(2);
    expect(endpoint(straight, "target").y).toBeCloseTo(
      expectedRowY(diagram, "customer", 0),
      1,
    );
  });

  it("selects attribute-ended relationships and preserves association-class support", () => {
    const { diagram, host } = createRelationshipDiagram();
    const selectionChanged = vi.fn();
    diagram.on("selection-changed", selectionChanged);
    const group = relationshipGroup(host, "auto attribute attribute");
    const wrapper = group.querySelector<SVGElement>('[joint-selector="wrapper"]');
    if (!wrapper) throw new Error("Expected relationship wrapper");

    wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    wrapper.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));

    expect(selectionChanged).toHaveBeenLastCalledWith({
      type: "selection-changed",
      selection: { kind: "relationship", id: "auto-attribute-attribute" },
    });
    expect(
      host.querySelectorAll(
        '[data-type="model-diagram.AssociationClassConnector"]',
      ),
    ).toHaveLength(1);
    expect(diagram.getModel().relationships[4]?.associationClass).toBe(
      "membership",
    );
  });
});
