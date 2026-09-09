import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  validateDiagramLayout,
  validateDiagramModel,
  type Diagram,
  type DiagramModel,
  type RelationshipEndpoint,
  type RelationshipRouting,
} from "../src/index.js";

const diagrams: Diagram[] = [];

function endpointModel(): DiagramModel {
  return {
    classes: [
      {
        id: "customer",
        name: "Customer",
        attributes: [
          { name: "code", type: "string" },
          { name: "email", type: "string" },
        ],
      },
      {
        id: "order",
        name: "Order",
        attributes: [{ name: "number", type: "string" }],
      },
    ],
    relationships: [
      {
        id: "order-customer-code",
        type: "directed-association",
        routing: "straight",
        from: { type: "class", classId: "order" },
        to: {
          type: "attribute",
          classId: "customer",
          attributeId: "code",
        },
      },
      {
        id: "number-customer",
        type: "dependency",
        from: {
          type: "attribute",
          classId: "order",
          attributeId: "number",
        },
        to: "customer",
      },
      {
        id: "number-email",
        type: "association",
        from: {
          type: "attribute",
          classId: "order",
          attributeId: "number",
        },
        to: {
          type: "attribute",
          classId: "customer",
          attributeId: "email",
        },
      },
    ],
  };
}

function makeDiagram(model = endpointModel()): Diagram {
  const host = document.createElement("div");
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 600 },
  });
  document.body.append(host);
  const diagram = createDiagram(host, {
    model,
    editable: true,
    autoLayout: false,
    layout: {
      classes: {
        order: { x: 180, y: 200 },
        customer: { x: 700, y: 200 },
      },
    },
  });
  diagrams.push(diagram);
  return diagram;
}

afterEach(() => {
  for (const diagram of diagrams.splice(0)) diagram.destroy();
  document.body.replaceChildren();
});

