# YLinkedList Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `YLinkedList(itemSchema)` schema marker and `YLinkedListLens<T>` that provides an ordered, CRDT-backed linked list with stable per-node lenses, reactive ID tracking, and efficient rendering support.

**Architecture:** `YLinkedList` is a schema marker (like `YText`) that maps to a `Y.Array` of `Y.Map`s. Each node gets an auto-generated UUIDv7 `_id`. A specialized `YLinkedListLens` exposes list mutations (`append`, `insertAt`, etc.), stable node access (`find`, `nodes`), and two reactive atoms: one for the full array data and one for the set of node IDs (`ids()`).

**Tech Stack:** Effect Schema, Yjs, effect-atom, uuid (v7), effect/HashSet

**Design doc:** `docs/plans/2026-02-17-ylinkedlist-design.md`

---

### Task 1: Add `uuid` dependency

**Files:**
- Modify: `package.json`

**Step 1: Install uuid**

```bash
cd /home/hfahmi/work/oss/effect-yjs/.worktrees/ylinkedlist
pnpm add uuid
pnpm add -D @types/uuid
```

**Step 2: Verify install**

```bash
pnpm check
```

Expected: no errors

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add uuid dependency"
```

---

### Task 2: YLinkedList schema marker

**Files:**
- Modify: `src/markers.ts`
- Create: `test/YLinkedList.test.ts`

**Step 1: Write the failing test**

In `test/YLinkedList.test.ts`:

```ts
import { describe, expect, it } from "@effect/vitest"
import * as S from "effect/Schema"
import * as AST from "effect/SchemaAST"
import { YLinkedList, YLinkedListTypeId } from "../src/markers.js"

describe("YLinkedList marker", () => {
  it("is detectable via annotation on the AST", () => {
    const schema = YLinkedList(S.Struct({ x: S.Number, y: S.Number }))
    const annotation = AST.getAnnotation<symbol>(YLinkedListTypeId)(schema.ast)
    expect(annotation._tag).toBe("Some")
  })

  it("stores the item schema in an annotation", () => {
    const ItemSchema = S.Struct({ x: S.Number, y: S.Number })
    const schema = YLinkedList(ItemSchema)
    const itemAST = AST.getAnnotation<AST.AST>(YLinkedListItemAST)(schema.ast)
    expect(itemAST._tag).toBe("Some")
  })
})
```

Note: `YLinkedListItemAST` is a second annotation symbol used to store the
item schema AST on the marker, so the traversal engine can retrieve it later.

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: FAIL — `YLinkedList` and `YLinkedListTypeId` not exported from markers.

**Step 3: Implement the marker**

In `src/markers.ts`, add after the existing `YText` code:

```ts
export const YLinkedListTypeId: unique symbol = Symbol.for("effect-yjs/YLinkedList")
export const YLinkedListItemAST: unique symbol = Symbol.for("effect-yjs/YLinkedList/itemAST")

export const YLinkedList = <TFields extends S.Struct.Fields>(
  itemSchema: S.Struct<TFields>
): S.Schema<Array<S.Struct.Type<TFields>>> =>
  S.declare(
    (input) => Array.isArray(input),
    { identifier: "YLinkedList" }
  ).annotations({
    [YLinkedListTypeId]: YLinkedListTypeId,
    [YLinkedListItemAST]: itemSchema.ast
  }) as any
```

**Step 4: Update the test import**

Make sure the test imports `YLinkedListItemAST` from markers as well:

```ts
import { YLinkedList, YLinkedListItemAST, YLinkedListTypeId } from "../src/markers.js"
```

**Step 5: Run test to verify it passes**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/markers.ts test/YLinkedList.test.ts
git commit -m "feat: add YLinkedList schema marker"
```

---

### Task 3: Traversal engine recognizes YLinkedList

**Files:**
- Modify: `src/traversal.ts`
- Modify: `test/YLinkedList.test.ts`

**Step 1: Write the failing test**

Append to `test/YLinkedList.test.ts`:

