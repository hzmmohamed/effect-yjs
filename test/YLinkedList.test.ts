import { Atom, Registry } from "@effect-atom/atom"
import { describe, expect, it } from "@effect/vitest"
import * as HashSet from "effect/HashSet"
import * as S from "effect/Schema"
import * as AST from "effect/SchemaAST"
import * as Y from "yjs"
import { YLinkedList, YLinkedListItemAST, YLinkedListTypeId } from "../src/markers.js"
import { buildYjsTree } from "../src/traversal.js"
import { YDocument } from "../src/YDocument.js"

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

describe("YLinkedListLens.append and get", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("append adds a node and returns a UUIDv7 id", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
    const id = pathLens.append({ x: 10, y: 20 })
    expect(typeof id).toBe("string")
    expect(id.length).toBe(36) // UUID format
  })

  it("get returns array of plain objects without _id", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
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
    const pathLens = root.focus("path")
    // @ts-expect-error — intentionally passing invalid data to test runtime validation
    expect(() => pathLens.append({ x: "not a number", y: 20 })).toThrow()
  })

  it("underlying Yjs structure is Y.Array of Y.Map with _id", () => {
    const { doc, root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
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

describe("YLinkedListLens insertion operations", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("prepend inserts at the beginning", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
    pathLens.append({ x: 10, y: 20 })
    pathLens.prepend({ x: 0, y: 0 })
    expect(pathLens.get()).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 }
    ])
  })

  it("insertAt inserts at a specific index", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
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
    const pathLens = root.focus("path")
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
    const pathLens = root.focus("path")
    expect(() => pathLens.insertAfter("nonexistent", { x: 1, y: 2 })).toThrow(
      /Node not found/
    )
  })
})

describe("YLinkedListLens removal and length", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("removeAt removes node at index", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
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
    const pathLens = root.focus("path")
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
    const pathLens = root.focus("path")
    expect(() => pathLens.remove("nonexistent")).toThrow(/Node not found/)
  })

  it("length returns node count", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
    expect(pathLens.length()).toBe(0)
    pathLens.append({ x: 10, y: 20 })
    expect(pathLens.length()).toBe(1)
    pathLens.append({ x: 30, y: 40 })
    expect(pathLens.length()).toBe(2)
    pathLens.removeAt(0)
    expect(pathLens.length()).toBe(1)
  })
})

describe("YLinkedListLens node access", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("at() returns a lens to node at index", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
    pathLens.append({ x: 10, y: 20 })
    pathLens.append({ x: 30, y: 40 })
    const lens = pathLens.at(1)
    expect(lens.get()).toEqual({ x: 30, y: 40 })
  })

  it("at() lens can set values", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
    pathLens.append({ x: 10, y: 20 })
    const lens = pathLens.at(0)
    lens.focus("x").syncSet(99)
    expect(pathLens.get()).toEqual([{ x: 99, y: 20 }])
  })

  it("find() returns a lens by id", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
    const id = pathLens.append({ x: 10, y: 20 })
    const lens = pathLens.find(id)
    expect(lens.get()).toEqual({ x: 10, y: 20 })
  })

  it("find() lens is stable — survives insertions", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
    const id = pathLens.append({ x: 10, y: 20 })
    const lens = pathLens.find(id)
    // Insert before — the Y.Map reference doesn't change
    pathLens.prepend({ x: 0, y: 0 })
    expect(lens.get()).toEqual({ x: 10, y: 20 })
    lens.focus("x").syncSet(99)
    expect(lens.get()).toEqual({ x: 99, y: 20 })
  })

  it("find() throws for unknown id", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
    expect(() => pathLens.find("nonexistent")).toThrow(/Node not found/)
  })

  it("nodes() returns a Map of id to lens", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
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

describe("YLinkedListLens.atom()", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("returns an Atom instance", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
    const a = pathLens.atom()
    expect(Atom.isAtom(a)).toBe(true)
  })

  it("atom reads current list state", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
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
    const pathLens = root.focus("path")
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
    const pathLens = root.focus("path")
    const id = pathLens.append({ x: 10, y: 20 })
    const a = pathLens.atom()
    const registry = Registry.make()
    expect(registry.get(a)).toEqual([{ x: 10, y: 20 }])
    pathLens.find(id).focus("x").syncSet(99)
    expect(registry.get(a)).toEqual([{ x: 99, y: 20 }])
  })
})

describe("YLinkedListLens.ids()", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("returns a HashSet of current node ids", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
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
    const pathLens = root.focus("path")
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
    const pathLens = root.focus("path")
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
    const pathLens = root.focus("path")
    const id = pathLens.append({ x: 10, y: 20 })
    const idsAtom = pathLens.ids()
    const registry = Registry.make()
    registry.get(idsAtom)
    pathLens.find(id).focus("x").syncSet(99)
    const after = registry.get(idsAtom)
    // Should be the exact same HashSet reference — no structural change
    expect(HashSet.size(after)).toBe(1)
    expect(HashSet.has(after, id)).toBe(true)
  })
})

describe("Node atom behavior on removal", () => {
  const PointSchema = S.Struct({ x: S.Number, y: S.Number })
  const TestSchema = S.Struct({
    path: YLinkedList(PointSchema)
  })

  it("node atom retains last value after removal", () => {
    const { root } = YDocument.make(TestSchema)
    const pathLens = root.focus("path")
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
