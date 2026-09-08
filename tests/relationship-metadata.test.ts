import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  type Diagram,
  type DiagramRelationship,
  type DiagramRelationshipChanges,
} from "../src/index.js";
import { DiagramStore } from "../src/rendering/store.js";
import { modelFixture } from "./fixtures.js";

const diagrams: Diagram[] = [];

function makeContainer(): HTMLDivElement {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientWidth: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 600 },
  });
  document.body.append(container);
  return container;
}

function makeDiagram(
  relationship: Partial<DiagramRelationship> = {},
): { diagram: Diagram; container: HTMLDivElement } {
  const model = modelFixture();
  Object.assign(model.relationships[1]!, {
    type: "directed-association",
    ...relationship,
  });
  const container = makeContainer();
  const diagram = createDiagram(container, {
    model,
    editable: true,
    autoLayout: false,
    layout: {
      classes: {
        person: { x: 100, y: 100 },
        party: { x: 400, y: 100 },
        source: { x: 700, y: 300 },
      },
      relationships: {
        "party-source": { waypoints: [{ x: 520, y: 260 }] },
      },
    },
  });
  diagrams.push(diagram);
  return { diagram, container };
}

function relationshipNode(container: HTMLElement): SVGElement {
  const nodes = container.querySelectorAll<SVGElement>(
    '[data-type="model-diagram.Relationship"]',
  );
  const node = [...nodes].find((candidate) =>
    candidate.textContent?.includes("supported by"),
  );
  if (!node) throw new Error("Expected party-source relationship");
  return node;
}

function relationshipLabel(
  relationship: SVGElement,
  text: string,
): Element | undefined {
  return [...relationship.querySelectorAll("[label-idx]")].find(
    (candidate) => candidate.textContent === text,
  );
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("relationship label", () => {
  it("keeps the public label distinct and normalizes absent text", () => {
    const relationship = {
      id: "ownership",
      from: "person",
      to: "parcel",
      type: "association",
      label: "owns",
      role: "owner",
      fromMultiplicity: "0..*",
      toMultiplicity: "1",
    } satisfies DiagramRelationship;
    const changes = {
      label: relationship.label,
    } satisfies DiagramRelationshipChanges;
    expect(changes).toEqual({ label: "owns" });

    const model = modelFixture();
    Object.assign(model.relationships[0]!, {
      label: "   ",
    });
    const store = new DiagramStore(model);
    expect(store.getRelationship("person-party")).not.toHaveProperty("label");
  });

  it("renders a central label without changing existing labels", () => {
    const { container } = makeDiagram({
      label: "documents",
    });
    const relationship = relationshipNode(container);
    const label = relationshipLabel(relationship, "documents");
    expect(label).toBeDefined();
    expect(label?.querySelector("rect")).toBeNull();
    expect(relationship.textContent).toContain("supported by");
    expect(relationship.textContent).toContain("1");
    expect(relationship.textContent).toContain("0..*");
  });

  it("updates and removes labels through event-silent setModel synchronization", () => {
    const { diagram, container } = makeDiagram({
      label: "before",
    });
    const changed = vi.fn();
    diagram.on("relationship-changed", changed);
    const relationshipBefore = relationshipNode(container);
    const layoutBefore = diagram.getLayout();

    const updated = diagram.getModel();
    Object.assign(updated.relationships[1]!, {
      label: "after",
    });
    diagram.setModel(updated);

    expect(relationshipNode(container)).toBe(relationshipBefore);
    expect(relationshipLabel(relationshipBefore, "after")).toBeDefined();
    expect(diagram.getModel().relationships[1]).toMatchObject({ label: "after" });
    expect(diagram.getLayout()).toEqual(layoutBefore);
    expect(changed).not.toHaveBeenCalled();

    const removed = diagram.getModel();
    delete removed.relationships[1]!.label;
    diagram.setModel(removed);
    expect(relationshipLabel(relationshipBefore, "after")).toBeUndefined();
    expect(diagram.getModel().relationships[1]).not.toHaveProperty("label");
    expect(diagram.getLayout()).toEqual(layoutBefore);
    expect(changed).not.toHaveBeenCalled();
  });

  it("emits semantic label changes and restores them through undo and redo", () => {
    const { diagram, container } = makeDiagram({
      label: "old label",
    });
    const changed = vi.fn();
    diagram.on("relationship-changed", changed);

    diagram.updateRelationship("party-source", {
      label: "new label",
    });
    expect(changed).toHaveBeenLastCalledWith({
      type: "relationship-changed",
      relationshipId: "party-source",
      changes: {
        label: "new label",
      },
    });
    expect(diagram.getModel().relationships[1]).toMatchObject({
      label: "new label",
    });
    expect(relationshipNode(container).textContent).toContain("new label");

    diagram.undo();
    expect(diagram.getModel().relationships[1]).toMatchObject({
      label: "old label",
    });
    expect(changed).toHaveBeenLastCalledWith({
      type: "relationship-changed",
      relationshipId: "party-source",
      changes: {
        label: "old label",
      },
    });

    diagram.redo();
    expect(diagram.getModel().relationships[1]).toMatchObject({
      label: "new label",
    });
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("uses undefined removals in semantic events and history", () => {
    const { diagram } = makeDiagram({
      label: "temporary",
    });
    const changed = vi.fn();
    diagram.on("relationship-changed", changed);

    diagram.updateRelationship("party-source", {
      label: "   ",
    });
    const removal = changed.mock.calls[0]?.[0] as {
      changes: DiagramRelationshipChanges;
    };
    expect(Object.hasOwn(removal.changes, "label")).toBe(true);
    expect(removal.changes).toEqual({ label: undefined });
    expect(diagram.getModel().relationships[1]).not.toHaveProperty("label");

    diagram.undo();
    expect(diagram.getModel().relationships[1]).toMatchObject({
      label: "temporary",
    });
    diagram.redo();
    expect(diagram.getModel().relationships[1]).not.toHaveProperty("label");
  });

  it("does not record unchanged property updates and enforces editable mode", () => {
    const { diagram } = makeDiagram({ label: "same" });
    const changed = vi.fn();
    diagram.on("relationship-changed", changed);
    diagram.updateRelationship("party-source", { label: "same" });
    expect(diagram.canUndo()).toBe(false);
    expect(changed).not.toHaveBeenCalled();

    diagram.setEditable(false);
    expect(() =>
      diagram.updateRelationship("party-source", { label: "blocked" }),
    ).toThrow("read-only");
  });
});
