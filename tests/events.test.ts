import { describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "../src/events/emitter.js";

describe("semantic events", () => {
  it("delivers preview and committed events as distinct types", () => {
    const emitter = new TypedEventEmitter();
    const preview = vi.fn();
    const committed = vi.fn();
    emitter.on("class-position-preview", preview);
    emitter.on("class-position-changed", committed);
    emitter.emit("class-position-preview", {
      type: "class-position-preview",
      classId: "person",
      x: 10,
      y: 20,
    });
    emitter.emit("class-position-changed", {
      type: "class-position-changed",
      classId: "person",
      x: 30,
      y: 40,
    });
    expect(preview).toHaveBeenCalledOnce();
    expect(committed).toHaveBeenCalledOnce();
  });

  it("uses semantic identities and contains no renderer objects", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();
    emitter.on("selection-changed", listener);
    emitter.emit("selection-changed", {
      type: "selection-changed",
      selection: { kind: "relationship", id: "party-source" },
    });
    const serialized = JSON.stringify(listener.mock.calls[0]?.[0]);
    expect(serialized).toBe(
      '{"type":"selection-changed","selection":{"kind":"relationship","id":"party-source"}}',
    );
    expect(serialized).not.toMatch(/joint|svg|cell/i);
  });

  it("unsubscribe is idempotent and stops delivery", () => {
    const emitter = new TypedEventEmitter();
    const listener = vi.fn();
    const unsubscribe = emitter.on("relationship-route-reset", listener);
    unsubscribe();
    unsubscribe();
    emitter.emit("relationship-route-reset", {
      type: "relationship-route-reset",
      relationshipId: "party-source",
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
