# @modern-ant/model-diagram

A framework-neutral TypeScript library for rendering and interactively
arranging portable UML-style model diagrams in a browser. It accepts resolved
JavaScript objects, keeps layout changes in memory, and emits semantic events
that a host can translate into its own persistence format.

The library renders and edits diagram layout in memory and emits semantic
events. It does not persist YAML or project files.

## Responsibility boundary

```text
YAML or another host format
  -> host parser/resolver
  -> portable DiagramModel + DiagramLayout
  -> @modern-ant/model-diagram
  -> interactive diagram
  -> semantic events
  -> host persistence
```

This package does not read or write files, parse YAML, manage Git or locks,
authenticate users, decide permissions, or depend on a particular editor or
UI framework. JointJS is kept behind the internal
`src/jointjs` adapter and no JointJS model, view, cell, vertex, or SVG identity
appears in the public API.

## Installation

```sh
npm install @modern-ant/model-diagram
```

Before publication, use the repository directly through an npm workspace or a
local file dependency:

```json
{
  "dependencies": {
    "@modern-ant/model-diagram": "file:../model-diagram"
  }
}
```

The package is ESM-first and includes TypeScript declarations and source maps.
The host must give the container a non-zero width and height. The host remains
consumer-owned: its CSS controls its dimensions, and the package sizes a
library-owned child rendering surface to the host's current bounds. A
`ResizeObserver` keeps that internal surface synchronized when flex, grid,
block, or resizable-panel layout changes the host size.

## Minimal usage

```ts
import {
  createDiagram,
  type DiagramLayout,
  type DiagramModel,
} from "@modern-ant/model-diagram";

const model: DiagramModel = {
  classes: [
    {
      id: "parcel",
      name: "Parcel",
      stereotype: "featureType",
      note: "A registered spatial unit.",
      attributes: [
        { name: "id", type: "UUID", required: true },
        { name: "area", type: "Measure", multiplicity: "0..1" },
      ],
    },
    { id: "right", name: "Right" },
  ],
  relationships: [
    {
      id: "parcel-right",
      from: "parcel",
      to: "right",
      type: "association",
      label: "is subject to",
      role: "parcel / applicable right",
      fromMultiplicity: "1",
      toMultiplicity: "0..*",
    },
  ],
};

const storedLayout: DiagramLayout = {
  classes: { parcel: { x: 300, y: 180 } },
  relationships: {
    "parcel-right": { waypoints: [{ x: 540, y: 260 }] },
  },
};

const diagram = createDiagram(document.querySelector("#diagram")!, {
  model,
  layout: storedLayout,
  editable: true,
});

const unsubscribe = diagram.on("class-position-changed", (event) => {
  // The host decides how and when this becomes a YAML/file update.
  console.log(event.classId, event.x, event.y);
});

await diagram.whenReady();
diagram.fitToContent();

// Later:
unsubscribe();
diagram.destroy();
```

## Input model

```ts
type ClassId = string;

interface DiagramModel {
  classes: DiagramClass[];
  relationships: DiagramRelationship[];
}

interface DiagramClass {
  id: ClassId;
  name: string;
  note?: string;
  stereotype?: string;
  attributes?: DiagramAttribute[];
}

interface DiagramAttribute {
  name: string;
  type?: string;
  required?: boolean;
  multiplicity?: string;
  description?: string;
}

interface DiagramRelationship {
  id: string;
  from: ClassId;
  to: ClassId;
  type:
    | "association"
    | "directed-association"
    | "aggregation"
    | "composition"
    | "inheritance"
    | "dependency";
  associationClass?: ClassId;
  label?: string;
  role?: string;
  fromMultiplicity?: string;
  toMultiplicity?: string;
}
```

Class and relationship IDs must be unique. Relationship endpoints must refer
to existing class IDs. `createDiagram`, `setModel`, and `setLayout` fail with a
`DiagramValidationError` containing all detected issues when their input is
invalid.

`note` contains explanatory class text rendered in a connected note element.
`label` is short display text placed near the relationship midpoint and remains
distinct from `role`, relationship type, and endpoint multiplicities. Empty or
whitespace-only relationship labels are normalized as absent.

Class attributes render in input order. A filled dot marks required attributes
and an open dot marks optional attributes. An association is a plain solid
line, while a directed association adds an open arrow at its `to` endpoint.
Aggregation uses a hollow diamond and composition a filled diamond at their
`from` (owning) endpoints. Inheritance uses a hollow target triangle, and a
dependency uses a dashed line with an open target arrow.

Relationship direction is determined exclusively by `from` and `to`, not by
where the classes happen to be drawn. Endpoint multiplicities are independent
of relationship type: `fromMultiplicity` labels `from`, and `toMultiplicity`
labels `to`. For example, an undirected many-to-many association is:

```ts
{
  type: "association",
  from: "class-a",
  to: "class-b",
  fromMultiplicity: "0..*",
  toMultiplicity: "0..*",
}
```

Changing only `type` to `"directed-association"` gives the same
multiplicities and an arrow at `class-b`. Cardinalities such as one-to-many or
many-to-many are not relationship types.

### Association classes

Set `associationClass` to the ID of a normal class whose attributes and
behavior describe an association:

```ts
const model: DiagramModel = {
  classes: [
    { id: "student", name: "Student" },
    { id: "course", name: "Course" },
    {
      id: "enrollment",
      name: "Enrollment",
      attributes: [
        { name: "enrolledAt", type: "date" },
        { name: "grade", type: "string" },
      ],
    },
  ],
  relationships: [
    {
      id: "student-course",
      type: "association",
      from: "student",
      to: "course",
      fromMultiplicity: "*",
      toMultiplicity: "*",
      associationClass: "enrollment",
    },
  ],
};
```

The referenced class is rendered, selected, dragged, and reported through
events like every other class. The renderer derives a markerless dashed
connector from that class to the midpoint of the rendered association. This
connector follows class movement and relationship rerouting, but it is not a
second `DiagramRelationship` and never introduces a fabricated relationship
ID or normal relationship mutation event.

Association classes are supported on `association` and
`directed-association`. Validation rejects them on aggregation, composition,
inheritance, and dependency relationships, and rejects missing or empty class
references. A class may describe more than one association. Removing a
referenced class through `setModel()` requires removing or changing every
binding in the same replacement model; otherwise validation rejects the model
without changing the current diagram.

## Portable layout

```ts
interface DiagramLayout {
  classes?: Record<string, Position>;
  notes?: Record<string, Position>;
  relationships?: Record<string, RelationshipLayout>;
}

interface Position {
  x: number;
  y: number;
}

interface RelationshipLayout {
  waypoints?: Position[];
}
```

All positions are diagram-space coordinates. Class and note positions are
element centers. Relationship waypoints are ordered intermediate points only;
attachment points are calculated at the class boundaries and are never part
of persisted layout.

- A class without stored coordinates is placed by ELK during initial layout.
- A note without stored coordinates follows its class at a default offset.
- A stored note position makes that note independent of later class movement.
- A relationship without waypoints uses automatic Manhattan routing.
- A relationship with waypoints preserves their order and uses those points
  while its endpoint segments continue to follow moved classes.

`diagram.getLayout()` returns current class centers, manual note centers, and
non-empty waypoint lists. Layout is owned per diagram instance, so the same
class ID can have different positions in multiple diagrams.

## Events

Subscribe with `diagram.on(type, listener)`. It returns an idempotent
unsubscribe function. Every event is a plain object with semantic IDs only.

| Event | Meaning |
| --- | --- |
| `selection-changed` | Class, relationship, note, waypoint, or empty selection |
| `class-position-preview` | High-frequency class drag preview |
| `class-position-changed` | Class drag committed on pointer release |
| `note-position-preview` | High-frequency note drag preview |
| `note-position-changed` | Note drag committed on pointer release |
| `relationship-waypoint-added` | Ordered intermediate point inserted |
| `relationship-waypoint-preview` | High-frequency waypoint drag preview |
| `relationship-waypoint-changed` | Waypoint drag committed |
| `relationship-waypoint-removed` | Intermediate point removed |
| `relationship-route-reset` | All manual waypoints removed |
| `relationship-changed` | Committed relationship label changes |
| `auto-layout-completed` | ELK result applied in memory and available to the host |
| `history-changed` | Current actionable `canUndo` and `canRedo` availability |

Preview events are transient. Hosts should normally persist only committed
events. A waypoint selection has this renderer-neutral shape:

```ts
{
  kind: "relationship-waypoint",
  relationshipId: "parcel-right",
  index: 0,
}
```

## Editing and waypoint interaction

In editable mode, classes and notes are draggable. Moving a class
keeps all relationship endpoints and note connectors attached. A note follows
its class until the user moves the note; its committed position then becomes
manual and independent.

Select a relationship to show its waypoint handles. Double-click a relationship
segment to insert a waypoint, drag a handle to move it, and double-click a
handle to remove it. Delete or Backspace also removes a selected waypoint. For
touch interfaces and explicit host controls, use the semantic command methods:

```ts
diagram.addRelationshipWaypoint(id, { x: 640, y: 300 }, 1);
diagram.moveRelationshipWaypoint(id, 1, { x: 680, y: 320 });
diagram.removeRelationshipWaypoint(id, 1);
diagram.resetRelationshipRoute(id);
diagram.updateRelationship(id, {
  label: "owns",
});
```

