# effect-yjs v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a schema-first integration between Effect Schema and Yjs that provides type-safe, validated, reactive access to collaborative documents via `YLens`.

**Architecture:** A recursive schema AST traversal engine builds Yjs document trees from Effect Schemas. `YLens<T>` provides self-contained, type-safe accessors with focus/get/set/atom. Reactive reading via effect-atom bridges Yjs observe events to atoms.

**Tech Stack:** Effect (v3, Schema, SchemaAST), Yjs, effect-atom (@effect-atom/atom), TypeScript, Vitest

---

## Pre-Implementation Setup

### Task 0: Add effect-atom dependency and update project structure

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`

**Step 1: Install effect-atom**

Run: `pnpm add @effect-atom/atom`

**Step 2: Update vitest config to also include src test files**

The existing config only includes `./test/**/*.test.ts`. Update to also include `./src/**/*.test.ts` so both locations are supported. However, for the clean-slate redesign, we'll put all new tests in `test/`.

No change needed — tests go in `test/`.

**Step 3: Verify setup**

Run: `pnpm check`
Expected: No errors

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @effect-atom/atom dependency"
```

---

## Task 1: Errors Module

**Files:**
- Create: `src/errors.ts`
- Create: `test/errors.test.ts`

**Step 1: Write the failing test**

```ts
// test/errors.test.ts
import { describe, expect, it } from "@effect/vitest"
import { ParseError } from "effect/ParseResult"
import * as S from "effect/Schema"
import { TypedYValidationError, UnsupportedSchemaError } from "../src/errors.js"

describe("TypedYValidationError", () => {
  it("wraps a ParseError with context", () => {
    const schema = S.String
    let parseError: ParseError | undefined
    try {
      S.decodeUnknownSync(schema)(123)
    } catch (e) {
      parseError = e as ParseError
    }
    const error = new TypedYValidationError("field 'name'", parseError!)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("field 'name'")
    expect(error.cause).toBe(parseError)
  })
})

describe("UnsupportedSchemaError", () => {
  it("reports the schema type and path", () => {
    const error = new UnsupportedSchemaError(
      "Discriminated union",
      ["shapes", "items"]
    )
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("Discriminated union")
    expect(error.message).toContain("shapes.items")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/errors.test.ts`
Expected: FAIL — cannot resolve `../src/errors.js`

**Step 3: Write minimal implementation**

```ts
// src/errors.ts
import type { ParseError } from "effect/ParseResult"

export class TypedYValidationError extends Error {
  readonly _tag = "TypedYValidationError"
  constructor(
    readonly context: string,
    readonly parseError: ParseError
  ) {
    super(`Validation failed at ${context}: ${parseError.message}`)
    this.cause = parseError
  }
}

export class UnsupportedSchemaError extends Error {
  readonly _tag = "UnsupportedSchemaError"
  constructor(
    readonly schemaType: string,
    readonly path: ReadonlyArray<string>
  ) {
    super(
      `Unsupported schema type "${schemaType}" at path: ${path.join(".")}`
    )
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/errors.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/errors.ts test/errors.test.ts
git commit -m "feat: add error types for validation and unsupported schemas"
```

---

## Task 2: YText Marker

**Files:**
- Create: `src/markers.ts`
- Create: `test/markers.test.ts`

**Step 1: Write the failing test**

We need a way to mark a schema field as collaborative text. `YText` should be an Effect Schema that the traversal engine can detect, but at the type level it represents a `Y.Text` instance.

```ts
// test/markers.test.ts
import { describe, expect, it } from "@effect/vitest"
import * as AST from "effect/SchemaAST"
import * as Y from "yjs"
import { YText, YTextTypeId } from "../src/markers.js"

describe("YText marker", () => {
  it("is detectable via annotation on the AST", () => {
    const ast = YText.ast
    const annotation = AST.getAnnotation<symbol>(YTextTypeId)(ast)
    expect(annotation._tag).toBe("Some")
  })

  it("encodes/decodes Y.Text instances", () => {
    // YText schema should accept Y.Text instances
    // At the schema level, it's a marker — actual Y.Text creation
    // happens in the traversal engine
    expect(YText).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/markers.test.ts`
Expected: FAIL — cannot resolve `../src/markers.js`

**Step 3: Write minimal implementation**

```ts
// src/markers.ts
import * as S from "effect/Schema"

export const YTextTypeId: unique symbol = Symbol.for("effect-yjs/YText")

// YText is a schema marker. It tells the traversal engine to create a Y.Text.
// At the type level, it represents an opaque marker that YLens understands.
// The actual Y.Text instance lives inside the Yjs document.
export class YTextMarker {
  readonly _tag = "YTextMarker"
}

export const YText: S.Schema<YTextMarker> = S.declare(
  (input) => input instanceof YTextMarker,
  { identifier: "YText" }
).annotations({ [YTextTypeId]: YTextTypeId })
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/markers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/markers.ts test/markers.test.ts
git commit -m "feat: add YText schema marker for collaborative text fields"
```

---

## Task 3: Schema Traversal Engine — Core

This is the engine room. It walks an Effect Schema AST and builds the corresponding Yjs shared type tree.

**Files:**
- Create: `src/traversal.ts`
- Create: `test/traversal.test.ts`

**Step 1: Write the failing tests for basic traversal**

```ts
// test/traversal.test.ts
import { describe, expect, it } from "@effect/vitest"
import * as S from "effect/Schema"
import * as Y from "yjs"
import { YText } from "../src/markers.js"
import { buildYjsTree } from "../src/traversal.js"

describe("buildYjsTree", () => {
  describe("Struct with primitives", () => {
    it("creates a Y.Map for a struct", () => {
      const schema = S.Struct({ name: S.String, age: S.Number })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      buildYjsTree(schema.ast, root, [])
      // Struct fields that are primitives don't create nested shared types
      // The Y.Map just exists and is ready for primitive values
      expect(root).toBeInstanceOf(Y.Map)
    })
  })

  describe("Struct with nested Struct", () => {
    it("creates nested Y.Maps for nested structs", () => {
      const schema = S.Struct({
        name: S.String,
        position: S.Struct({ x: S.Number, y: S.Number }),
      })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      buildYjsTree(schema.ast, root, [])
      const posMap = root.get("position")
      expect(posMap).toBeInstanceOf(Y.Map)
    })
  })

  describe("Struct with Array field", () => {
    it("creates Y.Array for array fields", () => {
      const schema = S.Struct({
        items: S.Array(S.Number),
      })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      buildYjsTree(schema.ast, root, [])
      const arr = root.get("items")
      expect(arr).toBeInstanceOf(Y.Array)
    })
  })

  describe("Struct with Record field", () => {
    it("creates Y.Map for record fields", () => {
      const schema = S.Struct({
        shapes: S.Record({ key: S.String, value: S.Number }),
      })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      buildYjsTree(schema.ast, root, [])
      const shapesMap = root.get("shapes")
      expect(shapesMap).toBeInstanceOf(Y.Map)
    })
  })

  describe("Struct with YText field", () => {
    it("creates Y.Text for YText-marked fields", () => {
      const schema = S.Struct({
        title: YText,
      })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      buildYjsTree(schema.ast, root, [])
      const text = root.get("title")
      expect(text).toBeInstanceOf(Y.Text)
    })
  })

  describe("Deeply nested structs", () => {
    it("recursively creates nested Y.Maps", () => {
      const schema = S.Struct({
        a: S.Struct({
          b: S.Struct({
            c: S.Number,
          }),
        }),
      })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      buildYjsTree(schema.ast, root, [])
      const aMap = root.get("a") as Y.Map<any>
      expect(aMap).toBeInstanceOf(Y.Map)
      const bMap = aMap.get("b") as Y.Map<any>
      expect(bMap).toBeInstanceOf(Y.Map)
    })
  })

  describe("Refinement unwrapping", () => {
    it("unwraps refinements to find underlying structure", () => {
      const schema = S.Struct({
        name: S.String.pipe(S.minLength(1)),
        age: S.Number,
      })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      // Should not throw — refinement on primitive is fine
      buildYjsTree(schema.ast, root, [])
      expect(root).toBeInstanceOf(Y.Map)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/traversal.test.ts`
