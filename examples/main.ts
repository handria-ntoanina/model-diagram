import "./style.css";
import {
  createDiagram,
  type DiagramEvent,
  type DiagramEventType,
  type DiagramModel,
  type DiagramSelection,
} from "../src/index.js";

const model: DiagramModel = {
  classes: [
    {
      id: "party",
      name: "Party",
      stereotype: "abstract",
      note: "A person or organisation participating in land administration.",
      attributes: [
        { name: "id", type: "UUID", required: true },
        { name: "name", type: "CharacterString", required: true },
      ],
    },
    {
      id: "person",
      name: "Person",
      note: "A natural person. This manually draggable note follows Person until moved.",
      attributes: [
        { name: "givenName", type: "CharacterString", required: true },
        { name: "familyName", type: "CharacterString", required: true },
      ],
    },
    {
      id: "baunit",
      name: "BAUnit",
      stereotype: "featureType",
      note: "The basic administrative unit to which rights and restrictions apply.",
      attributes: [
        { name: "uid", type: "OID", required: true },
        { name: "name", type: "CharacterString" },
        { name: "rrr", type: "RRR", multiplicity: "0..*" },
      ],
    },
    {
      id: "rrr",
      name: "RRR",
      stereotype: "abstract",
      attributes: [
        { name: "share", type: "Fraction" },
        { name: "timeSpec", type: "DateTime", multiplicity: "0..1" },
      ],
    },
    {
      id: "right",
      name: "Right",
      attributes: [
        { name: "type", type: "RightType", required: true },
        { name: "description", type: "CharacterString" },
      ],
    },
    {
      id: "source",
      name: "AdministrativeSource",
      note: "A document or record providing evidence for a model element.",
      attributes: [
        { name: "reference", type: "CharacterString", required: true },
        { name: "date", type: "Date" },
      ],
    },
    {
      id: "student",
      name: "Student",
    },
    {
      id: "course",
      name: "Course",
    },
    {
      id: "enrollment",
      name: "Enrollment",
      attributes: [
        { name: "enrolledAt", type: "Date", required: true },
        { name: "grade", type: "CharacterString" },
      ],
    },
  ],
  relationships: [
    {
      id: "party-baunit",
      from: "party",
      to: "baunit",
      type: "association",
      label: "holds",
      role: "holder / unit",
      fromMultiplicity: "1..*",
      toMultiplicity: "0..*",
    },
    {
      id: "right-baunit",
      from: "right",
      to: "baunit",
      type: "directed-association",
      label: "applies to",
      fromMultiplicity: "0..*",
      toMultiplicity: "1",
    },
    {
      id: "baunit-rrr",
      from: "baunit",
      to: "rrr",
      type: "aggregation",
      role: "interests",
      fromMultiplicity: "1",
      toMultiplicity: "0..*",
    },
    {
      id: "rrr-source",
      from: "rrr",
      to: "source",
      type: "composition",
      role: "evidence",
      fromMultiplicity: "1",
      toMultiplicity: "1..*",
    },
    {
      id: "person-party",
      from: "person",
      to: "party",
      type: "inheritance",
    },
    {
      id: "right-source",
      from: "right",
      to: "source",
      type: "dependency",
      role: "supported by",
    },
    {
      id: "student-course",
      from: "student",
      to: "course",
      type: "association",
      associationClass: "enrollment",
      label: "takes",
      role: "student / course",
      fromMultiplicity: "0..*",
      toMultiplicity: "0..*",
    },
  ],
};

const container = document.querySelector<HTMLElement>("#diagram");
const eventPanel = document.querySelector<HTMLElement>("#events");
if (!container || !eventPanel) throw new Error("Demo elements are missing");
const eventPanelElement = eventPanel;

const diagram = createDiagram(container, { model, editable: true });
let selection: DiagramSelection | null = null;
let zoom = 1;
const eventLog: DiagramEvent[] = [];
const eventTypes: DiagramEventType[] = [
  "selection-changed",
  "class-position-preview",
  "class-position-changed",
  "note-position-preview",
  "note-position-changed",
  "relationship-waypoint-added",
  "relationship-waypoint-preview",
  "relationship-waypoint-changed",
  "relationship-waypoint-removed",
  "relationship-route-reset",
  "relationship-changed",
  "auto-layout-completed",
];

function showEvent(event: DiagramEvent): void {
  if (event.type === "selection-changed") selection = event.selection;
  eventLog.unshift(event);
  eventLog.splice(30);
  eventPanelElement.textContent = eventLog
    .map((item) => JSON.stringify(item, null, 2))
    .join("\n\n");
}

for (const eventType of eventTypes) {
  diagram.on(eventType, showEvent);
}

function selectedRelationshipId(): string | undefined {
  if (selection?.kind === "relationship") return selection.id;
  if (selection?.kind === "relationship-waypoint") {
    return selection.relationshipId;
  }
  return undefined;
}

document.querySelector("#auto-layout")?.addEventListener("click", () => {
  void diagram.autoLayout().then(() => diagram.fitToContent());
});
document.querySelector("#fit")?.addEventListener("click", () =>
  diagram.fitToContent(),
);
document.querySelector("#zoom-in")?.addEventListener("click", () => {
  zoom *= 1.2;
  diagram.setZoom(zoom);
});
document.querySelector("#zoom-out")?.addEventListener("click", () => {
  zoom /= 1.2;
  diagram.setZoom(zoom);
});
document.querySelector("#add-waypoint")?.addEventListener("click", () => {
  const relationshipId = selectedRelationshipId();
  if (!relationshipId) return;
  const relationship = model.relationships.find(({ id }) => id === relationshipId);
  if (!relationship) return;
  const layout = diagram.getLayout();
  const source = layout.classes?.[relationship.from];
  const target = layout.classes?.[relationship.to];
  if (!source || !target) return;
  diagram.addRelationshipWaypoint(relationshipId, {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2 + 70,
  });
});
document.querySelector("#remove-waypoint")?.addEventListener("click", () => {
  const relationshipId = selectedRelationshipId();
  if (!relationshipId) return;
  const waypoints =
    diagram.getLayout().relationships?.[relationshipId]?.waypoints ?? [];
  const index =
    selection?.kind === "relationship-waypoint"
      ? selection.index
      : waypoints.length - 1;
  if (index >= 0) diagram.removeRelationshipWaypoint(relationshipId, index);
});
document.querySelector("#reset-route")?.addEventListener("click", () => {
  const relationshipId = selectedRelationshipId();
  if (relationshipId) diagram.resetRelationshipRoute(relationshipId);
});
document.querySelector<HTMLInputElement>("#editable")?.addEventListener(
  "change",
  (event) => diagram.setEditable((event.currentTarget as HTMLInputElement).checked),
);

void diagram.whenReady().then(() => diagram.fitToContent());
