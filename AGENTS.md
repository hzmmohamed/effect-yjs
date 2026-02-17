# Project Overview

**effect-yjs** is a schema-first integration between
[Effect Schema](https://effect.website) and [Yjs](https://yjs.dev) that
provides type-safe, validated, reactive collaborative documents. You define
your document shape with Effect Schema; the library automatically builds the
corresponding Yjs CRDT structure and gives you `YLens` accessors with
compile-time type safety, runtime validation, and reactive atoms.

## Repository Structure

- `src/` — Library source (~650 LOC); traversal engine, lens accessors,
  atoms, document API, error types, schema markers.
- `test/` — Vitest test suite (~800 LOC); unit, integration, and
  compile-time type-safety tests.
- `build/` — Compiled output (ESM, CJS, DTS). **Generated — do not edit.**
- `dist/` — Packaged distribution directory. **Generated — do not edit.**
- `docs/plans/` — Design documents and implementation plans for v1.
- `.github/` — CI workflows (check, release, snapshot) and composite
  setup action.
- `.changeset/` — Changesets release configuration.
- `.agents/` — Git submodules for agent reference repos
  (e.g. `effect-atom`).
- `patches/` — pnpm patch overrides for dependencies.
- `scratchpad/` — Throwaway experiments. Gitignored except tsconfig.
- `.vscode/` — Editor settings and recommended extensions.

## Build & Development Commands

All commands assume `pnpm` (v10.14.0) via Corepack. A Nix flake
(`.envrc` + `flake.nix`) provides Node 24, pnpm, bun, and python3.

```bash
# Install dependencies
pnpm install

# Type-check (project references)
pnpm check            # tsc -b tsconfig.json

# Lint (ESLint + dprint formatter)
pnpm lint             # eslint --max-warnings 0 ...

# Run tests
pnpm test             # vitest
pnpm coverage         # vitest --coverage

# Full build (ESM → CJS → annotations → pack)
pnpm build

# Individual build stages
pnpm build-esm        # tsc -b tsconfig.build.json
pnpm build-cjs        # babel build/esm → build/cjs
pnpm build-annotate   # babel pure-call annotations

# Prepare package exports (codegen)
pnpm codegen          # build-utils prepare-v2

# Release (handled by CI)
pnpm changeset-version
pnpm changeset-publish
```

## Code Style & Conventions

**Formatter:** dprint (via `@effect/dprint` ESLint rule — no Prettier).

| Rule | Value |
|------|-------|
| Indent | 2 spaces |
| Line width | 120 |
| Semicolons | ASI (none) |
| Quotes | Always double |
| Trailing commas | None |
| Array type | Generic (`Array<T>`, not `T[]`) |

**Naming patterns:**
- Modules use PascalCase filenames (`YDocument.ts`, `YLens.ts`).
- Exported constructors follow Effect convention: `ModuleName.make()`,
  `ModuleName.bind()`.
- Private helpers use camelCase.
- Unused parameters prefixed with `_`.

**Imports:**
- Sorted by `simple-import-sort`; destructure keys sorted.
- Consistent type imports (`import type`).
- Path aliases in tests: `@template/basic` → `src/`,
  `@template/basic/test` → `test/`.

**Commit messages:**
- Conventional Commits style: `feat:`, `fix:`, `chore:`, `docs:`.
- Changesets used for versioning — add a changeset for user-facing
  changes.

## Architecture Notes

```
┌─────────────────────────────────────────────────────┐
│                   User Code                         │
│  const { doc, root } = YDocument.make(MySchema)     │
│  root.focus("field").set(value)                     │
└────────────┬────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────┐
│  YDocument  (src/YDocument.ts)                      │
│  • make(schema) → creates Y.Doc + root YLens       │
│  • bind(schema, doc) → attaches to existing Y.Doc  │
│  • transact(root, fn) → batched mutations           │
└────────────┬────────────────────────────────────────┘
             │ uses
┌────────────▼────────────────────────────────────────┐
│  Traversal Engine  (src/traversal.ts)               │
│  buildYjsTree(ast) — recursively walks Effect       │
│  Schema AST and creates the corresponding Yjs       │
│  structure:                                         │
│    S.Struct → Y.Map (pre-populated)                 │
│    S.Record → Y.Map (empty, dynamic entries)        │
│    S.Array  → Y.Array                               │
│    YText    → Y.Text                                │
│    Primitives → plain values in parent Y.Map        │
└────────────┬────────────────────────────────────────┘
             │ wraps
┌────────────▼────────────────────────────────────────┐
│  YLens  (src/YLens.ts)                              │
│  Type-safe accessor with variants per schema kind:  │
│  • createStructLens()   — navigate fields via       │
│    focus(key), get/set with validation              │
│  • createRecordLens()   — dynamic key access        │
│  • createArrayLens()    — indexed access            │
│  • createPrimitiveLens()— leaf read/write           │
│  • createYTextLens()    — collaborative text        │
│                                                     │
│  APIs: get(), set(), getSafe(), setEffect(),        │
│        focus(key), atom()                           │
└────────────┬────────────────────────────────────────┘
             │ reactive layer
┌────────────▼────────────────────────────────────────┐
│  Atoms  (src/atoms.ts)                              │
│  Bridges Yjs observe events to @effect-atom/atom:   │
│  atomFromYMapKey, atomFromYMap, atomFromYArray,      │
│  atomFromYText — auto-cleanup via get.addFinalizer  │
└─────────────────────────────────────────────────────┘
```

**Data flow:**

1. User defines an Effect `Schema.Struct(...)`.
2. `YDocument.make` passes the schema AST to `buildYjsTree`, which
   creates nested `Y.Map` / `Y.Array` / `Y.Text` nodes.
3. A root `YLens` is returned, typed to the schema.
4. `focus(key)` returns a child lens; `get()` reads from Yjs,
   `set(value)` validates via Effect Schema then writes.
5. `atom()` creates a reactive atom that re-fires on Yjs `observe`
   events.

**Key design decisions:**
- YLens is self-contained — no root-threading required.
- Discriminated unions are explicitly rejected
  (`UnsupportedSchemaError`).
- `get()` trusts data (fast); `getSafe()` validates via Effect.
- `set()` throws on validation failure; `setEffect()` returns
  `Effect<void, TypedYValidationError>`.

## Testing Strategy

**Framework:** Vitest 3.x with `@effect/vitest` integration.

**Setup file:** `setupTests.ts` adds Effect equality testers.

**Test categories:**

| Category | Files | What it covers |
|----------|-------|----------------|
| Unit | `errors.test.ts`, `markers.test.ts`, `traversal.test.ts` | Error types, YText markers, schema → Yjs mapping |
| Component | `YDocument.test.ts`, `YLens.test.ts`, `atoms.test.ts` | Document lifecycle, lens CRUD, reactive atoms |
| Integration | `integration.test.ts` | Cross-doc sync, full workflows, lens passing |
| Type safety | `type-safety.test.ts` | `@ts-expect-error` compile-time checks |

**Running locally:**

```bash
pnpm test              # all tests
pnpm vitest run        # single run (no watch)
pnpm coverage          # with coverage report
```

**CI:** The `check.yml` workflow runs `pnpm test` on every PR and push
to `main`.

## Security & Compliance

- **License:** MIT (see `LICENSE`).
- **Secrets:** `NPM_TOKEN` and `GITHUB_TOKEN` used only in CI release
  workflows. Never committed to source.
- **No `.env` files** in source — `.gitignore` excludes `.env*`.
- **Dependency scanning:** pnpm lockfile (`pnpm-lock.yaml`) pins
  exact versions.

> TODO: Add automated dependency audit step to CI (e.g.
> `pnpm audit` or Dependabot).

## Agent Guardrails

**Do not modify:**
- `pnpm-lock.yaml` — only change via `pnpm install`.
- `build/`, `dist/`, `.tsbuildinfo/` — generated artifacts.
- `.github/workflows/release.yml` — release pipeline; changes need
  human review.
- `patches/` — deliberate dependency overrides.

**Always run before claiming work is done:**

```bash
pnpm check && pnpm lint && pnpm test
```

**Style enforcement:**
- Do not add semicolons — ASI style enforced by dprint.
- Use `Array<T>` generic syntax, not `T[]`.
- Keep imports sorted; use `import type` for type-only imports.
- Follow existing Effect conventions (pipe, Schema.*, Effect.*).

**Changesets:**
- Any user-facing change requires a changeset
  (`pnpm changeset`).

**Boundaries:**
- Do not push to `main` without CI passing.
- Do not publish packages manually — releases are automated via
  Changesets GitHub Action.

## Extensibility Hooks

**Schema markers:** Add new Yjs type support by creating a marker
(see `src/markers.ts` for the `YText` pattern) and extending the
traversal engine's `buildYjsTree` function plus `classifyAST` in
`YLens.ts`.

**Lens variants:** New lens kinds can be added by implementing the
`YLens<T>` interface and registering the constructor in `classifyAST`.

**Atoms:** The reactive layer (`src/atoms.ts`) can be extended with
new `atomFromY*` functions for additional Yjs types.

**Environment variables:**
> TODO: No runtime env vars currently used. Document if added.

**Feature flags:**
> TODO: No feature flags currently. Document if added.

## Further Reading

- [README.md](README.md) — User-facing documentation, quick start,
  API reference, and limitations.
- [docs/plans/2026-02-14-effect-yjs-v1-design.md](docs/plans/2026-02-14-effect-yjs-v1-design.md)
  — v1 vision, core concepts, and architectural rationale.
- [docs/plans/2026-02-14-effect-yjs-v1-plan.md](docs/plans/2026-02-14-effect-yjs-v1-plan.md)
  — Detailed implementation plan with 15 tasks and TDD approach.
- [Effect Documentation](https://effect.website/docs) — Effect
  framework reference.
- [Yjs Documentation](https://docs.yjs.dev) — Yjs CRDT library
  reference.