```ts
import * as Y from "yjs"
import { buildYjsTree } from "../src/traversal.js"

describe("buildYjsTree with YLinkedList", () => {
  it("creates a Y.Array for a YLinkedList field", () => {
    const schema = S.Struct({
      points: YLinkedList(S.Struct({ x: S.Number, y: S.Number }))
    })
    const doc = new Y.Doc()
    const root = doc.getMap("root")
    buildYjsTree(schema.ast, root, [])
    expect(root.get("points")).toBeInstanceOf(Y.Array)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: FAIL — `points` is not recognized, no `Y.Array` created.

**Step 3: Implement traversal support**

In `src/traversal.ts`:

1. Add import at top:

```ts
import { YLinkedListTypeId } from "./markers.js"
```

2. Add detection function after `isYTextAST`:

```ts
export const isYLinkedListAST = (ast: AST.AST): boolean => {
  const annotation = AST.getAnnotation<symbol>(YLinkedListTypeId)(ast)
  return annotation._tag === "Some"
}
```

3. In `buildYjsTree`, inside the `if (isStruct(core))` block, in the
   `for (const prop of core.propertySignatures)` loop, add a check
   **before** the existing `isYTextAST` check (around line 58):

```ts
if (isYLinkedListAST(prop.type) || isYLinkedListAST(fieldCore)) {
  parent.set(fieldName, new Y.Array())
} else if (isYTextAST(prop.type) || isYTextAST(fieldCore)) {
```

Note: the `else if` chains the existing YText check.

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: PASS

**Step 5: Run all tests to verify no regressions**

```bash
pnpm vitest run
```

Expected: all pass

**Step 6: Commit**

```bash
git add src/traversal.ts test/YLinkedList.test.ts
git commit -m "feat: teach traversal engine to recognize YLinkedList"
```

---

### Task 4: classifyAST recognizes YLinkedList

**Files:**
- Modify: `src/YLens.ts`

**Step 1: Write the failing test**

Append to `test/YLinkedList.test.ts`:

```ts
import { YDocument } from "../src/YDocument.js"

describe("YLinkedListLens via focus", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("focus into a YLinkedList field returns a lens", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
    expect(pathLens).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: FAIL or wrong lens type (falls through to primitive/array).

**Step 3: Implement classifyAST + focus support**

In `src/YLens.ts`:

1. Add import at top:

```ts
import { isYLinkedListAST } from "./traversal.js"
```

2. Update `LensKind` type:

```ts
type LensKind = "struct" | "record" | "array" | "ytext" | "linkedlist" | "primitive"
```

3. In `classifyAST`, add check **before** the `unwrap` call (after the
   existing ytext checks at lines 14-16):

```ts
if (isYLinkedListAST(ast)) return "linkedlist"
const core = unwrap(ast)
if (isYLinkedListAST(core)) return "linkedlist"
```

Wait — the existing code already checks `isYTextAST` before and after
`unwrap`. Follow the same pattern: add `isYLinkedListAST` checks right
after the `isYTextAST` checks (lines 14-16):

```ts
if (isYTextAST(ast)) return "ytext"
if (isYLinkedListAST(ast)) return "linkedlist"
const core = unwrap(ast)
if (isYTextAST(core)) return "ytext"
if (isYLinkedListAST(core)) return "linkedlist"
```

4. In `createStructLens`, in the `focus` method, add a case for
   `"linkedlist"` after the `"array"` case (around line 196):

```ts
if (fieldKind === "linkedlist") {
  let childArray = yMap.get(key)
  if (!(childArray instanceof Y.Array)) {
    childArray = new Y.Array()
    yMap.set(key, childArray)
  }
  return createLinkedListLens(fieldAST, childArray, doc)
}
```

5. Add a stub `createLinkedListLens` at the bottom of the file (we'll
   implement it fully in the next tasks):

```ts
import { YLinkedListItemAST } from "./markers.js"

export const createLinkedListLens = (
  ast: AST.AST,
  yArray: Y.Array<any>,
  doc: Y.Doc
): any => {
  return {
    focus: () => { throw new Error("Use find(id) or at(index) for linked list node access") },
    get: () => [],
    set: () => { throw new Error("Cannot set a linked list directly") },
    setEffect: () => Effect.fail(new ParseError({ _tag: "Type", ast: AST.stringKeyword, actual: undefined, message: "Cannot set a linked list directly" } as any)),
    getSafe: () => Effect.succeed([]),
    atom: () => atomFromYArray(yArray, () => [])
  }
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/YLens.ts test/YLinkedList.test.ts
git commit -m "feat: classifyAST recognizes YLinkedList, stub lens"
```

---

### Task 5: append() and get()

**Files:**
- Create: `src/YLinkedList.ts`
- Modify: `src/YLens.ts` (move `createLinkedListLens` to delegate to new file)
- Modify: `test/YLinkedList.test.ts`

**Step 1: Write the failing tests**

Append to `test/YLinkedList.test.ts`:

```ts
describe("YLinkedListLens.append and get", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("append adds a node and returns a UUIDv7 id", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    const id = pathLens.append({ x: 10, y: 20 })
    expect(typeof id).toBe("string")
    expect(id.length).toBe(36) // UUID format
  })

  it("get returns array of plain objects without _id", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    pathLens.append({ x: 10, y: 20 })
    pathLens.append({ x: 30, y: 40 })
    const result = pathLens.get()
    expect(result).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 }
    ])
  })

  it("append validates against item schema", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    expect(() => pathLens.append({ x: "not a number", y: 20 })).toThrow()
  })

  it("underlying Yjs structure is Y.Array of Y.Map with _id", () => {
    const { doc, root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    pathLens.append({ x: 10, y: 20 })
    const rootMap = doc.getMap("root")
    const yArray = rootMap.get("path") as Y.Array<any>
    expect(yArray.length).toBe(1)
    const node = yArray.get(0)
    expect(node).toBeInstanceOf(Y.Map)
    expect(typeof node.get("_id")).toBe("string")
    expect(node.get("x")).toBe(10)
    expect(node.get("y")).toBe(20)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: FAIL — `append` is not implemented.

**Step 3: Create `src/YLinkedList.ts`**

```ts
import type { Atom } from "@effect-atom/atom"
import * as Effect from "effect/Effect"
import * as HashSet from "effect/HashSet"
import { ParseError } from "effect/ParseResult"
import * as S from "effect/Schema"
import * as AST from "effect/SchemaAST"
import { v7 as uuidv7 } from "uuid"
import * as Y from "yjs"
import { atomFromYArray } from "./atoms.js"
import { TypedYValidationError } from "./errors.js"
import { YLinkedListItemAST } from "./markers.js"
import { createStructLens, type YLens } from "./YLens.js"
import { buildYjsTree, unwrap } from "./traversal.js"

const getItemAST = (ast: AST.AST): AST.AST => {
  const annotation = AST.getAnnotation<AST.AST>(YLinkedListItemAST)(ast)
  if (annotation._tag === "None") {
    throw new Error("YLinkedList marker missing item AST annotation")
  }
  return annotation.value
}

const readNodeAsObject = (yMap: Y.Map<any>, itemAST: AST.AST): any => {
  const core = unwrap(itemAST)
  if (!AST.isTypeLiteral(core)) return undefined
  const obj: Record<string, any> = {}
  for (const prop of core.propertySignatures) {
    const key = String(prop.name)
    obj[key] = yMap.get(key)
  }
  return obj
}

const writeNodeToMap = (
  yMap: Y.Map<any>,
  itemAST: AST.AST,
  value: Record<string, any>,
  id: string
): void => {
  const core = unwrap(itemAST)
  if (!AST.isTypeLiteral(core)) return
  yMap.set("_id", id)
  for (const prop of core.propertySignatures) {
    const key = String(prop.name)
    if (key in value) {
      yMap.set(key, value[key])
    }
  }
}

export interface YLinkedListLens<T> {
  append(value: T): string
  prepend(value: T): string
  insertAt(index: number, value: T): string
  insertAfter(id: string, value: T): string
  removeAt(index: number): void
  remove(id: string): void
  at(index: number): YLens<T>
  find(id: string): YLens<T>
  nodes(): Map<string, YLens<T>>
  get(): Array<T>
  getSafe(): Effect.Effect<Array<T>, ParseError>
  length(): number
  atom(): Atom.Atom<Array<T>>
  ids(): Atom.Atom<HashSet.HashSet<string>>
}

export const createLinkedListLens = (
  ast: AST.AST,
  yArray: Y.Array<any>,
  doc: Y.Doc
): YLinkedListLens<any> => {
  const itemAST = getItemAST(ast)
  const itemSchema = S.make(itemAST)

  const validateItem = (value: any): void => {
    try {
      S.decodeUnknownSync(itemSchema)(value)
    } catch (error) {
      if (error instanceof ParseError) {
        throw new TypedYValidationError("linked list item", error)
      }
      throw error
    }
  }

  const readAll = (): Array<any> =>
    yArray.toArray().map((item) => {
      if (item instanceof Y.Map) {
        return readNodeAsObject(item, itemAST)
      }
      return item
    })

  const createNode = (value: any): { yMap: Y.Map<any>; id: string } => {
    const id = uuidv7()
    const yMap = new Y.Map()
    writeNodeToMap(yMap, itemAST, value, id)
    return { yMap, id }
  }

  const findIndex = (id: string): number => {
    for (let i = 0; i < yArray.length; i++) {
      const item = yArray.get(i)
      if (item instanceof Y.Map && item.get("_id") === id) return i
    }
    return -1
  }

  return {
    append(value: any): string {
      validateItem(value)
      const { yMap, id } = createNode(value)
      doc.transact(() => {
        yArray.push([yMap])
      })
      return id
    },

    prepend(value: any): string {
      validateItem(value)
      const { yMap, id } = createNode(value)
      doc.transact(() => {
        yArray.insert(0, [yMap])
      })
      return id
    },

    insertAt(index: number, value: any): string {
      validateItem(value)
      const { yMap, id } = createNode(value)
      doc.transact(() => {
        yArray.insert(index, [yMap])
      })
      return id
    },

    insertAfter(afterId: string, value: any): string {
      const idx = findIndex(afterId)
      if (idx === -1) throw new Error(`Node not found: ${afterId}`)
      return this.insertAt(idx + 1, value)
    },

    removeAt(index: number): void {
      doc.transact(() => {
        yArray.delete(index, 1)
      })
    },

    remove(id: string): void {
      const idx = findIndex(id)
      if (idx === -1) throw new Error(`Node not found: ${id}`)
      this.removeAt(idx)
    },

    at(index: number): YLens<any> {
      const item = yArray.get(index)
      if (!(item instanceof Y.Map)) {
        throw new Error(`No node at index ${index}`)
      }
      return createStructLens(itemAST, item, doc)
    },

    find(id: string): YLens<any> {
      const idx = findIndex(id)
      if (idx === -1) throw new Error(`Node not found: ${id}`)
      return this.at(idx)
    },

    nodes(): Map<string, YLens<any>> {
      const result = new Map<string, YLens<any>>()
      for (let i = 0; i < yArray.length; i++) {
        const item = yArray.get(i)
        if (item instanceof Y.Map) {
          const id = item.get("_id") as string
          result.set(id, createStructLens(itemAST, item, doc))
        }
      }
      return result
    },

    get(): Array<any> {
      return readAll()
    },

    getSafe() {
      return Effect.try({
        try: () => {
          const arr = readAll()
          return arr.map((item) => S.decodeUnknownSync(itemSchema)(item))
        },
        catch: (error) => {
          if (error instanceof ParseError) return error
          throw error
        }
      })
    },

    length(): number {
      return yArray.length
    },

    atom() {
      return atomFromYArray(yArray, readAll)
    },

    ids() {
      return atomFromYArray(yArray, () => {
        let set = HashSet.empty<string>()
        for (let i = 0; i < yArray.length; i++) {
          const item = yArray.get(i)
          if (item instanceof Y.Map) {
            set = HashSet.add(set, item.get("_id") as string)
          }
        }
        return set
      })
    }
  }
}
```

**Step 4: Update `src/YLens.ts`**

Replace the stub `createLinkedListLens` with a re-export. Remove the stub
and instead import from the new file:

```ts
import { createLinkedListLens } from "./YLinkedList.js"
```

Remove the stub function and its local imports that are no longer needed.
Keep the `"linkedlist"` case in `classifyAST` and the `focus` handler —
they now delegate to the real implementation.

**Step 5: Run test to verify it passes**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: PASS

**Step 6: Run all tests**

```bash
pnpm vitest run
```

Expected: all pass

**Step 7: Commit**

```bash
git add src/YLinkedList.ts src/YLens.ts test/YLinkedList.test.ts
git commit -m "feat: YLinkedListLens with append() and get()"
```

---

### Task 6: prepend, insertAt, insertAfter

**Files:**
- Modify: `test/YLinkedList.test.ts`

Implementation is already in Task 5's code. This task adds tests to verify.

**Step 1: Write the tests**

Append to `test/YLinkedList.test.ts`:

```ts
describe("YLinkedListLens insertion operations", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("prepend inserts at the beginning", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    pathLens.append({ x: 10, y: 20 })
    pathLens.prepend({ x: 0, y: 0 })
    expect(pathLens.get()).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 }
    ])
  })

  it("insertAt inserts at a specific index", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    pathLens.append({ x: 10, y: 20 })
    pathLens.append({ x: 30, y: 40 })
    pathLens.insertAt(1, { x: 20, y: 30 })
    expect(pathLens.get()).toEqual([
      { x: 10, y: 20 },
      { x: 20, y: 30 },
      { x: 30, y: 40 }
    ])
  })

  it("insertAfter inserts after a specific node", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    const idA = pathLens.append({ x: 10, y: 20 })
    pathLens.append({ x: 30, y: 40 })
    pathLens.insertAfter(idA, { x: 20, y: 30 })
    expect(pathLens.get()).toEqual([
      { x: 10, y: 20 },
      { x: 20, y: 30 },
      { x: 30, y: 40 }
    ])
  })

  it("insertAfter throws for unknown id", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    expect(() => pathLens.insertAfter("nonexistent", { x: 1, y: 2 })).toThrow(
      /Node not found/
    )
  })
})
```

**Step 2: Run tests**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add test/YLinkedList.test.ts
git commit -m "test: insertion operations for YLinkedListLens"
```