Expected: FAIL — cannot resolve `../src/traversal.js`

**Step 3: Write the traversal implementation**

```ts
// src/traversal.ts
import * as AST from "effect/SchemaAST"
import * as Y from "yjs"
import { UnsupportedSchemaError } from "./errors.js"
import { YTextTypeId } from "./markers.js"

/**
 * Checks if an AST node is annotated as YText.
 */
const isYTextAST = (ast: AST.AST): boolean => {
  const annotation = AST.getAnnotation<symbol>(YTextTypeId)(ast)
  return annotation._tag === "Some"
}

/**
 * Checks if a Union AST is a discriminated union (all members are TypeLiterals
 * with a common literal field like `_tag`).
 */
const isDiscriminatedUnion = (ast: AST.Union): boolean => {
  if (ast.types.length < 2) return false
  // Find common literal fields across all members
  const firstMember = ast.types[0]
  if (!AST.isTypeLiteral(firstMember)) return false

  const literalFields = firstMember.propertySignatures.filter(
    (p) => AST.isLiteral(p.type)
  )
  if (literalFields.length === 0) return false

  return literalFields.some((candidateField) =>
    ast.types.every((member) => {
      if (!AST.isTypeLiteral(member)) return false
      return member.propertySignatures.some(
        (p) => p.name === candidateField.name && AST.isLiteral(p.type)
      )
    })
  )
}

/**
 * Determines if an AST node represents a "structural" type that needs its own
 * Yjs shared type (Y.Map, Y.Array, Y.Text), vs a primitive/leaf value.
 */
const isStructuralAST = (ast: AST.AST): boolean => {
  if (isYTextAST(ast)) return true
  if (AST.isTypeLiteral(ast)) return true
  if (AST.isTupleType(ast)) return true
  if (AST.isRefinement(ast)) return isStructuralAST(ast.from)
  if (AST.isSuspend(ast)) return isStructuralAST(ast.f())
  if (AST.isTransformation(ast)) return isStructuralAST(ast.from)
  return false
}

/**
 * Gets the "structural" core of an AST node, unwrapping refinements,
 * suspends, and transformations.
 */
const unwrap = (ast: AST.AST): AST.AST => {
  if (AST.isRefinement(ast)) return unwrap(ast.from)
  if (AST.isSuspend(ast)) return unwrap(ast.f())
  if (AST.isTransformation(ast)) return unwrap(ast.from)
  return ast
}

/**
 * Checks if a TypeLiteral is a Struct (has propertySignatures, no indexSignatures).
 */
const isStruct = (ast: AST.TypeLiteral): boolean =>
  ast.propertySignatures.length > 0 && ast.indexSignatures.length === 0

/**
 * Checks if a TypeLiteral is a Record (has indexSignatures, no propertySignatures).
 */
const isRecord = (ast: AST.TypeLiteral): boolean =>
  ast.propertySignatures.length === 0 && ast.indexSignatures.length > 0

/**
 * Recursively builds the Yjs shared type tree from an Effect Schema AST.
 *
 * - Struct fields that are structural (nested Struct, Record, Array, YText)
 *   get their own Y.Map/Y.Array/Y.Text created as children of the parent Y.Map.
 * - Struct fields that are primitives are left unset (set at runtime via YLens.set).
 * - Records and Arrays start empty — entries created dynamically.
 */
export const buildYjsTree = (
  ast: AST.AST,
  parent: Y.Map<any>,
  path: ReadonlyArray<string>
): void => {
  const core = unwrap(ast)

  if (AST.isTypeLiteral(core)) {
    if (isStruct(core)) {
      // Struct: iterate fields, create nested shared types for structural fields
      for (const prop of core.propertySignatures) {
        const fieldName = String(prop.name)
        const fieldCore = unwrap(prop.type)
        const fieldPath = [...path, fieldName]

        if (isYTextAST(prop.type) || isYTextAST(fieldCore)) {
          const text = new Y.Text()
          parent.set(fieldName, text)
        } else if (AST.isTypeLiteral(fieldCore)) {
          const childMap = new Y.Map()
          parent.set(fieldName, childMap)
          if (isStruct(fieldCore)) {
            // Recurse into nested struct to create its children
            buildYjsTree(fieldCore, childMap, fieldPath)
          }
          // Records start empty — no recursion needed
        } else if (AST.isTupleType(fieldCore)) {
          const childArray = new Y.Array()
          parent.set(fieldName, childArray)
          // Arrays start empty — items created dynamically
        }
        // Primitives, unions, etc. — no Yjs type created
      }
    }
    // Records at top level: the Y.Map already exists, starts empty
    return
  }

  if (AST.isUnion(core)) {
    if (isDiscriminatedUnion(core)) {
      throw new UnsupportedSchemaError("Discriminated union", [...path])
    }
    // Simple union of literals/primitives: treated as leaf value
    return
  }

  if (AST.isTupleType(core)) {
    // Array at top level: parent should already be a Y.Array
    // Nothing to pre-populate
    return
  }

  // All other cases (primitives, literals, etc.) — nothing to do
}

/**
 * Creates the Yjs structure for a struct entry being added to a Record or Array.
 * Used when dynamically adding entries at runtime.
 */
export const buildStructEntry = (
  ast: AST.AST,
  yMap: Y.Map<any>,
  path: ReadonlyArray<string>
): void => {
  buildYjsTree(ast, yMap, path)
}

export { isStruct, isRecord, isStructuralAST, isYTextAST, unwrap, isDiscriminatedUnion }
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/traversal.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/traversal.ts test/traversal.test.ts
git commit -m "feat: add schema traversal engine for building Yjs trees from Effect Schema AST"
```

