import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  type Diagram,
  type DiagramEventType,
  type DiagramFocusTarget,
  type DiagramModel,
  type LayoutEngine,
  type Position,
} from "../src/index.js";
import { modelFixture } from "./fixtures.js";

const diagrams: Diagram[] = [];

class ChangingLayoutEngine implements LayoutEngine {
  private offset = 0;

  layout(model: DiagramModel): Promise<Map<string, Position>> {
    this.offset += 100;
    return Promise.resolve(
      new Map(
        model.classes.map(({ id }, index) => [
          id,
          { x: this.offset + index * 320, y: this.offset },
        ]),
      ),
    );
  }
}

function makeContainer(width = 900, height = 600): HTMLElement {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
  document.body.append(container);
  return container;
}

function makeDiagram(): Diagram {
  const model = modelFixture();
  const diagram = createDiagram(makeContainer(), {
    model,
    editable: true,
    autoLayout: false,
    layout: {
      classes: Object.fromEntries(
        model.classes.map(({ id }, index) => [
          id,
          { x: 200 + index * 350, y: 180 },
        ]),
      ),
    },
    layoutEngine: new ChangingLayoutEngine(),
  });
  diagrams.push(diagram);
  return diagram;
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("semantic focus API", () => {
  it("exports a renderer-neutral target and resolves classes and attributes", () => {
    const diagram = makeDiagram();
    const classTarget: DiagramFocusTarget = { type: "class", id: "person" };
    const attributeTarget: DiagramFocusTarget = {
      type: "attribute",
      classId: "person",
      attributeId: "aliases",
    };

    expect(diagram.focusElement(classTarget)).toBe(true);
    expect(diagram.focusElement(attributeTarget)).toBe(true);
  });

  it("fails safely without changing the viewport or selection", () => {
    const diagram = makeDiagram();
    const selectionChanged = vi.fn();
    diagram.on("selection-changed", selectionChanged);
    diagram.setZoom(1.4);
    diagram.panBy(37, -29);
    const layers = document.querySelector<SVGGElement>(".joint-layers");
    const viewportBefore = layers?.getAttribute("transform");

    expect(diagram.focusElement({ type: "class", id: "missing" })).toBe(false);
    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "missing",
        attributeId: "name",
        select: true,
      }),
    ).toBe(false);
    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "person",
        attributeId: "missing",
        select: true,
      }),
    ).toBe(false);
    expect(layers?.getAttribute("transform")).toBe(viewportBefore);
    expect(selectionChanged).not.toHaveBeenCalled();
  });

  it("uses existing class selection semantics only when requested", () => {
    const diagram = makeDiagram();
    const selectionChanged = vi.fn();
    diagram.on("selection-changed", selectionChanged);

    expect(diagram.focusElement({ type: "class", id: "person" })).toBe(true);
    expect(selectionChanged).not.toHaveBeenCalled();

    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "person",
        attributeId: "name",
        select: true,
      }),
    ).toBe(true);
    expect(selectionChanged).toHaveBeenCalledOnce();
    expect(selectionChanged).toHaveBeenCalledWith({
      type: "selection-changed",
      selection: { kind: "class", id: "person" },
    });
  });

  it("does not mutate semantic data, emit edit events, or add history", () => {
    const diagram = makeDiagram();
    const modelBefore = diagram.getModel();
    const layoutBefore = diagram.getLayout();
    const editListener = vi.fn();
    const editEvents: DiagramEventType[] = [
      "class-position-preview",
      "class-position-changed",
      "note-position-preview",
      "note-position-changed",
      "relationship-waypoint-added",
      "relationship-waypoint-preview",
      "relationship-waypoint-changed",
      "relationship-waypoint-removed",
      "relationship-route-reset",
      "relationship-changed",
      "auto-layout-completed",
      "history-changed",
    ];
    const unsubscribers = editEvents.map((type) =>
      diagram.on(type, editListener),
    );

    diagram.panBy(-4000, 3000);
    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "person",
        attributeId: "aliases",
      }),
    ).toBe(true);

    expect(diagram.getModel()).toEqual(modelBefore);
    expect(diagram.getLayout()).toEqual(layoutBefore);
    expect(diagram.canUndo()).toBe(false);
    expect(diagram.canRedo()).toBe(false);
    expect(editListener).not.toHaveBeenCalled();
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  it("continues to work after model, layout, auto-layout, resize, pan, zoom, undo, redo, and reset", async () => {
    const diagram = makeDiagram();
    const nextModel = modelFixture();
    nextModel.classes.push({
      id: "customer",
      name: "Customer",
      attributes: [{ name: "email", type: "string" }],
    });
    diagram.setModel(nextModel);
    await diagram.whenReady();
    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);

    diagram.setLayout({ classes: { customer: { x: 5000, y: -4000 } } });
    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "customer",
        attributeId: "email",
      }),
    ).toBe(true);

    await diagram.autoLayout();
    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);

    const container = document.querySelector<HTMLElement>(".model-diagram");
    if (!container) throw new Error("Expected a diagram container");
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 520 },
      clientHeight: { configurable: true, value: 360 },
    });
    diagram.setZoom(0.2);
    diagram.panBy(700, -900);
    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);

    expect(diagram.canUndo()).toBe(true);
    diagram.undo();
    expect(diagram.canRedo()).toBe(true);
    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);
    expect(diagram.canRedo()).toBe(true);
    diagram.redo();
    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);

    diagram.addRelationshipWaypoint("party-source", { x: 250, y: 220 });
    diagram.resetRelationshipRoute("party-source");
    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);

    diagram.clearHistory();
    expect(diagram.focusElement({ type: "class", id: "customer" })).toBe(true);
    expect(diagram.canUndo()).toBe(false);
    expect(diagram.canRedo()).toBe(false);
  });
});