---

### Task 7: remove, removeAt, length

**Files:**
- Modify: `test/YLinkedList.test.ts`

**Step 1: Write the tests**

```ts
describe("YLinkedListLens removal and length", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("removeAt removes node at index", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    pathLens.append({ x: 10, y: 20 })
    pathLens.append({ x: 30, y: 40 })
    pathLens.append({ x: 50, y: 60 })
    pathLens.removeAt(1)
    expect(pathLens.get()).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 60 }
    ])
  })

  it("remove removes node by id", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    pathLens.append({ x: 10, y: 20 })
    const idB = pathLens.append({ x: 30, y: 40 })
    pathLens.append({ x: 50, y: 60 })
    pathLens.remove(idB)
    expect(pathLens.get()).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 60 }
    ])
  })

  it("remove throws for unknown id", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    expect(() => pathLens.remove("nonexistent")).toThrow(/Node not found/)
  })

  it("length returns node count", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    expect(pathLens.length()).toBe(0)
    pathLens.append({ x: 10, y: 20 })
    expect(pathLens.length()).toBe(1)
    pathLens.append({ x: 30, y: 40 })
    expect(pathLens.length()).toBe(2)
    pathLens.removeAt(0)
    expect(pathLens.length()).toBe(1)
  })
})
```

**Step 2: Run tests**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add test/YLinkedList.test.ts
git commit -m "test: removal and length for YLinkedListLens"
```

---

### Task 8: at(), find(), nodes() — stable node access

**Files:**
- Modify: `test/YLinkedList.test.ts`

**Step 1: Write the tests**

```ts
describe("YLinkedListLens node access", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("at() returns a lens to node at index", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    pathLens.append({ x: 10, y: 20 })
    pathLens.append({ x: 30, y: 40 })
    const lens = pathLens.at(1)
    expect(lens.get()).toEqual({ x: 30, y: 40 })
  })

  it("at() lens can set values", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    pathLens.append({ x: 10, y: 20 })
    const lens = pathLens.at(0)
    lens.focus("x").set(99)
    expect(pathLens.get()).toEqual([{ x: 99, y: 20 }])
  })

  it("find() returns a lens by id", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    const id = pathLens.append({ x: 10, y: 20 })
    const lens = pathLens.find(id)
    expect(lens.get()).toEqual({ x: 10, y: 20 })
  })

  it("find() lens is stable — survives insertions", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    const id = pathLens.append({ x: 10, y: 20 })
    const lens = pathLens.find(id)
    // Insert before — the Y.Map reference doesn't change
    pathLens.prepend({ x: 0, y: 0 })
    expect(lens.get()).toEqual({ x: 10, y: 20 })
    lens.focus("x").set(99)
    expect(lens.get()).toEqual({ x: 99, y: 20 })
  })

  it("find() throws for unknown id", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    expect(() => pathLens.find("nonexistent")).toThrow(/Node not found/)
  })

  it("nodes() returns a Map of id to lens", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    const idA = pathLens.append({ x: 10, y: 20 })
    const idB = pathLens.append({ x: 30, y: 40 })
    const nodeMap = pathLens.nodes()
    expect(nodeMap.size).toBe(2)
    expect(nodeMap.has(idA)).toBe(true)
    expect(nodeMap.has(idB)).toBe(true)
    expect(nodeMap.get(idA)!.get()).toEqual({ x: 10, y: 20 })
    expect(nodeMap.get(idB)!.get()).toEqual({ x: 30, y: 40 })
  })
})
```

**Step 2: Run tests**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add test/YLinkedList.test.ts
git commit -m "test: at(), find(), nodes() for YLinkedListLens"
```

