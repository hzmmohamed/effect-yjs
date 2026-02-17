# effect-yjs

Schema-first integration between [Effect Schema](https://effect.website/docs/schema/introduction) and [Yjs](https://yjs.dev). Define your data model as an Effect Schema, get a fully typed, validated, reactive Yjs document.

## Why

Yjs is the backbone of many collaborative applications, but it offers no type safety, no runtime validation, and no schema-level composition. You work with raw bytes and imperative mutations.

Effect Schema stores its schema as a traversable AST. effect-yjs walks that AST and builds a Yjs document tree automatically — every `S.Struct` becomes a `Y.Map`, every `S.Array` becomes a `Y.Array`, every `YText` becomes a `Y.Text`. You get validated reads and writes, self-contained lenses for precise access, and reactive atoms powered by [effect-atom](https://github.com/tim-smart/effect-atom).

## Install

```sh
pnpm add effect-yjs effect yjs y-protocols @effect-atom/atom
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
root.focus("metadata").focus("version").unsafeSet(1)
root.focus("tags").unsafeSet(["drawing", "v1"])

// Focus deep into records
root.focus("shapes").focus("shape-1").focus("x").unsafeSet(100)
root.focus("shapes").focus("shape-1").focus("y").unsafeSet(200)

// Read back
root.focus("shapes").focus("shape-1").focus("x").unsafeGet() // 100

// Use Y.Text directly for collaborative rich text
const title = root.focus("metadata").focus("title").unsafeGet()
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

xLens.unsafeSet(99)
xLens.unsafeGet() // 99
```

A `YLens<T>` depends only on `T` in its type signature — the root reference is internal. Components receive a lens and can read, write, and subscribe without knowing the document structure:

```ts
function VertexEditor({ position }: { position: YLens<{ x: number; y: number }> }) {
  const pos = useAtom(position.atom())
  const onDrag = (p: { x: number; y: number }) => position.unsafeSet(p)
  // ...
}
```

### Validation

Writes validate through Effect Schema before mutating Yjs:

```ts
// Throwing API — for programmer errors
root.focus("count").unsafeSet("not a number") // throws TypedYValidationError

// Effect API — for expected failures
const result = root.focus("count").set(value) // Effect<void, ParseError>

// Validated reads — validate data from untrusted peers
const count = root.focus("count").get() // Effect<number, ParseError>
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
  root.focus("metadata").focus("version").unsafeSet(2)
  root.focus("tags").unsafeSet(["updated"])
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
root.focus("metadata").focus("version").unsafeGet() // reads synced data
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

### Awareness — Typed Presence & Ephemeral State

The [Yjs Awareness protocol](https://docs.yjs.dev/getting-started/adding-awareness) handles ephemeral data like cursor positions, user info, and selections. Unlike document data, awareness state is not persisted — it's automatically removed when a client goes offline.

effect-yjs wraps the Awareness CRDT with the same schema-validated lens API used for document data:

```ts
import * as S from "effect/Schema"
import { YAwareness } from "effect-yjs"

const PresenceSchema = S.Struct({
  user: S.Struct({ name: S.String, color: S.String }),
  cursor: S.Struct({ x: S.Number, y: S.Number }),
})

// Bind to a provider's awareness instance
const handle = YAwareness.bind(PresenceSchema, provider.awareness)

// Or create a standalone awareness from a Y.Doc
const handle2 = YAwareness.make(PresenceSchema, doc)
```

#### Local State — Read-Write Lens

Your own awareness state is a full `YLens<A>` with `focus()`, validation, and atoms:

```ts
handle.local.unsafeSet({
  user: { name: "Alice", color: "#ff0000" },
  cursor: { x: 0, y: 0 },
})

// Focus into nested fields
handle.local.focus("cursor").focus("x").unsafeSet(100)
handle.local.focus("user").focus("name").unsafeGet() // "Alice"

// Reactive atom on a specific field
const cursorAtom = handle.local.focus("cursor").atom()

// Go offline
handle.unsafeClearLocal()
```

#### Remote State — Read-Only Lens

Other clients' states are accessible via `ReadonlyYLens<A>` — same `focus()`/`unsafeGet()`/`atom()` API, but no `set()`:

```ts
const bobCursor = handle.remote(bobClientId).focus("cursor").unsafeGet()
const bobNameAtom = handle.remote(bobClientId).focus("user").focus("name").atom()
```

#### Presence Detection & Atom Family

Track who's online with `clientIdsAtom()` (backed by the `'update'` event for heartbeat-based offline detection), and get stable per-client atom references via `Atom.family`:

```ts
// Reactive list of connected client IDs
const onlineIds = handle.clientIdsAtom()

// Stable atom per client — value becomes undefined when they go offline
const bobStateAtom = handle.remoteStateFamily(bobClientId)

// Full states map
const allStates = handle.statesAtom() // Atom<ReadonlyMap<number, PresenceState>>
```

## API Reference

### `YDocument.make(schema)`

Creates a new `Y.Doc` and typed root from an Effect Schema. Returns `{ doc, root }`.

### `YDocument.bind(schema, doc)`

Binds a typed root to an existing `Y.Doc`.

### `YDocument.transact(root, fn)`

Wraps operations in a single Yjs transaction.

### `YText`

Schema marker for collaborative text fields. Maps to `Y.Text` in the Yjs document. Access the `Y.Text` instance via `.unsafeGet()` and manipulate it using the standard Yjs Text API.

### `YLens<T>`

| Method | Returns | Description |
|--------|---------|-------------|
| `focus(key)` | `YLens<T[K]>` | Focus on a child field or record entry |
| `unsafeGet()` | `T \| undefined` | Read the current value |
| `unsafeSet(value)` | `void` | Write with validation (throws on failure) |
| `set(value)` | `Effect<void, ParseError>` | Write with validation (Effect-based) |
| `get()` | `Effect<T, ParseError>` | Read with validation |
| `atom()` | `Atom<T \| undefined>` | Reactive atom that updates on Yjs changes |

### `ReadonlyYLens<T>`

Read-only variant of `YLens<T>`. Used for remote awareness states.

| Method | Returns | Description |
|--------|---------|-------------|
| `focus(key)` | `ReadonlyYLens<T[K]>` | Focus on a child field |
| `unsafeGet()` | `T \| undefined` | Read the current value |
| `get()` | `Effect<T, ParseError>` | Read with validation |
| `atom()` | `Atom<T \| undefined>` | Reactive atom that updates on changes |

### `YAwareness.make(schema, doc)`

Creates a new `Awareness` instance (from `y-protocols`) bound to a `Y.Doc` and returns a `YAwarenessHandle<A>`.

### `YAwareness.bind(schema, awareness)`

Binds a schema to an existing `Awareness` instance (e.g., from a provider like `y-websocket`).

### `YAwarenessHandle<A>`

| Property / Method | Returns | Description |
|-------------------|---------|-------------|
| `local` | `YLens<A>` | Read-write lens for the local client's state |
| `remote(clientId)` | `ReadonlyYLens<A>` | Read-only lens for a remote client's state |
| `clearLocal()` | `Effect<void>` | Set local state to null (signals offline) |
| `unsafeClearLocal()` | `void` | Set local state to null (throws on failure) |
| `unsafeGetStates()` | `ReadonlyMap<number, A>` | All clients' states (unvalidated) |
| `getStates()` | `Effect<ReadonlyMap<number, A>, ParseError>` | All states with validation |
| `statesAtom()` | `Atom<ReadonlyMap<number, A>>` | Reactive atom for all states |
| `clientIdsAtom()` | `Atom<ReadonlyArray<number>>` | Reactive presence tracking (uses `'update'` event) |
| `remoteStateFamily` | `(id: number) => Atom<A \| undefined>` | Stable per-client atoms via `Atom.family` |

## Limitations

- **Discriminated unions** are detected and rejected at document creation time with a clear error. Support may be added in the future when conflict resolution semantics are well-defined.
- **Y.XmlFragment / Y.XmlElement** are not supported.
- **Schema migrations** between versions are not handled — this is a separate concern.
- **Undo/Redo** integration with `Y.UndoManager` is not yet wired into the lens API.
- **Persistence adapters** — users wire persistence at the `Y.Doc` level.
- **Full optics** — prisms, traversals, isos deferred to a future version.

## Development

```sh
pnpm install
pnpm test      # run tests
pnpm check     # type check
pnpm build     # build for distribution
```
