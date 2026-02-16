import { Atom, Registry } from "@effect-atom/atom"
import { describe, expect, it } from "@effect/vitest"
import * as S from "effect/Schema"
import { YDocument } from "../src/YDocument.js"

const TestSchema = S.Struct({
  name: S.String,
  count: S.Number,
  position: S.Struct({ x: S.Number, y: S.Number })
})

describe("YLens.atom()", () => {
  it("returns an Atom instance", () => {
    const { root } = YDocument.make(TestSchema)
    root.focus("count").unsafeSet(42)
    const atom = root.focus("count").atom()
    expect(Atom.isAtom(atom)).toBe(true)
  })

  it("atom reads initial value via registry", () => {
    const { root } = YDocument.make(TestSchema)
    root.focus("count").unsafeSet(42)
    const atom = root.focus("count").atom()
    const registry = Registry.make()
    const value = registry.get(atom)
    expect(value).toBe(42)
  })

  it("atom updates when Yjs value changes", () => {
    const { root } = YDocument.make(TestSchema)
    root.focus("count").unsafeSet(1)
    const atom = root.focus("count").atom()
    const registry = Registry.make()

    // Initial read
    expect(registry.get(atom)).toBe(1)

    // Mutate via YLens
    root.focus("count").unsafeSet(2)

    // Atom should reflect the update
    expect(registry.get(atom)).toBe(2)
  })

  it("struct atom reads nested values", () => {
    const { root } = YDocument.make(TestSchema)
    root.focus("position").focus("x").unsafeSet(10)
    root.focus("position").focus("y").unsafeSet(20)
    const atom = root.focus("position").atom()
    const registry = Registry.make()
    const value = registry.get(atom)
    expect(value).toEqual({ x: 10, y: 20 })
  })
})