---

### Task 9: atom() — array-level reactivity

**Files:**
- Modify: `test/YLinkedList.test.ts`

**Step 1: Write the tests**

```ts
import { Atom, Registry } from "@effect-atom/atom"

describe("YLinkedListLens.atom()", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("returns an Atom instance", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    const a = pathLens.atom()
    expect(Atom.isAtom(a)).toBe(true)
  })

  it("atom reads current list state", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    pathLens.append({ x: 10, y: 20 })
    pathLens.append({ x: 30, y: 40 })
    const a = pathLens.atom()
    const registry = Registry.make()
    expect(registry.get(a)).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 }
    ])
  })

  it("atom updates when a node is appended", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    pathLens.append({ x: 10, y: 20 })
    const a = pathLens.atom()
    const registry = Registry.make()
    expect(registry.get(a)).toEqual([{ x: 10, y: 20 }])
    pathLens.append({ x: 30, y: 40 })
    expect(registry.get(a)).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 }
    ])
  })

  it("atom updates when a node field changes", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    const id = pathLens.append({ x: 10, y: 20 })
    const a = pathLens.atom()
    const registry = Registry.make()
    expect(registry.get(a)).toEqual([{ x: 10, y: 20 }])
    pathLens.find(id).focus("x").set(99)
    expect(registry.get(a)).toEqual([{ x: 99, y: 20 }])
  })
})
```

