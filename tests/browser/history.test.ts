import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  type Diagram,
  type LayoutEngine,
  type Position,
} from "../../src/index.js";
import { modelFixture } from "../fixtures.js";

const diagrams: Diagram[] = [];

interface BrowserDiagram {
  parent: HTMLDivElement;
  host: HTMLDivElement;
  surface: HTMLDivElement;
  diagram: Diagram;
}

function createBrowserDiagram(layoutEngine?: LayoutEngine): BrowserDiagram {
  const parent = document.createElement("div");
  parent.style.width = "520px";
  parent.style.height = "500px";
  const host = document.createElement("div");
  host.style.width = "100%";
  host.style.height = "100%";
  parent.append(host);
  document.body.append(parent);

  const diagram = createDiagram(host, {
    model: modelFixture(),
    editable: true,
    autoLayout: false,
    layoutEngine,
    layout: {
      classes: {
        person: { x: 100, y: 100 },
        party: { x: 400, y: 100 },
        source: { x: 400, y: 400 },
      },
      relationships: {
        "person-party": { waypoints: [{ x: 250, y: 220 }] },
      },
    },
  });
  diagrams.push(diagram);
  const surface = host.querySelector<HTMLDivElement>(
    ".model-diagram-surface",
  );
  if (!surface) throw new Error("Expected an internal diagram surface");
  return { parent, host, surface, diagram };
}

function semanticGroup(
  host: HTMLElement,
  type: "Class" | "Note",
  text: string,
): SVGGElement {
  const group = [
    ...host.querySelectorAll<SVGGElement>(
      `[data-type="model-diagram.${type}"]`,
    ),
  ].find((candidate) => candidate.textContent?.includes(text));
  if (!group) throw new Error(`Expected ${type} containing "${text}"`);
  return group;
}

function body(group: SVGGElement): SVGElement {
  const result = group.querySelector<SVGElement>('[joint-selector="body"]');
  if (!result) throw new Error("Expected an element body");
  return result;
}

function selectRelationship(host: HTMLElement): void {
  const wrapper = host.querySelector<SVGElement>(
    '[data-type="model-diagram.Relationship"] [joint-selector="wrapper"]',
  );
  if (!wrapper) throw new Error("Expected a relationship wrapper");
  wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  wrapper.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
}

function waypointHit(host: HTMLElement): SVGCircleElement {
  const hit = host.querySelector<SVGCircleElement>(
    ".model-diagram-waypoint-hit",
  );
  if (!hit) throw new Error("Expected a waypoint hit target");
  return hit;
}

function relationshipPath(host: HTMLElement): SVGPathElement {
  const path = host.querySelector<SVGPathElement>(
    '[data-type="model-diagram.Relationship"] [joint-selector="line"]',
  );
  if (!path) throw new Error("Expected a relationship path");
  return path;
}

function dragElementThrough(
  source: SVGElement,
  host: HTMLElement,
  positions: Position[],
): void {
  const sourceBounds = source.getBoundingClientRect();
  const hostBounds = host.getBoundingClientRect();
  source.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: sourceBounds.left + sourceBounds.width / 2,
      clientY: sourceBounds.top + sourceBounds.height / 2,
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
  const finalPosition = positions.at(-1);
  if (!finalPosition) throw new Error("Expected at least one drag position");
  document.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: hostBounds.left + finalPosition.x,
      clientY: hostBounds.top + finalPosition.y,
    }),
  );
}

function dragWaypointThrough(
  source: SVGCircleElement,
  host: HTMLElement,
  positions: Position[],
): void {
  const sourceBounds = source.getBoundingClientRect();
  const hostBounds = host.getBoundingClientRect();
  const pointerId = 17;
  const surface = source.closest<HTMLElement>(".model-diagram-surface");
  if (!surface) throw new Error("Expected an internal diagram surface");
  surface.setPointerCapture = () => undefined;
  surface.hasPointerCapture = () => false;
  source.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId,
      clientX: sourceBounds.left + sourceBounds.width / 2,
      clientY: sourceBounds.top + sourceBounds.height / 2,
    }),
  );
  for (const position of positions) {
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        button: 0,
        buttons: 1,
        pointerId,
        clientX: hostBounds.left + position.x,
        clientY: hostBounds.top + position.y,
      }),
    );
  }
  const finalPosition = positions.at(-1);
  if (!finalPosition) throw new Error("Expected at least one drag position");
  document.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId,
      clientX: hostBounds.left + finalPosition.x,
      clientY: hostBounds.top + finalPosition.y,
    }),
  );
}

