import type { ParseError } from "effect/ParseResult"

export class TypedYValidationError extends Error {
  readonly _tag = "TypedYValidationError"
  constructor(
    readonly context: string,
    readonly parseError: ParseError
  ) {
    super(`Validation failed at ${context}: ${parseError.message}`)
    this.cause = parseError
  }
}

export class UnsupportedSchemaError extends Error {
  readonly _tag = "UnsupportedSchemaError"
  constructor(
    readonly schemaType: string,
    readonly path: ReadonlyArray<string>
  ) {
    super(
      `Unsupported schema type "${schemaType}" at path: ${path.join(".")}`
    )
  }
}
