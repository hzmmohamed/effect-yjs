import type { Atom } from "@effect-atom/atom"
import * as Effect from "effect/Effect"
import { ParseError } from "effect/ParseResult"
import * as S from "effect/Schema"
import * as AST from "effect/SchemaAST"
import { v7 as uuidv7 } from "uuid"
import * as Y from "yjs"
import { atomFromYArray } from "./atoms.js"
import { TypedYValidationError } from "./errors.js"
import { YLinkedListItemAST } from "./markers.js"
import { unwrap } from "./traversal.js"
import { createStructLens, type YLens } from "./YLens.js"

const getItemAST = (ast: AST.AST): AST.AST => {
  const annotation = AST.getAnnotation<AST.AST>(YLinkedListItemAST)(ast)
  if (annotation._tag === "None") {
    throw new Error("YLinkedList marker missing item AST annotation")
  }
  return annotation.value
}

const readNodeAsObject = (yMap: Y.Map<any>, itemAST: AST.AST): any => {
  const core = unwrap(itemAST)
  if (!AST.isTypeLiteral(core)) return undefined
  const obj: Record<string, any> = {}
  for (const prop of core.propertySignatures) {
    const key = String(prop.name)
    obj[key] = yMap.get(key)
  }
  return obj
}

const writeNodeToMap = (
  yMap: Y.Map<any>,
  itemAST: AST.AST,
  value: Record<string, any>,
  id: string
): void => {
  const core = unwrap(itemAST)
  if (!AST.isTypeLiteral(core)) return
  yMap.set("_id", id)
  for (const prop of core.propertySignatures) {
    const key = String(prop.name)
    if (key in value) {
      yMap.set(key, value[key])
    }
  }
}

export interface YLinkedListLens<T> {
  append(value: T): string
  prepend(value: T): string
  insertAt(index: number, value: T): string
  insertAfter(id: string, value: T): string
  removeAt(index: number): void
  remove(id: string): void
  at(index: number): YLens<T>
  find(id: string): YLens<T>
  nodes(): Map<string, YLens<T>>
  get(): Array<T>
  getSafe(): Effect.Effect<Array<T>, ParseError>
  length(): number
  atom(): Atom.Atom<Array<T>>
  ids(): Atom.Atom<any>
}

export const createLinkedListLens = (
  ast: AST.AST,
  yArray: Y.Array<any>,
  doc: Y.Doc
): YLinkedListLens<any> => {
  const itemAST = getItemAST(ast)
  const itemSchema = S.make(itemAST)

  const validateItem = (value: any): void => {
    try {
      S.decodeUnknownSync(itemSchema)(value)
    } catch (error) {
      if (error instanceof ParseError) {
        throw new TypedYValidationError("linked list item", error)
      }
      throw error
    }
  }

  const readAll = (): Array<any> =>
    yArray.toArray().map((item) => {
      if (item instanceof Y.Map) {
        return readNodeAsObject(item, itemAST)
      }
      return item
    })

  const createNode = (value: any): { yMap: Y.Map<any>; id: string } => {
    const id = uuidv7()
    const yMap = new Y.Map()
    writeNodeToMap(yMap, itemAST, value, id)
    return { yMap, id }
  }

  const findIndex = (id: string): number => {
    for (let i = 0; i < yArray.length; i++) {
      const item = yArray.get(i)
      if (item instanceof Y.Map && item.get("_id") === id) return i
    }
    return -1
  }

  return {
    append(value: any): string {
      validateItem(value)
      const { yMap, id } = createNode(value)
      doc.transact(() => {
        yArray.push([yMap])
      })
      return id
    },

    prepend(value: any): string {
      validateItem(value)
      const { yMap, id } = createNode(value)
      doc.transact(() => {
        yArray.insert(0, [yMap])
      })
      return id
    },

    insertAt(index: number, value: any): string {
      validateItem(value)
      const { yMap, id } = createNode(value)
      doc.transact(() => {
        yArray.insert(index, [yMap])
      })
      return id
    },

    insertAfter(afterId: string, value: any): string {
      const idx = findIndex(afterId)
      if (idx === -1) throw new Error(`Node not found: ${afterId}`)
      return this.insertAt(idx + 1, value)
    },

    removeAt(index: number): void {
      doc.transact(() => {
        yArray.delete(index, 1)
      })
    },

    remove(id: string): void {
      const idx = findIndex(id)
      if (idx === -1) throw new Error(`Node not found: ${id}`)
      this.removeAt(idx)
    },

    at(index: number): YLens<any> {
      const item = yArray.get(index)
      if (!(item instanceof Y.Map)) {
        throw new Error(`No node at index ${index}`)
      }
      return createStructLens(itemAST, item, doc)
    },

    find(id: string): YLens<any> {
      const idx = findIndex(id)
      if (idx === -1) throw new Error(`Node not found: ${id}`)
      return this.at(idx)
    },

    nodes(): Map<string, YLens<any>> {
      const result = new Map<string, YLens<any>>()
      for (let i = 0; i < yArray.length; i++) {
        const item = yArray.get(i)
        if (item instanceof Y.Map) {
          const id = item.get("_id") as string
          result.set(id, createStructLens(itemAST, item, doc))
        }
      }
      return result
    },

    get(): Array<any> {
      return readAll()
    },

    getSafe() {
      return Effect.try({
        try: () => {
          const arr = readAll()
          return arr.map((item) => S.decodeUnknownSync(itemSchema)(item))
        },
        catch: (error) => {
          if (error instanceof ParseError) return error
          throw error
        }
      })
    },

    length(): number {
      return yArray.length
    },

    atom() {
      return atomFromYArray(yArray, readAll)
    },

    ids() {
      return atomFromYArray(yArray, () => {
        const ids: Array<string> = []
        for (let i = 0; i < yArray.length; i++) {
          const item = yArray.get(i)
          if (item instanceof Y.Map) {
            ids.push(item.get("_id") as string)
          }
        }
        return ids
      })
    }
  }
}
