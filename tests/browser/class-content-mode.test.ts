import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  type Diagram,
  type DiagramEventType,
  type DiagramModel,
} from "../../src/index.js";

const diagrams: Diagram[] = [];
const CLASS_WIDTH = 260;
const HEADER_HEIGHT = 58;
const ROW_HEIGHT = 23;
const BODY_PADDING = 14;

function model(): DiagramModel {
  return {
    classes: [
      {
        id: "order",
        name: "Order",
        attributes: [
          { name: "number", type: "string", visibility: "private" },
          { name: "total", type: "decimal" },
        ],
      },
      {
        id: "customer",
        name: "Customer",
        attributes: [
          { name: "code", type: "string", required: true },
          { name: "email", type: "string", visibility: "protected" },
        ],
      },
    ],
    relationships: [
      {
        id: "order-code",
        type: "directed-association",
        routing: "straight",
        from: "order",
        to: {
          type: "attribute",
          classId: "customer",
          attributeId: "code",
        },
        role: "order to code",
      },
      {
        id: "number-customer",
        type: "dependency",
        routing: "straight",
        from: {
          type: "attribute",
          classId: "order",
          attributeId: "number",
        },
        to: "customer",
        role: "number to customer",
      },
      {
        id: "number-email",
        type: "association",
        from: {
          type: "attribute",
          classId: "order",
          attributeId: "number",
        },
        to: {
          type: "attribute",
          classId: "customer",
          attributeId: "email",
        },
        role: "number to email",
      },
      {
        id: "order-email-multiple",
        type: "association",
        routing: "straight",
        from: "order",
        to: {
          type: "attribute",
          classId: "customer",
          attributeId: "email",
        },
        role: "multiple waypoints to email",
      },
    ],
  };
}

function createContentDiagram(classContentMode: "full" | "name-only" = "full"):
  { diagram: Diagram; host: HTMLDivElement } {
  const host = document.createElement("div");
  host.style.width = "1000px";
  host.style.height = "700px";
  document.body.append(host);
  const diagram = createDiagram(host, {
    model: model(),
    classContentMode,
    attributeMarkerMode: "requiredness",
    editable: true,
    autoLayout: false,
    layout: {
      classes: {
        order: { x: 180, y: 240 },
        customer: { x: 820, y: 240 },
      },
      relationships: {
        "order-code": { waypoints: [{ x: 500, y: 100 }] },
        "order-email-multiple": {
          waypoints: [
            { x: 360, y: 520 },
            { x: 650, y: 520 },
          ],
        },
      },
    },
  });
  diagrams.push(diagram);
  return { diagram, host };
}

function classGroup(host: HTMLElement, name: string): SVGGElement {
  const group = [
    ...host.querySelectorAll<SVGGElement>('[data-type="model-diagram.Class"]'),
  ].find((candidate) => candidate.textContent?.includes(name));
  if (!group) throw new Error(`Expected class ${name}`);
  return group;
}

function classBody(host: HTMLElement, name: string): SVGRectElement {
  const body = classGroup(host, name).querySelector<SVGRectElement>(
    '[joint-selector="body"]',
  );
  if (!body) throw new Error(`Expected class body ${name}`);
  return body;
}

function attributeText(host: HTMLElement, name: string): SVGTextElement {
  const text = classGroup(host, name).querySelector<SVGTextElement>(
    '[joint-selector="attributes"]',
  );
  if (!text) throw new Error(`Expected attribute text for ${name}`);
  return text;
}

function relationshipPath(host: HTMLElement, role: string): SVGPathElement {
  const group = [
    ...host.querySelectorAll<SVGGElement>(
      '[data-type="model-diagram.Relationship"]',
    ),
  ].find((candidate) => candidate.textContent?.includes(role));
  const path = group?.querySelector<SVGPathElement>('[joint-selector="line"]');
  if (!path) throw new Error(`Expected relationship ${role}`);
  return path;
}

function endpoint(path: SVGPathElement, end: "source" | "target"): DOMPoint {
  return path.getPointAtLength(end === "source" ? 0 : path.getTotalLength());
}

function pathCommandCount(path: SVGPathElement): number {
  return path.getAttribute("d")?.match(/[MLCQ]/g)?.length ?? 0;
}

function fullClassHeight(attributeCount: number): number {
  return HEADER_HEIGHT + Math.max(ROW_HEIGHT, attributeCount * ROW_HEIGHT) + BODY_PADDING;
}

