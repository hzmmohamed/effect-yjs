import * as S from "effect/Schema"

export const YTextTypeId: unique symbol = Symbol.for("effect-yjs/YText")

export class YTextMarker {
  readonly _tag = "YTextMarker"
}

export const YText: S.Schema<YTextMarker> = S.declare(
  (input) => input instanceof YTextMarker,
  { identifier: "YText" }
).annotations({ [YTextTypeId]: YTextTypeId })

export const YLinkedListTypeId: unique symbol = Symbol.for("effect-yjs/YLinkedList")
export const YLinkedListItemAST: unique symbol = Symbol.for("effect-yjs/YLinkedList/itemAST")

export const YLinkedListBrand: unique symbol = Symbol.for("effect-yjs/YLinkedListBrand")

export interface YLinkedListOf<T> {
  readonly [YLinkedListBrand]: T
}

export const YLinkedList = <TFields extends S.Struct.Fields>(
  itemSchema: S.Struct<TFields>
): S.Schema<YLinkedListOf<S.Struct.Type<TFields>>> =>
  S.declare(
    (input) => Array.isArray(input),
    { identifier: "YLinkedList" }
  ).annotations({
    [YLinkedListTypeId]: YLinkedListTypeId,
    [YLinkedListItemAST]: itemSchema.ast
  }) as any
