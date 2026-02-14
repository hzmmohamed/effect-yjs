import type { Atom } from "@effect-atom/atom"
import * as Effect from "effect/Effect"
import { ParseError } from "effect/ParseResult"
import * as S from "effect/Schema"
import * as AST from "effect/SchemaAST"
import * as Y from "yjs"
import { atomFromYArray, atomFromYMap, atomFromYMapKey, atomFromYText } from "./atoms.js"
import { TypedYValidationError } from "./errors.js"
import { buildYjsTree, isYTextAST, unwrap } from "./traversal.js"

type LensKind = "struct" | "record" | "array" | "ytext" | "primitive"

const classifyAST = (ast: AST.AST): LensKind => {
  if (isYTextAST(ast)) return "ytext"
  const core = unwrap(ast)
  if (isYTextAST(core)) return "ytext"
  if (AST.isTypeLiteral(core)) {
    if (core.propertySignatures.length > 0 && core.indexSignatures.length === 0) {
      return "struct"
    }
    if (core.indexSignatures.length > 0 && core.propertySignatures.length === 0) {
      return "record"
    }
    if (core.propertySignatures.length > 0) return "struct"
    return "primitive"
  }
  if (AST.isTupleType(core)) return "array"
  return "primitive"
}

const getFieldAST = (
  ast: AST.AST,
  key: string
): AST.AST | undefined => {
  const core = unwrap(ast)
  if (!AST.isTypeLiteral(core)) return undefined
  const prop = core.propertySignatures.find((p) => String(p.name) === key)
  return prop?.type
}

const readStructAsObject = (yMap: Y.Map<any>, ast: AST.AST): any => {
  const core = unwrap(ast)
  if (!AST.isTypeLiteral(core)) return undefined
  const obj: Record<string, any> = {}
  for (const prop of core.propertySignatures) {
    const key = String(prop.name)
    const value = yMap.get(key)
    const fieldKind = classifyAST(prop.type)
    if (fieldKind === "struct" && value instanceof Y.Map) {
      obj[key] = readStructAsObject(value, prop.type)
    } else if (fieldKind === "array" && value instanceof Y.Array) {
      obj[key] = readArrayAsPlain(value, prop.type)
    } else if (fieldKind === "record" && value instanceof Y.Map) {
      obj[key] = readRecordAsObject(value, prop.type)
    } else if (fieldKind === "ytext" && value instanceof Y.Text) {
      obj[key] = value
    } else {
      obj[key] = value
    }
  }
  return obj
}

const readRecordAsObject = (yMap: Y.Map<any>, ast: AST.AST): any => {
  const core = unwrap(ast)
  if (!AST.isTypeLiteral(core) || core.indexSignatures.length === 0) {
    return Object.fromEntries(yMap.entries())
  }
  const valueAST = core.indexSignatures[0].type
  const valueKind = classifyAST(valueAST)
  const result: Record<string, any> = {}
  for (const [k, v] of yMap.entries()) {
    if (valueKind === "struct" && v instanceof Y.Map) {
      result[k] = readStructAsObject(v, valueAST)
    } else if (valueKind === "record" && v instanceof Y.Map) {
      result[k] = readRecordAsObject(v, valueAST)
    } else if (valueKind === "array" && v instanceof Y.Array) {
      result[k] = readArrayAsPlain(v, valueAST)
    } else {
      result[k] = v
    }
  }
  return result
}

const readArrayAsPlain = (yArray: Y.Array<any>, ast: AST.AST): Array<any> => {
  const core = unwrap(ast)
  if (!AST.isTupleType(core) || core.rest.length === 0) return yArray.toArray()
  const itemAST = core.rest[0].type
  const itemKind = classifyAST(itemAST)
  return yArray.toArray().map((item) => {
    if (itemKind === "struct" && item instanceof Y.Map) {
      return readStructAsObject(item, itemAST)
    }
    return item
  })
}

