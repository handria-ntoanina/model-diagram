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

class FixedLayoutEngine implements LayoutEngine {
  layout(model: DiagramModel): Promise<Map<string, Position>> {
    return Promise.resolve(new Map(
      model.classes.map(({ id }, index) => [
        id,
        { x: 100 + index * 300, y: 120 },
      ]),
    ));
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

function relationshipWrapper(container: HTMLElement): SVGElement {
  const wrapper = container.querySelector<SVGElement>(
    '[data-type="model-diagram.Relationship"] [joint-selector="wrapper"]',
  );
  if (!wrapper) throw new Error("Expected a rendered relationship wrapper");
  return wrapper;
}

function selectFirstRelationship(container: HTMLElement): void {
  const wrapper = relationshipWrapper(container);
  wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  wrapper.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
}

function waypointHandles(container: HTMLElement): SVGGElement[] {
  return [...container.querySelectorAll<SVGGElement>(".joint-marker-vertex")];
}

function dragWaypoint(
  container: HTMLElement,
  index: number,
  clientPosition: Position,
  pointerId = 1,
): void {
  const target = waypointHandles(container)[index]?.querySelector(
    ".model-diagram-waypoint-hit",
  );
  if (!target) throw new Error(`Expected waypoint handle ${index}`);
  target.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId,
      clientX: clientPosition.x,
      clientY: clientPosition.y,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      pointerId,
      clientX: clientPosition.x,
      clientY: clientPosition.y,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId,
      clientX: clientPosition.x,
      clientY: clientPosition.y,
    }),
  );
}

