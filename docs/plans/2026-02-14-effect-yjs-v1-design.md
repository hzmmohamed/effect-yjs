# effect-yjs v1 Design

## Vision

A schema-first integration between Effect Schema and Yjs that provides type-safe, validated, reactive access to collaborative documents. Define an Effect Schema, get a fully typed Yjs document with validated reads/writes and fine-grained reactivity.

## Core Concept: Schema-to-Yjs Mapping

Every Effect Schema type maps deterministically to a Yjs structure:

| Effect Schema | Yjs Type | Notes |
|---|---|---|
| `S.Struct({...})` | `Y.Map` | Each field is a key in the map |
| `S.Record({key, value})` | `Y.Map` | Dynamic keys, homogeneous values |
| `S.Array(item)` | `Y.Array` | Ordered collection |
| `YText` (custom combinator) | `Y.Text` | Collaborative rich text |
| Primitives (`S.String`, `S.Number`, `S.Boolean`, etc.) | Plain values | Stored directly in parent |
| Simple unions (`S.Union(S.Literal(...))`) | Plain values | Validated on read/write |
| Nested `S.Struct` | Nested `Y.Map` | Recursive |
| `S.Array(S.Struct({...}))` | `Y.Array` of `Y.Map` | Each element is a Y.Map |
| Discriminated unions | **Rejected** | `Effect.die()` at traversal time |
| `S.Refinement` | Unwrapped | Traverse underlying type, keep full schema for validation |
| `S.Suspend` | Forced | Handles recursive schemas |

Primitives and simple unions are leaf nodes. Structs, Records, and Arrays are structural nodes that become their own Yjs shared types. This means Yjs conflict resolution operates at the right granularity -- two users editing different fields of the same struct don't conflict.

## Document API

### Construction

```ts
import * as S from "effect/Schema"
import { YDocument, YText } from "effect-yjs"

const Position = { x: S.Number, y: S.Number }

const Shape = S.Struct({
  id: S.String,
  ...Position,
  vertices: S.Array(S.Struct({ x: S.Number, y: S.Number })),
  label: YText,
})

const AppSchema = S.Struct({
  shapes: S.Record({ key: S.String, value: Shape }),
  metadata: S.Struct({ title: YText, version: S.Number }),
})

// Create a new Y.Doc
const { doc, root } = YDocument.make(AppSchema)

// Bind to an existing Y.Doc (from a provider)
const root = YDocument.bind(AppSchema, existingYDoc)
```

### Transactions

```ts
YDocument.transact(root, () => {
  posLens.focus("x").set(10)
  posLens.focus("y").set(20)
})
```

## YLens: Type-Safe Accessors

`YLens<T>` is the primary way to interact with data. Lenses are created from the root via `.focus()`, carry their own root reference internally, and compose via further `.focus()` calls.

### Creation and Composition

```ts
const shapesLens = root.focus("shapes")           // YLens<Record<string, Shape>>
const shapeLens = shapesLens.focus("shape-1")      // YLens<Shape>
const posLens = shapeLens.focus("position")        // YLens<Position>
const xLens = posLens.focus("x")                   // YLens<number>
```

### Reading

```ts
xLens.get()                  // number (trusts the data)
xLens.getSafe()              // Effect<number, ParseError> (validates)
```

### Writing

```ts
xLens.set(10)                // throws TypedYValidationError on invalid data
xLens.setEffect(value)       // Effect<void, ParseError>
```

### Reactivity

```ts
xLens.atom()                 // Atom<number> — updates when this value changes
posLens.atom()               // Atom<{ x: number, y: number }>
```

### Key Property: Self-Contained

A `YLens<T>` depends only on `T` in its type signature. The root reference is internal. This means:

- Components receive `YLens<Position>`, not `YLens<Root, Position>`
- No need to thread the root through the component tree
- A component can read, write, and subscribe through the same lens
- Lenses are fully reusable across different document structures

### Component Pattern

```ts
// shapes-module.ts — no knowledge of root or document
function ShapeEditor({ shape }: { shape: YLens<Shape> }) {
  return <VertexEditor position={shape.focus("position")} />
}

function VertexEditor({ position }: { position: YLens<Position> }) {
  const pos = useAtom(position.atom())
  const onDrag = (p: Position) => position.set(p)
  return <circle cx={pos.x} cy={pos.y} />
}

// app.tsx — the only place that knows the full document
const root = YDocument.bind(AppSchema, ydoc)

function App() {
  return <ShapeEditor shape={root.focus("shapes").focus(selectedId)} />
}
```

