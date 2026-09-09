import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  type ClassContentMode,
  type Diagram,
  type DiagramEventType,
  type DiagramModel,
  type LayoutEngine,
  type LayoutRenderingContext,
  type Position,
} from "../src/index.js";

const diagrams: Diagram[] = [];

function contentModel(): DiagramModel {
  return {
    classes: [
      {
        id: "customer",
        name: "Customer",
        attributes: [
          { name: "code", type: "string", required: true },
          { name: "email", type: "string" },
        ],
      },
      {
        id: "order",
        name: "Order",
        attributes: [{ name: "number", type: "string" }],
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
      },
      {
        id: "number-customer",
        type: "dependency",
        from: {
          type: "attribute",
          classId: "order",
          attributeId: "number",
        },
        to: "customer",
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
      },
    ],
  };
}

function makeContainer(): HTMLDivElement {
  const host = document.createElement("div");
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 600 },
  });
  document.body.append(host);
  return host;
}

function makeDiagram(mode?: ClassContentMode): {
  diagram: Diagram;
  host: HTMLDivElement;
} {
  const host = makeContainer();
  const diagram = createDiagram(host, {
    model: contentModel(),
    classContentMode: mode,
    editable: true,
    autoLayout: false,
    layout: {
      classes: {
        order: { x: 180, y: 220 },
        customer: { x: 720, y: 220 },
      },
      relationships: {
        "order-code": { waypoints: [{ x: 460, y: 100 }] },
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

function classHeight(group: SVGGElement): number {
  const value = group
    .querySelector<SVGRectElement>('[joint-selector="body"]')
    ?.getAttribute("height");
  if (value === null || value === undefined) {
    throw new Error("Expected class body height");
  }
  return Number(value);
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("class content rendering mode", () => {
  it("defaults to full rendering and exports the public mode type", () => {
    const mode: ClassContentMode = "full";
    const { host } = makeDiagram();
    const customer = classGroup(host, "Customer");
    const attributes = customer.querySelector<SVGTextElement>(
      '[joint-selector="attributes"]',
    );

    expect(mode).toBe("full");
    expect(attributes?.textContent).toContain("● code: string");
    expect(attributes?.textContent).toContain("○ email: string");
    expect(classHeight(customer)).toBe(118);
  });

  it("renders compact name-only classes without changing semantic or portable state", () => {
    const { diagram, host } = makeDiagram("name-only");
    const modelBefore = diagram.getModel();
    const layoutBefore = diagram.getLayout();
    const customer = classGroup(host, "Customer");
    const attributes = customer.querySelector<SVGTextElement>(
      '[joint-selector="attributes"]',
    );

    expect(customer.textContent).toContain("Customer");
    expect(attributes?.getAttribute("display")).toBe("none");
    expect(classHeight(customer)).toBe(58);
    expect(diagram.getModel()).toEqual(modelBefore);
    expect(diagram.getLayout()).toEqual(layoutBefore);
    expect(diagram.getModel().classes[0]?.attributes).toHaveLength(2);
  });

  it("switches modes without model, layout, waypoint, event, or history mutations", () => {
    const { diagram, host } = makeDiagram();
    const modelBefore = diagram.getModel();
    const layoutBefore = diagram.getLayout();
    const listener = vi.fn();
    const mutationEvents: DiagramEventType[] = [
      "class-position-changed",
      "note-position-changed",
      "relationship-changed",
      "relationship-waypoint-changed",
      "auto-layout-completed",
      "history-changed",
    ];
    const unsubscribers = mutationEvents.map((type) =>
      diagram.on(type, listener),
    );

    diagram.setClassContentMode("name-only");
    expect(classHeight(classGroup(host, "Customer"))).toBe(58);
    diagram.setAttributeMarkerMode("visibility");
    expect(
      classGroup(host, "Customer")
        .querySelector('[joint-selector="attributes"]')
        ?.getAttribute("display"),
    ).toBe("none");
    diagram.setClassContentMode("full");

    expect(classHeight(classGroup(host, "Customer"))).toBe(118);
    expect(
      classGroup(host, "Customer").querySelector(
        '[joint-selector="attributes"]',
      )?.textContent,
    ).toContain("+ code: string");
    expect(diagram.getModel()).toEqual(modelBefore);
    expect(diagram.getLayout()).toEqual(layoutBefore);
    expect(diagram.canUndo()).toBe(false);
    expect(diagram.canRedo()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  it("keeps all attribute endpoint combinations semantic and focusable while hidden", () => {
    const { diagram } = makeDiagram("name-only");
    const modelBefore = diagram.getModel();

    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "customer",
        attributeId: "email",
        select: true,
      }),
    ).toBe(true);
    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "customer",
        attributeId: "missing",
      }),
    ).toBe(false);
    expect(diagram.getModel()).toEqual(modelBefore);
    expect(diagram.getModel().relationships).toEqual(contentModel().relationships);

    diagram.setClassContentMode("full");
    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "customer",
        attributeId: "email",
      }),
    ).toBe(true);
  });

  it("validates constructor and runtime values consistently", () => {
    expect(() =>
      createDiagram(makeContainer(), {
        model: contentModel(),
        classContentMode: "headers" as ClassContentMode,
        autoLayout: false,
      }),
    ).toThrowError(/Unsupported class content mode "headers"/);

    const { diagram } = makeDiagram();
    expect(() =>
      diagram.setClassContentMode("headers" as ClassContentMode),
    ).toThrowError(/Unsupported class content mode "headers"/);
  });

  it("passes the active rendering mode to automatic layout", async () => {
    const contexts: LayoutRenderingContext[] = [];
    const engine: LayoutEngine = {
      layout(
        model: DiagramModel,
        _layout,
        _options,
        rendering,
      ): Promise<Map<string, Position>> {
        if (rendering) contexts.push(rendering);
        return Promise.resolve(
          new Map(
            model.classes.map(({ id }, index) => [
              id,
              { x: 200 + index * 320, y: 200 },
            ]),
          ),
        );
      },
    };
    const diagram = createDiagram(makeContainer(), {
      model: contentModel(),
      classContentMode: "name-only",
      layoutEngine: engine,
      autoLayout: false,
    });
    diagrams.push(diagram);

    await diagram.autoLayout();
    expect(contexts).toEqual([{ classContentMode: "name-only" }]);
  });
});