---

## Task 4: Traversal — Discriminated Union Rejection

**Files:**
- Modify: `test/traversal.test.ts`

**Step 1: Write the failing test**

Add to `test/traversal.test.ts`:

```ts
describe("Discriminated union rejection", () => {
  it("throws UnsupportedSchemaError for discriminated unions", () => {
    const schema = S.Struct({
      shape: S.Union(
        S.Struct({ _tag: S.Literal("circle"), radius: S.Number }),
        S.Struct({ _tag: S.Literal("square"), side: S.Number })
      ),
    })
    const doc = new Y.Doc()
    const root = doc.getMap("root")
    expect(() => buildYjsTree(schema.ast, root, [])).toThrow(
      /Discriminated union/
    )
  })

  it("allows simple unions of literals", () => {
    const schema = S.Struct({
      color: S.Union(S.Literal("red"), S.Literal("blue"), S.Literal("green")),
    })
    const doc = new Y.Doc()
    const root = doc.getMap("root")
    // Should not throw — simple union of literals is fine
    expect(() => buildYjsTree(schema.ast, root, [])).not.toThrow()
  })
})
```

**Step 2: Run test to verify it fails or passes**

Run: `pnpm vitest run test/traversal.test.ts`

If the discriminated union detection works correctly from Task 3, this should already pass. If not, adjust the `isDiscriminatedUnion` logic in `src/traversal.ts`.

**Step 3: Commit (if new tests added)**

```bash
git add test/traversal.test.ts
git commit -m "test: add discriminated union detection tests"
```

---

## Task 5: YDocument — make() and bind()

**Files:**
- Create: `src/YDocument.ts`
- Create: `test/YDocument.test.ts`

**Step 1: Write the failing test**

```ts
// test/YDocument.test.ts
import { describe, expect, it } from "@effect/vitest"
import * as S from "effect/Schema"
import * as Y from "yjs"
import { YDocument } from "../src/YDocument.js"
import { YText } from "../src/markers.js"

const TestSchema = S.Struct({
  name: S.String,
  count: S.Number,
  position: S.Struct({ x: S.Number, y: S.Number }),
  tags: S.Array(S.String),
  metadata: S.Record({ key: S.String, value: S.String }),
  title: YText,
})

describe("YDocument", () => {
  describe("make", () => {
    it("creates a Y.Doc and typed root", () => {
      const { doc, root } = YDocument.make(TestSchema)
      expect(doc).toBeInstanceOf(Y.Doc)
      expect(root).toBeDefined()
    })

    it("pre-creates nested Y.Maps for struct fields", () => {
      const { doc } = YDocument.make(TestSchema)
      const rootMap = doc.getMap("root")
      expect(rootMap.get("position")).toBeInstanceOf(Y.Map)
    })

    it("pre-creates Y.Array for array fields", () => {
      const { doc } = YDocument.make(TestSchema)
      const rootMap = doc.getMap("root")
      expect(rootMap.get("tags")).toBeInstanceOf(Y.Array)
    })

    it("pre-creates Y.Map for record fields", () => {
      const { doc } = YDocument.make(TestSchema)
      const rootMap = doc.getMap("root")
      expect(rootMap.get("metadata")).toBeInstanceOf(Y.Map)
    })

    it("pre-creates Y.Text for YText fields", () => {
      const { doc } = YDocument.make(TestSchema)
      const rootMap = doc.getMap("root")
      expect(rootMap.get("title")).toBeInstanceOf(Y.Text)
    })
  })

  describe("bind", () => {
    it("binds to an existing Y.Doc", () => {
      const doc = new Y.Doc()
      const rootMap = doc.getMap("root")
      // Pre-populate some structure
      rootMap.set("position", new Y.Map())
      rootMap.set("tags", new Y.Array())
      rootMap.set("metadata", new Y.Map())
      rootMap.set("title", new Y.Text())

      const root = YDocument.bind(TestSchema, doc)
      expect(root).toBeDefined()
    })
  })

  describe("transact", () => {
    it("wraps operations in a Y.Doc transaction", () => {
      const { doc, root } = YDocument.make(TestSchema)
      const rootMap = doc.getMap("root")
      let transactionCount = 0
      doc.on("update", () => { transactionCount++ })

      YDocument.transact(root, () => {
        rootMap.set("name", "test")
        rootMap.set("count", 42)
      })
      // Both sets should be in a single transaction
      expect(transactionCount).toBe(1)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/YDocument.test.ts`
Expected: FAIL — cannot resolve `../src/YDocument.js`

**Step 3: Write implementation**

```ts
// src/YDocument.ts
import type * as S from "effect/Schema"
import * as Y from "yjs"
import { buildYjsTree } from "./traversal.js"
import type { YLens } from "./YLens.js"

const ROOT_MAP_NAME = "root"

export interface YDocumentRoot<TSchema extends S.Struct.Fields> {
  readonly _tag: "YDocumentRoot"
  readonly doc: Y.Doc
  readonly schema: S.Struct<TSchema>
  readonly rootMap: Y.Map<any>
  focus: YLens<S.Struct<TSchema>>["focus"]
}

export const YDocument = {
  make<TSchema extends S.Struct.Fields>(
    schema: S.Struct<TSchema>
  ): { doc: Y.Doc; root: YDocumentRoot<TSchema> } {
    const doc = new Y.Doc()
    const rootMap = doc.getMap(ROOT_MAP_NAME)
    doc.transact(() => {
      buildYjsTree(schema.ast, rootMap, [])
    })
    const root: YDocumentRoot<TSchema> = {
      _tag: "YDocumentRoot",
      doc,
      schema,
      rootMap,
      // focus will be wired in Task 6 when YLens exists
      focus: undefined as any,
    }
    return { doc, root }
  },

  bind<TSchema extends S.Struct.Fields>(
    schema: S.Struct<TSchema>,
    doc: Y.Doc
  ): YDocumentRoot<TSchema> {
    const rootMap = doc.getMap(ROOT_MAP_NAME)
    // For bind, we build any missing structure
    doc.transact(() => {
      buildYjsTree(schema.ast, rootMap, [])
    })
    return {
      _tag: "YDocumentRoot",
      doc,
      schema,
      rootMap,
      focus: undefined as any,
    }
  },

  transact<T>(root: YDocumentRoot<any>, fn: () => T): T {
    let result: T
    root.doc.transact(() => {
      result = fn()
    })
    return result!
  },
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/YDocument.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/YDocument.ts test/YDocument.test.ts
git commit -m "feat: add YDocument.make(), bind(), and transact()"
```

