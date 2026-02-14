import { describe, expect, it } from "@effect/vitest"
import * as S from "effect/Schema"
import * as Y from "yjs"
import { YText } from "../src/markers.js"
import { YDocument } from "../src/YDocument.js"

const TestSchema = S.Struct({
  name: S.String,
  count: S.Number,
  position: S.Struct({ x: S.Number, y: S.Number }),
  tags: S.Array(S.String),
  metadata: S.Record({ key: S.String, value: S.String }),
  title: YText
})

describe("YDocument", () => {
  describe("make", () => {
    it("creates a Y.Doc and typed root", () => {
      const { doc, root } = YDocument.make(TestSchema)
      expect(doc).toBeInstanceOf(Y.Doc)
      expect(root).toBeDefined()
      expect(root._tag).toBe("YDocumentRoot")
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
      const root = YDocument.bind(TestSchema, doc)
      expect(root).toBeDefined()
      expect(root._tag).toBe("YDocumentRoot")
    })
  })

  describe("transact", () => {
    it("wraps operations in a Y.Doc transaction", () => {
      const { root } = YDocument.make(TestSchema)
      let updateCount = 0
      root.doc.on("update", () => {
        updateCount++
      })

      YDocument.transact(root, () => {
        root.rootMap.set("name", "test")
        root.rootMap.set("count", 42)
      })
      expect(updateCount).toBe(1)
    })
  })
})
