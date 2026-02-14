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
      expect(root).toBeInstanceOf(Y.Map)
    })
  })

  describe("Struct with nested Struct", () => {
    it("creates nested Y.Maps for nested structs", () => {
      const schema = S.Struct({
        name: S.String,
        position: S.Struct({ x: S.Number, y: S.Number })
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
        items: S.Array(S.Number)
      })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      buildYjsTree(schema.ast, root, [])
      expect(root.get("items")).toBeInstanceOf(Y.Array)
    })
  })

  describe("Struct with Record field", () => {
    it("creates Y.Map for record fields", () => {
      const schema = S.Struct({
        shapes: S.Record({ key: S.String, value: S.Number })
      })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      buildYjsTree(schema.ast, root, [])
      expect(root.get("shapes")).toBeInstanceOf(Y.Map)
    })
  })

  describe("Struct with YText field", () => {
    it("creates Y.Text for YText-marked fields", () => {
      const schema = S.Struct({ title: YText })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      buildYjsTree(schema.ast, root, [])
      expect(root.get("title")).toBeInstanceOf(Y.Text)
    })
  })

  describe("Deeply nested structs", () => {
    it("recursively creates nested Y.Maps", () => {
      const schema = S.Struct({
        a: S.Struct({
          b: S.Struct({ c: S.Number })
        })
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
        age: S.Number
      })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      buildYjsTree(schema.ast, root, [])
      expect(root).toBeInstanceOf(Y.Map)
    })
  })

  describe("Discriminated union rejection", () => {
    it("throws UnsupportedSchemaError for discriminated unions", () => {
      const schema = S.Struct({
        shape: S.Union(
          S.Struct({ _tag: S.Literal("circle"), radius: S.Number }),
          S.Struct({ _tag: S.Literal("square"), side: S.Number })
        )
      })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      expect(() => buildYjsTree(schema.ast, root, [])).toThrow(
        /Discriminated union/
      )
    })

    it("allows simple unions of literals", () => {
      const schema = S.Struct({
        color: S.Union(S.Literal("red"), S.Literal("blue"), S.Literal("green"))
      })
      const doc = new Y.Doc()
      const root = doc.getMap("root")
      expect(() => buildYjsTree(schema.ast, root, [])).not.toThrow()
    })
  })
})
