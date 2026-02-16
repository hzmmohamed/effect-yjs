import type * as S from "effect/Schema"
import * as Y from "yjs"
import { buildYjsTree } from "./traversal.js"
import { createStructLens, type YLens } from "./YLens.js"

const ROOT_MAP_NAME = "root"

export interface YDocumentRoot<T> extends YLens<T> {
  readonly _tag: "YDocumentRoot"
  readonly doc: Y.Doc
  readonly rootMap: Y.Map<any>
}

export const YDocument = {
  make<TFields extends S.Struct.Fields>(
    schema: S.Struct<TFields>
  ): { doc: Y.Doc; root: YDocumentRoot<S.Struct.Type<TFields>> } {
    const doc = new Y.Doc()
    const rootMap = doc.getMap(ROOT_MAP_NAME)
    doc.transact(() => {
      buildYjsTree(schema.ast, rootMap, [])
    })
    const lens = createStructLens(schema.ast, rootMap, doc)
    const root = Object.assign(lens, {
      _tag: "YDocumentRoot" as const,
      doc,
      rootMap
    }) as YDocumentRoot<S.Struct.Type<TFields>>
    return { doc, root }
  },

  bind<TFields extends S.Struct.Fields>(
    schema: S.Struct<TFields>,
    doc: Y.Doc
  ): YDocumentRoot<S.Struct.Type<TFields>> {
    const rootMap = doc.getMap(ROOT_MAP_NAME)
    doc.transact(() => {
      buildYjsTree(schema.ast, rootMap, [])
    })
    const lens = createStructLens(schema.ast, rootMap, doc)
    return Object.assign(lens, {
      _tag: "YDocumentRoot" as const,
      doc,
      rootMap
    }) as YDocumentRoot<S.Struct.Type<TFields>>
  },

  transact<T>(root: YDocumentRoot<any>, fn: () => T): T {
    let result: T
    root.doc.transact(() => {
      result = fn()
    })
    return result!
  }
}
