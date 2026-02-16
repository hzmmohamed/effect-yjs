import { Atom } from "@effect-atom/atom"
import * as Effect from "effect/Effect"
import { ParseError } from "effect/ParseResult"
import * as S from "effect/Schema"
import type * as AST from "effect/SchemaAST"
import { Awareness } from "y-protocols/awareness"
import type * as Y from "yjs"
import {
  atomFromAwarenessAllChanges,
  atomFromAwarenessChange,
  atomFromAwarenessPresence,
  atomFromAwarenessUpdate
} from "./awarenessAtoms.js"
import { TypedYValidationError } from "./errors.js"
import { unwrap } from "./traversal.js"
import { getFieldAST, type ReadonlyYLens, type YLens } from "./YLens.js"

// ── AwarenessLike interface ──────────────────────────────────

/**
 * Minimal structural interface for Awareness-compatible objects.
 * Structurally matches `y-protocols/awareness.Awareness`.
 */
export interface AwarenessLike {
  readonly clientID: number
  getLocalState(): Record<string, any> | null
  setLocalState(state: Record<string, any> | null): void
  setLocalStateField(field: string, value: any): void
  getStates(): Map<number, Record<string, any>>
  on(
    event: "change" | "update",
    handler: (
      changes: { added: Array<number>; updated: Array<number>; removed: Array<number> },
      origin: any
    ) => void
  ): void
  off(
    event: "change" | "update",
    handler: (...args: Array<any>) => void
  ): void
  destroy(): void
}

// ── YAwarenessHandle interface ───────────────────────────────

export interface YAwarenessHandle<A> {
  readonly awareness: AwarenessLike
  readonly clientID: number

  /** Local state — full read-write lens */
  readonly local: YLens<A>

  /** Remote state — read-only lens for a specific client */
  remote(clientId: number): ReadonlyYLens<A>

  /** Set local state to null (signals offline to peers) */
  clearLocal(): void

  /** Get all connected clients' awareness states (unvalidated) */
  unsafeGetStates(): ReadonlyMap<number, A>
  /** Get all clients' states with schema validation */
  getStates(): Effect.Effect<ReadonlyMap<number, A>, ParseError>
  /** Reactive atom tracking all clients' states */
  statesAtom(): Atom.Atom<ReadonlyMap<number, A>>

  /** Reactive atom tracking connected client IDs (uses 'update' event for presence) */
  clientIdsAtom(): Atom.Atom<ReadonlyArray<number>>

  /** Atom.family for stable per-client atom references (uses 'update' event) */
  remoteStateFamily: (clientId: number) => Atom.Atom<A | undefined>
}

// ── Path helpers ─────────────────────────────────────────────

const getAtPath = (obj: any, path: ReadonlyArray<string>): any => {
  let current = obj
  for (const key of path) {
    if (current == null) return undefined
    current = current[key]
  }
  return current
}

const setAtPath = (
  obj: Record<string, any>,
  path: ReadonlyArray<string>,
  value: any
): Record<string, any> => {
  if (path.length === 0) return value as Record<string, any>
  const [head, ...tail] = path
  return {
    ...obj,
    [head]: tail.length === 0 ? value : setAtPath((obj[head] as Record<string, any>) ?? {}, tail, value)
  }
}

// ── Awareness lens factories ─────────────────────────────────

const resolveFieldAST = (ast: AST.AST, key: string): AST.AST | undefined => {
  const fieldAST = getFieldAST(ast, key)
  if (fieldAST) return fieldAST
  const core = unwrap(ast)
  return getFieldAST(core, key)
}

const createAwarenessLocalLens = (
  rootAST: AST.AST,
  focusedAST: AST.AST,
  awareness: AwarenessLike,
  path: ReadonlyArray<string>
): YLens<any> => ({
  focus(key: string): any {
    const fieldAST = resolveFieldAST(focusedAST, key)
    if (!fieldAST) {
      throw new Error(`Unknown field: ${key}`)
    }
    return createAwarenessLocalLens(rootAST, fieldAST, awareness, [...path, key])
  },

  unsafeGet() {
    const state = awareness.getLocalState()
    return getAtPath(state, path)
  },

  unsafeSet(value: any) {
    const schema = S.make(focusedAST)
    try {
      S.decodeUnknownSync(schema)(value)
    } catch (error) {
      if (error instanceof ParseError) {
        const context = path.length > 0 ? `awareness.${path.join(".")}` : "awareness"
        throw new TypedYValidationError(context, error)
      }
      throw error
    }
    const current = awareness.getLocalState() ?? {}
    if (path.length === 0) {
      awareness.setLocalState(value as Record<string, any>)
    } else {
      const updated = setAtPath(current, path, value)
      awareness.setLocalState(updated)
    }
  },

  set(value: any) {
    return Effect.try({
      try: () => {
        const schema = S.make(focusedAST)
        S.decodeUnknownSync(schema)(value)
        const current = awareness.getLocalState() ?? {}
        if (path.length === 0) {
          awareness.setLocalState(value as Record<string, any>)
        } else {
          const updated = setAtPath(current, path, value)
          awareness.setLocalState(updated)
        }
      },
      catch: (error) => {
        if (error instanceof ParseError) return error
        throw error
      }
    })
  },

  get() {
    return Effect.try({
      try: () => {
        const raw = getAtPath(awareness.getLocalState(), path)
        const schema = S.make(focusedAST)
        return S.decodeUnknownSync(schema)(raw)
      },
      catch: (error) => {
        if (error instanceof ParseError) return error
        throw error
      }
    })
  },

  atom() {
    return atomFromAwarenessChange(
      awareness,
      awareness.clientID,
      () => getAtPath(awareness.getLocalState(), path)
    )
  }
})