const writeStructFromObject = (
  yMap: Y.Map<any>,
  ast: AST.AST,
  value: Record<string, any>
): void => {
  const core = unwrap(ast)
  if (!AST.isTypeLiteral(core)) return
  for (const prop of core.propertySignatures) {
    const key = String(prop.name)
    if (!(key in value)) continue
    const fieldKind = classifyAST(prop.type)
    if (fieldKind === "struct") {
      let childMap = yMap.get(key)
      if (!(childMap instanceof Y.Map)) {
        childMap = new Y.Map()
        yMap.set(key, childMap)
      }
      writeStructFromObject(childMap, prop.type, value[key])
    } else if (fieldKind === "array") {
      let childArray = yMap.get(key)
      if (!(childArray instanceof Y.Array)) {
        childArray = new Y.Array()
        yMap.set(key, childArray)
      }
      writeArrayFromPlain(childArray, prop.type, value[key])
    } else if (fieldKind === "ytext") {
      // Skip — Y.Text is managed via its own API
    } else {
      yMap.set(key, value[key])
    }
  }
}

const writeArrayFromPlain = (
  yArray: Y.Array<any>,
  ast: AST.AST,
  value: Array<any>
): void => {
  yArray.delete(0, yArray.length)
  const core = unwrap(ast)
  if (!AST.isTupleType(core) || core.rest.length === 0) {
    yArray.push(value)
    return
  }
  const itemAST = core.rest[0].type
  const itemKind = classifyAST(itemAST)
  for (const item of value) {
    if (itemKind === "struct") {
      const childMap = new Y.Map()
      writeStructFromObject(childMap, itemAST, item)
      yArray.push([childMap])
    } else {
      yArray.push([item])
    }
  }
}

export interface YLens<T> {
  focus: T extends { readonly [K in keyof T]: any } ? <K extends keyof T & string>(key: K) => YLens<T[K]>
    : (key: string) => YLens<any>
  get: () => T | undefined
  set: (value: T) => void
  setEffect: (value: T) => Effect.Effect<void, ParseError>
  getSafe: () => Effect.Effect<T, ParseError>
  atom: () => Atom.Atom<T | undefined>
}

export const createStructLens = (
  ast: AST.AST,
  yMap: Y.Map<any>,
  doc: Y.Doc
): YLens<any> => ({
  focus(key: string): any {
    const fieldAST = getFieldAST(ast, key)
    if (!fieldAST) {
      throw new Error(`Unknown field: ${key}`)
    }
    const fieldKind = classifyAST(fieldAST)

    if (fieldKind === "struct") {
      let childMap = yMap.get(key)
      if (!(childMap instanceof Y.Map)) {
        childMap = new Y.Map()
        yMap.set(key, childMap)
      }
      return createStructLens(fieldAST, childMap, doc)
    }

    if (fieldKind === "record") {
      let childMap = yMap.get(key)
      if (!(childMap instanceof Y.Map)) {
        childMap = new Y.Map()
        yMap.set(key, childMap)
      }
      return createRecordLens(fieldAST, childMap, doc)
    }

    if (fieldKind === "array") {
      let childArray = yMap.get(key)
      if (!(childArray instanceof Y.Array)) {
        childArray = new Y.Array()
        yMap.set(key, childArray)
      }
      return createArrayLens(fieldAST, childArray, doc)
    }

    if (fieldKind === "ytext") {
      let childText = yMap.get(key)
      if (!(childText instanceof Y.Text)) {
        childText = new Y.Text()
        yMap.set(key, childText)
      }
      return createYTextLens(childText, doc)
    }

    return createPrimitiveLens(fieldAST, yMap, key, doc)
  },

  get() {
    return readStructAsObject(yMap, ast)
  },

  set(value: any) {
    const schema = S.make(ast)
    try {
      S.decodeUnknownSync(schema)(value)
    } catch (error) {
      if (error instanceof ParseError) {
        throw new TypedYValidationError("struct", error)
      }
      throw error
    }
    doc.transact(() => {
      writeStructFromObject(yMap, ast, value)
    })
  },

  setEffect(value: any) {
    return Effect.try({
      try: () => {
        const schema = S.make(ast)
        S.decodeUnknownSync(schema)(value)
        doc.transact(() => {
          writeStructFromObject(yMap, ast, value)
        })
      },
      catch: (error) => {
        if (error instanceof ParseError) return error
        throw error
      }
    })
  },

  getSafe() {
    return Effect.try({
      try: () => {
        const obj = readStructAsObject(yMap, ast)
        const schema = S.make(ast)
        return S.decodeUnknownSync(schema)(obj)
      },
      catch: (error) => {
        if (error instanceof ParseError) return error
        throw error
      }
    })
  },

  atom() {
    return atomFromYMap(yMap, () => readStructAsObject(yMap, ast))
  }
})

