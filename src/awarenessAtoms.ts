import { Atom } from "@effect-atom/atom"
import type { AwarenessLike } from "./YAwareness.js"

type AwarenessChanges = { added: Array<number>; updated: Array<number>; removed: Array<number> }

const clientInChanges = (clientId: number, changes: AwarenessChanges): boolean =>
  changes.added.includes(clientId) ||
  changes.updated.includes(clientId) ||
  changes.removed.includes(clientId)

/**
 * Atom that subscribes to awareness `'change'` events filtered for a specific clientId.
 * Used by local and remote lens `atom()` methods.
 */
export const atomFromAwarenessChange = <T>(
  awareness: AwarenessLike,
  clientId: number,
  readValue: () => T
): Atom.Atom<T> =>
  Atom.make((get: Atom.Context) => {
    const handler = (changes: AwarenessChanges) => {
      if (clientInChanges(clientId, changes)) {
        get.setSelf(readValue())
      }
    }
    awareness.on("change", handler)
    get.addFinalizer(() => awareness.off("change", handler))
    return readValue()
  })

/**
 * Atom that subscribes to awareness `'update'` events filtered for a specific clientId.
 * Used by `remoteStateFamily`. Captures heartbeat-based offline detection.
 */
export const atomFromAwarenessUpdate = <T>(
  awareness: AwarenessLike,
  clientId: number,
  readValue: () => T
): Atom.Atom<T> =>
  Atom.make((get: Atom.Context) => {
    const handler = (changes: AwarenessChanges) => {
      if (clientInChanges(clientId, changes)) {
        get.setSelf(readValue())
      }
    }
    awareness.on("update", handler)
    get.addFinalizer(() => awareness.off("update", handler))
    return readValue()
  })

/**
 * Atom that subscribes to all awareness `'change'` events (any client).
 * Used by `statesAtom()`.
 */
export const atomFromAwarenessAllChanges = <T>(
  awareness: AwarenessLike,
  readValue: () => T
): Atom.Atom<T> =>
  Atom.make((get: Atom.Context) => {
    const handler = () => {
      get.setSelf(readValue())
    }
    awareness.on("change", handler)
    get.addFinalizer(() => awareness.off("change", handler))
    return readValue()
  })

/**
 * Atom that subscribes to all awareness `'update'` events (any client).
 * Used by `clientIdsAtom()` for presence detection including heartbeat timeouts.
 */
export const atomFromAwarenessPresence = <T>(
  awareness: AwarenessLike,
  readValue: () => T
): Atom.Atom<T> =>
  Atom.make((get: Atom.Context) => {
    const handler = () => {
      get.setSelf(readValue())
    }
    awareness.on("update", handler)
    get.addFinalizer(() => awareness.off("update", handler))
    return readValue()
  })
