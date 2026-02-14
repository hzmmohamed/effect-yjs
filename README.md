# effect-yjs

Schema-first integration between [Effect Schema](https://effect.website/docs/schema/introduction) and [Yjs](https://yjs.dev). Define your data model as an Effect Schema, get a fully typed, validated, reactive Yjs document.

## Why

Yjs is the backbone of many collaborative applications, but it offers no type safety, no runtime validation, and no schema-level composition. You work with raw bytes and imperative mutations.

Effect Schema stores its schema as a traversable AST. effect-yjs walks that AST and builds a Yjs document tree automatically — every `S.Struct` becomes a `Y.Map`, every `S.Array` becomes a `Y.Array`, every `YText` becomes a `Y.Text`. You get validated reads and writes, self-contained lenses for precise access, and reactive atoms powered by [effect-atom](https://github.com/tim-smart/effect-atom).

## Install

```sh
pnpm add effect-yjs effect yjs @effect-atom/atom
```

## Quick Start

```ts
import * as S from "effect/Schema"
import { YDocument, YText } from "effect-yjs"

// Define your schema
const AppSchema = S.Struct({
  shapes: S.Record({
    key: S.String,
    value: S.Struct({ x: S.Number, y: S.Number, label: YText }),
  }),
  metadata: S.Struct({ title: YText, version: S.Number }),
  tags: S.Array(S.String),
})

// Create a typed Yjs document
const { doc, root } = YDocument.make(AppSchema)

// Write with validation
root.focus("metadata").focus("version").set(1)
root.focus("tags").set(["drawing", "v1"])

// Focus deep into records
root.focus("shapes").focus("shape-1").focus("x").set(100)
root.focus("shapes").focus("shape-1").focus("y").set(200)

// Read back
root.focus("shapes").focus("shape-1").focus("x").get() // 100

// Use Y.Text directly for collaborative rich text
const title = root.focus("metadata").focus("title").get()
title.insert(0, "My Drawing")
```

## Core Concepts

### Schema-to-Yjs Mapping

Every Effect Schema type maps deterministically to a Yjs structure:

| Effect Schema | Yjs Type | Notes |
|---|---|---|
| `S.Struct({...})` | `Y.Map` | Each field is a key in the map |
| `S.Record({key, value})` | `Y.Map` | Dynamic keys, homogeneous values |
| `S.Array(item)` | `Y.Array` | Ordered collection |
| `YText` | `Y.Text` | Collaborative rich text |
| Primitives | Plain values | Stored directly in parent |

Structs are pre-populated at document creation time — nested shared types are created immediately so the structure is always navigable. Records and Arrays start empty; entries are created dynamically when you write to them.

### YLens — Type-Safe Accessors

`YLens<T>` is the primary way to interact with data. Lenses are created via `.focus()`, carry their own root reference internally, and compose via further `.focus()` calls.

```ts
const shapeLens = root.focus("shapes").focus("shape-1")
const xLens = shapeLens.focus("x")

xLens.set(99)
xLens.get() // 99
```

A `YLens<T>` depends only on `T` in its type signature — the root reference is internal. Components receive a lens and can read, write, and subscribe without knowing the document structure:

```ts
function VertexEditor({ position }: { position: YLens<{ x: number; y: number }> }) {
  const pos = useAtom(position.atom())
  const onDrag = (p: { x: number; y: number }) => position.set(p)
  // ...
}
```

### Validation

Writes validate through Effect Schema before mutating Yjs:

```ts
// Throwing API — for programmer errors
root.focus("count").set("not a number") // throws TypedYValidationError

// Effect API — for expected failures
const result = root.focus("count").setEffect(value) // Effect<void, ParseError>

// Safe reads — validate data from untrusted peers
const count = root.focus("count").getSafe() // Effect<number, ParseError>
```

### Reactive Atoms

Every lens can produce an [effect-atom](https://github.com/tim-smart/effect-atom) `Atom` that updates when the underlying Yjs data changes:

```ts
const countAtom = root.focus("count").atom()        // Atom<number | undefined>
const posAtom = root.focus("position").atom()        // Atom<{x, y} | undefined>

// Derived atoms compose naturally
const doubled = Atom.map(countAtom, (c) => (c ?? 0) * 2)
```

Granularity comes from Yjs's per-shared-type observation — changing a shape's x coordinate only triggers atoms subscribed to that specific path.

### Transactions

Batch multiple writes into a single Yjs transaction:

```ts
YDocument.transact(root, () => {
  root.focus("metadata").focus("version").set(2)
  root.focus("tags").set(["updated"])
})
```

### Binding to Existing Documents

Connect to a Y.Doc from any Yjs provider (WebSocket, WebRTC, etc.):

```ts
import * as Y from "yjs"
import { WebsocketProvider } from "y-websocket"

const ydoc = new Y.Doc()
new WebsocketProvider("ws://localhost:1234", "my-room", ydoc)

const root = YDocument.bind(AppSchema, ydoc)
root.focus("metadata").focus("version").get() // reads synced data
```

### Schema Composability

Compose schemas using plain Effect Schema mechanics — no special API:

```ts
// Field-level: spread shared field groups
const Position = { x: S.Number, y: S.Number }
const Dimensions = { width: S.Number, height: S.Number }

const Rectangle = S.Struct({
  id: S.String,
  ...Position,
  ...Dimensions,
  label: YText,
})

// Document-level: compose modules into a top-level document
const ShapesFragment = S.Record({ key: S.String, value: Rectangle })
const ChatFragment = S.Array(S.Struct({ author: S.String, message: YText }))

const AppDocument = S.Struct({
  shapes: ShapesFragment,
  chat: ChatFragment,
})
```

## API Reference

### `YDocument.make(schema)`

Creates a new `Y.Doc` and typed root from an Effect Schema. Returns `{ doc, root }`.

### `YDocument.bind(schema, doc)`

Binds a typed root to an existing `Y.Doc`.

### `YDocument.transact(root, fn)`

Wraps operations in a single Yjs transaction.

### `YText`

Schema marker for collaborative text fields. Maps to `Y.Text` in the Yjs document. Access the `Y.Text` instance via `.get()` and manipulate it using the standard Yjs Text API.

### `YLens<T>`

| Method | Returns | Description |
|--------|---------|-------------|
| `focus(key)` | `YLens<T[K]>` | Focus on a child field or record entry |
| `get()` | `T \| undefined` | Read the current value |
| `set(value)` | `void` | Write with validation (throws on failure) |
| `setEffect(value)` | `Effect<void, ParseError>` | Write with validation (Effect-based) |
| `getSafe()` | `Effect<T, ParseError>` | Read with validation |
| `atom()` | `Atom<T \| undefined>` | Reactive atom that updates on Yjs changes |

## Limitations

- **Discriminated unions** are detected and rejected at document creation time with a clear error. Support may be added in the future when conflict resolution semantics are well-defined.
- **Y.XmlFragment / Y.XmlElement** are not supported.
- **Schema migrations** between versions are not handled — this is a separate concern.
- **Undo/Redo** integration with `Y.UndoManager` is not yet wired into the lens API.

## Development

```sh
pnpm install
pnpm test      # run tests
pnpm check     # type check
pnpm build     # build for distribution
```
