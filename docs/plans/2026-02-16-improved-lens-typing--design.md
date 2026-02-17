# Plan: Type-Safe Lens Hierarchy

## Context

All 5 lens factories return `YLens<any>` which exposes every method. Invalid operations (e.g. `focus()` on a primitive, `unsafeSet()` on YText) only fail at runtime via throws. The type system should prevent these at compile time instead.

## Approach

Replace the monolithic `YLens<T>` interface with 5 specific interfaces per lens kind. `YLens<T>` becomes a conditional type alias that resolves to the right interface based on `T`. Same treatment for `ReadonlyYLens<T>`.

### Method availability per lens kind

| Kind | focus | unsafeGet | unsafeSet | set | get | atom |
|------|-------|-----------|-----------|-----|-----|------|
| Struct | `<K extends keyof T & string>(key: K) => YLens<T[K]>` | yes | yes | yes | yes | yes |
| Record | `(key: string) => YLens<V>` | yes | yes | yes | yes | yes |
| Primitive | **no** | yes | yes | yes | yes | yes |
| Array | **no** | yes | yes | yes | yes | yes |
| YText | **no** | yes (returns Y.Text) | **no** | **no** | yes | yes |

### Type-level detection logic

The conditional resolves in this order (ordering matters):

```ts
type YLens<T> =
  T extends YTextMarker ? YTextLens :
  T extends ReadonlyArray<any> ? YArrayLens<T> :
  string extends keyof T ? YRecordLens<T> :
  T extends Record<string, any> ? YStructLens<T> :
  YPrimitiveLens<T>
```

Why this order:
1. `YTextMarker` first — it's a class with `_tag`, would also match `Record<string, any>`
2. `ReadonlyArray` second — arrays are objects, must be caught before struct/record
3. `string extends keyof T` third — detects index signatures (records have `string` in keyof, structs have finite keys)
4. `Record<string, any>` fourth — finite-key structs
5. Fallback — primitives (`string`, `number`, `boolean`)

## Files to Modify

### 1. `src/YLens.ts` — Core changes

**Add import**: `import { YTextMarker } from "./markers.js"`

**Replace `YLens<T>` interface** with 5 specific interfaces + conditional type alias:

```ts
export interface YStructLens<T> {
  focus<K extends keyof T & string>(key: K): YLens<T[K]>
  unsafeGet(): T | undefined
  unsafeSet(value: T): void
  set(value: T): Effect.Effect<void, ParseError>
  get(): Effect.Effect<T, ParseError>
  atom(): Atom.Atom<T | undefined>
}

export interface YRecordLens<T> {
  focus(key: string): YLens<T[string & keyof T]>
  unsafeGet(): T | undefined
  unsafeSet(value: T): void
  set(value: T): Effect.Effect<void, ParseError>
  get(): Effect.Effect<T, ParseError>
  atom(): Atom.Atom<T | undefined>
}

export interface YPrimitiveLens<T> {
  unsafeGet(): T | undefined
  unsafeSet(value: T): void
  set(value: T): Effect.Effect<void, ParseError>
  get(): Effect.Effect<T, ParseError>
  atom(): Atom.Atom<T | undefined>
}

export interface YArrayLens<T> {
  unsafeGet(): T | undefined
  unsafeSet(value: T): void
  set(value: T): Effect.Effect<void, ParseError>
  get(): Effect.Effect<T, ParseError>
  atom(): Atom.Atom<T | undefined>
}

export interface YTextLens {
  unsafeGet(): Y.Text | undefined
  get(): Effect.Effect<Y.Text, ParseError>
  atom(): Atom.Atom<Y.Text | undefined>
}

export type YLens<T> =
  T extends YTextMarker ? YTextLens :
  T extends ReadonlyArray<any> ? YArrayLens<T> :
  string extends keyof T ? YRecordLens<T> :
  T extends Record<string, any> ? YStructLens<T> :
  YPrimitiveLens<T>
```

**Replace `ReadonlyYLens<T>` interface** with 5 readonly interfaces + conditional type alias (same pattern, dropping `unsafeSet`/`set`, and `focus` returns `ReadonlyYLens` instead of `YLens`):

```ts
export interface ReadonlyYStructLens<T> {
  focus<K extends keyof T & string>(key: K): ReadonlyYLens<T[K]>
  unsafeGet(): T | undefined
  get(): Effect.Effect<T, ParseError>
  atom(): Atom.Atom<T | undefined>
}

export interface ReadonlyYRecordLens<T> {
  focus(key: string): ReadonlyYLens<T[string & keyof T]>
  unsafeGet(): T | undefined
  get(): Effect.Effect<T, ParseError>
  atom(): Atom.Atom<T | undefined>
}

export interface ReadonlyYPrimitiveLens<T> {
  unsafeGet(): T | undefined
  get(): Effect.Effect<T, ParseError>
  atom(): Atom.Atom<T | undefined>
}

export interface ReadonlyYArrayLens<T> {
  unsafeGet(): T | undefined
  get(): Effect.Effect<T, ParseError>
  atom(): Atom.Atom<T | undefined>
}

export interface ReadonlyYTextLens {
  unsafeGet(): Y.Text | undefined
  get(): Effect.Effect<Y.Text, ParseError>
  atom(): Atom.Atom<Y.Text | undefined>
}

export type ReadonlyYLens<T> =
  T extends YTextMarker ? ReadonlyYTextLens :
  T extends ReadonlyArray<any> ? ReadonlyYArrayLens<T> :
  string extends keyof T ? ReadonlyYRecordLens<T> :
  T extends Record<string, any> ? ReadonlyYStructLens<T> :
  ReadonlyYPrimitiveLens<T>
```

