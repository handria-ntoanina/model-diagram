import { afterEach, describe, expect, it } from "vitest";
import {
  createDiagram,
  type AttributeMarkerMode,
  type Diagram,
  type DiagramModel,
} from "../../src/index.js";

const diagrams: Diagram[] = [];

function createMarkerDiagram(mode?: AttributeMarkerMode): {
  diagram: Diagram;
  host: HTMLDivElement;
} {
  const host = document.createElement("div");
  host.style.width = "900px";
  host.style.height = "500px";
  document.body.append(host);
  const model: DiagramModel = {
    classes: [
      {
        id: "component",
        name: "Component",
        attributes: [
          { name: "id", required: true, visibility: "public" },
          { name: "internalState", visibility: "private" },
          { name: "value", visibility: "protected" },
          { name: "helper", visibility: "package" },
          { name: "label" },
        ],
      },
      { id: "consumer", name: "Consumer" },
    ],
    relationships: [
      {
        id: "consumer-value",
        type: "association",
        from: "consumer",
        to: {
          type: "attribute",
          classId: "component",
          attributeId: "value",
        },
      },
    ],
  };
  const diagram = createDiagram(host, {
    model,
    attributeMarkerMode: mode,
    autoLayout: false,
    layout: {
      classes: {
        consumer: { x: 160, y: 230 },
        component: { x: 650, y: 230 },
      },
    },
  });
  diagrams.push(diagram);
  return { diagram, host };
}

function attributeLines(host: HTMLElement): SVGTextElement {
  const text = host.querySelector<SVGTextElement>(
    '[data-type="model-diagram.Class"] [joint-selector="attributes"]',
  );
  if (!text) throw new Error("Expected rendered attributes");
  return text;
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("attribute marker rendering", () => {
  it("renders every UML visibility symbol and defaults missing visibility to public", () => {
    const { host } = createMarkerDiagram("visibility");
    expect(attributeLines(host).textContent).toContain("+ id");
    expect(attributeLines(host).textContent).toContain("- internalState");
    expect(attributeLines(host).textContent).toContain("# value");
    expect(attributeLines(host).textContent).toContain("~ helper");
    expect(attributeLines(host).textContent).toContain("+ label");
  });

  it("keeps requiredness as the default and renders none without leading space", () => {
    const { diagram, host } = createMarkerDiagram();
    expect(attributeLines(host).textContent).toContain("● id");
    expect(attributeLines(host).textContent).toContain("○ internalState");
    diagram.setAttributeMarkerMode("none");
    const rows = [...attributeLines(host).querySelectorAll("tspan")].map(
      (row) => row.textContent,
    );
    expect(rows).toContain("id");
    expect(rows).toContain("internalState");
    expect(rows.every((row) => row === row?.trimStart())).toBe(true);
  });

  it("keeps class and attribute endpoint geometry stable across runtime changes", () => {
    const { diagram, host } = createMarkerDiagram("requiredness");
    const body = host.querySelector<SVGRectElement>(
      '[data-type="model-diagram.Class"] [joint-selector="body"]',
    );
    const path = host.querySelector<SVGPathElement>(
      '[data-type="model-diagram.Relationship"] [joint-selector="line"]',
    );
    if (!body || !path) throw new Error("Expected rendered diagram geometry");
    const before = {
      width: body.getBoundingClientRect().width,
      height: body.getBoundingClientRect().height,
      endpointY: path.getPointAtLength(path.getTotalLength()).y,
    };

    diagram.setAttributeMarkerMode("visibility");
    expect(attributeLines(host).textContent).toContain("# value");
    expect(body.getBoundingClientRect().width).toBeCloseTo(before.width);
    expect(body.getBoundingClientRect().height).toBeCloseTo(before.height);
    expect(path.getPointAtLength(path.getTotalLength()).y).toBeCloseTo(
      before.endpointY,
    );
    expect(
      diagram.focusElement({
        type: "attribute",
        classId: "component",
        attributeId: "value",
      }),
    ).toBe(true);

    diagram.setAttributeMarkerMode("none");
    expect(path.getPointAtLength(path.getTotalLength()).y).toBeCloseTo(
      before.endpointY,
    );
  });
});