Host property editors can call `updateRelationship`. These commands emit
committed semantic events for hosts to persist and throw while the diagram is
read-only. `relationship-changed` contains the relationship ID and only the
normalized fields changed by the command. Pass `undefined`, an empty string, or
whitespace-only text to remove a label; the emitted `changes` object retains
that changed key with the value `undefined`.

## Undo and redo

Each diagram has independent, in-memory semantic history:

```ts
if (diagram.canUndo()) diagram.undo();
if (diagram.canRedo()) diagram.redo();
diagram.clearHistory();
```

Class moves, note moves, relationship label changes, waypoint additions, moves
and removals, route resets, and explicit automatic layout are
undoable. Pointer-move previews never enter history; one completed drag creates
one entry. Undo and redo emit the normal
committed semantic event for the resulting state, followed by
`history-changed`. They never emit preview events, fit the viewport, or reset
zoom, pan, or valid selection.

Auto-layout is one atomic history entry regardless of how many classes move.
Its undo and redo each restore all affected class positions before emitting one
`auto-layout-completed` event containing the complete resulting layout. Undoing
a route reset restores the full route before emitting an ordered
`relationship-waypoint-added` event for each restored point; redoing it emits
`relationship-route-reset`.

Undoing and then committing a new edit clears the redo stack. `setModel()` and
`setLayout()` are authoritative external replacements and clear both stacks so
old entries cannot apply to refreshed state. History is not persistence,
revision control, YAML state, or Git state, and `destroy()` discards it.

In read-only mode, `canUndo()` and `canRedo()` both return `false`, while
`undo()` and `redo()` throw the same `Diagram is read-only` error as other edit
commands. The stacks are retained, so their availability returns if editable
mode is restored. `clearHistory()` remains available because it does not mutate
the diagram's semantic state.

## Automatic layout

ELK's layered algorithm calculates initial centers whenever at least one class
has no stored position. Stored class positions remain authoritative during that
initial pass; missing classes are placed into non-overlapping available space
where practical.

```ts
const calculated = await diagram.autoLayout({
  direction: "RIGHT",
  nodeSpacing: 70,
  layerSpacing: 130,
});
```

An explicit `autoLayout()` rearranges all classes by default. Pass
`preserveStoredPositions: true` to keep current positions and fill around them.
The method returns and emits the resulting portable layout and records one
atomic history transaction. It never persists that result. Automatic layout
during initial creation or an authoritative `setModel()`/`setLayout()` refresh
does not create history.

## Viewport

Drag blank space to pan and use the wheel to zoom around the pointer. The host
can also call `fitToContent()`, `setZoom()`, `zoomIn()`, `zoomOut()`, or
`panBy()`. The SVG viewport uses transforms over diagram-space coordinates,
not a fixed drawing boundary, so classes, notes, labels, markers, and waypoints
can be moved to negative or far-positive positions and recovered with
fit-to-content.

## Read-only mode and updates

```ts
diagram.setEditable(false); // pan, zoom, and selection remain enabled
diagram.setLayout(nextLayout);
diagram.setModel(nextModel);
const currentModel = diagram.getModel(); // detached semantic snapshot
```

`setLayout` updates the existing JointJS cells rather than recreating the
renderer. `setModel` reconciles elements by semantic ID and preserves current
positions and waypoints for IDs that remain stable. Both calls clear local
undo/redo history.

Call `destroy()` when removing a diagram. It is safe to call more than once and
disconnects resize observation, native listeners, JointJS views, graph state,
and event subscriptions.

## Host integration responsibilities

A host application must:

1. Parse and resolve its source format into `DiagramModel` and `DiagramLayout`.
2. Decide whether editing is permitted and call `setEditable` accordingly.
3. Debounce or otherwise handle preview events if it displays live state.
4. Translate committed semantic events into its own YAML or other persistence
   operations.
5. Handle revisions, conflicts, locks, files, Git, authentication, and errors.
6. Dispose the instance when its owning view unmounts.

## Browser requirements

The runtime targets modern evergreen browsers with ESM, SVG, Pointer Events,
`ResizeObserver`, and standard DOM geometry APIs. It has no server-side
rendering contract. React hosts should create and destroy the imperative
instance from their component lifecycle.

## Development demo

```sh
npm install
npm run demo
```

The demo contains all six relationship types, an Enrollment association-class
example, labels and multiplicities, notes, automatic layout, drag and waypoint
editing, viewport controls, a read-only toggle, and a semantic event log. It is
excluded from the runtime package.

## Licensing

This project is licensed under the [MIT License](./LICENSE).

Runtime dependencies and their separately applicable licenses are documented
in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). JointJS Community
Edition is consumed as an unmodified external dependency under MPL-2.0. ELK.js
is consumed as an unmodified external dependency under its EPL-2.0 option.

Modern ANT and associated marks are trademarks of Modern ANT SARL. The MIT
license applies to the software and does not grant rights to use Modern ANT
trademarks.
