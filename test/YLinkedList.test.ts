import { describe, expect, it } from "@effect/vitest"
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