---

## Task 6: YLens — Core (get, set, focus for Structs)

This is the central API. We start with Struct support.

**Files:**
- Create: `src/YLens.ts`
- Create: `test/YLens.test.ts`

**Step 1: Write the failing tests**

```ts
// test/YLens.test.ts
import { describe, expect, it } from "@effect/vitest"
import * as S from "effect/Schema"
import * as Y from "yjs"
import { YDocument } from "../src/YDocument.js"
import { TypedYValidationError } from "../src/errors.js"

const PositionSchema = S.Struct({ x: S.Number, y: S.Number })

const TestSchema = S.Struct({
  name: S.String,
  count: S.Number,
  position: PositionSchema,
})

describe("YLens", () => {
  describe("Struct — primitive fields", () => {
    it("set and get a string field", () => {
      const { root } = YDocument.make(TestSchema)
      root.focus("name").set("hello")
      expect(root.focus("name").get()).toBe("hello")
    })

    it("set and get a number field", () => {
      const { root } = YDocument.make(TestSchema)
      root.focus("count").set(42)
      expect(root.focus("count").get()).toBe(42)
    })

    it("get returns undefined for unset fields", () => {
      const { root } = YDocument.make(TestSchema)
      expect(root.focus("name").get()).toBeUndefined()
    })

    it("throws TypedYValidationError on invalid set", () => {
      const { root } = YDocument.make(TestSchema)
      expect(() => root.focus("count").set("not a number" as any)).toThrow(
        TypedYValidationError
      )
    })
  })

  describe("Struct — nested struct focus", () => {
    it("focus into nested struct and set/get", () => {
      const { root } = YDocument.make(TestSchema)
      root.focus("position").focus("x").set(10)
      root.focus("position").focus("y").set(20)
      expect(root.focus("position").focus("x").get()).toBe(10)
      expect(root.focus("position").focus("y").get()).toBe(20)
    })

    it("set entire nested struct", () => {
      const { root } = YDocument.make(TestSchema)
      root.focus("position").set({ x: 5, y: 15 })
      expect(root.focus("position").focus("x").get()).toBe(5)
      expect(root.focus("position").focus("y").get()).toBe(15)
    })

    it("get entire nested struct as object", () => {
      const { root } = YDocument.make(TestSchema)
      root.focus("position").focus("x").set(3)
      root.focus("position").focus("y").set(7)
      expect(root.focus("position").get()).toEqual({ x: 3, y: 7 })
    })
  })

  describe("focus type safety", () => {
    it("focus returns a YLens that can be passed around", () => {
      const { root } = YDocument.make(TestSchema)
      const posLens = root.focus("position")
      const xLens = posLens.focus("x")
      xLens.set(99)
      expect(xLens.get()).toBe(99)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/YLens.test.ts`
Expected: FAIL

**Step 3: Write YLens implementation**

