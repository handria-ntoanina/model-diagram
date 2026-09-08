import type { DiagramModel } from "../src/model/types.js";

export function modelFixture(): DiagramModel {
  return {
    classes: [
      {
        id: "person",
        name: "Person",
        note: "A human party.",
        attributes: [
          { name: "name", type: "string", required: true },
          { name: "aliases", type: "string", multiplicity: "0..*" },
        ],
      },
      { id: "party", name: "Party" },
      { id: "source", name: "Source", note: "Evidence." },
    ],
    relationships: [
      {
        id: "person-party",
        from: "person",
        to: "party",
        type: "inheritance",
      },
      {
        id: "party-source",
        from: "party",
        to: "source",
        type: "association",
        role: "supported by",
        fromMultiplicity: "1",
        toMultiplicity: "0..*",
      },
    ],
  };
}
