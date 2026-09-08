import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  type Diagram,
  type DiagramModel,
} from "../../src/index.js";

const diagrams: Diagram[] = [];

function model(label: string | undefined): DiagramModel {
  return {
    classes: [
      { id: "person", name: "Person" },
      { id: "parcel", name: "Parcel" },
    ],
    relationships: [
      {
        id: "ownership",
        from: "person",
        to: "parcel",
        type: "association",
        ...(label === undefined ? {} : { label }),
        role: "owner/property",
        fromMultiplicity: "0..*",
        toMultiplicity: "1",
      },
    ],
  };
}

function createLabelDiagram(): {
  host: HTMLDivElement;
  surface: HTMLDivElement;
  diagram: Diagram;
} {
  const host = document.createElement("div");
  host.style.width = "900px";
  host.style.height = "600px";
  document.body.append(host);
  const diagram = createDiagram(host, {
    model: model("owns"),
    editable: true,
    autoLayout: false,
    layout: {
      classes: {
        person: { x: 140, y: 160 },
        parcel: { x: 740, y: 420 },
      },
    },
  });
  diagrams.push(diagram);
  const surface = host.querySelector<HTMLDivElement>(".model-diagram-surface");
  if (!surface) throw new Error("Expected diagram surface");
  return { host, surface, diagram };
}

function labelRoot(host: HTMLElement): SVGGElement {
  const label = host.querySelector<SVGTextElement>(
    ".model-diagram-relationship-label",
  );
  const root = label?.closest<SVGGElement>("[label-idx]");
  if (!root) throw new Error("Expected central relationship label");
  return root;
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("central relationship label placement", () => {
  it("tracks orthogonal and waypoint-routed paths while preserving other labels", () => {
    const { host, diagram } = createLabelDiagram();
    const label = labelRoot(host);
    const initialTransform = label.getAttribute("transform");
    const relationship = label.closest<SVGGElement>(
      '[data-type="model-diagram.Relationship"]',
    );
    expect(initialTransform).toBeTruthy();
    expect(label.querySelector("rect")).toBeNull();
    expect(relationship?.textContent).toContain("owns");
    expect(relationship?.textContent).toContain("owner/property");
    expect(relationship?.textContent).toContain("0..*");
    expect(relationship?.textContent).toContain("1");

    diagram.addRelationshipWaypoint("ownership", { x: 300, y: 500 });
    const routedTransform = label.getAttribute("transform");
    expect(routedTransform).not.toBe(initialTransform);

    diagram.moveRelationshipWaypoint("ownership", 0, { x: 520, y: 80 });
    expect(label.getAttribute("transform")).not.toBe(routedTransform);

    diagram.resetRelationshipRoute("ownership");
    expect(label.getAttribute("transform")).toBe(initialTransform);
  });

  it("reconciles label text in place without changing viewport or editable state", () => {
    const { host, surface, diagram } = createLabelDiagram();
    const relationship = host.querySelector<SVGGElement>(
      '[data-type="model-diagram.Relationship"]',
    );
    if (!relationship) throw new Error("Expected relationship");
    const wrapper = relationship.querySelector<SVGElement>(
      '[joint-selector="wrapper"]',
    );
    const line = relationship.querySelector<SVGPathElement>(
      '[joint-selector="line"]',
    );
    if (!wrapper || !line) throw new Error("Expected relationship paths");
    wrapper.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    wrapper.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, button: 0 }),
    );
    expect(line.getAttribute("stroke")).toBe("#2563eb");
    const changed = vi.fn();
    diagram.on("relationship-changed", changed);
    diagram.setZoom(1.7);
    diagram.panBy(45, -35);
    const layers = surface.querySelector<SVGGElement>(".joint-layers");
    if (!layers) throw new Error("Expected viewport layers");
    const viewport = layers.getAttribute("transform");

    diagram.setModel(model("possesses"));
    expect(
      relationship.querySelector(".model-diagram-relationship-label")
        ?.textContent,
    ).toBe("possesses");
    expect(layers.getAttribute("transform")).toBe(viewport);
    expect(line.getAttribute("stroke")).toBe("#2563eb");
    expect(changed).not.toHaveBeenCalled();

    expect(() =>
      diagram.updateRelationship("ownership", {
        label: "editable state remains enabled",
      }),
    ).not.toThrow();
    expect(changed).toHaveBeenCalledOnce();

    diagram.setModel(model(undefined));
    expect(
      relationship.querySelector(".model-diagram-relationship-label"),
    ).toBeNull();
    expect(layers.getAttribute("transform")).toBe(viewport);
  });
});
