import { describe, expect, it } from "@effect/vitest"
import * as S from "effect/Schema"
import { YDocument } from "../src/index.js"

const Schema = S.Struct({
  name: S.String,
  count: S.Number,
  nested: S.Struct({ x: S.Number })
})

describe("Type safety", () => {
  it("focus accepts only valid field names", () => {
    const { root } = YDocument.make(Schema)
    root.focus("name")
    root.focus("count")
    root.focus("nested")
    // @ts-expect-error — "invalid" is not a field
    expect(() => root.focus("invalid")).toThrow()
  })

  it("set accepts only the correct type", () => {
    const { root } = YDocument.make(Schema)
    root.focus("name").unsafeSet("hello")
    // @ts-expect-error — number is not assignable to string
    expect(() => root.focus("name").unsafeSet(123)).toThrow()
  })

  it("nested focus is type-safe", () => {
    const { root } = YDocument.make(Schema)
    root.focus("nested").focus("x").unsafeSet(1)
    // @ts-expect-error — "y" is not a field of nested
    expect(() => root.focus("nested").focus("y")).toThrow()
  })
})
