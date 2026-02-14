import { describe, expect, it } from "@effect/vitest"
import * as AST from "effect/SchemaAST"
import { YText, YTextTypeId } from "../src/markers.js"

describe("YText marker", () => {
  it("is detectable via annotation on the AST", () => {
    const annotation = AST.getAnnotation<symbol>(YTextTypeId)(YText.ast)
    expect(annotation._tag).toBe("Some")
  })

  it("has Declaration AST type", () => {
    expect(YText.ast._tag).toBe("Declaration")
  })
})