## Schema Composability

Two levels of composability, both using plain Effect Schema mechanics:

### Field-Level

```ts
const Position = { x: S.Number, y: S.Number }
const Dimensions = { width: S.Number, height: S.Number }

const Rectangle = S.Struct({
  id: S.String,
  ...Position,
  ...Dimensions,
  label: YText,
})
```

### Document-Level

```ts
// shapes-module.ts
const ShapesFragment = S.Record({ key: S.String, value: Shape })

// chat-module.ts
const ChatFragment = S.Array(S.Struct({
  author: S.String,
  message: YText,
  timestamp: S.Number,
}))

// document.ts
const AppDocument = S.Struct({
  shapes: ShapesFragment,
  chat: ChatFragment,
  metadata: S.Struct({ title: YText, version: S.Number }),
})
```

No special fragment API. Any Effect Schema is a valid fragment.

## Validation

- **Writes** validate through Effect Schema before mutating Yjs
- **Throwing API** (`set`) for programmer errors
- **Effect API** (`setEffect`) for expected failures (user input, external data)
- **Safe reads** (`getSafe`) validate data from untrusted peers
- **Async validation** works naturally through `setEffect` since it returns an `Effect`

## Reactive Reading with effect-atom

Yjs observe events (`Y.Map.observe`, `Y.Array.observe`, `Y.Text.observe`) feed into effect-atom `Atom` primitives.

- **Path-level granularity**: moving a shape only triggers atoms subscribed to that shape's data
- **Derived atoms**: compose multiple atoms via standard effect-atom combinators
- **React hooks**: via effect-atom's existing React integration (`useAtom`)

## Schema Traversal Engine

Recursive function that walks the Effect Schema AST and builds the Yjs tree:

```
traverseSchema(schema, parentYType):
  match schema.ast:
    Struct      → create Y.Map, recurse into each field
    Record      → create Y.Map (empty, entries added at runtime)
    Array       → create Y.Array (empty, items added at runtime)
    YText       → create Y.Text
    Primitive   → no-op (stored as plain value in parent)
    Union       → if discriminated: Effect.die()
                   otherwise: treat as primitive
    Refinement  → unwrap, recurse into underlying type
    Suspend     → force, recurse (handles recursive schemas)
```

- **Structs** are pre-populated: nested shared types created immediately
- **Records and Arrays** start empty: entries created dynamically on set/push
- **Adding a struct entry** to a record/array triggers traversal for that entry's schema

## Module Structure

```
src/
  YDocument.ts          — make(), bind(), transact()
  YLens.ts              — YLens<T> with focus, get, set, setEffect, getSafe, atom
  traversal.ts          — Schema AST walker, builds Yjs tree
  markers.ts            — YText schema combinator
  atoms.ts              — Yjs observe → effect-atom bridge
  errors.ts             — TypedYValidationError, UnsupportedSchemaError
  types.ts              — Shared type definitions
  index.ts              — Public API re-exports
```

## Public API Surface

- `YDocument.make(schema)` — create new doc and typed root
- `YDocument.bind(schema, ydoc)` — bind typed root to existing Y.Doc
- `YDocument.transact(root, fn)` — batched writes in a Yjs transaction
- `YText` — schema marker for collaborative text fields
- `YLens<T>` — type-safe accessor (created via `root.focus()`, not constructed directly)
- `TypedYValidationError` — validation error type

## Out of Scope for v1

- **Discriminated unions** — detected and rejected with `Effect.die()`
- **Y.XmlFragment / Y.XmlElement** — no XML types
- **Schema migrations / versioning** — no automatic migration of existing docs
- **Undo/Redo integration** — Yjs UndoManager wiring deferred
- **Awareness protocol** — cursor positions, presence, selections
- **Persistence adapters** — users wire at the Y.Doc level
- **Full optics** — prisms, traversals, isos deferred to Effect v4 or future version
- **Async validation optimization** — works via setEffect but not specifically optimized
