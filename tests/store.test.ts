import { describe, expect, it } from "vitest";
import { defaultNotePosition } from "../src/rendering/geometry.js";
import { DiagramStore } from "../src/rendering/store.js";
import { modelFixture } from "./fixtures.js";

describe("portable layout state", () => {
  it("uses stored class and note centers", () => {
    const store = new DiagramStore(modelFixture(), {
      classes: { person: { x: 420, y: 180 } },
      notes: { person: { x: 720, y: 180 } },
    });
    expect(store.getClassPosition("person")).toEqual({ x: 420, y: 180 });
    expect(store.getNotePosition("person")).toEqual({ x: 720, y: 180 });
    expect(store.hasManualNotePosition("person")).toBe(true);
  });

  it("moves a default note with its class by the same delta", () => {
    const model = modelFixture();
    const store = new DiagramStore(model, {
      classes: { person: { x: 100, y: 100 } },
    });
    const before = store.getNotePosition("person");
    store.setClassPosition("person", { x: 160, y: 75 });
    const after = store.getNotePosition("person");
    expect(after).toEqual({ x: before.x + 60, y: before.y - 25 });
    expect(after).toEqual(
      defaultNotePosition({ x: 160, y: 75 }, model.classes[0]!),
    );
  });

  it("keeps a manually positioned note fixed when its class moves", () => {
    const store = new DiagramStore(modelFixture(), {
      classes: { person: { x: 100, y: 100 } },
      notes: { person: { x: 500, y: -200 } },
    });
    store.setClassPosition("person", { x: -800, y: 900 });
    expect(store.getNotePosition("person")).toEqual({ x: 500, y: -200 });
  });

  it("preserves waypoint order through add, move, and remove", () => {
    const store = new DiagramStore(modelFixture(), {
      relationships: {
        "party-source": {
          waypoints: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
        },
      },
    });
    store.addWaypoint("party-source", { x: 20, y: 30 }, 1);
    store.moveWaypoint("party-source", 2, { x: 35, y: 45 });
    store.removeWaypoint("party-source", 0);
    expect(store.getWaypoints("party-source")).toEqual([
      { x: 20, y: 30 },
      { x: 35, y: 45 },
    ]);
  });

  it("does not lose waypoints when either endpoint moves", () => {
    const store = new DiagramStore(modelFixture(), {
      relationships: {
        "party-source": { waypoints: [{ x: 300, y: 400 }] },
      },
    });
    store.setClassPosition("party", { x: -500, y: -300 });
    store.setClassPosition("source", { x: 900, y: 800 });
    expect(store.getWaypoints("party-source")).toEqual([{ x: 300, y: 400 }]);
  });

  it("resets a route without changing endpoint positions", () => {
    const store = new DiagramStore(modelFixture(), {
      classes: { party: { x: 20, y: 30 }, source: { x: 800, y: 30 } },
      relationships: {
        "party-source": { waypoints: [{ x: 300, y: 400 }] },
      },
    });
    store.resetRoute("party-source");
    expect(store.getWaypoints("party-source")).toEqual([]);
    expect(store.getClassPosition("party")).toEqual({ x: 20, y: 30 });
    expect(store.getClassPosition("source")).toEqual({ x: 800, y: 30 });
  });

  it("isolates coordinates between diagram instances", () => {
    const first = new DiagramStore(modelFixture(), {
      classes: { person: { x: 10, y: 20 } },
    });
    const second = new DiagramStore(modelFixture(), {
      classes: { person: { x: 900, y: 800 } },
    });
    first.setClassPosition("person", { x: -100, y: -200 });
    expect(second.getClassPosition("person")).toEqual({ x: 900, y: 800 });
  });

  it("preserves positions for stable ids across model updates", () => {
    const model = modelFixture();
    const store = new DiagramStore(model, {
      classes: { person: { x: 123, y: 456 } },
    });
    store.setModel({
      ...model,
      classes: model.classes.map((item) =>
        item.id === "person" ? { ...item, name: "Natural Person" } : item,
      ),
    });
    expect(store.getClassPosition("person")).toEqual({ x: 123, y: 456 });
  });

  it("round-trips directed association metadata independently of layout", () => {
    const model = modelFixture();
    Object.assign(model.relationships[1]!, {
      type: "directed-association",
      label: "documents",
      role: "evidence",
      fromMultiplicity: "0..*",
      toMultiplicity: "1",
    });
    const store = new DiagramStore(model, {
      relationships: {
        "party-source": { waypoints: [{ x: 300, y: 240 }] },
      },
    });

    expect(store.getRelationship("party-source")).toEqual(
      model.relationships[1],
    );
    expect(store.getLayout().relationships?.["party-source"]?.waypoints).toEqual(
      [{ x: 300, y: 240 }],
    );
  });

  it("retains class notes and drops removed class and relationship descriptions", () => {
    const model = modelFixture();
    Object.assign(model.classes[0]!, { description: "legacy class text" });
    Object.assign(model.relationships[0]!, {
      description: "legacy relationship text",
    });

    const store = new DiagramStore(model);
    expect(store.model.classes[0]).toMatchObject({ note: "A human party." });
    expect(store.model.classes[0]).not.toHaveProperty("description");
    expect(store.model.relationships[0]).not.toHaveProperty("description");
  });

  it("serializes only manual notes and non-empty routes", () => {
    const store = new DiagramStore(modelFixture(), {
      notes: { person: { x: 70, y: 80 } },
      relationships: {
        "party-source": { waypoints: [{ x: 1, y: 2 }] },
      },
    });
    const layout = store.getLayout();
    expect(layout.notes).toEqual({ person: { x: 70, y: 80 } });
    expect(layout.relationships).toEqual({
      "party-source": { waypoints: [{ x: 1, y: 2 }] },
    });
    expect(layout.notes).not.toHaveProperty("source");
  });
});
