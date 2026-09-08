import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  type Diagram,
  type DiagramEventType,
  type Position,
} from "../../src/index.js";
import { modelFixture } from "../fixtures.js";

const diagrams: Diagram[] = [];
const nativeResizeObserver = window.ResizeObserver;

interface ResizableDiagram {
  parent: HTMLDivElement;
  host: HTMLDivElement;
  surface: HTMLDivElement;
  diagram: Diagram;
}

function createResizableDiagram(width = 280): ResizableDiagram {
  const parent = document.createElement("div");
  parent.style.width = `${width}px`;
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

async function expectWidth(element: Element, expected: number): Promise<void> {
  await expect
    .poll(() => Math.round(element.getBoundingClientRect().width))
    .toBe(expected);
}

function relationshipWrapper(host: HTMLElement): SVGElement {
  const wrapper = host.querySelector<SVGElement>(
    '[data-type="model-diagram.Relationship"] [joint-selector="wrapper"]',
  );
  if (!wrapper) throw new Error("Expected a relationship wrapper");
  return wrapper;
}

function selectRelationship(host: HTMLElement): void {
  const wrapper = relationshipWrapper(host);
  wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  wrapper.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
}

function waypointHits(host: HTMLElement): SVGCircleElement[] {
  return [
    ...host.querySelectorAll<SVGCircleElement>(
      ".model-diagram-waypoint-hit",
    ),
  ];
}

function expectPosition(actual: Position | undefined, expected: Position): void {
  expect(Math.abs((actual?.x ?? Number.NaN) - expected.x)).toBeLessThanOrEqual(1);
  expect(Math.abs((actual?.y ?? Number.NaN) - expected.y)).toBeLessThanOrEqual(1);
}

afterEach(() => {
  window.ResizeObserver = nativeResizeObserver;
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("CSS-owned host resizing", () => {
  it("expands and shrinks the host and internal paper repeatedly", async () => {
    const { parent, host, surface } = createResizableDiagram();
    const svg = surface.querySelector("svg");
    if (!svg) throw new Error("Expected a JointJS paper SVG");

    expect(host.style.width).toBe("100%");
    expect(host.style.width).not.toMatch(/px$/);
    await expectWidth(host, 280);
    await expectWidth(surface, 280);
    await expectWidth(svg, 280);

    parent.style.width = "500px";
    await expectWidth(host, 500);
    await expectWidth(surface, 500);
    await expectWidth(svg, 500);
    expect(host.style.width).toBe("100%");

    parent.style.width = "240px";
    await expectWidth(host, 240);
    await expectWidth(surface, 240);
    await expectWidth(svg, 240);
    expect(host.style.width).toBe("100%");

    parent.style.width = "420px";
    await expectWidth(host, 420);
    await expectWidth(surface, 420);
    await expectWidth(svg, 420);
  });

  it("preserves zoom, pan, selection, layout, and semantic event silence", async () => {
    const { parent, host, surface, diagram } = createResizableDiagram();
    selectRelationship(host);
    expect(waypointHits(host)).toHaveLength(1);
    const relationshipLine = host.querySelector<SVGPathElement>(
      '[data-type="model-diagram.Relationship"] [joint-selector="line"]',
    );
    expect(relationshipLine?.getAttribute("stroke")).toBe("#2563eb");

    diagram.setZoom(1.75);
    diagram.panBy(43, -27);
    const layers = surface.querySelector<SVGGElement>(".joint-layers");
    if (!layers) throw new Error("Expected JointJS viewport layers");
    const transformBefore = layers.getAttribute("transform");
    const layoutBefore = diagram.getLayout();
    const semanticListener = vi.fn();
    const semanticEvents: DiagramEventType[] = [
      "class-position-preview",
      "class-position-changed",
      "note-position-preview",
      "note-position-changed",
      "relationship-waypoint-added",
      "relationship-waypoint-preview",
      "relationship-waypoint-changed",
      "relationship-waypoint-removed",
      "relationship-route-reset",
      "auto-layout-completed",
    ];
    const unsubscribers = semanticEvents.map((type) =>
      diagram.on(type, semanticListener),
    );

    parent.style.width = "500px";
    parent.style.height = "360px";
    await expectWidth(surface, 500);
    await expect.poll(() => Math.round(surface.getBoundingClientRect().height)).toBe(360);

    expect(layers.getAttribute("transform")).toBe(transformBefore);
    expect(diagram.getLayout()).toEqual(layoutBefore);
    expect(waypointHits(host)).toHaveLength(1);
    expect(relationshipLine?.getAttribute("stroke")).toBe("#2563eb");
    expect(semanticListener).not.toHaveBeenCalled();
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  it("keeps selection, class dragging, and waypoint dragging working", async () => {
    const { parent, host, diagram } = createResizableDiagram();
    parent.style.width = "520px";
    await expectWidth(host, 520);

    const selectionChanged = vi.fn();
    const classCommitted = vi.fn();
    const waypointCommitted = vi.fn();
    diagram.on("selection-changed", selectionChanged);
    diagram.on("class-position-changed", classCommitted);
    diagram.on("relationship-waypoint-changed", waypointCommitted);

    const classBody = host.querySelector<SVGElement>(
      '[data-type="model-diagram.Class"] [joint-selector="body"]',
    );
    if (!classBody) throw new Error("Expected a class body");
    await userEvent.dragAndDrop(classBody, host, {
      force: true,
      targetPosition: { x: 180, y: 170 },
    });
    expectPosition(diagram.getLayout().classes?.person, { x: 180, y: 170 });
    expect(classCommitted).toHaveBeenCalledOnce();
    expect(selectionChanged).toHaveBeenCalledWith({
      type: "selection-changed",
      selection: { kind: "class", id: "person" },
    });

    selectRelationship(host);
    const waypoint = waypointHits(host)[0];
    if (!waypoint) throw new Error("Expected a waypoint hit target");
    await userEvent.dragAndDrop(waypoint, host, {
      force: true,
      targetPosition: { x: 300, y: 260 },
    });
    expectPosition(
      diagram.getLayout().relationships?.["person-party"]?.waypoints?.[0],
      { x: 300, y: 260 },
    );
    expect(waypointCommitted).toHaveBeenCalledOnce();
    expect(selectionChanged).toHaveBeenCalledWith({
      type: "selection-changed",
      selection: {
        kind: "relationship-waypoint",
        relationshipId: "person-party",
        index: 0,
      },
    });
  });

  it("isolates instances and disconnects each host observer on destroy", async () => {
    let activeObservers = 0;

    class TrackingResizeObserver implements ResizeObserver {
      private readonly observer: ResizeObserver;
      private connected = true;

      constructor(callback: ResizeObserverCallback) {
        activeObservers += 1;
        this.observer = new nativeResizeObserver(callback);
      }

      observe(target: Element, options?: ResizeObserverOptions): void {
        this.observer.observe(target, options);
      }

      unobserve(target: Element): void {
        this.observer.unobserve(target);
      }

      disconnect(): void {
        if (this.connected) activeObservers -= 1;
        this.connected = false;
        this.observer.disconnect();
      }
    }

    window.ResizeObserver = TrackingResizeObserver;
    const first = createResizableDiagram(280);
    const second = createResizableDiagram(360);
    expect(activeObservers).toBe(2);

    first.parent.style.width = "500px";
    await expectWidth(first.surface, 500);
    await expectWidth(second.surface, 360);

    first.diagram.destroy();
    expect(activeObservers).toBe(1);
    expect(first.host.isConnected).toBe(true);
    expect(first.host.querySelector(".model-diagram-surface")).toBeNull();

    second.parent.style.width = "440px";
    await expectWidth(second.surface, 440);
    second.diagram.destroy();
    expect(activeObservers).toBe(0);
    expect(second.host.isConnected).toBe(true);
  });
});
