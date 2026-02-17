import { describe, expect, it } from "@effect/vitest"
import * as S from "effect/Schema"
import * as AST from "effect/SchemaAST"
import { YLinkedList, YLinkedListItemAST, YLinkedListTypeId } from "../src/markers.js"

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
