import { Registry } from "@effect-atom/atom"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as S from "effect/Schema"
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness"
import * as Y from "yjs"
import { TypedYValidationError } from "../src/errors.js"
import { type AwarenessLike, YAwareness } from "../src/YAwareness.js"

const PresenceSchema = S.Struct({
  user: S.Struct({ name: S.String, color: S.String }),
  cursor: S.Struct({ x: S.Number, y: S.Number })
})

type PresenceState = S.Schema.Type<typeof PresenceSchema>

const alice: PresenceState = {
  user: { name: "Alice", color: "#ff0000" },
  cursor: { x: 10, y: 20 }
}

const bob: PresenceState = {
  user: { name: "Bob", color: "#00ff00" },
  cursor: { x: 30, y: 40 }
}

const syncAwareness = (from: Awareness, to: Awareness) => {
  const update = encodeAwarenessUpdate(from, [from.clientID])
  applyAwarenessUpdate(to, update, "test")
}

describe("YAwareness", () => {
  describe("make", () => {
    it("creates an awareness handle with correct clientID", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      expect(handle.clientID).toBe(handle.awareness.clientID)
      handle.awareness.destroy()
    })
  })

  describe("bind", () => {
    it("binds to an existing awareness instance", () => {
      const doc = new Y.Doc()
      const awareness = new Awareness(doc)
      const handle = YAwareness.bind(PresenceSchema, awareness as unknown as AwarenessLike)
      expect(handle.clientID).toBe(awareness.clientID)
      awareness.destroy()
    })
  })

  describe("local lens", () => {
    it("setLocal and getLocal round-trip", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      handle.local.unsafeSet(alice)
      expect(handle.local.unsafeGet()).toEqual(alice)
      handle.awareness.destroy()
    })

    it("focus into nested fields and read", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      handle.local.unsafeSet(alice)
      expect(handle.local.focus("cursor").unsafeGet()).toEqual({ x: 10, y: 20 })
      expect(handle.local.focus("cursor").focus("x").unsafeGet()).toBe(10)
      expect(handle.local.focus("user").focus("name").unsafeGet()).toBe("Alice")
      handle.awareness.destroy()
    })

    it("focus into nested field and set", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      handle.local.unsafeSet(alice)
      handle.local.focus("cursor").focus("x").unsafeSet(100)
      expect(handle.local.focus("cursor").focus("x").unsafeGet()).toBe(100)
      // Other fields preserved
      expect(handle.local.focus("cursor").focus("y").unsafeGet()).toBe(20)
      expect(handle.local.focus("user").focus("name").unsafeGet()).toBe("Alice")
      handle.awareness.destroy()
    })

    it("focus set on struct replaces the substruct", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      handle.local.unsafeSet(alice)
      handle.local.focus("cursor").unsafeSet({ x: 99, y: 88 })
      expect(handle.local.focus("cursor").unsafeGet()).toEqual({ x: 99, y: 88 })
      handle.awareness.destroy()
    })

    it("throws TypedYValidationError on invalid set", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      expect(() => handle.local.unsafeSet({ user: 123 } as any)).toThrow(TypedYValidationError)
      handle.awareness.destroy()
    })

    it("throws TypedYValidationError on invalid focused set", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      handle.local.unsafeSet(alice)
      expect(() => handle.local.focus("cursor").focus("x").unsafeSet("not a number" as any)).toThrow(
        TypedYValidationError
      )
      handle.awareness.destroy()
    })

    it("setEffect returns failure on invalid data", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      const result = Effect.runSyncExit(handle.local.set({ user: 123 } as any))
      expect(result._tag).toBe("Failure")
      handle.awareness.destroy()
    })

    it("setEffect succeeds with valid data", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      const result = Effect.runSyncExit(handle.local.set(alice))
      expect(result._tag).toBe("Success")
      expect(handle.local.unsafeGet()).toEqual(alice)
      handle.awareness.destroy()
    })

    it("getSafe validates and returns", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      handle.local.unsafeSet(alice)
      const result = Effect.runSync(handle.local.focus("cursor").get())
      expect(result).toEqual({ x: 10, y: 20 })
      handle.awareness.destroy()
    })

    it("get returns initial empty state before set", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      // Awareness initializes with {} by default
      expect(handle.local.unsafeGet()).toEqual({})
      handle.awareness.destroy()
    })

    it("focus throws on unknown field", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      expect(() => (handle.local as any).focus("nonexistent")).toThrow("Unknown field")
      handle.awareness.destroy()
    })
  })

  describe("clearLocal", () => {
    it("sets state to null", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      handle.local.unsafeSet(alice)
      expect(handle.local.unsafeGet()).toEqual(alice)
      handle.clearLocal()
      expect(handle.local.unsafeGet()).toBeNull()
      handle.awareness.destroy()
    })
  })

  describe("remote lens", () => {
    it("reads remote client state", () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()
      const a1 = new Awareness(doc1)
      const a2 = new Awareness(doc2)
      const h2 = YAwareness.bind(PresenceSchema, a2 as unknown as AwarenessLike)

      a1.setLocalState(alice as any)
      syncAwareness(a1, a2)

      const remote = h2.remote(a1.clientID)
      expect(remote.unsafeGet()).toEqual(alice)
      a1.destroy()
      a2.destroy()
    })

    it("focus into remote state fields", () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()
      const a1 = new Awareness(doc1)
      const a2 = new Awareness(doc2)
      const h2 = YAwareness.bind(PresenceSchema, a2 as unknown as AwarenessLike)

      a1.setLocalState(alice as any)
      syncAwareness(a1, a2)

      expect(h2.remote(a1.clientID).focus("cursor").unsafeGet()).toEqual({ x: 10, y: 20 })
      expect(h2.remote(a1.clientID).focus("cursor").focus("x").unsafeGet()).toBe(10)
      expect(h2.remote(a1.clientID).focus("user").focus("name").unsafeGet()).toBe("Alice")
      a1.destroy()
      a2.destroy()
    })

    it("getSafe validates remote state", () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()
      const a1 = new Awareness(doc1)
      const a2 = new Awareness(doc2)
      const h2 = YAwareness.bind(PresenceSchema, a2 as unknown as AwarenessLike)

      a1.setLocalState(alice as any)
      syncAwareness(a1, a2)

      const result = Effect.runSync(h2.remote(a1.clientID).focus("cursor").get())
      expect(result).toEqual({ x: 10, y: 20 })
      a1.destroy()
      a2.destroy()
    })

    it("returns undefined for unknown client", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      expect(handle.remote(999999).unsafeGet()).toBeUndefined()
      handle.awareness.destroy()
    })
  })

  describe("multi-client states", () => {
    it("getStates returns all clients", () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()
      const a1 = new Awareness(doc1)
      const a2 = new Awareness(doc2)
      const h2 = YAwareness.bind(PresenceSchema, a2 as unknown as AwarenessLike)

      a1.setLocalState(alice as any)
      a2.setLocalState(bob as any)
      syncAwareness(a1, a2)

      const states = h2.unsafeGetStates()
      expect(states.size).toBe(2)
      expect(states.get(a1.clientID)).toEqual(alice)
      expect(states.get(a2.clientID)).toEqual(bob)
      a1.destroy()
      a2.destroy()
    })

    it("getStatesSafe validates all states", () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()
      const a1 = new Awareness(doc1)
      const a2 = new Awareness(doc2)
      const h2 = YAwareness.bind(PresenceSchema, a2 as unknown as AwarenessLike)

      a1.setLocalState(alice as any)
      a2.setLocalState(bob as any)
      syncAwareness(a1, a2)

      const result = Effect.runSync(h2.getStates())
      expect(result.size).toBe(2)
      a1.destroy()
      a2.destroy()
    })

    it("getStatesSafe fails on invalid remote state", () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()
      const a1 = new Awareness(doc1)
      const a2 = new Awareness(doc2)
      const h2 = YAwareness.bind(PresenceSchema, a2 as unknown as AwarenessLike)

      a1.setLocalState({ invalid: true } as any)
      a2.setLocalState(bob as any)
      syncAwareness(a1, a2)

      const result = Effect.runSyncExit(h2.getStates())
      expect(result._tag).toBe("Failure")
      a1.destroy()
      a2.destroy()
    })
  })

  describe("atoms", () => {
    it("local atom reflects state changes", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      const atom = handle.local.atom()
      const registry = Registry.make()

      // Awareness initializes with {} by default
      expect(registry.get(atom)).toEqual({})

      handle.local.unsafeSet(alice)
      expect(registry.get(atom)).toEqual(alice)
      handle.awareness.destroy()
    })

    it("focused local atom reflects field changes", () => {
      const doc = new Y.Doc()
      const handle = YAwareness.make(PresenceSchema, doc)
      handle.local.unsafeSet(alice)

      const cursorAtom = handle.local.focus("cursor").atom()
      const registry = Registry.make()

      expect(registry.get(cursorAtom)).toEqual({ x: 10, y: 20 })

      handle.local.focus("cursor").unsafeSet({ x: 99, y: 88 })
      expect(registry.get(cursorAtom)).toEqual({ x: 99, y: 88 })
      handle.awareness.destroy()
    })

    it("remote atom reflects remote state changes", () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()
      const a1 = new Awareness(doc1)
      const a2 = new Awareness(doc2)
      const h2 = YAwareness.bind(PresenceSchema, a2 as unknown as AwarenessLike)

      a1.setLocalState(alice as any)
      syncAwareness(a1, a2)

      const remoteCursorAtom = h2.remote(a1.clientID).focus("cursor").atom()
      const registry = Registry.make()

      expect(registry.get(remoteCursorAtom)).toEqual({ x: 10, y: 20 })

      // Update remote state
      a1.setLocalState({ ...alice, cursor: { x: 50, y: 60 } } as any)
      syncAwareness(a1, a2)

      expect(registry.get(remoteCursorAtom)).toEqual({ x: 50, y: 60 })
      a1.destroy()
      a2.destroy()
    })

    it("statesAtom updates when states change", () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()
      const a1 = new Awareness(doc1)
      const a2 = new Awareness(doc2)
      const h2 = YAwareness.bind(PresenceSchema, a2 as unknown as AwarenessLike)

      a2.setLocalState(bob as any)
      const stAtom = h2.statesAtom()
      const registry = Registry.make()

      const initial = registry.get(stAtom)
      expect(initial.size).toBe(1)

      a1.setLocalState(alice as any)
      syncAwareness(a1, a2)

      const updated = registry.get(stAtom)
      expect(updated.size).toBe(2)
      a1.destroy()
      a2.destroy()
    })

    it("clientIdsAtom tracks presence", () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()
      const a1 = new Awareness(doc1)
      const a2 = new Awareness(doc2)
      const h2 = YAwareness.bind(PresenceSchema, a2 as unknown as AwarenessLike)

      a2.setLocalState(bob as any)
      const idsAtom = h2.clientIdsAtom()
      const registry = Registry.make()

      const initial = registry.get(idsAtom)
      expect(initial).toContain(a2.clientID)

      a1.setLocalState(alice as any)
      syncAwareness(a1, a2)

      const updated = registry.get(idsAtom)
      expect(updated).toContain(a1.clientID)
      expect(updated).toContain(a2.clientID)
      a1.destroy()
      a2.destroy()
    })

    it("remoteStateFamily returns stable atom references", () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()
      const a1 = new Awareness(doc1)
      const a2 = new Awareness(doc2)
      const h2 = YAwareness.bind(PresenceSchema, a2 as unknown as AwarenessLike)

      // Same clientId returns same atom reference
      const atom1 = h2.remoteStateFamily(a1.clientID)
      const atom2 = h2.remoteStateFamily(a1.clientID)
      expect(atom1).toBe(atom2)

      // Different clientId returns different atom
      const atom3 = h2.remoteStateFamily(999999)
      expect(atom1).not.toBe(atom3)
      a1.destroy()
      a2.destroy()
    })

    it("remoteStateFamily atom tracks remote state", () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()
      const a1 = new Awareness(doc1)
      const a2 = new Awareness(doc2)
      const h2 = YAwareness.bind(PresenceSchema, a2 as unknown as AwarenessLike)
      const registry = Registry.make()

      const remoteAtom = h2.remoteStateFamily(a1.clientID)

      // Initially undefined (remote client hasn't set state yet)
      expect(registry.get(remoteAtom)).toBeUndefined()

      // Remote client sets state
      a1.setLocalState(alice as any)
      syncAwareness(a1, a2)

      expect(registry.get(remoteAtom)).toEqual(alice)
      a1.destroy()
      a2.destroy()
    })
  })
})
