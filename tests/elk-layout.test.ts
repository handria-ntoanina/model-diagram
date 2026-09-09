import { describe, expect, it } from "vitest";
import { ElkLayoutEngine } from "../src/layout/elk-layout.js";
import type { DiagramModel } from "../src/model/types.js";
import { classSize } from "../src/rendering/geometry.js";
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

  it("lays out name-only classes using their compact rendered height", async () => {
    const attributes = Array.from({ length: 12 }, (_, index) => ({
      name: `field_${index}`,
    }));
    const model: DiagramModel = {
      classes: [
        { id: "source", name: "Source", attributes },
        { id: "target", name: "Target", attributes },
      ],
      relationships: [
        {
          id: "source-target",
          type: "association",
          from: "source",
          to: "target",
        },
      ],
    };
    const engine = new ElkLayoutEngine();
    const full = await engine.layout(
      model,
      {},
      { direction: "DOWN" },
      { classContentMode: "full" },
    );
    const nameOnly = await engine.layout(
      model,
      {},
      { direction: "DOWN" },
      { classContentMode: "name-only" },
    );
    const fullDistance = Math.abs(full.get("target")!.y - full.get("source")!.y);
    const compactDistance = Math.abs(
      nameOnly.get("target")!.y - nameOnly.get("source")!.y,
    );

    expect(compactDistance).toBeLessThan(fullDistance);
  });

  it("places an association class deterministically near its association", async () => {
    const model: DiagramModel = {
      classes: [
        { id: "student", name: "Student" },
        { id: "course", name: "Course" },
        {
          id: "enrollment",
          name: "Enrollment",
          attributes: [{ name: "enrolledAt", type: "date" }],
        },
      ],
      relationships: [
        {
          id: "student-course",
          type: "association",
          from: "student",
          to: "course",
          associationClass: "enrollment",
        },
      ],
    };
    const engine = new ElkLayoutEngine();
    const first = await engine.layout(model, {}, { direction: "RIGHT" });
    const second = await engine.layout(model, {}, { direction: "RIGHT" });
    expect(second).toEqual(first);

    const student = first.get("student")!;
    const course = first.get("course")!;
    const enrollment = first.get("enrollment")!;
    const midpoint = {
      x: (student.x + course.x) / 2,
      y: (student.y + course.y) / 2,
    };
    expect(Math.abs(enrollment.x - midpoint.x)).toBeLessThanOrEqual(160);
    expect(enrollment.y).toBeGreaterThan(midpoint.y);
    expect(
      enrollment.y - classSize(model.classes[2]!).height / 2,
    ).toBeGreaterThan(midpoint.y);
  });
});