```ts
// src/YLens.ts
import { ParseError } from "effect/ParseResult"
import * as S from "effect/Schema"
import * as AST from "effect/SchemaAST"
import * as Y from "yjs"
import { TypedYValidationError } from "./errors.js"
import { isYTextAST, unwrap } from "./traversal.js"

/**
 * Resolves the field schema for a given key from a Struct schema.
 */
const getFieldSchema = (
  structSchema: S.Schema.AnyNoContext,
  key: string
): S.Schema.AnyNoContext | undefined => {
  const ast = unwrap(structSchema.ast)
  if (!AST.isTypeLiteral(ast)) return undefined
  const prop = ast.propertySignatures.find((p) => String(p.name) === key)
  if (!prop) return undefined
  return S.make(prop.type)
}

/**
 * Determines the "kind" of a schema for YLens behavior.
 */
type LensKind = "struct" | "record" | "array" | "ytext" | "primitive"

const classifyAST = (ast: AST.AST): LensKind => {
  if (isYTextAST(ast)) return "ytext"
  const core = unwrap(ast)
  if (AST.isTypeLiteral(core)) {
    if (core.propertySignatures.length > 0 && core.indexSignatures.length === 0)
      return "struct"
    if (core.indexSignatures.length > 0 && core.propertySignatures.length === 0)
      return "record"
    // Mixed — treat as struct
    if (core.propertySignatures.length > 0) return "struct"
    return "primitive"
  }
  if (AST.isTupleType(core)) return "array"
  return "primitive"
}

/**
 * Reads a plain object from a Y.Map representing a struct.
 */
const readStructAsObject = (yMap: Y.Map<any>, ast: AST.AST): any => {
  const core = unwrap(ast)
  if (!AST.isTypeLiteral(core)) return undefined
  const obj: Record<string, any> = {}
  for (const prop of core.propertySignatures) {
    const key = String(prop.name)
    const value = yMap.get(key)
    const fieldKind = classifyAST(prop.type)
    if (fieldKind === "struct" && value instanceof Y.Map) {
      obj[key] = readStructAsObject(value, prop.type)
    } else if (fieldKind === "array" && value instanceof Y.Array) {
      obj[key] = readArrayAsPlain(value, prop.type)
    } else if (fieldKind === "ytext" && value instanceof Y.Text) {
      obj[key] = value
    } else {
      obj[key] = value
    }
  }
  return obj
}

/**
 * Reads a Y.Array as a plain array.
 */
const readArrayAsPlain = (yArray: Y.Array<any>, ast: AST.AST): any[] => {
  const core = unwrap(ast)
  if (!AST.isTupleType(core) || core.rest.length === 0) return yArray.toArray()
  const itemAST = core.rest[0].type
  const itemKind = classifyAST(itemAST)
  return yArray.toArray().map((item) => {
    if (itemKind === "struct" && item instanceof Y.Map) {
      return readStructAsObject(item, itemAST)
    }
    return item
  })
}

/**
 * Writes a plain object into a Y.Map representing a struct.
 */
const writeStructFromObject = (
  yMap: Y.Map<any>,
  ast: AST.AST,
  value: Record<string, any>
): void => {
  const core = unwrap(ast)
  if (!AST.isTypeLiteral(core)) return
  for (const prop of core.propertySignatures) {
    const key = String(prop.name)
    if (!(key in value)) continue
    const fieldKind = classifyAST(prop.type)
    if (fieldKind === "struct") {
      let childMap = yMap.get(key)
      if (!(childMap instanceof Y.Map)) {
        childMap = new Y.Map()
        yMap.set(key, childMap)
      }
      writeStructFromObject(childMap, prop.type, value[key])
    } else if (fieldKind === "array") {
      let childArray = yMap.get(key)
      if (!(childArray instanceof Y.Array)) {
        childArray = new Y.Array()
        yMap.set(key, childArray)
      }
      writeArrayFromPlain(childArray, prop.type, value[key])
    } else {
      yMap.set(key, value[key])
    }
  }
}

/**
 * Writes a plain array into a Y.Array.
 */
const writeArrayFromPlain = (
  yArray: Y.Array<any>,
  ast: AST.AST,
  value: any[]
): void => {
  // Clear and repopulate
  yArray.delete(0, yArray.length)
  const core = unwrap(ast)
  if (!AST.isTupleType(core) || core.rest.length === 0) {
    yArray.push(value)
    return
  }
  const itemAST = core.rest[0].type
  const itemKind = classifyAST(itemAST)
  for (const item of value) {
    if (itemKind === "struct") {
      const childMap = new Y.Map()
      writeStructFromObject(childMap, itemAST, item)
      yArray.push([childMap])
    } else {
      yArray.push([item])
    }
  }
}

export interface YLens<T> {
  /** Focus on a child field/key, returning a new YLens for that path. */
  focus: T extends S.Struct<infer Fields>
    ? <K extends keyof Fields & string>(key: K) => YLens<S.Schema.Type<Fields[K] extends S.Schema.AnyNoContext ? Fields[K] : never>>
    : T extends Record<string, infer V>
      ? (key: string) => YLens<V>
      : never

  /** Get the current value. */
  get: () => T | undefined

  /** Set the value (validates via Effect Schema, throws on failure). */
  set: (value: T) => void
}

/**
 * Creates a YLens for a Struct field backed by a Y.Map.
 */
export const createStructLens = <TSchema extends S.Schema.AnyNoContext>(
  schema: TSchema,
  yMap: Y.Map<any>,
  doc: Y.Doc
): YLens<S.Schema.Type<TSchema>> => {
  const kind = classifyAST(schema.ast)

  return {
    focus(key: string): any {
      const fieldSchema = getFieldSchema(schema, key)
      if (!fieldSchema) {
        throw new Error(`Unknown field: ${key}`)
      }
      const fieldKind = classifyAST(fieldSchema.ast)

      if (fieldKind === "struct") {
        let childMap = yMap.get(key)
        if (!(childMap instanceof Y.Map)) {
          childMap = new Y.Map()
          yMap.set(key, childMap)
        }
        return createStructLens(fieldSchema, childMap, doc)
      }

      if (fieldKind === "record") {
        let childMap = yMap.get(key)
        if (!(childMap instanceof Y.Map)) {
          childMap = new Y.Map()
          yMap.set(key, childMap)
        }
        return createRecordLens(fieldSchema, childMap, doc)
      }

      if (fieldKind === "array") {
        let childArray = yMap.get(key)
        if (!(childArray instanceof Y.Array)) {
          childArray = new Y.Array()
          yMap.set(key, childArray)
        }
        return createArrayLens(fieldSchema, childArray, doc)
      }

      // Primitive field
      return createPrimitiveLens(fieldSchema, yMap, key, doc)
    },

    get() {
      if (kind === "struct") {
        return readStructAsObject(yMap, schema.ast)
      }
      return undefined
    },

    set(value: any) {
      // Validate the entire struct value
      try {
        S.decodeUnknownSync(schema)(value)
      } catch (error) {
        if (error instanceof ParseError) {
          throw new TypedYValidationError("struct", error)
        }
        throw error
      }
      doc.transact(() => {
        writeStructFromObject(yMap, schema.ast, value)
      })
    },
  } as any
}

/**
 * Creates a YLens for a primitive field stored in a parent Y.Map.
 */
const createPrimitiveLens = (
  schema: S.Schema.AnyNoContext,
  parentMap: Y.Map<any>,
  key: string,
  doc: Y.Doc
): YLens<any> => ({
  focus: (() => {
    throw new Error("Cannot focus into a primitive value")
  }) as any,

  get() {
    return parentMap.get(key)
  },

  set(value: any) {
    try {
      S.decodeUnknownSync(schema)(value)
    } catch (error) {
      if (error instanceof ParseError) {
        throw new TypedYValidationError(`field '${key}'`, error)
      }
      throw error
    }
    parentMap.set(key, value)
  },
})

/**
 * Creates a YLens for a Record field backed by a Y.Map.
 */
export const createRecordLens = <TSchema extends S.Schema.AnyNoContext>(
  schema: TSchema,
  yMap: Y.Map<any>,
  doc: Y.Doc
): YLens<any> => {
  const core = unwrap(schema.ast)
  const valueAST =
    AST.isTypeLiteral(core) && core.indexSignatures.length > 0
      ? core.indexSignatures[0].type
      : undefined
  const valueSchema = valueAST ? S.make(valueAST) : undefined
  const valueKind = valueAST ? classifyAST(valueAST) : "primitive"

  return {
    focus(key: string): any {
      if (!valueSchema) throw new Error("Cannot determine record value schema")

      if (valueKind === "struct") {
        let childMap = yMap.get(key)
        if (!(childMap instanceof Y.Map)) {
          childMap = new Y.Map()
          yMap.set(key, childMap)
          // Build nested struct structure
          const { buildYjsTree } = require("./traversal.js")
          buildYjsTree(valueAST!, childMap, [key])
        }
        return createStructLens(valueSchema, childMap, doc)
      }

      if (valueKind === "record") {
        let childMap = yMap.get(key)
        if (!(childMap instanceof Y.Map)) {
          childMap = new Y.Map()
          yMap.set(key, childMap)
        }
        return createRecordLens(valueSchema, childMap, doc)
      }

      // Primitive record values
      return createPrimitiveLens(valueSchema, yMap, key, doc)
    },

    get() {
      const result: Record<string, any> = {}
      for (const [k, v] of yMap.entries()) {
        if (valueKind === "struct" && v instanceof Y.Map && valueAST) {
          result[k] = readStructAsObject(v, valueAST)
        } else {
          result[k] = v
        }
      }
      return result
    },

    set(value: any) {
      try {
        S.decodeUnknownSync(schema)(value)
      } catch (error) {
        if (error instanceof ParseError) {
          throw new TypedYValidationError("record", error)
        }
        throw error
      }
      doc.transact(() => {
        // Clear existing entries
        for (const key of Array.from(yMap.keys())) {
          yMap.delete(key)
        }
        // Set new entries
        for (const [k, v] of Object.entries(value as Record<string, any>)) {
          if (valueKind === "struct" && valueAST) {
            const childMap = new Y.Map()
            writeStructFromObject(childMap, valueAST, v as any)
            yMap.set(k, childMap)
          } else {
            yMap.set(k, v)
          }
        }
      })
    },
  } as any
}

/**
 * Creates a YLens for an Array field backed by a Y.Array.
 */
export const createArrayLens = <TSchema extends S.Schema.AnyNoContext>(
  schema: TSchema,
  yArray: Y.Array<any>,
  doc: Y.Doc
): YLens<any> => ({
  focus: (() => {
    throw new Error("Use .at(index) for array access (not yet implemented)")
  }) as any,

  get() {
    const core = unwrap(schema.ast)
    if (AST.isTupleType(core) && core.rest.length > 0) {
      return readArrayAsPlain(yArray, schema.ast)
    }
    return yArray.toArray()
  },

  set(value: any) {
    try {
      S.decodeUnknownSync(schema)(value)
    } catch (error) {
      if (error instanceof ParseError) {
        throw new TypedYValidationError("array", error)
      }
      throw error
    }
    doc.transact(() => {
      writeArrayFromPlain(yArray, schema.ast, value)
    })
  },
})
```

