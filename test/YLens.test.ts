import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as S from "effect/Schema"
import * as Y from "yjs"
import { TypedYValidationError } from "../src/errors.js"
import { YText } from "../src/markers.js"
import { YDocument } from "../src/YDocument.js"

const PositionSchema = S.Struct({ x: S.Number, y: S.Number })

const TestSchema = S.Struct({
  name: S.String,
  count: S.Number,
  position: PositionSchema
})

describe("YLens", () => {
  describe("Struct — primitive fields", () => {
    it("set and get a string field", () => {
      const { root } = YDocument.make(TestSchema)
      root.focus("name").unsafeSet("hello")
      expect(root.focus("name").unsafeGet()).toBe("hello")
    })

    it("set and get a number field", () => {
      const { root } = YDocument.make(TestSchema)
      root.focus("count").unsafeSet(42)
      expect(root.focus("count").unsafeGet()).toBe(42)
    })

    it("get returns undefined for unset fields", () => {
      const { root } = YDocument.make(TestSchema)
      expect(root.focus("name").unsafeGet()).toBeUndefined()
    })

    it("throws TypedYValidationError on invalid set", () => {
      const { root } = YDocument.make(TestSchema)
      expect(() => root.focus("count").unsafeSet("not a number" as any)).toThrow(
        TypedYValidationError
      )
    })
  })

  describe("Struct — nested struct focus", () => {
    it("focus into nested struct and set/get", () => {
      const { root } = YDocument.make(TestSchema)
      root.focus("position").focus("x").unsafeSet(10)
      root.focus("position").focus("y").unsafeSet(20)
      expect(root.focus("position").focus("x").unsafeGet()).toBe(10)
      expect(root.focus("position").focus("y").unsafeGet()).toBe(20)
    })

    it("set entire nested struct", () => {
      const { root } = YDocument.make(TestSchema)
      root.focus("position").unsafeSet({ x: 5, y: 15 })
      expect(root.focus("position").focus("x").unsafeGet()).toBe(5)
      expect(root.focus("position").focus("y").unsafeGet()).toBe(15)
    })

    it("get entire nested struct as object", () => {
      const { root } = YDocument.make(TestSchema)
      root.focus("position").focus("x").unsafeSet(3)
      root.focus("position").focus("y").unsafeSet(7)
      expect(root.focus("position").unsafeGet()).toEqual({ x: 3, y: 7 })
    })
  })

  describe("focus composition", () => {
    it("lens can be passed around and still works", () => {
      const { root } = YDocument.make(TestSchema)
      const posLens = root.focus("position")
      const xLens = posLens.focus("x")
      xLens.unsafeSet(99)
      expect(xLens.unsafeGet()).toBe(99)
    })
  })
})

// --- Record tests ---

const RecordSchema = S.Struct({
  scores: S.Record({ key: S.String, value: S.Number }),
  shapes: S.Record({
    key: S.String,
    value: S.Struct({ x: S.Number, y: S.Number })
  })
})

describe("YLens — Records", () => {
  it("set and get primitive record entries", () => {
    const { root } = YDocument.make(RecordSchema)
    root.focus("scores").focus("alice").unsafeSet(100)
    root.focus("scores").focus("bob").unsafeSet(85)
    expect(root.focus("scores").focus("alice").unsafeGet()).toBe(100)
    expect(root.focus("scores").focus("bob").unsafeGet()).toBe(85)
  })

  it("get entire record as object", () => {
    const { root } = YDocument.make(RecordSchema)
    root.focus("scores").focus("alice").unsafeSet(100)
    expect(root.focus("scores").unsafeGet()).toEqual({ alice: 100 })
  })

  it("focus into record with struct values", () => {
    const { root } = YDocument.make(RecordSchema)
    root.focus("shapes").focus("s1").focus("x").unsafeSet(10)
    root.focus("shapes").focus("s1").focus("y").unsafeSet(20)
    expect(root.focus("shapes").focus("s1").unsafeGet()).toEqual({ x: 10, y: 20 })
  })

  it("set entire struct within a record", () => {
    const { root } = YDocument.make(RecordSchema)
    root.focus("shapes").focus("s1").unsafeSet({ x: 5, y: 15 })
    expect(root.focus("shapes").focus("s1").focus("x").unsafeGet()).toBe(5)
  })
})

// --- Array tests ---

const ArraySchema = S.Struct({
  numbers: S.Array(S.Number),
  points: S.Array(S.Struct({ x: S.Number, y: S.Number }))
})

describe("YLens — Arrays", () => {
  it("set and get a primitive array", () => {
    const { root } = YDocument.make(ArraySchema)
    root.focus("numbers").unsafeSet([1, 2, 3])
    expect(root.focus("numbers").unsafeGet()).toEqual([1, 2, 3])
  })

  it("set and get an array of structs", () => {
    const { root } = YDocument.make(ArraySchema)
    root.focus("points").unsafeSet([
      { x: 1, y: 2 },
      { x: 3, y: 4 }
    ])
    expect(root.focus("points").unsafeGet()).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 }
    ])
  })

  it("overwrite replaces the entire array", () => {
    const { root } = YDocument.make(ArraySchema)
    root.focus("numbers").unsafeSet([1, 2, 3])
    root.focus("numbers").unsafeSet([4, 5])
    expect(root.focus("numbers").unsafeGet()).toEqual([4, 5])
  })
})

// --- YText tests ---

const TextSchema = S.Struct({
  title: YText,
  content: YText
})

describe("YLens — YText", () => {
  it("focus on YText field returns the Y.Text instance", () => {
    const { root } = YDocument.make(TextSchema)
    const titleText = root.focus("title").unsafeGet()
    expect(titleText).toBeInstanceOf(Y.Text)
  })

  it("Y.Text can be manipulated directly", () => {
    const { root } = YDocument.make(TextSchema)
    const titleText = root.focus("title").unsafeGet() as unknown as Y.Text
    titleText.insert(0, "Hello, world!")
    expect(titleText.toString()).toBe("Hello, world!")
  })
})

// --- Effect integration tests ---

describe("YLens — Effect integration", () => {
  it("setEffect returns Effect<void, ParseError> on success", () => {
    const { root } = YDocument.make(TestSchema)
    const result = Effect.runSync(root.focus("count").set(42))
    expect(result).toBeUndefined()
    expect(root.focus("count").unsafeGet()).toBe(42)
  })

  it("setEffect returns failure Effect on validation error", () => {
    const { root } = YDocument.make(TestSchema)
    const result = Effect.runSyncExit(
      root.focus("count").set("not a number" as any)
    )
    expect(result._tag).toBe("Failure")
  })

  it("getSafe returns Effect<T, ParseError> validating the data", () => {
    const { root } = YDocument.make(TestSchema)
    root.focus("count").unsafeSet(42)
    const result = Effect.runSync(root.focus("count").get())
    expect(result).toBe(42)
  })
})