const createAwarenessRemoteLens = (
  focusedAST: AST.AST,
  awareness: AwarenessLike,
  clientId: number,
  path: ReadonlyArray<string>
): ReadonlyYLens<any> => ({
  focus(key: string): any {
    const fieldAST = resolveFieldAST(focusedAST, key)
    if (!fieldAST) {
      throw new Error(`Unknown field: ${key}`)
    }
    return createAwarenessRemoteLens(fieldAST, awareness, clientId, [...path, key])
  },

  unsafeGet() {
    const state = awareness.getStates().get(clientId)
    return getAtPath(state, path)
  },

  get() {
    return Effect.try({
      try: () => {
        const state = awareness.getStates().get(clientId)
        const raw = getAtPath(state, path)
        const schema = S.make(focusedAST)
        return S.decodeUnknownSync(schema)(raw)
      },
      catch: (error) => {
        if (error instanceof ParseError) return error
        throw error
      }
    })
  },

  atom() {
    return atomFromAwarenessChange(
      awareness,
      clientId,
      () => getAtPath(awareness.getStates().get(clientId), path)
    )
  }
})

// ── Handle factory ───────────────────────────────────────────

const createAwarenessHandle = <A>(
  schema: S.Schema<A>,
  awareness: AwarenessLike
): YAwarenessHandle<A> => {
  const ast = schema.ast
  const decode = S.decodeUnknownSync(schema)

  const readStates = (): ReadonlyMap<number, A> => {
    const rawMap = awareness.getStates()
    const result = new Map<number, A>()
    for (const [clientId, state] of rawMap) {
      result.set(clientId, state as A)
    }
    return result
  }

  const readClientIds = (): ReadonlyArray<number> => Array.from(awareness.getStates().keys())

  return {
    awareness,
    clientID: awareness.clientID,

    local: createAwarenessLocalLens(ast, ast, awareness, []),

    remote(clientId: number): ReadonlyYLens<A> {
      return createAwarenessRemoteLens(ast, awareness, clientId, []) as ReadonlyYLens<A>
    },

    clearLocal() {
      awareness.setLocalState(null)
    },

    unsafeGetStates(): ReadonlyMap<number, A> {
      return readStates()
    },

    getStates(): Effect.Effect<ReadonlyMap<number, A>, ParseError> {
      return Effect.try({
        try: () => {
          const rawMap = awareness.getStates()
          const result = new Map<number, A>()
          for (const [clientId, state] of rawMap) {
            result.set(clientId, decode(state))
          }
          return result as ReadonlyMap<number, A>
        },
        catch: (error) => {
          if (error instanceof ParseError) return error
          throw error
        }
      })
    },

    statesAtom() {
      return atomFromAwarenessAllChanges(awareness, readStates)
    },

    clientIdsAtom() {
      return atomFromAwarenessPresence(awareness, readClientIds)
    },

    remoteStateFamily: Atom.family((clientId: number) =>
      atomFromAwarenessUpdate(awareness, clientId, () => {
        const state = awareness.getStates().get(clientId)
        return (state as A) ?? undefined
      })
    )
  }
}

// ── Public API ───────────────────────────────────────────────

export const YAwareness = {
  /**
   * Create a new Awareness instance from a Y.Doc and bind a schema to it.
   */
  make<A extends Record<string, any>>(
    schema: S.Schema<A>,
    doc: Y.Doc
  ): YAwarenessHandle<A> {
    const awareness = new Awareness(doc)
    return createAwarenessHandle(schema, awareness as unknown as AwarenessLike)
  },

  /**
   * Bind a schema to an existing Awareness instance (e.g., from a provider).
   */
  bind<A extends Record<string, any>>(
    schema: S.Schema<A>,
    awareness: AwarenessLike
  ): YAwarenessHandle<A> {
    return createAwarenessHandle(schema, awareness)
  }
}
