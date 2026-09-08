import type { RelationshipType } from "../model/types.js";

export interface MarkerStyle {
  type: "path";
  d: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface RelationshipAppearance {
  strokeDasharray?: string;
  sourceMarker?: MarkerStyle;
  targetMarker?: MarkerStyle;
}

const LINE_COLOR = "#334155";

const openArrow = (): MarkerStyle => ({
  type: "path",
  d: "M 10 -5 0 0 10 5",
  fill: "none",
  stroke: LINE_COLOR,
  strokeWidth: 1.5,
});

const diamond = (fill: string): MarkerStyle => ({
  type: "path",
  d: "M 20 0 10 -6 0 0 10 6 Z",
  fill,
  stroke: LINE_COLOR,
  strokeWidth: 1.5,
});

const triangle = (): MarkerStyle => ({
  type: "path",
  d: "M 14 -7 0 0 14 7 Z",
  fill: "#ffffff",
  stroke: LINE_COLOR,
  strokeWidth: 1.5,
});

export function getRelationshipAppearance(
  type: RelationshipType,
): RelationshipAppearance {
  switch (type) {
    case "association":
      return {};
    case "directed-association":
      return { targetMarker: openArrow() };
    case "aggregation":
      return { sourceMarker: diamond("#ffffff") };
    case "composition":
      return { sourceMarker: diamond(LINE_COLOR) };
    case "inheritance":
      return { targetMarker: triangle() };
    case "dependency":
      return { strokeDasharray: "7 5", targetMarker: openArrow() };
  }
}
