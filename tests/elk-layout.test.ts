import { describe, expect, it } from "vitest";
import { ElkLayoutEngine } from "../src/layout/elk-layout.js";
import { modelFixture } from "./fixtures.js";

describe("ELK automatic layout", () => {
  it("calculates finite center positions for every class", async () => {
    const positions = await new ElkLayoutEngine().layout(modelFixture());
    expect([...positions.keys()].sort()).toEqual(["party", "person", "source"]);
    for (const position of positions.values()) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
  });

  it("preserves stored positions while laying out only missing classes", async () => {
    const positions = await new ElkLayoutEngine().layout(
      modelFixture(),
      { classes: { person: { x: -400, y: 700 } } },
      { preserveStoredPositions: true },
    );
    expect(positions.get("person")).toEqual({ x: -400, y: 700 });
    expect(positions.get("party")).toBeDefined();
    expect(positions.get("source")).toBeDefined();
  });

  it("rearranges stored positions when preservation is disabled", async () => {
    const positions = await new ElkLayoutEngine().layout(
      modelFixture(),
      { classes: { person: { x: -400, y: 700 } } },
      { preserveStoredPositions: false },
    );
    expect(positions.get("person")).not.toEqual({ x: -400, y: 700 });
  });
});
