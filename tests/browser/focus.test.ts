import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  type Diagram,
  type DiagramAttribute,
  type DiagramEventType,
  type DiagramModel,
} from "../../src/index.js";

const diagrams: Diagram[] = [];

function createFocusDiagram(options: {
  width?: number;
  height?: number;
  targetX?: number;
  targetY?: number;
  attributes?: DiagramAttribute[];
} = {}): { diagram: Diagram; host: HTMLDivElement } {
  const host = document.createElement("div");
  host.style.width = `${options.width ?? 720}px`;
  host.style.height = `${options.height ?? 480}px`;
  document.body.append(host);

  const model: DiagramModel = {
    classes: [
      {
        id: "customer",
        name: "Customer",
        attributes: options.attributes ?? [
          { name: "id", type: "string" },
          { name: "email", type: "string" },
        ],
      },
      { id: "order", name: "Order" },
    ],
    relationships: [],
  };
  const diagram = createDiagram(host, {
    model,
    editable: true,
    autoLayout: false,
    layout: {
      classes: {
        customer: {
          x: options.targetX ?? 360,
          y: options.targetY ?? 240,
        },
        order: { x: 900, y: 700 },
      },
    },
  });
  diagrams.push(diagram);
  return { diagram, host };
}

function classElement(host: HTMLElement, name: string): SVGGElement {
  const element = [
    ...host.querySelectorAll<SVGGElement>(
      '[data-type="model-diagram.Class"]',
    ),
  ].find((candidate) => candidate.textContent?.includes(name));
  if (!element) throw new Error(`Expected rendered class ${name}`);
  return element;
}

function viewportScale(host: HTMLElement): number {
  const transform = host
    .querySelector<SVGGElement>(".joint-layers")
    ?.getAttribute("transform");
  if (!transform) return 1;
  return new DOMMatrix(transform).a;
}

function expectInsideViewport(element: Element, host: HTMLElement): void {
  const elementBounds = element.getBoundingClientRect();
  const hostBounds = host.getBoundingClientRect();
  expect(elementBounds.left).toBeGreaterThanOrEqual(hostBounds.left);
  expect(elementBounds.top).toBeGreaterThanOrEqual(hostBounds.top);
  expect(elementBounds.right).toBeLessThanOrEqual(hostBounds.right);
  expect(elementBounds.bottom).toBeLessThanOrEqual(hostBounds.bottom);
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("semantic focus viewport behavior", () => {
  it("brings an off-screen class into view without semantic changes", () => {
    const { diagram, host } = createFocusDiagram({
      targetX: 5000,
      targetY: -4000,
    });
    const customer = classElement(host, "Customer");
    const modelBefore = diagram.getModel();
    const layoutBefore = diagram.getLayout();
    const semanticListener = vi.fn();
    const semanticEvents: DiagramEventType[] = [
      "class-position-preview",
      "class-position-changed",
      "relationship-changed",
      "history-changed",
    ];
    const unsubscribers = semanticEvents.map((type) =>
      diagram.on(type, semanticListener),
    );

    expect(customer.getBoundingClientRect().left).toBeGreaterThan(
      host.getBoundingClientRect().right,
    );
    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);

    expectInsideViewport(customer, host);
    expect(diagram.getModel()).toEqual(modelBefore);
    expect(diagram.getLayout()).toEqual(layoutBefore);
    expect(diagram.canUndo()).toBe(false);
    expect(semanticListener).not.toHaveBeenCalled();
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  it("centers a partially visible class while preserving a useful zoom", () => {
    const { diagram, host } = createFocusDiagram({ targetX: 680 });
    const customer = classElement(host, "Customer");
    expect(customer.getBoundingClientRect().right).toBeGreaterThan(
      host.getBoundingClientRect().right,
    );

    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);

    expect(viewportScale(host)).toBeCloseTo(1);
    expectInsideViewport(customer, host);
    const customerCenter = customer.getBoundingClientRect().x +
      customer.getBoundingClientRect().width / 2;
    const hostCenter = host.getBoundingClientRect().x +
      host.getBoundingClientRect().width / 2;
    expect(customerCenter).toBeCloseTo(hostCenter, 0);
  });

  it("zooms a tiny class to readability", () => {
    const { diagram, host } = createFocusDiagram();
    diagram.setZoom(0.1);

    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);

    expect(viewportScale(host)).toBeCloseTo(0.75);
    expectInsideViewport(classElement(host, "Customer"), host);
  });

  it("does not change an already readable and comfortably visible viewport", () => {
    const { diagram, host } = createFocusDiagram();
    diagram.setZoom(1.25);
    const layers = host.querySelector<SVGGElement>(".joint-layers");
    const viewportBefore = layers?.getAttribute("transform");

    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);

    expect(viewportScale(host)).toBeCloseTo(1.25);
    expect(layers?.getAttribute("transform")).toBe(viewportBefore);
  });

  it("focuses a requested attribute row in a tall owning class", () => {
    const attributes = Array.from({ length: 30 }, (_, index) => ({
      name: `field_${index}`,
      type: "string",
    }));
    const { diagram, host } = createFocusDiagram({
      height: 300,
      targetX: 3000,
      targetY: 2000,
      attributes,
    });
    const selectionChanged = vi.fn();
    diagram.on("selection-changed", selectionChanged);

    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "customer",
        attributeId: "field_24",
        select: true,
      }),
    ).toBe(true);

    expect(viewportScale(host)).toBeGreaterThanOrEqual(0.75);
    const attributeLine = [
      ...classElement(host, "Customer").querySelectorAll("tspan"),
    ].find((candidate) => candidate.textContent?.includes("field_24"));
    if (!attributeLine) throw new Error("Expected the focused attribute row");
    const rowBounds = attributeLine.getBoundingClientRect();
    const hostBounds = host.getBoundingClientRect();
    expect(rowBounds.top).toBeGreaterThanOrEqual(hostBounds.top);
    expect(rowBounds.bottom).toBeLessThanOrEqual(hostBounds.bottom);
    expect(rowBounds.height).toBeGreaterThanOrEqual(8);
    expect(selectionChanged).toHaveBeenCalledWith({
      type: "selection-changed",
      selection: { kind: "class", id: "customer" },
    });
  });

  it("focuses correctly after a real host resize and manual pan and zoom", async () => {
    const { diagram, host } = createFocusDiagram({ targetX: 2200, targetY: 1600 });
    host.style.width = "460px";
    host.style.height = "340px";
    await expect
      .poll(() => Math.round(host.querySelector("svg")?.getBoundingClientRect().width ?? 0))
      .toBe(460);
    diagram.setZoom(0.3);
    diagram.panBy(-800, 600);

    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);

    expectInsideViewport(classElement(host, "Customer"), host);
    expect(viewportScale(host)).toBeCloseTo(0.75);
  });

  it("focuses a class after it has been manually moved", async () => {
    const { diagram, host } = createFocusDiagram();
    const customer = classElement(host, "Customer");
    const body = customer.querySelector<SVGElement>('[joint-selector="body"]');
    if (!body) throw new Error("Expected the class body");

    await userEvent.dragAndDrop(body, host, {
      force: true,
      targetPosition: { x: 690, y: 450 },
    });
    expect(customer.getBoundingClientRect().right).toBeGreaterThan(
      host.getBoundingClientRect().right,
    );

    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);

    expectInsideViewport(customer, host);
    expect(diagram.canUndo()).toBe(true);
  });
});
