import { describe, expect, it } from "@effect/vitest"
import * as S from "effect/Schema"
import { YDocument, YLinkedList } from "../src/index.js"

const Schema = S.Struct({
  name: S.String,
  count: S.Number,
  nested: S.Struct({ x: S.Number })
})

const LinkedListSchema = S.Struct({
  name: S.String,
  path: YLinkedList(S.Struct({ x: S.Number, y: S.Number }))
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

  it("syncSet accepts only the correct type", () => {
    const { root } = YDocument.make(Schema)
    root.focus("name").syncSet("hello")
    // @ts-expect-error — number is not assignable to string
    expect(() => root.focus("name").syncSet(123)).toThrow()
  })

  it("nested focus is type-safe", () => {
    const { root } = YDocument.make(Schema)
    root.focus("nested").focus("x").syncSet(1)
    // @ts-expect-error — "y" is not a field of nested
    expect(() => root.focus("nested").focus("y")).toThrow()
  })
})

describe("YLinkedList type safety", () => {
  it("focus on linked list field returns YLinkedListLens with append", () => {
    const { root } = YDocument.make(LinkedListSchema)
    const pathLens = root.focus("path")
    // Should have append — this is a YLinkedListLens, not a YLens
    pathLens.append({ x: 1, y: 2 })
    expect(pathLens.length()).toBe(1)
  })

  it("focus on linked list field does not have YLens.syncSet", () => {
    const { root } = YDocument.make(LinkedListSchema)
    const pathLens = root.focus("path")
    // @ts-expect-error — YLinkedListLens does not have syncSet()
    expect(pathLens.syncSet).toBeUndefined()
  })

  it("focus on linked list field does not have YLens.focus", () => {
    const { root } = YDocument.make(LinkedListSchema)
    const pathLens = root.focus("path")
    // @ts-expect-error — YLinkedListLens does not have focus()
    expect(pathLens.focus).toBeUndefined()
  })

  it("append rejects wrong item type", () => {
    const { root } = YDocument.make(LinkedListSchema)
    const pathLens = root.focus("path")
    // @ts-expect-error — string is not assignable to number
    expect(() => pathLens.append({ x: "wrong", y: 2 })).toThrow()
  })

  it("regular field still returns YLens", () => {
    const { root } = YDocument.make(LinkedListSchema)
    const nameLens = root.focus("name")
    nameLens.syncSet("hello")
    expect(nameLens.syncGet()).toBe("hello")
  })
})
