# ADR 0001: YAML Support for Task Specs

- Status: Accepted
- Date: 2025-09-03

## Context

The ctx-gen roadmap specifies that task specifications should be loadable from YAML or JSON. To parse YAML reliably and safely, we need a YAML parser at runtime for the CLI.

## Decision

Adopt the `yaml` npm package (https://www.npmjs.com/package/yaml) as a small, well-maintained dependency for parsing YAML task specs. The loader accepts `.yaml`/`.yml` and `.json` files and validates the resulting object with Zod before use.

## Consequences

- Add `yaml` as a runtime dependency in `package.json`.
- Implement `src/utils/task-loader.ts` to parse YAML/JSON and validate via Zod.
- Keep the step engine decoupled; the loader only validates shape, not semantics.

## Alternatives Considered

- Implementing a minimal YAML subset parser in-house: too error-prone and time-consuming.
- JSON-only: conflicts with roadmap/spec and reduces usability for package authors.

## Security & Safety

- `yaml` parses plain data; no custom types or eval. We validate with Zod after parse.
- No side effects or file writes; functions are pure and testable.