function expectPosition(actual: Position | undefined, expected: Position): void {
  expect(Math.abs((actual?.x ?? Number.NaN) - expected.x)).toBeLessThanOrEqual(2);
  expect(Math.abs((actual?.y ?? Number.NaN) - expected.y)).toBeLessThanOrEqual(2);
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("interaction history", () => {
  it("undoes and redoes one class drag without preview or viewport replay", () => {
    const { host, surface, diagram } = createBrowserDiagram();
    const person = semanticGroup(host, "Class", "Person");
    const visualBefore = person.getAttribute("transform");
    const previews = vi.fn();
    const committed = vi.fn();
    diagram.on("class-position-preview", previews);
    diagram.on("class-position-changed", committed);

    dragElementThrough(body(person), host, [
      { x: 125, y: 120 },
      { x: 150, y: 145 },
      { x: 180, y: 170 },
    ]);
    const visualAfter = person.getAttribute("transform");
    expect(visualAfter).not.toBe(visualBefore);
    expectPosition(diagram.getLayout().classes?.person, { x: 180, y: 170 });
    expect(previews.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(committed).toHaveBeenCalledOnce();
    expect(diagram.canUndo()).toBe(true);
    const previewCount = previews.mock.calls.length;

    diagram.setZoom(1.6);
    diagram.panBy(45, -30);
    const layers = surface.querySelector<SVGGElement>(".joint-layers");
    if (!layers) throw new Error("Expected JointJS viewport layers");
    const viewport = layers.getAttribute("transform");

    diagram.undo();
    expect(person.getAttribute("transform")).toBe(visualBefore);
    expect(diagram.getLayout().classes?.person).toEqual({ x: 100, y: 100 });
    expect(previews).toHaveBeenCalledTimes(previewCount);
    expect(committed).toHaveBeenLastCalledWith({
      type: "class-position-changed",
      classId: "person",
      x: 100,
      y: 100,
    });
    expect(diagram.canUndo()).toBe(false);
    expect(diagram.canRedo()).toBe(true);
    expect(layers.getAttribute("transform")).toBe(viewport);

    diagram.redo();
    expect(person.getAttribute("transform")).toBe(visualAfter);
    expectPosition(diagram.getLayout().classes?.person, { x: 180, y: 170 });
    expect(previews).toHaveBeenCalledTimes(previewCount);
    expect(committed).toHaveBeenCalledTimes(3);
    expect(layers.getAttribute("transform")).toBe(viewport);
  });

  it("restores automatic and manual note positioning across undo and redo", async () => {
    const { host, diagram } = createBrowserDiagram();
    const personNote = semanticGroup(host, "Note", "A human party");
    const visualBefore = personNote.getAttribute("transform");
    expect(diagram.getLayout().notes).toBeUndefined();

    await userEvent.dragAndDrop(body(personNote), host, {
      force: true,
      targetPosition: { x: 250, y: 300 },
    });
    const visualAfter = personNote.getAttribute("transform");
    expect(visualAfter).not.toBe(visualBefore);
    expectPosition(diagram.getLayout().notes?.person, { x: 250, y: 300 });
    expect(diagram.canUndo()).toBe(true);

    diagram.undo();
    expect(personNote.getAttribute("transform")).toBe(visualBefore);
    expect(diagram.getLayout().notes).toBeUndefined();
    expect(diagram.canUndo()).toBe(false);

    diagram.redo();
    expect(personNote.getAttribute("transform")).toBe(visualAfter);
    expectPosition(diagram.getLayout().notes?.person, { x: 250, y: 300 });

    await userEvent.dragAndDrop(body(personNote), host, {
      force: true,
      targetPosition: { x: 320, y: 340 },
    });
    expectPosition(diagram.getLayout().notes?.person, { x: 320, y: 340 });
    diagram.undo();
    expectPosition(diagram.getLayout().notes?.person, { x: 250, y: 300 });
    diagram.redo();
    expectPosition(diagram.getLayout().notes?.person, { x: 320, y: 340 });

    diagram.undo();
    diagram.undo();
    const automaticNotePosition = personNote.getAttribute("transform");
    const person = semanticGroup(host, "Class", "Person");
    dragElementThrough(body(person), host, [
      { x: 140, y: 130 },
      { x: 180, y: 170 },
    ]);
    expect(personNote.getAttribute("transform")).not.toBe(automaticNotePosition);
    expect(diagram.getLayout().notes).toBeUndefined();
    expect(diagram.canRedo()).toBe(false);
  });

  it("replays waypoint visuals and retains CSS-owned resizing afterward", async () => {
    const { parent, host, surface, diagram } = createBrowserDiagram();
    selectRelationship(host);
    const path = relationshipPath(host);
    const visualBefore = path.getAttribute("d");
    const previews = vi.fn();
    const committed = vi.fn();
    diagram.on("relationship-waypoint-preview", previews);
    diagram.on("relationship-waypoint-changed", committed);

    dragWaypointThrough(waypointHit(host), host, [
      { x: 265, y: 230 },
      { x: 280, y: 245 },
      { x: 300, y: 260 },
    ]);
    const visualAfter = path.getAttribute("d");
    expect(visualAfter).not.toBe(visualBefore);
    expectPosition(
      diagram.getLayout().relationships?.["person-party"]?.waypoints?.[0],
      { x: 300, y: 260 },
    );
    const previewCount = previews.mock.calls.length;
    expect(previewCount).toBeGreaterThanOrEqual(3);
    expect(committed).toHaveBeenCalledOnce();
    expect(diagram.canUndo()).toBe(true);

    diagram.undo();
    expect(path.getAttribute("d")).toBe(visualBefore);
    expect(
      diagram.getLayout().relationships?.["person-party"]?.waypoints,
    ).toEqual([{ x: 250, y: 220 }]);
    expect(previews).toHaveBeenCalledTimes(previewCount);
    expect(diagram.canUndo()).toBe(false);
    expect(diagram.canRedo()).toBe(true);

    diagram.redo();
    expect(path.getAttribute("d")).toBe(visualAfter);
    expectPosition(
      diagram.getLayout().relationships?.["person-party"]?.waypoints?.[0],
      { x: 300, y: 260 },
    );
    expect(committed).toHaveBeenCalledTimes(3);

    parent.style.width = "680px";
    await expect
      .poll(() => Math.round(surface.getBoundingClientRect().width))
      .toBe(680);
    expect(Math.round(host.getBoundingClientRect().width)).toBe(680);
    expect(host.style.width).toBe("100%");
  });

  it("keeps the viewport fixed across atomic auto-layout replay", async () => {
    const layoutEngine: LayoutEngine = {
      layout: () =>
        Promise.resolve(
          new Map([
            ["person", { x: -600, y: 700 }],
            ["party", { x: 200, y: 500 }],
            ["source", { x: 1000, y: -400 }],
          ]),
        ),
    };
    const { surface, diagram } = createBrowserDiagram(layoutEngine);
    const before = diagram.getLayout();
    diagram.setZoom(1.8);
    diagram.panBy(-75, 55);
    const layers = surface.querySelector<SVGGElement>(".joint-layers");
    if (!layers) throw new Error("Expected JointJS viewport layers");
    const viewport = layers.getAttribute("transform");

    const after = await diagram.autoLayout();
    expect(after).not.toEqual(before);
    expect(layers.getAttribute("transform")).toBe(viewport);

    diagram.undo();
    expect(diagram.getLayout()).toEqual(before);
    expect(diagram.canUndo()).toBe(false);
    expect(layers.getAttribute("transform")).toBe(viewport);

    diagram.redo();
    expect(diagram.getLayout()).toEqual(after);
    expect(layers.getAttribute("transform")).toBe(viewport);
  });
});