**Step 4: Wire YLens into YDocument**

Update `src/YDocument.ts` to connect `focus` on the root:

Replace the `focus: undefined as any` lines in both `make` and `bind` with:

```ts
import { createStructLens } from "./YLens.js"

// In make():
const lens = createStructLens(schema as any, rootMap, doc)
const root = { ...lens, _tag: "YDocumentRoot" as const, doc, schema, rootMap }

// In bind():
const lens = createStructLens(schema as any, rootMap, doc)
return { ...lens, _tag: "YDocumentRoot" as const, doc, schema, rootMap }
```

**Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/YLens.test.ts test/YDocument.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/YLens.ts src/YDocument.ts test/YLens.test.ts
git commit -m "feat: add YLens with focus/get/set for structs and primitive fields"
```

---

## Task 7: YLens — Record Support

**Files:**
- Modify: `test/YLens.test.ts`

**Step 1: Write the failing tests**

Add to `test/YLens.test.ts`:

```ts
const RecordSchema = S.Struct({
  scores: S.Record({ key: S.String, value: S.Number }),
  shapes: S.Record({
    key: S.String,
    value: S.Struct({ x: S.Number, y: S.Number }),
  }),
})

describe("YLens — Records", () => {
  it("set and get primitive record entries", () => {
    const { root } = YDocument.make(RecordSchema)
    root.focus("scores").focus("alice").set(100)
    root.focus("scores").focus("bob").set(85)
    expect(root.focus("scores").focus("alice").get()).toBe(100)
    expect(root.focus("scores").focus("bob").get()).toBe(85)
  })

  it("get entire record as object", () => {
    const { root } = YDocument.make(RecordSchema)
    root.focus("scores").focus("alice").set(100)
    expect(root.focus("scores").get()).toEqual({ alice: 100 })
  })

  it("focus into record with struct values", () => {
    const { root } = YDocument.make(RecordSchema)
    root.focus("shapes").focus("s1").focus("x").set(10)
    root.focus("shapes").focus("s1").focus("y").set(20)
    expect(root.focus("shapes").focus("s1").get()).toEqual({ x: 10, y: 20 })
  })

  it("set entire struct within a record", () => {
    const { root } = YDocument.make(RecordSchema)
    root.focus("shapes").focus("s1").set({ x: 5, y: 15 })
    expect(root.focus("shapes").focus("s1").focus("x").get()).toBe(5)
  })
})
```

**Step 2: Run test**

Run: `pnpm vitest run test/YLens.test.ts`

These should pass if the `createRecordLens` from Task 6 works. Fix the dynamic import issue — replace `require("./traversal.js")` with a direct import at the top of the file.

**Step 3: Commit**

```bash
git add test/YLens.test.ts src/YLens.ts
git commit -m "feat: add YLens record support with struct values"
```

---

## Task 8: YLens — Array Support

**Files:**
- Modify: `test/YLens.test.ts`
- Modify: `src/YLens.ts`

**Step 1: Write the failing tests**

Add to `test/YLens.test.ts`:

```ts
const ArraySchema = S.Struct({
  numbers: S.Array(S.Number),
  points: S.Array(S.Struct({ x: S.Number, y: S.Number })),
})

describe("YLens — Arrays", () => {
  it("set and get a primitive array", () => {
    const { root } = YDocument.make(ArraySchema)
    root.focus("numbers").set([1, 2, 3])
    expect(root.focus("numbers").get()).toEqual([1, 2, 3])
  })

  it("set and get an array of structs", () => {
    const { root } = YDocument.make(ArraySchema)
    root.focus("points").set([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ])
    expect(root.focus("points").get()).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ])
  })

  it("overwrite replaces the entire array", () => {
    const { root } = YDocument.make(ArraySchema)
    root.focus("numbers").set([1, 2, 3])
    root.focus("numbers").set([4, 5])
    expect(root.focus("numbers").get()).toEqual([4, 5])
  })
})
```

**Step 2: Run test**

Run: `pnpm vitest run test/YLens.test.ts`
Expected: Should mostly pass from Task 6 implementation. Fix any issues.

**Step 3: Commit**

```bash
git add test/YLens.test.ts src/YLens.ts
git commit -m "feat: add YLens array support"
```

---

## Task 9: YLens — YText Support

**Files:**
- Modify: `test/YLens.test.ts`
- Modify: `src/YLens.ts`

**Step 1: Write the failing tests**

```ts
import { YText } from "../src/markers.js"
import * as Y from "yjs"

const TextSchema = S.Struct({
  title: YText,
  content: YText,
})

describe("YLens — YText", () => {
  it("focus on YText field returns the Y.Text instance", () => {
    const { root } = YDocument.make(TextSchema)
    const titleText = root.focus("title").get()
    expect(titleText).toBeInstanceOf(Y.Text)
  })

  it("Y.Text can be manipulated directly", () => {
    const { root } = YDocument.make(TextSchema)
    const titleText = root.focus("title").get() as Y.Text
    titleText.insert(0, "Hello, world!")
    expect(titleText.toString()).toBe("Hello, world!")
  })
})
```

**Step 2: Implement YText lens**

Add a `createYTextLens` function in `src/YLens.ts`:

```ts
const createYTextLens = (
  yText: Y.Text,
  _doc: Y.Doc
): YLens<any> => ({
  focus: (() => {
    throw new Error("Cannot focus into a Y.Text")
  }) as any,

  get() {
    return yText
  },

  set(_value: any) {
    throw new Error("Cannot set Y.Text directly — use the Y.Text API (insert, delete, etc.)")
  },
})
```

Wire it into `createStructLens.focus` for the `ytext` case:

```ts
if (fieldKind === "ytext") {
  let childText = yMap.get(key)
  if (!(childText instanceof Y.Text)) {
    childText = new Y.Text()
    yMap.set(key, childText)
  }
  return createYTextLens(childText, doc)
}
```

**Step 3: Run test**

Run: `pnpm vitest run test/YLens.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add test/YLens.test.ts src/YLens.ts
git commit -m "feat: add YLens YText support"
```

---

## Task 10: YLens — setEffect and getSafe (Effect integration)

**Files:**
- Modify: `src/YLens.ts`
- Modify: `test/YLens.test.ts`

**Step 1: Write the failing tests**

```ts
import * as Effect from "effect/Effect"