function makeDiagram(
  options: { editable?: boolean; layout?: DiagramLayout; autoLayout?: boolean } = {},
): Diagram {
  const diagram = createDiagram(makeContainer(), {
    model: modelFixture(),
    editable: options.editable ?? true,
    layout: options.layout,
    autoLayout: options.autoLayout ?? false,
    layoutEngine: new FixedLayoutEngine(),
  });
  diagrams.push(diagram);
  return diagram;
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("public lifecycle", () => {
  it("renders requiredness by default and switches marker modes without changing the model", () => {
    const container = makeContainer();
    const model = modelFixture();
    Object.assign(model.classes[0]!.attributes![0]!, { visibility: "private" });
    const diagram = createDiagram(container, { model, autoLayout: false });
    diagrams.push(diagram);
    const renderedAttributes = (): string =>
      container.querySelector<SVGElement>('[joint-selector="attributes"]')
        ?.textContent ?? "";
    const semanticModel = diagram.getModel();

    expect(renderedAttributes()).toContain("● name");
    expect(renderedAttributes()).toContain("○ aliases");
    diagram.setAttributeMarkerMode("visibility");
    expect(renderedAttributes()).toContain("- name");
    expect(renderedAttributes()).toContain("+ aliases");
    diagram.setAttributeMarkerMode("none");
    expect(renderedAttributes()).toContain("name: string");
    expect(renderedAttributes()).not.toMatch(/[●○+~-] /);
    expect(diagram.getModel()).toEqual(semanticModel);
    expect(diagram.canUndo()).toBe(false);
  });

  it("preserves attribute visibility through detached snapshots and setModel", () => {
    const diagram = makeDiagram();
    const model = modelFixture();
    model.classes[0]!.attributes![0]!.visibility = "protected";
    diagram.setModel(model);
    const snapshot = diagram.getModel();
    expect(snapshot.classes[0]!.attributes![0]!.visibility).toBe("protected");
    snapshot.classes[0]!.attributes![0]!.visibility = "package";
    expect(diagram.getModel().classes[0]!.attributes![0]!.visibility).toBe(
      "protected",
    );
  });

  it("rejects an invalid runtime marker mode", () => {
    const diagram = makeDiagram();
    expect(() =>
      diagram.setAttributeMarkerMode("symbols" as "visibility"),
    ).toThrowError(/Unsupported attribute marker mode "symbols"/);
  });

  it("supports setModel while preserving stable layout ids", () => {
    const diagram = makeDiagram({
      layout: { classes: { person: { x: 111, y: 222 } } },
    });
    const model = modelFixture();
    model.classes[0]!.name = "Renamed Person";
    diagram.setModel(model);
    expect(diagram.getLayout().classes?.person).toEqual({ x: 111, y: 222 });
  });

  it("applies layout updates without replacing the paper element", () => {
    const container = makeContainer();
    const diagram = createDiagram(container, {
      model: modelFixture(),
      autoLayout: false,
    });
    diagrams.push(diagram);
    const paper = container.querySelector("svg");
    diagram.setLayout({
      classes: { person: { x: -1000, y: 1500 } },
      notes: { person: { x: -700, y: 1500 } },
    });
    expect(container.querySelector("svg")).toBe(paper);
    expect(diagram.getLayout().classes?.person).toEqual({ x: -1000, y: 1500 });
  });

  it("renders relationship roles and both endpoint multiplicities", () => {
    const container = makeContainer();
    const diagram = createDiagram(container, {
      model: modelFixture(),
      autoLayout: false,
    });
    diagrams.push(diagram);
    const relationships = container.querySelectorAll(
      '[data-type="model-diagram.Relationship"]',
    );
    expect(relationships).toHaveLength(2);
    expect([...relationships].map((node) => node.textContent).join(" ")).toContain(
      "supported by10..*",
    );
  });

  it("updates relationship and note connector endpoints in place", () => {
    const container = makeContainer();
    const model = modelFixture();
    const allPositions = Object.fromEntries(
      model.classes.map(({ id }, index) => [
        id,
        { x: 100 + index * 300, y: 100 },
      ]),
    );
    const diagram = createDiagram(container, {
      model,
      layout: { classes: allPositions },
      autoLayout: false,
    });
    diagrams.push(diagram);
    const relationshipPath = container.querySelector(
      '[data-type="model-diagram.Relationship"] [joint-selector="line"]',
    );
    const noteConnectorPath = container.querySelector(
      '[data-type="model-diagram.NoteConnector"] [joint-selector="line"]',
    );
    const relationshipBefore = relationshipPath?.getAttribute("d");
    const noteBefore = noteConnectorPath?.getAttribute("d");
    diagram.setLayout({
      classes: {
        person: { x: -600, y: -400 },
        party: { x: 700, y: 900 },
        source: { x: 1200, y: -800 },
      },
    });
    expect(relationshipPath?.getAttribute("d")).not.toBe(relationshipBefore);
    expect(noteConnectorPath?.getAttribute("d")).not.toBe(noteBefore);
  });

  it("enforces read-only mode for semantic layout mutations", () => {
    const diagram = makeDiagram({ editable: false });
    expect(() =>
      diagram.addRelationshipWaypoint("party-source", { x: 1, y: 2 }),
    ).toThrow("read-only");
    diagram.setEditable(true);
    expect(() =>
      diagram.addRelationshipWaypoint("party-source", { x: 1, y: 2 }),
    ).not.toThrow();
  });

  it("emits one committed event per API mutation after repeated updates", () => {
    const diagram = makeDiagram();
    const listener = vi.fn();
    diagram.on("relationship-waypoint-added", listener);
    diagram.setModel(modelFixture());
    diagram.setModel(modelFixture());
    diagram.setLayout({});
    diagram.setLayout({});
    diagram.addRelationshipWaypoint("party-source", { x: 10, y: 20 });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("supports add, move, remove, and reset waypoint commands", () => {
    const diagram = makeDiagram();
    const events: string[] = [];
    diagram.on("relationship-waypoint-added", ({ type }) => events.push(type));
    diagram.on("relationship-waypoint-changed", ({ type }) => events.push(type));
    diagram.on("relationship-waypoint-removed", ({ type }) => events.push(type));
    diagram.on("relationship-route-reset", ({ type }) => events.push(type));
    diagram.addRelationshipWaypoint("party-source", { x: 10, y: 20 });
    diagram.moveRelationshipWaypoint("party-source", 0, { x: 30, y: 40 });
    diagram.removeRelationshipWaypoint("party-source", 0);
    diagram.addRelationshipWaypoint("party-source", { x: 50, y: 60 });
    diagram.resetRelationshipRoute("party-source");
    expect(events).toEqual([
      "relationship-waypoint-added",
      "relationship-waypoint-changed",
      "relationship-waypoint-removed",
      "relationship-waypoint-added",
      "relationship-route-reset",
    ]);
    expect(diagram.getLayout().relationships).toBeUndefined();
  });

  it("drags first, middle, and last waypoints without reordering them", () => {
    const container = makeContainer();
    const model = modelFixture();
    Object.assign(model.relationships[0]!, {
      type: "composition",
      role: "owns",
      fromMultiplicity: "1",
      toMultiplicity: "0..*",
    });
    const diagram = createDiagram(container, {
      model,
      editable: true,
      autoLayout: false,
      layout: {
        relationships: {
          "person-party": {
            waypoints: [
              { x: 100, y: 110 },
              { x: 200, y: 210 },
              { x: 300, y: 310 },
            ],
          },
        },
      },
    });
    diagrams.push(diagram);
    const committed = vi.fn();
    diagram.on("relationship-waypoint-changed", committed);

    selectFirstRelationship(container);
    expect(waypointHandles(container)).toHaveLength(3);
    expect(
      waypointHandles(container)[0]?.querySelector(
        ".model-diagram-waypoint-marker",
      )?.getAttribute("r"),
    ).toBe("6");
    expect(
      waypointHandles(container)[0]?.querySelector(
        ".model-diagram-waypoint-hit",
      )?.getAttribute("r"),
    ).toBe("14");
    const relationshipNode = container.querySelector(
      '[data-type="model-diagram.Relationship"]',
    );
    const relationshipLine = relationshipNode?.querySelector(
      '[joint-selector="line"]',
    );
    const stableRendering = {
      labels: relationshipNode?.textContent,
      markerStart: relationshipLine?.getAttribute("marker-start"),
      markerEnd: relationshipLine?.getAttribute("marker-end"),
      strokeDasharray: relationshipLine?.getAttribute("stroke-dasharray"),
    };
    expect(stableRendering.labels).toContain("owns10..*");

    dragWaypoint(container, 0, { x: 120, y: 130 }, 1);
    dragWaypoint(container, 1, { x: 220, y: 230 }, 2);
    dragWaypoint(container, 2, { x: 320, y: 330 }, 3);

    expect(diagram.getLayout().relationships?.["person-party"]?.waypoints).toEqual([
      { x: 120, y: 130 },
      { x: 220, y: 230 },
      { x: 320, y: 330 },
    ]);
    expect(
      committed.mock.calls.map(([event]) => event as Record<string, unknown>),
    ).toEqual([
      {
        type: "relationship-waypoint-changed",
        relationshipId: "person-party",
        index: 0,
        x: 120,
        y: 130,
      },
      {
        type: "relationship-waypoint-changed",
        relationshipId: "person-party",
        index: 1,
        x: 220,
        y: 230,
      },
      {
        type: "relationship-waypoint-changed",
        relationshipId: "person-party",
        index: 2,
        x: 320,
        y: 330,
      },
    ]);
    expect({
      labels: relationshipNode?.textContent,
      markerStart: relationshipLine?.getAttribute("marker-start"),
      markerEnd: relationshipLine?.getAttribute("marker-end"),
      strokeDasharray: relationshipLine?.getAttribute("stroke-dasharray"),
    }).toEqual(stableRendering);
  });

  it("converts repeated waypoint drags through zoom, pan, and container offset", () => {
    const container = makeContainer();
    container.getBoundingClientRect = () =>
      ({ left: 20, top: 30, width: 900, height: 600 }) as DOMRect;
    const diagram = createDiagram(container, {
      model: modelFixture(),
      editable: true,
      autoLayout: false,
      layout: {
        relationships: {
          "person-party": { waypoints: [{ x: 100, y: 100 }] },
        },
      },
    });
    const surface = container.querySelector<HTMLElement>(
      ".model-diagram-surface",
    );
    if (!surface) throw new Error("Expected an internal diagram surface");
    surface.getBoundingClientRect = () => container.getBoundingClientRect();
    diagrams.push(diagram);
    const previews = vi.fn();
    const committed = vi.fn();
    diagram.on("relationship-waypoint-preview", previews);
    diagram.on("relationship-waypoint-changed", committed);
    selectFirstRelationship(container);

    diagram.setZoom(2);
    diagram.panBy(80, -40);
    // At scale 2 the centered zoom translation is (-450, -300), then pan
    // changes it to (-370, -340). Include the container's (20, 30) origin.
    dragWaypoint(container, 0, { x: 150, y: 90 }, 4);
    dragWaypoint(container, 0, { x: 190, y: 130 }, 5);

    expect(diagram.getLayout().relationships?.["person-party"]?.waypoints).toEqual([
      { x: 270, y: 220 },
    ]);
    expect(previews).toHaveBeenCalledTimes(2);
    expect(committed).toHaveBeenCalledTimes(2);
    expect(committed).toHaveBeenLastCalledWith({
      type: "relationship-waypoint-changed",
      relationshipId: "person-party",
      index: 0,
      x: 270,
      y: 220,
    });
  });

  it("does not expose or drag waypoint handles in read-only mode", () => {
    const container = makeContainer();
    const diagram = createDiagram(container, {
      model: modelFixture(),
      editable: false,
      autoLayout: false,
      layout: {
        relationships: {
          "person-party": { waypoints: [{ x: 100, y: 100 }] },
        },
      },
    });
    diagrams.push(diagram);
    const committed = vi.fn();
    diagram.on("relationship-waypoint-changed", committed);

    selectFirstRelationship(container);
    expect(waypointHandles(container)).toHaveLength(0);
    expect(committed).not.toHaveBeenCalled();
    expect(diagram.getLayout().relationships?.["person-party"]?.waypoints).toEqual([
      { x: 100, y: 100 },
    ]);
  });

  it("emits automatic layout but never persists externally", async () => {
    const diagram = makeDiagram();
    const listener = vi.fn();
    diagram.on("auto-layout-completed", listener);
    const layout = await diagram.autoLayout();
    expect(layout.classes?.person).toEqual({ x: 100, y: 120 });
    expect(listener).toHaveBeenCalledWith({
      type: "auto-layout-completed",
      layout,
    });
  });

  it("fits, zooms, and pans with far negative and positive coordinates", () => {
    const diagram = makeDiagram({
      layout: {
        classes: {
          person: { x: -5000, y: -4000 },
          party: { x: 6000, y: 7000 },
        },
        relationships: {
          "party-source": { waypoints: [{ x: 9000, y: -8000 }] },
        },
      },
    });
    expect(() => {
      diagram.fitToContent();
      diagram.setZoom(2);
      diagram.zoomIn();
      diagram.zoomOut();
      diagram.panBy(-400, 900);
    }).not.toThrow();
    expect(diagram.getLayout().relationships?.["party-source"]?.waypoints).toEqual([
      { x: 9000, y: -8000 },
    ]);
  });

  it("destroys idempotently, removes rendering, and rejects later work", () => {
    const container = makeContainer();
    const diagram = createDiagram(container, {
      model: modelFixture(),
      autoLayout: false,
    });
    const surface = container.querySelector(".model-diagram-surface");
    expect(surface).not.toBeNull();
    expect(container.style.width).toBe("");
    expect(container.querySelector("svg")).not.toBeNull();
    diagram.destroy();
    diagram.destroy();
    expect(container.isConnected).toBe(true);
    expect(surface?.isConnected).toBe(false);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.classList.contains("model-diagram")).toBe(false);
    expect(container.style.overflow).toBe("");
    expect(container.style.touchAction).toBe("");
    expect(() => diagram.setModel(modelFixture())).toThrow("destroyed");
  });
});
