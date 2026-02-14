import { describe, expect, it } from "@effect/vitest"
import { ParseError } from "effect/ParseResult"
import * as S from "effect/Schema"
import { TypedYValidationError, UnsupportedSchemaError } from "../src/errors.js"

describe("TypedYValidationError", () => {
  it("wraps a ParseError with context", () => {
    let parseError: ParseError | undefined
    try {
      S.decodeUnknownSync(S.String)(123)
    } catch (e) {
      parseError = e as ParseError
    }
    const error = new TypedYValidationError("field 'name'", parseError!)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("field 'name'")
    expect(error.cause).toBe(parseError)
  })
})

describe("UnsupportedSchemaError", () => {
  it("reports the schema type and path", () => {
    const error = new UnsupportedSchemaError(
      "Discriminated union",
      ["shapes", "items"]
    )
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("Discriminated union")
    expect(error.message).toContain("shapes.items")
  })
})