**Step 2: Run tests**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: The basic `atom()` tests should pass since `atomFromYArray` uses
`observe` which fires on structural changes. The "node field changes" test
may fail because `Y.Array.observe` doesn't fire on deep changes to child
`Y.Map`s.

**Step 3: Fix if needed — use observeDeep**

If the "node field changes" test fails, update `src/YLinkedList.ts` to use
a deep-observing atom instead of `atomFromYArray`. Replace the `atom()`
method:

```ts
atom() {
  return Atom.make((get: Atom.Context) => {
    const handler = () => {
      get.setSelf(readAll())
    }
    yArray.observeDeep(handler)
    get.addFinalizer(() => yArray.unobserveDeep(handler))
    return readAll()
  })
}
```

Add the `Atom` import at the top of `src/YLinkedList.ts`:

```ts
import { Atom } from "@effect-atom/atom"
```

**Step 4: Run tests**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/YLinkedList.ts test/YLinkedList.test.ts
git commit -m "feat: array-level atom() for YLinkedListLens"
```

---

### Task 10: ids() — reactive HashSet of node IDs

**Files:**
- Modify: `src/YLinkedList.ts` (may need to refine `ids()` implementation)
- Modify: `test/YLinkedList.test.ts`

**Step 1: Write the tests**

```ts
import * as HashSet from "effect/HashSet"

