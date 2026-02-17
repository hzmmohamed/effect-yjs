# YLinkedList Design

## Motivation

A higher-level linked-list data structure built on top of Yjs arrays and maps,
designed for ordered collections where nodes are frequently inserted in the
middle, appended, removed, and individually mutated by concurrent users.

Primary use case: bezier curve editing, where each node is a control point
with position and handle data. Multiple users can insert vertices, drag
existing points, and delete nodes concurrently.

## Schema Definition

`YLinkedList(itemSchema)` is a schema marker (like `YText`) that declares an
ordered collection of struct-typed nodes. Each node gets an auto-generated
UUIDv7 `_id` field managed internally.

```ts
import * as S from "effect/Schema"
import { YLinkedList } from "effect-yjs"

const ControlPoint = S.Struct({
  x: S.Number,
  y: S.Number,
  handleInAngle: S.Number,
  handleInDistance: S.Number,
  handleOutAngle: S.Number,
  handleOutDistance: S.Number,
})

const AppSchema = S.Struct({
  curvePath: YLinkedList(ControlPoint),
})
```

## Yjs Representation

Under the hood, `YLinkedList(T)` maps to a `Y.Array` of `Y.Map`s. Each
`Y.Map` contains the node's fields plus a `_id: string` field holding the
UUIDv7. The `Y.Array` provides CRDT-native ordering and concurrent insert
resolution.

```
Y.Array [
  Y.Map { _id: "01961...", x: 10, y: 20, handleInAngle: 0, ... },
  Y.Map { _id: "01962...", x: 50, y: 30, handleInAngle: 1.2, ... },
  Y.Map { _id: "01963...", x: 80, y: 10, handleInAngle: 0.5, ... },
]
```

Adjacency is purely positional -- determined by array order. No explicit
prev/next pointers or per-edge metadata.

## Lens API: YLinkedListLens<T>

When you `focus()` into a `YLinkedList` field, you get a `YLinkedListLens<T>`
-- a specialized lens with list operations.

```ts
interface YLinkedListLens<T> {
  // --- Structural mutations ---
  append(value: T): string              // returns the generated _id
  prepend(value: T): string
  insertAt(index: number, value: T): string
  insertAfter(id: string, value: T): string
  removeAt(index: number): void
  remove(id: string): void

  // --- Node access ---
  at(index: number): YLens<T>           // lens by index (unstable across inserts)
  find(id: string): YLens<T>            // lens by _id (stable)
  nodes(): Map<string, YLens<T>>        // all nodes keyed by _id (snapshot)

  // --- Whole-list reading ---
  get(): Array<T>                       // plain snapshot (no _id in output)
  getSafe(): Effect<Array<T>, ParseError>
  length(): number

  // --- Reactivity ---
  atom(): Atom<Array<T>>                // fires on any change (structural or node-level)
  ids(): Atom<HashSet<string>>          // reactive set of node _ids
}
```

### Design Notes

- **`nodes()`** returns a snapshot `Map` keyed by `_id`. The lenses point
  directly at their `Y.Map`, so they remain stable regardless of list
  mutations. The rendering layer diffs this map to create/destroy objects.

- **`find(id)`** is the primary way to get a stable per-node lens. A rendered
  object holds this lens and calls `lens.atom()` for a reactive atom scoped to
  that node's fields only.

- **`at(index)`** binds to whatever `Y.Map` is at that index at call time. It
  does not shift when the list changes.

- **`get()`** strips the internal `_id` -- returns clean `Array<T>` matching
  the user's schema. The `_id` is an internal concern.

- **`append`/`prepend`/`insertAt`/`insertAfter`** all validate the value
  against the item schema before writing, and return the generated `_id` so
  the caller can immediately `find()` it.

- **`ids()`** returns an `Atom<HashSet<string>>` that fires only when nodes
  are added or removed. The rendering layer diffs `newSet - oldSet` for
  additions and `oldSet - newSet` for removals.

### Node Atom Behavior on Removal

When a node is removed from the list, its atom (obtained via
`find(id).atom()`) retains its last known value and stops emitting updates.
It does not emit `undefined` or throw. The `ids()` atom tells the rendering
layer that the node is gone; the rendering layer then tears down the
associated object and finalizes the atom.

This prevents flashes of broken rendering during the teardown window.

## Rendering Walkthrough

### Initial state: nodes A, B, C

```
ids() atom = HashSet { "aaa", "bbb", "ccc" }
```

Rendering layer has:
- Vertex objects for A, B, C, each holding `find(id).atom()`
- Curve renderer subscribed to `atom()` for drawing the path

### Remote user inserts D between A and B

Two atoms fire:

1. **`ids()` fires:** `HashSet { "aaa", "bbb", "ccc", "ddd" }`
   - Diff: `newSet - oldSet = { "ddd" }`
   - Call `find("ddd")` for a stable lens
   - Call `find("ddd").atom()` for the new vertex object
   - Existing vertex objects untouched

2. **`atom()` fires:** `[A, D, B, C]`
   - Curve renderer redraws the full path

### User drags vertex B

- B's node-level atom fires -- vertex B re-renders position
- `atom()` fires -- curve renderer redraws
- `ids()` does NOT fire -- set of IDs unchanged
- No other vertex objects affected

### User removes vertex C

1. **`ids()` fires:** `HashSet { "aaa", "ddd", "bbb" }`
   - Diff: `oldSet - newSet = { "ccc" }`
   - Destroy C's vertex object, finalize its atom

2. **`atom()` fires:** `[A, D, B]`
   - Curve renderer redraws

## Implementation Strategy

### New files

- `src/YLinkedList.ts` -- the `YLinkedList` schema marker + `YLinkedListLens`

### Modified files

- `src/markers.ts` -- add `YLinkedListTypeId` symbol (following `YTextTypeId`)
- `src/traversal.ts` -- teach `buildYjsTree` and add `isYLinkedListAST` to
  recognize the marker and create a `Y.Array`
- `src/YLens.ts` -- teach `classifyAST` to return `"linkedlist"` kind, wire
  `focus()` to create a `YLinkedListLens`
- `src/atoms.ts` -- add atom factory for the `ids()` atom (tracks set of IDs
  from `Y.Array` observe events, with detach-safe node atoms)
- `src/index.ts` -- re-export `YLinkedList`

### Dependencies

- `uuid` (v7 generation)
- `effect/HashSet` for the `ids()` atom value

### Key implementation detail

Node-level atoms (from `find(id).atom()`) register a `Y.Array` observe
handler that checks whether their `Y.Map` is still in the array. On removal,
they unsubscribe and retain their last value until finalized.