describe("YLens — Effect integration", () => {
  it("setEffect returns Effect<void, ParseError> on success", async () => {
    const { root } = YDocument.make(TestSchema)
    const result = Effect.runSync(root.focus("count").setEffect(42))
    expect(result).toBeUndefined()
    expect(root.focus("count").get()).toBe(42)
  })

  it("setEffect returns failure Effect on validation error", async () => {
    const { root } = YDocument.make(TestSchema)
    const result = Effect.runSyncExit(
      root.focus("count").setEffect("not a number" as any)
    )
    expect(result._tag).toBe("Failure")
  })

  it("getSafe returns Effect<T, ParseError> validating the data", () => {
    const { root } = YDocument.make(TestSchema)
    root.focus("count").set(42)
    const result = Effect.runSync(root.focus("count").getSafe())
    expect(result).toBe(42)
  })
})
```

**Step 2: Add setEffect and getSafe to YLens interface and implementations**

Extend the `YLens<T>` interface:

```ts
import * as Effect from "effect/Effect"
import type { ParseError } from "effect/ParseResult"

export interface YLens<T> {
  focus: ...
  get: () => T | undefined
  set: (value: T) => void
  setEffect: (value: T) => Effect.Effect<void, ParseError>
  getSafe: () => Effect.Effect<T, ParseError>
}
```

For primitive lens:
```ts
setEffect(value: any) {
  return Effect.try({
    try: () => {
      S.decodeUnknownSync(schema)(value)
      parentMap.set(key, value)
    },
    catch: (error) => {
      if (error instanceof ParseError) return error
      throw error
    },
  })
},

getSafe() {
  return Effect.try({
    try: () => S.decodeUnknownSync(schema)(parentMap.get(key)),
    catch: (error) => {
      if (error instanceof ParseError) return error
      throw error
    },
  })
},
```

Similar pattern for struct, record, array lenses.

**Step 3: Run test**

Run: `pnpm vitest run test/YLens.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/YLens.ts test/YLens.test.ts
git commit -m "feat: add setEffect and getSafe to YLens for Effect-based validation"
```

---

## Task 11: Reactive Atoms — Yjs observe to effect-atom bridge

**Files:**
- Create: `src/atoms.ts`
- Create: `test/atoms.test.ts`
- Modify: `src/YLens.ts`

**Step 1: Write the failing tests**

```ts
// test/atoms.test.ts
import { describe, expect, it } from "@effect/vitest"
import * as S from "effect/Schema"
import * as Y from "yjs"
import { YDocument } from "../src/YDocument.js"

const TestSchema = S.Struct({
  name: S.String,
  count: S.Number,
  position: S.Struct({ x: S.Number, y: S.Number }),
})

describe("YLens.atom()", () => {
  it("returns an atom with the current value", () => {
    const { root } = YDocument.make(TestSchema)
    root.focus("count").set(42)
    const atom = root.focus("count").atom()
    expect(atom).toBeDefined()
    // The atom's initial value should reflect the current Yjs state
    // We need to read the atom value — this depends on effect-atom API
  })

  it("atom updates when Yjs value changes", async () => {
    const { root, doc } = YDocument.make(TestSchema)
    root.focus("count").set(1)
    const atom = root.focus("count").atom()

    // Mutate the Yjs doc
    root.focus("count").set(2)

    // The atom should reflect the new value
    // Verification depends on how effect-atom exposes values
  })
})
```

**Note:** The exact test assertions depend on how `@effect-atom/atom` exposes atom values outside of React. We may need to use `Atom.make((get) => get(ourAtom))` or similar. The implementation will need to:

1. Create an `Atom.make()` that reads the current value from Yjs
2. Use `get.addFinalizer()` to clean up Yjs observers
3. Use `get.setSelf()` when Yjs fires an observe event

**Step 2: Write the atoms bridge**

```ts
// src/atoms.ts
import { Atom } from "@effect-atom/atom"
import * as Y from "yjs"

/**
 * Creates an Atom that tracks a specific key in a Y.Map.
 */
export const atomFromYMapKey = <T>(
  yMap: Y.Map<any>,
  key: string,
  readValue: () => T
): Atom.Atom<T | undefined> =>
  Atom.make((get) => {
    const handler = () => get.setSelf(readValue())
    yMap.observe(handler)
    get.addFinalizer(() => yMap.unobserve(handler))
    return readValue()
  })

/**
 * Creates an Atom that tracks an entire Y.Map.
 */
export const atomFromYMap = <T>(
  yMap: Y.Map<any>,
  readValue: () => T
): Atom.Atom<T> =>
  Atom.make((get) => {
    const handler = () => get.setSelf(readValue())
    yMap.observeDeep(handler)
    get.addFinalizer(() => yMap.unobserveDeep(handler))
    return readValue()
  })

/**
 * Creates an Atom that tracks a Y.Array.
 */
export const atomFromYArray = <T>(
  yArray: Y.Array<any>,
  readValue: () => T
): Atom.Atom<T> =>
  Atom.make((get) => {
    const handler = () => get.setSelf(readValue())
    yArray.observe(handler)
    get.addFinalizer(() => yArray.unobserve(handler))
    return readValue()
  })

/**
 * Creates an Atom that tracks a Y.Text.
 */
export const atomFromYText = (
  yText: Y.Text
): Atom.Atom<Y.Text> =>
  Atom.make((get) => {
    const handler = () => get.setSelf(yText)
    yText.observe(handler)
    get.addFinalizer(() => yText.unobserve(handler))
    return yText
  })
```

**Step 3: Wire `.atom()` into each YLens variant**

Add `.atom()` method to each lens type in `src/YLens.ts`, calling the appropriate `atomFrom*` function.

For primitive lens:
```ts
atom() {
  return atomFromYMapKey(parentMap, key, () => parentMap.get(key))
}
```

For struct lens:
```ts
atom() {
  return atomFromYMap(yMap, () => readStructAsObject(yMap, schema.ast))
}
```

**Step 4: Run test**

Run: `pnpm vitest run test/atoms.test.ts`
Expected: PASS (may need adjustment based on effect-atom API behavior)

**Step 5: Commit**

```bash
git add src/atoms.ts test/atoms.test.ts src/YLens.ts
git commit -m "feat: add reactive atoms via Yjs observe → effect-atom bridge"
```

---

## Task 12: Public API and Index

**Files:**
- Create: `src/index.ts`

**Step 1: Write the public API barrel**

```ts
// src/index.ts
export { YDocument } from "./YDocument.js"
export type { YDocumentRoot } from "./YDocument.js"
export type { YLens } from "./YLens.js"
export { YText, YTextTypeId } from "./markers.js"
export { TypedYValidationError, UnsupportedSchemaError } from "./errors.js"
```

**Step 2: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests PASS

**Step 3: Run type check**

Run: `pnpm check`
Expected: No errors

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add public API barrel export"
```

