import { describe, expect, it } from "vitest";
import type { RelationshipType } from "../src/model/types.js";
import { getRelationshipAppearance } from "../src/routing/relationship-style.js";

describe("UML relationship appearances", () => {
  const types: RelationshipType[] = [
    "association",
    "aggregation",
    "composition",
    "inheritance",
    "dependency",
  ];

  it.each(types)("defines a visible semantic appearance for %s", (type) => {
    const appearance = getRelationshipAppearance(type);
    expect(
      appearance.sourceMarker ??
        appearance.targetMarker ??
        appearance.strokeDasharray,
    ).toBeTruthy();
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
