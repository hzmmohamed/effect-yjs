import * as AST from "effect/SchemaAST"
import * as Y from "yjs"
import { UnsupportedSchemaError } from "./errors.js"
import { YLinkedListTypeId, YTextTypeId } from "./markers.js"

export const isYTextAST = (ast: AST.AST): boolean => {
  const annotation = AST.getAnnotation<symbol>(YTextTypeId)(ast)
  return annotation._tag === "Some"
}

export const isYLinkedListAST = (ast: AST.AST): boolean => {
  const annotation = AST.getAnnotation<symbol>(YLinkedListTypeId)(ast)
  return annotation._tag === "Some"
}

export const isDiscriminatedUnion = (ast: AST.Union): boolean => {
  if (ast.types.length < 2) return false
  const firstMember = ast.types[0]
  if (!AST.isTypeLiteral(firstMember)) return false

  const literalFields = firstMember.propertySignatures.filter(
    (p) => AST.isLiteral(p.type)
  )
  if (literalFields.length === 0) return false

  return literalFields.some((candidateField) =>
    ast.types.every((member) => {
      if (!AST.isTypeLiteral(member)) return false
      return member.propertySignatures.some(
        (p) => p.name === candidateField.name && AST.isLiteral(p.type)
      )
    })
  )
}

export const unwrap = (ast: AST.AST): AST.AST => {
  if (AST.isRefinement(ast)) return unwrap(ast.from)
  if (AST.isSuspend(ast)) return unwrap(ast.f())
  if (AST.isTransformation(ast)) return unwrap(ast.from)
  return ast
}

export const isStruct = (ast: AST.TypeLiteral): boolean =>
  ast.propertySignatures.length > 0 && ast.indexSignatures.length === 0

export const isRecord = (ast: AST.TypeLiteral): boolean =>
  ast.propertySignatures.length === 0 && ast.indexSignatures.length > 0

export const buildYjsTree = (
  ast: AST.AST,
  parent: Y.Map<any>,
  path: ReadonlyArray<string>
): void => {
  const core = unwrap(ast)

  if (AST.isTypeLiteral(core)) {
    if (isStruct(core)) {
      for (const prop of core.propertySignatures) {
        const fieldName = String(prop.name)
        const fieldCore = unwrap(prop.type)
        const fieldPath = [...path, fieldName]

        if (isYLinkedListAST(prop.type) || isYLinkedListAST(fieldCore)) {
          parent.set(fieldName, new Y.Array())
        } else if (isYTextAST(prop.type) || isYTextAST(fieldCore)) {
          parent.set(fieldName, new Y.Text())
        } else if (AST.isTypeLiteral(fieldCore)) {
          const childMap = new Y.Map()
          parent.set(fieldName, childMap)
          if (isStruct(fieldCore)) {
            buildYjsTree(fieldCore, childMap, fieldPath)
          }
        } else if (AST.isTupleType(fieldCore)) {
          parent.set(fieldName, new Y.Array())
        } else if (AST.isUnion(fieldCore)) {
          if (isDiscriminatedUnion(fieldCore)) {
            throw new UnsupportedSchemaError("Discriminated union", fieldPath)
          }
        }
      }
    }
    return
  }

  if (AST.isUnion(core)) {
    if (isDiscriminatedUnion(core)) {
      throw new UnsupportedSchemaError("Discriminated union", [...path])
    }
    return
  }
}
