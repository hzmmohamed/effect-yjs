import { describe, expect, it } from "@effect/vitest"
import * as S from "effect/Schema"
import * as Y from "yjs"
import { YDocument, YText } from "../src/index.js"

const Position = { x: S.Number, y: S.Number }

const Shape = S.Struct({
  id: S.String,
  ...Position,
  label: YText
})

const AppSchema = S.Struct({
  shapes: S.Record({ key: S.String, value: Shape }),
  metadata: S.Struct({
    title: YText,
    version: S.Number
  }),
  tags: S.Array(S.String)
})

describe("Full document lifecycle", () => {
  it("create, populate, and read", () => {
    const { root } = YDocument.make(AppSchema)

    // Set primitive fields
    root.focus("metadata").focus("version").syncSet(1)

    // Use Y.Text directly
    const title = root.focus("metadata").focus("title").get() as unknown as Y.Text
    title.insert(0, "My Drawing")

    // Add shapes via record — focus into struct fields
    root.focus("shapes").focus("shape-1").focus("id").syncSet("shape-1")
    root.focus("shapes").focus("shape-1").focus("x").syncSet(100)
    root.focus("shapes").focus("shape-1").focus("y").syncSet(200)

    // Focus deep into a shape and update
    root.focus("shapes").focus("shape-1").focus("x").syncSet(150)

    // Set array
    root.focus("tags").syncSet(["drawing", "v1"])

    // Read back
    expect(root.focus("metadata").focus("version").get()).toBe(1)
    expect(title.toString()).toBe("My Drawing")
    expect(root.focus("shapes").focus("shape-1").focus("x").get()).toBe(150)
    expect(root.focus("shapes").focus("shape-1").focus("y").get()).toBe(200)
    expect(root.focus("tags").get()).toEqual(["drawing", "v1"])
  })

  it("two docs sync via Yjs", () => {
    const SimpleSchema = S.Struct({ count: S.Number })
    const { doc: doc1, root: root1 } = YDocument.make(SimpleSchema)
    const doc2 = new Y.Doc()
    const root2 = YDocument.bind(SimpleSchema, doc2)

    // Set on doc1
    root1.focus("count").syncSet(42)

    // Sync doc1 → doc2
    const state1 = Y.encodeStateAsUpdate(doc1)
    Y.applyUpdate(doc2, state1)

    // Read on doc2
    expect(root2.focus("count").get()).toBe(42)
  })

  it("lens passed to child component pattern", () => {
    const { root } = YDocument.make(AppSchema)
    root.focus("shapes").focus("s1").focus("id").syncSet("s1")
    root.focus("shapes").focus("s1").focus("x").syncSet(10)
    root.focus("shapes").focus("s1").focus("y").syncSet(20)

    // Simulate passing a lens to a child — child doesn't know about root
    const shapeLens = root.focus("shapes").focus("s1")
    const xLens = shapeLens.focus("x")

    xLens.syncSet(99)
    expect(xLens.get()).toBe(99)
  })

  it("transactions batch multiple writes", () => {
    const { root } = YDocument.make(AppSchema)
    let updateCount = 0
    root.doc.on("update", () => updateCount++)

    YDocument.transact(root, () => {
      root.focus("metadata").focus("version").syncSet(1)
      root.focus("tags").syncSet(["a", "b"])
    })

    expect(updateCount).toBe(1)
  })

  it("schema composability — field-level", () => {
    const Dimensions = { width: S.Number, height: S.Number }
    const Rectangle = S.Struct({
      id: S.String,
      ...Position,
      ...Dimensions
    })
    const { root } = YDocument.make(S.Struct({ rect: Rectangle }))
    root.focus("rect").syncSet({ id: "r1", x: 0, y: 0, width: 100, height: 50 })
    expect(root.focus("rect").focus("width").get()).toBe(100)
  })

  it("schema composability — document-level", () => {
    const ShapesFragment = S.Record({
      key: S.String,
      value: S.Struct({ x: S.Number, y: S.Number })
    })
    const MetaFragment = S.Struct({ version: S.Number })

    const ComposedDoc = S.Struct({
      shapes: ShapesFragment,
      meta: MetaFragment
    })

    const { root } = YDocument.make(ComposedDoc)
    root.focus("meta").focus("version").syncSet(1)
    root.focus("shapes").focus("p1").syncSet({ x: 5, y: 10 })
    expect(root.focus("shapes").focus("p1").get()).toEqual({ x: 5, y: 10 })
  })
})
