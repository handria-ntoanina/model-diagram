import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  type Diagram,
  type DiagramLayout,
  type DiagramModel,
  type LayoutEngine,
  type Position,
} from "../src/index.js";
import { modelFixture } from "./fixtures.js";

const diagrams: Diagram[] = [];

class HistoryLayoutEngine implements LayoutEngine {
  layout(model: DiagramModel): Promise<Map<string, Position>> {
    return Promise.resolve(
      new Map(
        model.classes.map(({ id }, index) => [
          id,
          { x: -500 + index * 700, y: 800 - index * 250 },
        ]),
      ),
    );
  }
}

function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientWidth: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 600 },
  });
  document.body.append(container);
  return container;
}

function makeDiagram(
  layout: DiagramLayout = {},
  editable = true,
): Diagram {
  const diagram = createDiagram(makeContainer(), {
    model: modelFixture(),
    layout,
    editable,
    autoLayout: false,
    layoutEngine: new HistoryLayoutEngine(),
  });
  diagrams.push(diagram);
  return diagram;
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("semantic undo and redo", () => {
  it("tracks basic history, reports deterministic state, and clears redo", () => {
    const diagram = makeDiagram();
    const history = vi.fn();
    const eventOrder: string[] = [];
    diagram.on("history-changed", (event) => {
      history(event);
      eventOrder.push(`history:${event.canUndo}:${event.canRedo}`);
    });
    diagram.on("relationship-waypoint-added", () => {
      eventOrder.push(`add:${diagram.canUndo()}:${diagram.canRedo()}`);
    });
    diagram.on("relationship-waypoint-removed", () => {
      eventOrder.push(`remove:${diagram.canUndo()}:${diagram.canRedo()}`);
    });

    expect(diagram.canUndo()).toBe(false);
    expect(diagram.canRedo()).toBe(false);

    diagram.addRelationshipWaypoint("party-source", { x: 10, y: 20 });
    expect(diagram.canUndo()).toBe(true);
    expect(diagram.canRedo()).toBe(false);
    expect(eventOrder).toEqual(["add:true:false", "history:true:false"]);

    diagram.undo();
    expect(diagram.getLayout().relationships).toBeUndefined();
    expect(diagram.canUndo()).toBe(false);
    expect(diagram.canRedo()).toBe(true);
    expect(eventOrder.slice(-2)).toEqual([
      "remove:false:true",
      "history:false:true",
    ]);

    diagram.redo();
    expect(
      diagram.getLayout().relationships?.["party-source"]?.waypoints,
    ).toEqual([{ x: 10, y: 20 }]);
    expect(diagram.canUndo()).toBe(true);
    expect(diagram.canRedo()).toBe(false);

    diagram.undo();
    diagram.addRelationshipWaypoint("party-source", { x: 30, y: 40 });
    expect(diagram.canRedo()).toBe(false);
    expect(() => diagram.redo()).not.toThrow();
    expect(
      diagram.getLayout().relationships?.["party-source"]?.waypoints,
    ).toEqual([{ x: 30, y: 40 }]);

    diagram.clearHistory();
    expect(diagram.canUndo()).toBe(false);
    expect(diagram.canRedo()).toBe(false);
    expect(history).toHaveBeenLastCalledWith({
      type: "history-changed",
      canUndo: false,
      canRedo: false,
    });
  });

  it("restores exact ordered waypoint lists for move, remove, and reset", () => {
    const original = [
      { x: 100, y: 110 },
      { x: 200, y: 210 },
      { x: 300, y: 310 },
    ];
    const diagram = makeDiagram({
      relationships: { "person-party": { waypoints: original } },
    });
    const changed = vi.fn();
    const added = vi.fn();
    const removed = vi.fn();
    const reset = vi.fn();
    diagram.on("relationship-waypoint-changed", changed);
    diagram.on("relationship-waypoint-added", added);
    diagram.on("relationship-waypoint-removed", removed);
    diagram.on("relationship-route-reset", reset);

    diagram.moveRelationshipWaypoint("person-party", 1, { x: -20, y: 900 });
    diagram.undo();
    expect(
      diagram.getLayout().relationships?.["person-party"]?.waypoints,
    ).toEqual(original);
    expect(changed).toHaveBeenLastCalledWith({
      type: "relationship-waypoint-changed",
      relationshipId: "person-party",
      index: 1,
      x: 200,
      y: 210,
    });
    diagram.redo();
    expect(
      diagram.getLayout().relationships?.["person-party"]?.waypoints,
    ).toEqual([original[0], { x: -20, y: 900 }, original[2]]);

    diagram.clearHistory();
    diagram.removeRelationshipWaypoint("person-party", 1);
    diagram.undo();
    expect(
      diagram.getLayout().relationships?.["person-party"]?.waypoints,
    ).toEqual([original[0], { x: -20, y: 900 }, original[2]]);
    expect(added).toHaveBeenLastCalledWith({
      type: "relationship-waypoint-added",
      relationshipId: "person-party",
      index: 1,
      x: -20,
      y: 900,
    });
    diagram.redo();
    expect(removed).toHaveBeenLastCalledWith({
      type: "relationship-waypoint-removed",
      relationshipId: "person-party",
      index: 1,
    });

    diagram.undo();
    diagram.clearHistory();
    added.mockClear();
    diagram.resetRelationshipRoute("person-party");
    expect(diagram.getLayout().relationships).toBeUndefined();
    diagram.undo();
    expect(
      diagram.getLayout().relationships?.["person-party"]?.waypoints,
    ).toEqual([original[0], { x: -20, y: 900 }, original[2]]);
    expect(
      added.mock.calls.map(
        ([event]) => (event as { index: number }).index,
      ),
    ).toEqual([0, 1, 2]);
    diagram.redo();
    expect(diagram.getLayout().relationships).toBeUndefined();
    expect(reset).toHaveBeenLastCalledWith({
      type: "relationship-route-reset",
      relationshipId: "person-party",
    });
  });

  it("treats auto-layout as one atomic class-position transaction", async () => {
    const diagram = makeDiagram({
      classes: {
        person: { x: -9000, y: -8000 },
        party: { x: 7000, y: 6000 },
        source: { x: 1200, y: -1400 },
      },
      notes: { person: { x: 75, y: 85 } },
      relationships: {
        "person-party": { waypoints: [{ x: 50, y: 60 }] },
      },
    });
    const before = diagram.getLayout();
    const completed = vi.fn();
    diagram.on("auto-layout-completed", completed);

    const after = await diagram.autoLayout();
    expect(after.classes).toEqual({
      person: { x: -500, y: 800 },
      party: { x: 200, y: 550 },
      source: { x: 900, y: 300 },
    });
    expect(diagram.canUndo()).toBe(true);

    diagram.undo();
    expect(diagram.getLayout()).toEqual(before);
    expect(diagram.canUndo()).toBe(false);
    expect(diagram.canRedo()).toBe(true);

    diagram.redo();
    expect(diagram.getLayout()).toEqual(after);
    expect(completed).toHaveBeenCalledTimes(3);
    expect(completed).toHaveBeenLastCalledWith({
      type: "auto-layout-completed",
      layout: after,
    });
  });

  it("does not record automatic initialization as an editable action", async () => {
    const diagram = createDiagram(makeContainer(), {
      model: modelFixture(),
      editable: true,
      autoLayout: true,
      layoutEngine: new HistoryLayoutEngine(),
    });
    diagrams.push(diagram);

    await diagram.whenReady();
    expect(diagram.getLayout().classes?.person).toEqual({ x: -500, y: 800 });
    expect(diagram.canUndo()).toBe(false);
    expect(diagram.canRedo()).toBe(false);
  });

  it("clears stale history for authoritative model and layout replacements", () => {
    const diagram = makeDiagram();
    diagram.addRelationshipWaypoint("party-source", { x: 10, y: 20 });
    diagram.setLayout({
      classes: {
        person: { x: 11, y: 12 },
        party: { x: 21, y: 22 },
        source: { x: 31, y: 32 },
      },
    });
    expect(diagram.canUndo()).toBe(false);
    diagram.undo();
    expect(diagram.getLayout().classes?.person).toEqual({ x: 11, y: 12 });

    diagram.addRelationshipWaypoint("party-source", { x: 30, y: 40 });
    const model = modelFixture();
    model.classes[0]!.name = "Authoritative Person";
    diagram.setModel(model);
    expect(diagram.canUndo()).toBe(false);
    diagram.undo();
    expect(
      diagram.getLayout().relationships?.["party-source"]?.waypoints,
    ).toEqual([{ x: 30, y: 40 }]);
  });

  it("hides and rejects history actions while read-only without corrupting stacks", () => {
    const diagram = makeDiagram();
    diagram.addRelationshipWaypoint("party-source", { x: 10, y: 20 });
    diagram.setEditable(false);
    expect(diagram.canUndo()).toBe(false);
    expect(diagram.canRedo()).toBe(false);
    expect(() => diagram.undo()).toThrow("read-only");
    expect(
      diagram.getLayout().relationships?.["party-source"]?.waypoints,
    ).toEqual([{ x: 10, y: 20 }]);

    diagram.setEditable(true);
    expect(diagram.canUndo()).toBe(true);
    diagram.undo();
    diagram.setEditable(false);
    expect(diagram.canRedo()).toBe(false);
    expect(() => diagram.redo()).toThrow("read-only");
    diagram.setEditable(true);
    expect(diagram.canRedo()).toBe(true);
    diagram.redo();
    expect(
      diagram.getLayout().relationships?.["party-source"]?.waypoints,
    ).toEqual([{ x: 10, y: 20 }]);
  });

  it("keeps history isolated per instance and clears it on destroy", () => {
    const first = makeDiagram();
    const second = makeDiagram();
    first.addRelationshipWaypoint("party-source", { x: 1, y: 2 });

    expect(first.canUndo()).toBe(true);
    expect(second.canUndo()).toBe(false);
    first.undo();
    expect(second.getLayout().relationships).toBeUndefined();

    first.destroy();
    expect(() => first.canUndo()).toThrow("destroyed");
    expect(() => first.canRedo()).toThrow("destroyed");
    expect(second.canUndo()).toBe(false);
  });
});