describe("relationship routing and endpoint model", () => {
  it("exports explicit endpoint and routing types while accepting legacy strings", () => {
    const endpoint: RelationshipEndpoint = {
      type: "attribute",
      classId: "customer",
      attributeId: "code",
    };
    const routing: RelationshipRouting = "straight";
    const model = endpointModel();
    model.relationships.push({
      id: "legacy",
      type: "association",
      from: "order",
      to: "customer",
      routing: "auto",
    });

    expect(endpoint.type).toBe("attribute");
    expect(routing).toBe("straight");
    expect(() => validateDiagramModel(model)).not.toThrow();
  });

  it("strictly validates endpoint shape, ownership, identity, ambiguity, and routing", () => {
    const cases: Array<[mutate: (model: DiagramModel) => void, message: RegExp]> = [
      [
        (model) => {
          model.relationships[0]!.to = {
            type: "attribute",
            classId: "missing",
            attributeId: "code",
          };
        },
        /unknown target class "missing"/,
      ],
      [
        (model) => {
          model.relationships[0]!.to = {
            type: "attribute",
            classId: "customer",
            attributeId: "missing",
          };
        },
        /unknown target attribute "missing" on class "customer"/,
      ],
      [
        (model) => {
          model.classes[0]!.attributes!.push({ name: "code" });
        },
        /ambiguous target attribute "code" on class "customer"/,
      ],
      [
        (model) => {
          Object.assign(model.relationships[0]!, {
            to: { type: "property", classId: "customer", attributeId: "code" },
          });
        },
        /unsupported target endpoint type "property"/,
      ],
      [
        (model) => {
          Object.assign(model.relationships[0]!, { from: { classId: "order" } });
        },
        /malformed source endpoint/,
      ],
      [
        (model) => {
          Object.assign(model.relationships[0]!, { routing: "curved" });
        },
        /unsupported routing "curved"/,
      ],
    ];

    for (const [mutate, message] of cases) {
      const model = endpointModel();
      mutate(model);
      expect(() => validateDiagramModel(model)).toThrowError(message);
    }
  });

  it("rejects stale attribute identities after rename or deletion", () => {
    for (const replacement of [
      [{ name: "renamed_code" }, { name: "email" }],
      [{ name: "email" }],
    ]) {
      const model = endpointModel();
      model.classes[0]!.attributes = replacement;
      expect(() => validateDiagramModel(model)).toThrowError(
        /unknown target attribute "code"/,
      );
    }

    const diagram = makeDiagram();
    const replacement = diagram.getModel();
    replacement.classes[0]!.attributes = [{ name: "email" }];
    expect(() => diagram.setModel(replacement)).toThrowError(
      /unknown target attribute "code"/,
    );
    expect(diagram.getModel().classes[0]!.attributes).toHaveLength(2);
  });

  it("rejects persisted waypoints and waypoint commands for straight relationships", () => {
    const model = endpointModel();
    expect(() =>
      validateDiagramLayout(
        {
          relationships: {
            "order-customer-code": { waypoints: [{ x: 10, y: 20 }] },
          },
        },
        model,
      ),
    ).toThrowError(/straight relationship layout.*must not contain waypoints/);

    const diagram = makeDiagram(model);
    expect(() =>
      diagram.addRelationshipWaypoint("order-customer-code", { x: 1, y: 2 }),
    ).toThrow(/does not support waypoints/);
    expect(() =>
      diagram.moveRelationshipWaypoint("order-customer-code", 0, { x: 1, y: 2 }),
    ).toThrow(/does not support waypoints/);
    expect(() =>
      diagram.removeRelationshipWaypoint("order-customer-code", 0),
    ).toThrow(/does not support waypoints/);
    expect(() =>
      diagram.resetRelationshipRoute("order-customer-code"),
    ).toThrow(/does not support waypoints/);
    expect(diagram.canUndo()).toBe(false);
  });

  it("requires an existing route to be reset before switching to straight", () => {
    const model = endpointModel();
    model.relationships[2]!.routing = "auto";
    const diagram = makeDiagram(model);
    diagram.addRelationshipWaypoint("number-email", { x: 400, y: 300 });

    expect(() =>
      diagram.updateRelationship("number-email", { routing: "straight" }),
    ).toThrow(/cannot retain waypoints; reset its route first/);
    expect(diagram.getModel().relationships[2]?.routing).toBe("auto");
    expect(diagram.getLayout().relationships?.["number-email"]?.waypoints).toEqual([
      { x: 400, y: 300 },
    ]);
  });

  it("updates routing through semantic events and exact undo and redo", () => {
    const model = endpointModel();
    delete model.relationships[2]!.routing;
    const diagram = makeDiagram(model);
    const changed = vi.fn();
    diagram.on("relationship-changed", changed);

    diagram.updateRelationship("number-email", { routing: "straight" });
    expect(diagram.getModel().relationships[2]?.routing).toBe("straight");
    expect(changed).toHaveBeenLastCalledWith({
      type: "relationship-changed",
      relationshipId: "number-email",
      source: {
        type: "attribute",
        classId: "order",
        attributeId: "number",
      },
      target: {
        type: "attribute",
        classId: "customer",
        attributeId: "email",
      },
      changes: { routing: "straight" },
    });

    diagram.undo();
    expect(diagram.getModel().relationships[2]).not.toHaveProperty("routing");
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ changes: { routing: undefined } }),
    );
    diagram.redo();
    expect(diagram.getModel().relationships[2]?.routing).toBe("straight");
  });

  it("preserves detached endpoint objects across getModel, setModel, layout, and auto-layout", async () => {
    const diagram = makeDiagram();
    const snapshot = diagram.getModel();
    const target = snapshot.relationships[0]!.to;
    if (typeof target === "string" || target.type !== "attribute") {
      throw new Error("Expected an attribute endpoint");
    }
    const customer = snapshot.classes.find(({ id }) => id === "customer");
    if (!customer?.attributes?.[0]) throw new Error("Expected code attribute");
    customer.attributes[0].name = "customer_code";
    target.attributeId = "customer_code";
    expect(diagram.getModel().relationships[0]!.to).toMatchObject({
      attributeId: "code",
    });

    diagram.setModel(snapshot);
    await diagram.whenReady();
    expect(diagram.getModel().relationships[0]!.to).toMatchObject({
      attributeId: "customer_code",
    });
    diagram.setLayout({
      classes: {
        order: { x: -1000, y: 700 },
        customer: { x: 1800, y: -600 },
      },
    });
    await diagram.autoLayout();
    expect(diagram.getModel().relationships[0]!.to).toMatchObject({
      attributeId: "customer_code",
    });
  });
});
