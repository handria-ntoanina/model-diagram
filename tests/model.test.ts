import { describe, expect, it } from "vitest";
import {
  validateDiagramLayout,
  validateDiagramModel,
} from "../src/model/validation.js";
import type { DiagramValidationError } from "../src/model/validation.js";
import { modelFixture } from "./fixtures.js";

describe("model validation", () => {
  it("accepts a valid renderer-neutral model", () => {
    expect(() => validateDiagramModel(modelFixture())).not.toThrow();
  });

  it.each(["public", "private", "protected", "package"] as const)(
    "accepts %s attribute visibility",
    (visibility) => {
      const model = modelFixture();
      model.classes[0]!.attributes![0]!.visibility = visibility;
      expect(() => validateDiagramModel(model)).not.toThrow();
    },
  );

  it("rejects unsupported attribute visibility", () => {
    const model = modelFixture();
    Object.assign(model.classes[0]!.attributes![0]!, { visibility: "internal" });
    expect(() => validateDiagramModel(model)).toThrowError(
      /attributes\[0\] has unsupported visibility "internal"/,
    );
  });

  it("accepts directed associations as a public relationship type", () => {
    const model = modelFixture();
    model.relationships[1]!.type = "directed-association";
    expect(() => validateDiagramModel(model)).not.toThrow();
  });

  it("accepts association classes on plain and directed associations", () => {
    for (const type of ["association", "directed-association"] as const) {
      const model = modelFixture();
      model.relationships[1]!.type = type;
      model.relationships[1]!.associationClass = "person";
      expect(() => validateDiagramModel(model)).not.toThrow();
    }
  });

  it("reports empty and missing association class references clearly", () => {
    const empty = modelFixture();
    empty.relationships[1]!.associationClass = "";
    expect(() => validateDiagramModel(empty)).toThrowError(
      /relationship "party-source" associationClass must not be empty/,
    );

    const missing = modelFixture();
    missing.relationships[1]!.associationClass = "enrollment";
    expect(() => validateDiagramModel(missing)).toThrowError(
      /relationship "party-source" has unknown association class "enrollment"/,
    );
  });

  it.each(["aggregation", "composition"] as const)(
    "rejects associationClass on %s relationships",
    (type) => {
      const model = modelFixture();
      model.relationships[1]!.type = type;
      model.relationships[1]!.associationClass = "person";
      expect(() => validateDiagramModel(model)).toThrowError(
        new RegExp(`type "${type}" does not support associationClass`),
      );
    },
  );

  it("rejects cardinalities used as relationship types", () => {
    const model = modelFixture();
    Object.assign(model.relationships[1]!, { type: "many-to-many" });
    expect(() => validateDiagramModel(model)).toThrowError(
      /unsupported type "many-to-many"/,
    );
  });

  it("reports duplicate class and relationship ids", () => {
    const model = modelFixture();
    model.classes.push({ ...model.classes[0]! });
    model.relationships.push({ ...model.relationships[0]! });
    let thrown: unknown;
    try {
      validateDiagramModel(model);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const issues = (thrown as DiagramValidationError).issues;
    expect(issues).toContain('duplicate class id "person"');
    expect(issues).toContain('duplicate relationship id "person-party"');
  });

  it("reports unknown relationship endpoints clearly", () => {
    const model = modelFixture();
    model.relationships[0]!.from = "missing-source";
    model.relationships[0]!.to = "missing-target";
    expect(() => validateDiagramModel(model)).toThrowError(
      /unknown source class "missing-source"[\s\S]*unknown target class "missing-target"/,
    );
  });

  it("accepts finite class, note, and ordered waypoint coordinates", () => {
    expect(() =>
      validateDiagramLayout(
        {
          classes: { person: { x: -300, y: 20 } },
          notes: { person: { x: 0, y: 40 } },
          relationships: {
            "person-party": {
              waypoints: [
                { x: 1, y: 2 },
                { x: 3, y: 4 },
              ],
            },
          },
        },
        modelFixture(),
      ),
    ).not.toThrow();
  });

  it("rejects non-finite and unknown layout entries", () => {
    expect(() =>
      validateDiagramLayout(
        {
          classes: { missing: { x: Number.NaN, y: 0 } },
          relationships: { unknown: { waypoints: [] } },
        },
        modelFixture(),
      ),
    ).toThrowError(/finite x and y[\s\S]*unknown class[\s\S]*unknown relationship/);
  });
});