---

## Task 13: Integration Test — Full Document Lifecycle

**Files:**
- Create: `test/integration.test.ts`

**Step 1: Write comprehensive integration test**

```ts
// test/integration.test.ts
import { describe, expect, it } from "@effect/vitest"
import * as S from "effect/Schema"
import * as Y from "yjs"
import { YDocument, YText } from "../src/index.js"

const Position = { x: S.Number, y: S.Number }

const Shape = S.Struct({
  id: S.String,
  ...Position,
  label: YText,
})

const AppSchema = S.Struct({
  shapes: S.Record({ key: S.String, value: Shape }),
  metadata: S.Struct({
    title: YText,
    version: S.Number,
  }),
  tags: S.Array(S.String),
})

describe("Full document lifecycle", () => {
  it("create, populate, read, and sync", () => {
    // Create document
    const { doc, root } = YDocument.make(AppSchema)

    // Set primitive fields
    root.focus("metadata").focus("version").set(1)

    // Use Y.Text directly
    const title = root.focus("metadata").focus("title").get() as Y.Text
    title.insert(0, "My Drawing")

    // Add shapes via record
    root.focus("shapes").focus("shape-1").set({
      id: "shape-1",
      x: 100,
      y: 200,
      label: undefined as any, // YText created by structure
    })

    // Focus deep into a shape
    root.focus("shapes").focus("shape-1").focus("x").set(150)

    // Set array
    root.focus("tags").set(["drawing", "v1"])

    // Read back
    expect(root.focus("metadata").focus("version").get()).toBe(1)
    expect(title.toString()).toBe("My Drawing")
    expect(root.focus("shapes").focus("shape-1").focus("x").get()).toBe(150)
    expect(root.focus("tags").get()).toEqual(["drawing", "v1"])
  })

  it("two docs sync via Yjs", () => {
    const { doc: doc1, root: root1 } = YDocument.make(
      S.Struct({ count: S.Number })
    )
    const doc2 = new Y.Doc()
    const root2 = YDocument.bind(S.Struct({ count: S.Number }), doc2)

    // Set on doc1
    root1.focus("count").set(42)

    // Sync doc1 → doc2
    const state1 = Y.encodeStateAsUpdate(doc1)
    Y.applyUpdate(doc2, state1)

    // Read on doc2
    expect(root2.focus("count").get()).toBe(42)
  })

  it("lens passed to child component pattern", () => {
    const { root } = YDocument.make(AppSchema)
    root.focus("shapes").focus("s1").set({
      id: "s1",
      x: 10,
      y: 20,
      label: undefined as any,
    })

    // Simulate passing a lens to a child
    const shapeLens = root.focus("shapes").focus("s1")
    const xLens = shapeLens.focus("x")

    // Child only knows about YLens<number>, not the full doc
    xLens.set(99)
    expect(xLens.get()).toBe(99)
  })

  it("transactions batch multiple writes", () => {
    const { doc, root } = YDocument.make(AppSchema)
    let updateCount = 0
    doc.on("update", () => updateCount++)

    YDocument.transact(root, () => {
      root.focus("metadata").focus("version").set(1)
      root.focus("tags").set(["a", "b"])
    })

    expect(updateCount).toBe(1)
  })
})
```

**Step 2: Run test**

Run: `pnpm vitest run test/integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add test/integration.test.ts
git commit -m "test: add full document lifecycle integration tests"
```

---

## Task 14: Type Safety Verification

**Files:**
- Create: `test/type-safety.test.ts`

This test file verifies that TypeScript catches type errors at compile time using `@ts-expect-error`.

**Step 1: Write type safety tests**

```ts
// test/type-safety.test.ts
import { describe, it } from "@effect/vitest"
import * as S from "effect/Schema"
import { YDocument } from "../src/index.js"

const Schema = S.Struct({
  name: S.String,
  count: S.Number,
  nested: S.Struct({ x: S.Number }),
})

describe("Type safety", () => {
  it("focus accepts only valid field names", () => {
    const { root } = YDocument.make(Schema)
    root.focus("name") // ok
    root.focus("count") // ok
    root.focus("nested") // ok
    // @ts-expect-error — "invalid" is not a field
    root.focus("invalid")
  })

  it("set accepts only the correct type", () => {
    const { root } = YDocument.make(Schema)
    root.focus("name").set("hello") // ok
    // @ts-expect-error — number is not assignable to string
    root.focus("name").set(123)
  })

  it("nested focus is type-safe", () => {
    const { root } = YDocument.make(Schema)
    root.focus("nested").focus("x").set(1) // ok
    // @ts-expect-error — "y" is not a field of nested
    root.focus("nested").focus("y")
  })
})
```

**Step 2: Run test and type check**

Run: `pnpm vitest run test/type-safety.test.ts && pnpm check`
Expected: PASS (all `@ts-expect-error` should be needed, meaning the types correctly reject invalid usage)

**Step 3: Commit**

```bash
git add test/type-safety.test.ts
git commit -m "test: add compile-time type safety verification tests"
```

---

## Task 15: Final Cleanup and Full Verification

**Files:**
- Clean up any unused old files (old `src/yjs-utils/` exploratory code can stay — it's uncommitted)

**Step 1: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests PASS

**Step 2: Run type check**

Run: `pnpm check`
Expected: No errors

**Step 3: Run lint**

Run: `pnpm lint`
Expected: No errors (fix any that appear)

**Step 4: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: final cleanup for effect-yjs v1"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 0 | Add effect-atom dependency | `package.json` |
| 1 | Error types | `src/errors.ts` |
| 2 | YText marker | `src/markers.ts` |
| 3 | Schema traversal — core | `src/traversal.ts` |
| 4 | Traversal — discriminated union rejection | `test/traversal.test.ts` |
| 5 | YDocument — make/bind/transact | `src/YDocument.ts` |
| 6 | YLens — core (struct + primitives) | `src/YLens.ts` |
| 7 | YLens — record support | `test/YLens.test.ts` |
| 8 | YLens — array support | `test/YLens.test.ts` |
| 9 | YLens — YText support | `src/YLens.ts` |
| 10 | YLens — setEffect/getSafe | `src/YLens.ts` |
| 11 | Reactive atoms bridge | `src/atoms.ts` |
| 12 | Public API barrel | `src/index.ts` |
| 13 | Integration tests | `test/integration.test.ts` |
| 14 | Type safety tests | `test/type-safety.test.ts` |
| 15 | Final cleanup + verification | — |