const createPrimitiveLens = (
  ast: AST.AST,
  parentMap: Y.Map<any>,
  key: string,
  _doc: Y.Doc
): YLens<any> => ({
  focus: (() => {
    throw new Error("Cannot focus into a primitive value")
  }) as any,

  get() {
    return parentMap.get(key)
  },

  set(value: any) {
    const schema = S.make(ast)
    try {
      S.decodeUnknownSync(schema)(value)
    } catch (error) {
      if (error instanceof ParseError) {
        throw new TypedYValidationError(`field '${key}'`, error)
      }
      throw error
    }
    parentMap.set(key, value)
  },

  setEffect(value: any) {
    return Effect.try({
      try: () => {
        const schema = S.make(ast)
        S.decodeUnknownSync(schema)(value)
        parentMap.set(key, value)
      },
      catch: (error) => {
        if (error instanceof ParseError) return error
        throw error
      }
    })
  },

  getSafe() {
    return Effect.try({
      try: () => {
        const schema = S.make(ast)
        return S.decodeUnknownSync(schema)(parentMap.get(key))
      },
      catch: (error) => {
        if (error instanceof ParseError) return error
        throw error
      }
    })
  },

  atom() {
    return atomFromYMapKey(parentMap, key, () => parentMap.get(key))
  }
})

