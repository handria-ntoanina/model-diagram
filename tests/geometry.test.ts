import { describe, expect, it } from "vitest";
import { clientToDiagramPosition } from "../src/rendering/geometry.js";

describe("viewport coordinate conversion", () => {
  it("converts client coordinates after zoom and pan", () => {
    expect(
      clientToDiagramPosition(
        { x: 470, y: 290 },
        { x: 20, y: 10 },
        2,
        { x: -150, y: 80 },
      ),
    ).toEqual({ x: 300, y: 100 });
  });

  it("supports negative diagram and viewport coordinates", () => {
    expect(
      clientToDiagramPosition(
        { x: -95, y: 255 },
        { x: 5, y: 15 },
        0.5,
        { x: 100, y: -60 },
      ),
    ).toEqual({ x: -400, y: 600 });
  });
});