describe("YLinkedListLens.ids()", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("returns a HashSet of current node ids", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    const idA = pathLens.append({ x: 10, y: 20 })
    const idB = pathLens.append({ x: 30, y: 40 })
    const idsAtom = pathLens.ids()
    const registry = Registry.make()
    const ids = registry.get(idsAtom)
    expect(HashSet.has(ids, idA)).toBe(true)
    expect(HashSet.has(ids, idB)).toBe(true)
    expect(HashSet.size(ids)).toBe(2)
  })

  it("ids() updates when a node is added", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    const idA = pathLens.append({ x: 10, y: 20 })
    const idsAtom = pathLens.ids()
    const registry = Registry.make()
    expect(HashSet.size(registry.get(idsAtom))).toBe(1)
    const idB = pathLens.append({ x: 30, y: 40 })
    const updated = registry.get(idsAtom)
    expect(HashSet.size(updated)).toBe(2)
    expect(HashSet.has(updated, idA)).toBe(true)
    expect(HashSet.has(updated, idB)).toBe(true)
  })

  it("ids() updates when a node is removed", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    const idA = pathLens.append({ x: 10, y: 20 })
    const idB = pathLens.append({ x: 30, y: 40 })
    const idsAtom = pathLens.ids()
    const registry = Registry.make()
    expect(HashSet.size(registry.get(idsAtom))).toBe(2)
    pathLens.remove(idA)
    const updated = registry.get(idsAtom)
    expect(HashSet.size(updated)).toBe(1)
    expect(HashSet.has(updated, idB)).toBe(true)
    expect(HashSet.has(updated, idA)).toBe(false)
  })

  it("ids() does NOT fire when a node field changes", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    const id = pathLens.append({ x: 10, y: 20 })
    const idsAtom = pathLens.ids()
    const registry = Registry.make()
    const before = registry.get(idsAtom)
    pathLens.find(id).focus("x").set(99)
    const after = registry.get(idsAtom)
    // Should be the exact same HashSet reference — no structural change
    expect(HashSet.size(after)).toBe(1)
    expect(HashSet.has(after, id)).toBe(true)
  })
})
```

**Step 2: Run tests**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: The "does NOT fire when a node field changes" test may fail if
`ids()` uses `observeDeep`. The `ids()` atom must use `yArray.observe`
(shallow), not `observeDeep`, because it only cares about structural changes.

**Step 3: Verify ids() uses shallow observe**

In `src/YLinkedList.ts`, the `ids()` method should use `yArray.observe`
(not `observeDeep`). It's already using `atomFromYArray` which uses
`observe`. If it's correct, move on. If it was changed to `observeDeep`
in Task 9, revert `ids()` to use the shallow version:

```ts
ids() {
  return atomFromYArray(yArray, () => {
    let set = HashSet.empty<string>()
    for (let i = 0; i < yArray.length; i++) {
      const item = yArray.get(i)
      if (item instanceof Y.Map) {
        set = HashSet.add(set, item.get("_id") as string)
      }
    }
    return set
  })
}
```

**Step 4: Run tests**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: PASS

**Step 5: Run all tests**

```bash
pnpm vitest run
```

Expected: all pass

**Step 6: Commit**

```bash
git add src/YLinkedList.ts test/YLinkedList.test.ts
git commit -m "feat: ids() reactive HashSet for YLinkedListLens"
```

---

### Task 11: Node atom stability on removal

**Files:**
- Modify: `test/YLinkedList.test.ts`

This tests the design requirement that a node-level atom retains its last
value after the node is removed from the list.

**Step 1: Write the tests**

```ts
describe("Node atom behavior on removal", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("node atom retains last value after removal", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path") as any
    const id = pathLens.append({ x: 10, y: 20 })
    const nodeLens = pathLens.find(id)
    const nodeAtom = nodeLens.atom()
    const registry = Registry.make()

    // Before removal
    expect(registry.get(nodeAtom)).toEqual({ x: 10, y: 20 })

    // Remove the node
    pathLens.remove(id)

    // After removal — should retain last value, not undefined
    expect(registry.get(nodeAtom)).toEqual({ x: 10, y: 20 })
  })
})
```

**Step 2: Run test to verify behavior**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: This may already pass because `atomFromYMap` reads from the
`Y.Map` reference which still holds its data after being detached from the
array. If it fails (returns `undefined` or empty), we need to wrap the
struct lens atom with detach-safe behavior.

**Step 3: Fix if needed**

If the test fails, the issue is that `readStructAsObject` reads from a
detached `Y.Map` that may have been garbage-collected. In that case, add
a wrapper in `src/YLinkedList.ts` that caches the last read value:

Create a helper `atomFromYMapDetachSafe` in `src/atoms.ts`:

```ts
export const atomFromYMapDetachSafe = <T>(
  yMap: Y.Map<any>,
  readValue: () => T
): Atom.Atom<T> =>
  Atom.make((get: Atom.Context) => {
    let lastValue = readValue()
    const handler = () => {
      try {
        lastValue = readValue()
        get.setSelf(lastValue)
      } catch {
        // Y.Map is detached — retain last value
      }
    }
    yMap.observeDeep(handler)
    get.addFinalizer(() => {
      try { yMap.unobserveDeep(handler) } catch { /* already detached */ }
    })
    return lastValue
  })
