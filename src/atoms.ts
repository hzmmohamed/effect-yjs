import { Atom } from "@effect-atom/atom"
import * as Y from "yjs"

export const atomFromYMapKey = <T>(
  yMap: Y.Map<any>,
  key: string,
  readValue: () => T
): Atom.Atom<T | undefined> =>
  Atom.make((get: Atom.Context) => {
    const handler = () => {
      get.setSelf(readValue())
    }
    yMap.observe(handler)
    get.addFinalizer(() => yMap.unobserve(handler))
    return readValue()
  })

export const atomFromYMap = <T>(
  yMap: Y.Map<any>,
  readValue: () => T
): Atom.Atom<T> =>
  Atom.make((get: Atom.Context) => {
    const handler = () => {
      get.setSelf(readValue())
    }
    yMap.observeDeep(handler)
    get.addFinalizer(() => yMap.unobserveDeep(handler))
    return readValue()
  })

export const atomFromYArray = <T>(
  yArray: Y.Array<any>,
  readValue: () => T
): Atom.Atom<T> =>
  Atom.make((get: Atom.Context) => {
    const handler = () => {
      get.setSelf(readValue())
    }
    yArray.observe(handler)
    get.addFinalizer(() => yArray.unobserve(handler))
    return readValue()
  })

export const atomFromYText = (
  yText: Y.Text
): Atom.Atom<Y.Text> =>
  Atom.make((get: Atom.Context) => {
    const handler = () => {
      get.setSelf(yText)
    }
    yText.observe(handler)
    get.addFinalizer(() => yText.unobserve(handler))
    return yText
  })