function rowY(centerY: number, attributeCount: number, index: number): number {
  return centerY - fullClassHeight(attributeCount) / 2 + HEADER_HEIGHT +
    index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function expectOnCompactBoundary(point: DOMPoint, center: { x: number; y: number }): void {
  const left = center.x - CLASS_WIDTH / 2;
  const right = center.x + CLASS_WIDTH / 2;
  const top = center.y - HEADER_HEIGHT / 2;
  const bottom = center.y + HEADER_HEIGHT / 2;
  const distance = Math.min(
    Math.abs(point.x - left),
    Math.abs(point.x - right),
    Math.abs(point.y - top),
    Math.abs(point.y - bottom),
  );
  expect(distance).toBeLessThanOrEqual(3);
  expect(point.x).toBeGreaterThanOrEqual(left - 3);
  expect(point.x).toBeLessThanOrEqual(right + 3);
  expect(point.y).toBeGreaterThanOrEqual(top - 3);
  expect(point.y).toBeLessThanOrEqual(bottom + 3);
}

function markerElement(
  host: HTMLElement,
  path: SVGPathElement,
  end: "start" | "end",
): SVGMarkerElement | null {
  const reference = path.getAttribute(`marker-${end}`);
  const id = reference?.match(/^url\(#(.+)\)$/)?.[1];
  return id ? host.querySelector<SVGMarkerElement>(`marker[id="${id}"]`) : null;
}

function expectInsideViewport(element: Element, host: HTMLElement): void {
  const bounds = element.getBoundingClientRect();
  const viewport = host.getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(viewport.left);
  expect(bounds.top).toBeGreaterThanOrEqual(viewport.top);
  expect(bounds.right).toBeLessThanOrEqual(viewport.right);
  expect(bounds.bottom).toBeLessThanOrEqual(viewport.bottom);
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("class content mode rendering", () => {
  it("renders full classes by default and compact boxes without a blank compartment", () => {
    const { diagram, host } = createContentDiagram();
    const customerBody = classBody(host, "Customer");
    const customerHeader = classGroup(host, "Customer").querySelector<SVGRectElement>(
      '[joint-selector="header"]',
    );
    const attributes = attributeText(host, "Customer");
    const modelBefore = diagram.getModel();
    const layoutBefore = diagram.getLayout();

    expect(customerBody.getBoundingClientRect().height).toBeCloseTo(118);
    expect(customerHeader?.getBoundingClientRect().height).toBeCloseTo(58);
    expect(attributes.textContent).toContain("● code: string");
    expect(attributes.textContent).toContain("○ email: string");

    diagram.setClassContentMode("name-only");

    expect(customerBody.getBoundingClientRect().height).toBeCloseTo(58);
    expect(customerHeader?.getBoundingClientRect().height).toBeCloseTo(58);
    expect(attributes.getAttribute("display")).toBe("none");
    expect(attributes.getBoundingClientRect().height).toBe(0);
    expect(classGroup(host, "Customer").getBoundingClientRect().height).toBeCloseTo(58);
    expect(diagram.getModel()).toEqual(modelBefore);
    expect(diagram.getLayout()).toEqual(layoutBefore);
  });

  it("reattaches semantic attribute endpoints through mode changes and preserves waypoints", () => {
    const { diagram, host } = createContentDiagram();
    const directed = relationshipPath(host, "order to code");
    const attributeToClass = relationshipPath(host, "number to customer");
    const attributeToAttribute = relationshipPath(host, "number to email");
    const multipleWaypoints = relationshipPath(
      host,
      "multiple waypoints to email",
    );
    const modelBefore = diagram.getModel();
    const layoutBefore = diagram.getLayout();
    const fullTargetY = endpoint(directed, "target").y;
    const markerOrientation = markerElement(host, directed, "end")?.getAttribute(
      "orient",
    );

    expect(fullTargetY).toBeCloseTo(rowY(240, 2, 0), 1);
    expect(endpoint(attributeToClass, "source").y).toBeCloseTo(
      rowY(240, 2, 0),
      1,
    );
    expect(endpoint(attributeToAttribute, "target").y).toBeCloseTo(
      rowY(240, 2, 1),
      1,
    );
    expect(pathCommandCount(directed)).toBe(3);
    expect(pathCommandCount(attributeToClass)).toBe(2);
    expect(pathCommandCount(multipleWaypoints)).toBe(4);

    diagram.setClassContentMode("name-only");

    expectOnCompactBoundary(endpoint(directed, "target"), { x: 820, y: 240 });
    expectOnCompactBoundary(endpoint(attributeToClass, "source"), {
      x: 180,
      y: 240,
    });
    expectOnCompactBoundary(endpoint(attributeToAttribute, "source"), {
      x: 180,
      y: 240,
    });
    expectOnCompactBoundary(endpoint(attributeToAttribute, "target"), {
      x: 820,
      y: 240,
    });
    expectOnCompactBoundary(endpoint(multipleWaypoints, "target"), {
      x: 820,
      y: 240,
    });
    expect(pathCommandCount(directed)).toBe(3);
    expect(pathCommandCount(attributeToClass)).toBe(2);
    expect(pathCommandCount(multipleWaypoints)).toBe(4);
    expect(endpoint(directed, "target").y).not.toBeCloseTo(fullTargetY, 1);
    expect(markerElement(host, directed, "end")?.getAttribute("orient")).toBe(
      markerOrientation,
    );
    expect(diagram.getLayout()).toEqual(layoutBefore);
    expect(diagram.getModel()).toEqual(modelBefore);

    diagram.setClassContentMode("full");

    expect(endpoint(directed, "target").y).toBeCloseTo(fullTargetY, 1);
    expect(diagram.getLayout().relationships?.["order-code"]?.waypoints).toEqual([
      { x: 500, y: 100 },
    ]);
    expect(
      diagram.getLayout().relationships?.["order-email-multiple"]?.waypoints,
    ).toEqual([
      { x: 360, y: 520 },
      { x: 650, y: 520 },
    ]);
    expect(diagram.getModel().relationships[0]?.to).toEqual({
      type: "attribute",
      classId: "customer",
      attributeId: "code",
    });
  });

  it("keeps rendering preferences out of events and history and restores marker mode", () => {
    const { diagram, host } = createContentDiagram();
    const listener = vi.fn();
    const mutationEvents: DiagramEventType[] = [
      "class-position-preview",
      "class-position-changed",
      "note-position-preview",
      "note-position-changed",
      "relationship-waypoint-added",
      "relationship-waypoint-changed",
      "relationship-waypoint-removed",
      "relationship-route-reset",
      "relationship-changed",
      "auto-layout-completed",
      "history-changed",
    ];
    const unsubscribers = mutationEvents.map((type) =>
      diagram.on(type, listener),
    );

    diagram.setClassContentMode("name-only");
    diagram.setAttributeMarkerMode("visibility");
    expect(attributeText(host, "Customer").getAttribute("display")).toBe("none");
    diagram.setClassContentMode("full");

    expect(attributeText(host, "Customer").textContent).toContain("# email");
    expect(diagram.canUndo()).toBe(false);
    expect(diagram.canRedo()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  it("focuses a hidden semantic attribute through its owning class", () => {
    const { diagram, host } = createContentDiagram("name-only");
    const selectionChanged = vi.fn();
    diagram.on("selection-changed", selectionChanged);
    diagram.setLayout({
      classes: {
        order: { x: 180, y: 240 },
        customer: { x: 5000, y: -4000 },
      },
      relationships: {
        "order-code": { waypoints: [{ x: 500, y: 100 }] },
        "order-email-multiple": {
          waypoints: [
            { x: 360, y: 520 },
            { x: 650, y: 520 },
          ],
        },
      },
    });

    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "customer",
        attributeId: "email",
        select: true,
      }),
    ).toBe(true);

    expectInsideViewport(classGroup(host, "Customer"), host);
    expect(attributeText(host, "Customer").getBoundingClientRect().height).toBe(0);
    expect(selectionChanged).toHaveBeenLastCalledWith({
      type: "selection-changed",
      selection: { kind: "class", id: "customer" },
    });
    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "customer",
        attributeId: "missing",
      }),
    ).toBe(false);
  });

  it("restores row-specific focus after switching back to full mode", () => {
    const host = document.createElement("div");
    host.style.width = "720px";
    host.style.height = "300px";
    document.body.append(host);
    const attributes = Array.from({ length: 30 }, (_, index) => ({
      name: `field_${index}`,
      type: "string",
    }));
    const diagram = createDiagram(host, {
      model: {
        classes: [{ id: "customer", name: "Customer", attributes }],
        relationships: [],
      },
      classContentMode: "name-only",
      autoLayout: false,
      layout: { classes: { customer: { x: 3000, y: 2000 } } },
    });
    diagrams.push(diagram);

    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "customer",
        attributeId: "field_24",
      }),
    ).toBe(true);
    expectInsideViewport(classGroup(host, "Customer"), host);
    expect(attributeText(host, "Customer").getBoundingClientRect().height).toBe(0);

    diagram.setClassContentMode("full");
    diagram.panBy(2500, -1800);
    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "customer",
        attributeId: "field_24",
      }),
    ).toBe(true);

    const row = [...classGroup(host, "Customer").querySelectorAll("tspan")].find(
      (candidate) => candidate.textContent?.includes("field_24"),
    );
    if (!row) throw new Error("Expected focused attribute row");
    expectInsideViewport(row, host);
    expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(8);
  });

  it("moves compact classes while keeping relationship geometry and waypoints valid", async () => {
    const { diagram, host } = createContentDiagram("name-only");
    const path = relationshipPath(host, "order to code");
    const before = path.getAttribute("d");
    const waypoints = diagram.getLayout().relationships?.["order-code"]?.waypoints;

    await userEvent.dragAndDrop(classBody(host, "Customer"), host, {
      force: true,
      targetPosition: { x: 760, y: 500 },
    });

    expect(path.getAttribute("d")).not.toBe(before);
    expect(diagram.getLayout().relationships?.["order-code"]?.waypoints).toEqual(
      waypoints,
    );
    expectOnCompactBoundary(
      endpoint(path, "target"),
      diagram.getLayout().classes!.customer!,
    );
    expect(diagram.getModel().relationships[0]?.to).toMatchObject({
      type: "attribute",
      attributeId: "code",
    });
  });
});
