import { describe, expect, it } from "vitest";
import { getRelationshipAppearance } from "../src/routing/relationship-style.js";

describe("UML relationship appearances", () => {
  it("uses no endpoint markers for an association", () => {
    expect(getRelationshipAppearance("association")).toEqual({});
  });

  it("uses an open marker only at the target of a directed association", () => {
    const appearance = getRelationshipAppearance("directed-association");
    expect(appearance.sourceMarker).toBeUndefined();
    expect(appearance.targetMarker).toMatchObject({
      fill: "none",
      stroke: "#334155",
    });
  });

  it("uses hollow and filled diamonds for aggregation and composition", () => {
    expect(getRelationshipAppearance("aggregation").sourceMarker?.fill).toBe(
      "#ffffff",
    );
    expect(getRelationshipAppearance("composition").sourceMarker?.fill).toBe(
      "#334155",
    );
    expect(getRelationshipAppearance("aggregation").sourceMarker?.d).toBe(
      getRelationshipAppearance("composition").sourceMarker?.d,
    );
  });

  it("uses a hollow target triangle for inheritance", () => {
    const marker = getRelationshipAppearance("inheritance").targetMarker;
    expect(marker).toMatchObject({ fill: "#ffffff", stroke: "#334155" });
    expect(marker?.d).toContain("Z");
  });

  it("uses a dashed open arrow for dependency", () => {
    const appearance = getRelationshipAppearance("dependency");
    expect(appearance.strokeDasharray).toBe("7 5");
    expect(appearance.targetMarker?.fill).toBe("none");
  });
});
