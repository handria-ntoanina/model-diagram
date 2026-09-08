import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiagram, type Diagram, type Position } from "../../src/index.js";
import { modelFixture } from "../fixtures.js";

const diagrams: Diagram[] = [];

function createWaypointDiagram(editable = true): {
  container: HTMLElement;
  diagram: Diagram;
} {
  const container = document.createElement("div");
  container.style.width = "900px";
  container.style.height = "600px";
  container.style.margin = "20px";
  document.body.append(container);
  const diagram = createDiagram(container, {
    model: modelFixture(),
    editable,
    autoLayout: false,
    layout: {
      classes: {
        person: { x: 120, y: 100 },
        party: { x: 700, y: 100 },
        source: { x: 700, y: 450 },
      },
      relationships: {
        "person-party": {
          waypoints: [
            { x: 240, y: 220 },
            { x: 400, y: 280 },
            { x: 560, y: 220 },
          ],
        },
      },
    },
  });
  diagrams.push(diagram);
  return { container, diagram };
}

function relationshipWrapper(container: HTMLElement): SVGElement {
  const wrapper = container.querySelector<SVGElement>(
    '[data-type="model-diagram.Relationship"] [joint-selector="wrapper"]',
  );
  if (!wrapper) throw new Error("Expected a relationship wrapper");
  return wrapper;
}

function selectRelationship(container: HTMLElement): void {
  const wrapper = relationshipWrapper(container);
  wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  wrapper.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
}

function waypointHits(container: HTMLElement): SVGCircleElement[] {
  return [
    ...container.querySelectorAll<SVGCircleElement>(
      ".model-diagram-waypoint-hit",
    ),
  ];
}

async function dragTo(
  container: HTMLElement,
  index: number,
  diagramPosition: Position,
  scale = 1,
  translation: Position = { x: 0, y: 0 },
): Promise<void> {
  const hit = waypointHits(container)[index];
  if (!hit) throw new Error(`Expected waypoint ${index}`);
  await userEvent.dragAndDrop(hit, container, {
    force: true,
    targetPosition: {
      x: translation.x + diagramPosition.x * scale,
      y: translation.y + diagramPosition.y * scale,
    },
  });
}

function expectPosition(actual: Position | undefined, expected: Position): void {
  expect(actual?.x).toBeCloseTo(expected.x, 1);
  expect(actual?.y).toBeCloseTo(expected.y, 1);
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("relationship waypoint pointer dragging", () => {
  it("drags the first, middle, and last waypoint in stable order", async () => {
    const { container, diagram } = createWaypointDiagram();
    const committed = vi.fn();
    diagram.on("relationship-waypoint-changed", committed);
    selectRelationship(container);

    expect(waypointHits(container)).toHaveLength(3);
    expect(waypointHits(container)[0]?.getBoundingClientRect().width).toBeCloseTo(
      28,
      1,
    );
    await dragTo(container, 0, { x: 260, y: 240 });
    await dragTo(container, 1, { x: 420, y: 300 });
    await dragTo(container, 2, { x: 580, y: 240 });

    const waypoints =
      diagram.getLayout().relationships?.["person-party"]?.waypoints;
    expectPosition(waypoints?.[0], { x: 260, y: 240 });
    expectPosition(waypoints?.[1], { x: 420, y: 300 });
    expectPosition(waypoints?.[2], { x: 580, y: 240 });
    expect(committed).toHaveBeenCalledTimes(3);
    expect(
      committed.mock.calls.map(
        ([event]) => (event as { index: number }).index,
      ),
    ).toEqual([0, 1, 2]);
  });

  it("drags repeatedly after zoom and pan with one commit per drag", async () => {
    const { container, diagram } = createWaypointDiagram();
    const previews = vi.fn();
    const committed = vi.fn();
    diagram.on("relationship-waypoint-preview", previews);
    diagram.on("relationship-waypoint-changed", committed);
    selectRelationship(container);

    diagram.setZoom(2);
    diagram.panBy(80, -40);
    expect(waypointHits(container)[1]?.getBoundingClientRect().width).toBeCloseTo(
      28,
      1,
    );
    const translation = { x: -370, y: -340 };
    await dragTo(container, 1, { x: 430, y: 260 }, 2, translation);
    await dragTo(container, 1, { x: 450, y: 250 }, 2, translation);

    const waypoints =
      diagram.getLayout().relationships?.["person-party"]?.waypoints;
    expectPosition(waypoints?.[0], { x: 240, y: 220 });
    expectPosition(waypoints?.[1], { x: 450, y: 250 });
    expectPosition(waypoints?.[2], { x: 560, y: 220 });
    expect(previews.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(committed).toHaveBeenCalledTimes(2);
    const lastEvent = committed.mock.lastCall?.[0] as
      | ({ type: string; relationshipId: string; index: number } & Position)
      | undefined;
    expect(lastEvent?.type).toBe("relationship-waypoint-changed");
    expect(lastEvent?.relationshipId).toBe("person-party");
    expect(lastEvent?.index).toBe(1);
    expectPosition(lastEvent, { x: 450, y: 250 });
  });

  it("keeps handles and waypoint movement disabled in read-only mode", () => {
    const { container, diagram } = createWaypointDiagram(false);
    const committed = vi.fn();
    diagram.on("relationship-waypoint-changed", committed);
    selectRelationship(container);

    expect(waypointHits(container)).toHaveLength(0);
    expect(committed).not.toHaveBeenCalled();
    expect(diagram.getLayout().relationships?.["person-party"]?.waypoints).toEqual([
      { x: 240, y: 220 },
      { x: 400, y: 280 },
      { x: 560, y: 220 },
    ]);
  });
});