export const createRecordLens = (
  ast: AST.AST,
  yMap: Y.Map<any>,
  doc: Y.Doc
): YLens<any> => {
  const core = unwrap(ast)
  const valueAST = AST.isTypeLiteral(core) && core.indexSignatures.length > 0
    ? core.indexSignatures[0].type
    : undefined
  const valueKind = valueAST ? classifyAST(valueAST) : "primitive"

  return {
    focus(key: string): any {
      if (!valueAST) throw new Error("Cannot determine record value schema")

      if (valueKind === "struct") {
        let childMap = yMap.get(key)
        if (!(childMap instanceof Y.Map)) {
          childMap = new Y.Map()
          yMap.set(key, childMap)
          buildYjsTree(valueAST, childMap, [key])
        }
        return createStructLens(valueAST, childMap, doc)
      }

      if (valueKind === "record") {
        let childMap = yMap.get(key)
        if (!(childMap instanceof Y.Map)) {
          childMap = new Y.Map()
          yMap.set(key, childMap)
        }
        return createRecordLens(valueAST, childMap, doc)
      }

      if (valueKind === "array") {
        let childArray = yMap.get(key)
        if (!(childArray instanceof Y.Array)) {
          childArray = new Y.Array()
          yMap.set(key, childArray)
        }
        return createArrayLens(valueAST, childArray, doc)
      }

      return createPrimitiveLens(valueAST, yMap, key, doc)
    },

    get() {
      return readRecordAsObject(yMap, ast)
    },

    set(value: any) {
      const schema = S.make(ast)
      try {
        S.decodeUnknownSync(schema)(value)
      } catch (error) {
        if (error instanceof ParseError) {
          throw new TypedYValidationError("record", error)
        }
        throw error
      }
      doc.transact(() => {
        for (const k of Array.from(yMap.keys())) {
          yMap.delete(k)
        }
        for (const [k, v] of Object.entries(value as Record<string, any>)) {
          if (valueKind === "struct" && valueAST) {
            const childMap = new Y.Map()
            writeStructFromObject(childMap, valueAST, v as any)
            yMap.set(k, childMap)
          } else {
            yMap.set(k, v)
          }
        }
      })
    },

    setEffect(value: any) {
      return Effect.try({
        try: () => {
          const schema = S.make(ast)
          S.decodeUnknownSync(schema)(value)
          doc.transact(() => {
            for (const k of Array.from(yMap.keys())) {
              yMap.delete(k)
            }
            for (const [k, v] of Object.entries(value as Record<string, any>)) {
              if (valueKind === "struct" && valueAST) {
                const childMap = new Y.Map()
                writeStructFromObject(childMap, valueAST, v as any)
                yMap.set(k, childMap)
              } else {
                yMap.set(k, v)
              }
            }
          })
        },
        catch: (error) => {
          if (error instanceof ParseError) return error
          throw error
        }
      })
    },

    getSafe() {
      return Effect.try({
        try: () => {
          const obj = readRecordAsObject(yMap, ast)
          const schema = S.make(ast)
          return S.decodeUnknownSync(schema)(obj)
        },
        catch: (error) => {
          if (error instanceof ParseError) return error
          throw error
        }
      })
    },

    atom() {
      return atomFromYMap(yMap, () => readRecordAsObject(yMap, ast))
    }
  } as any
}

export const createArrayLens = (
  ast: AST.AST,
  yArray: Y.Array<any>,
  doc: Y.Doc
): YLens<any> => ({
  focus: (() => {
    throw new Error("Use .at(index) for array access (not yet implemented)")
  }) as any,

  get() {
    return readArrayAsPlain(yArray, ast)
  },

  set(value: any) {
    const schema = S.make(ast)
    try {
      S.decodeUnknownSync(schema)(value)
    } catch (error) {
      if (error instanceof ParseError) {
        throw new TypedYValidationError("array", error)
      }
      throw error
    }
    doc.transact(() => {
      writeArrayFromPlain(yArray, ast, value)
    })
  },

  setEffect(value: any) {
    return Effect.try({
      try: () => {
        const schema = S.make(ast)
        S.decodeUnknownSync(schema)(value)
        doc.transact(() => {
          writeArrayFromPlain(yArray, ast, value)
        })
      },
      catch: (error) => {
        if (error instanceof ParseError) return error
        throw error
      }
    })
  },

  getSafe() {
    return Effect.try({
      try: () => {
        const arr = readArrayAsPlain(yArray, ast)
        const schema = S.make(ast)
        return S.decodeUnknownSync(schema)(arr)
      },
      catch: (error) => {
        if (error instanceof ParseError) return error
        throw error
      }
    })
  },

  atom() {
    return atomFromYArray(yArray, () => readArrayAsPlain(yArray, ast))
  }
})

const createYTextLens = (
  yText: Y.Text,
  _doc: Y.Doc
): YLens<any> => ({
  focus: (() => {
    throw new Error("Cannot focus into a Y.Text")
  }) as any,

  get() {
    return yText
  },

  set(_value: any) {
    throw new Error(
      "Cannot set Y.Text directly — use the Y.Text API (insert, delete, etc.)"
    )
  },

  setEffect(_value: any) {
    return Effect.fail(
      new ParseError({
        _tag: "Type",
        ast: AST.stringKeyword,
        actual: _value,
        message: "Cannot set Y.Text directly — use the Y.Text API"
      } as any)
    )
  },

  getSafe() {
    return Effect.succeed(yText)
  },

  atom() {
    return atomFromYText(yText)
  }
})