**Update factory return types and remove dead methods**:

| Factory | Return type change | Methods removed |
|---------|-------------------|-----------------|
| `createStructLens` | `YLens<any>` → `YStructLens<any>` | none |
| `createRecordLens` | `YLens<any>` → `YRecordLens<any>` | none |
| `createPrimitiveLens` | `YLens<any>` → `YPrimitiveLens<any>` | `focus()` |
| `createArrayLens` | `YLens<any>` → `YArrayLens<any>` | `focus()` |
| `createYTextLens` | `YLens<any>` → `YTextLens` | `focus()`, `unsafeSet()`, `set()` |

### 2. `src/YDocument.ts`

Change `YDocumentRoot` from `extends YLens<T>` (interface) to intersection with `YStructLens<T>` (the root is always a struct):

```ts
export type YDocumentRoot<T> = YStructLens<T> & {
  readonly _tag: "YDocumentRoot"
  readonly doc: Y.Doc
  readonly rootMap: Y.Map<any>
}
```

Update import from `type YLens` to `type YStructLens`.

### 3. `src/YAwareness.ts`

**`YAwarenessHandle<A>`**: Change `local` and `remote` types from the conditional `YLens<A>`/`ReadonlyYLens<A>` to the concrete struct variants (awareness root is always a struct):

```ts
export interface YAwarenessHandle<A> {
  readonly local: YStructLens<A>          // was YLens<A>
  remote(clientId: number): ReadonlyYStructLens<A>  // was ReadonlyYLens<A>
  // ... rest unchanged
}
```

This avoids the problem of TypeScript being unable to resolve conditional types with generic parameters. When the user calls `handle.local.focus("cursor")`, the return type `YLens<A["cursor"]>` resolves because `A["cursor"]` is concrete at usage.

Update the internal factory casts accordingly.

### 4. `src/index.ts`

Add all new type exports:

```ts
export type {
  YLens, ReadonlyYLens,
  YStructLens, YRecordLens, YPrimitiveLens, YArrayLens, YTextLens,
  ReadonlyYStructLens, ReadonlyYRecordLens, ReadonlyYPrimitiveLens,
  ReadonlyYArrayLens, ReadonlyYTextLens
} from "./YLens.js"
```

### 5. `test/type-safety.test.ts` — Add new compile-time tests

```ts
it("primitive lens has no focus", () => {
  const { root } = YDocument.make(Schema)
  // @ts-expect-error — YPrimitiveLens has no focus
  root.focus("count").focus
})

it("array lens has no focus", () => {
  const ArraySchema = S.Struct({ tags: S.Array(S.String) })
  const { root } = YDocument.make(ArraySchema)
  // @ts-expect-error — YArrayLens has no focus
  root.focus("tags").focus
})

it("ytext lens has no focus, unsafeSet, or set", () => {
  const TextSchema = S.Struct({ title: YText })
  const { root } = YDocument.make(TextSchema)
  // @ts-expect-error — YTextLens has no focus
  root.focus("title").focus
  // @ts-expect-error — YTextLens has no unsafeSet
  root.focus("title").unsafeSet
  // @ts-expect-error — YTextLens has no set
  root.focus("title").set
})

it("record focus into primitive has no focus", () => {
  const RecordSchema = S.Struct({ scores: S.Record({ key: S.String, value: S.Number }) })
  const { root } = YDocument.make(RecordSchema)
  // @ts-expect-error — focus("alice") returns YPrimitiveLens, no focus
  root.focus("scores").focus("alice").focus
})
```

### 6. Existing test adjustments

- `test/YLens.test.ts:168` — `as unknown as Y.Text` can be simplified to `as Y.Text` since `YTextLens.unsafeGet()` returns `Y.Text | undefined`
- `test/integration.test.ts` — same simplification if applicable

## What is NOT changed

- `src/markers.ts`, `src/atoms.ts`, `src/awarenessAtoms.ts`, `src/errors.ts`, `src/traversal.ts` — no modifications needed
- Runtime behavior — identical, we're only adding type-level restrictions
- `README.md` — API reference tables should be updated to reflect that different lens kinds expose different methods

## Verification

1. `pnpm check` — TypeScript compilation passes (existing code compiles, `@ts-expect-error` tests work)
2. `pnpm test` — All 83 existing tests pass
3. `pnpm lint` — No lint errors
4. New type-safety tests verify that invalid operations are compile-time errors