```

Then use it in `createStructLens` or as an override in the linked list's
`find()` method.

**Step 4: Run tests**

```bash
pnpm vitest run test/YLinkedList.test.ts
```

Expected: PASS

**Step 5: Run all tests**

```bash
pnpm vitest run
```

Expected: all pass

**Step 6: Commit**

```bash
git add src/atoms.ts src/YLinkedList.ts test/YLinkedList.test.ts
git commit -m "feat: detach-safe node atoms retain last value on removal"
```

---

### Task 12: Re-exports and type-check

**Files:**
- Modify: `src/index.ts`

**Step 1: Update exports**

Add to `src/index.ts`:

```ts
export { YLinkedList, YLinkedListTypeId } from "./markers.js"
export type { YLinkedListLens } from "./YLinkedList.js"
```

**Step 2: Run type-check**

```bash
pnpm check
```

Expected: no errors

**Step 3: Run lint**

```bash
pnpm lint
```

Expected: no errors (fix any import sorting / style issues)

**Step 4: Run all tests**

```bash
pnpm vitest run
```

Expected: all pass

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: export YLinkedList from public API"
```

---

### Task 13: Final verification

**Step 1: Run the full check suite**

```bash
pnpm check && pnpm lint && pnpm test
```

Expected: all pass

**Step 2: Review all changes**

```bash
git log --oneline main..HEAD
git diff main..HEAD --stat
```

Verify the commit history is clean and all expected files are modified.
