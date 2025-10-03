# PRD: Declarative Context Generation via `tz run <package>`

## Background & Motivation

Terrazul packages already ship static assets (templates rendered by `tz apply`), but they cannot
declare automation for generating context files. Previous planning for a `tz ctx gen` command laid
out how to execute declarative task pipelines (`ctx.generate`), invoke AI tools safely, and fall
back to template rendering. We have since landed profile support in the template renderer but still
lack the task runtime, tool integration, and CLI wiring. This PRD updates the original plan to use
`tz run <package>` as the entry point for running a package’s context generator.

## Goals

- Allow packages to define declarative tasks (YAML/JSON) under `[tasks]` in `agents.toml`.
- Execute `ctx.generate` for a selected package when the user runs `tz run <package>`.
- Provide safe, deterministic execution: built-in steps only, controlled tool invocations, no user
  code.
- Fall back to template exports (`[exports]`) when a task is absent.
- Respect manifest profiles and user-configured output targets.

## Non-Goals

- Running arbitrary user scripts or shell commands.
- Shipping language-specific SDKs inside packages.
- Building a general workflow editor or UI.
- Changing package installation semantics (we reuse `agent_modules`).

## Current State (May 2025)

- Manifest parsing already supports `[tasks]`, `[exports]`, and `[profiles]`
  (`src/utils/manifest.ts`). Profile metadata now controls `tz apply` and will be reused.
- `tz run` is a stub that validates `--profile` and logs “not implemented yet”
  (`src/commands/run.ts`).
- No task loader, step engine, or tool invocation helpers exist.
- User config merges context file defaults (`src/utils/config.ts`) but has no notion of preferred
  tools for generation.
- Integration tests cover template application and profiles but nothing for task execution.

## User Stories

1. _As a developer_, I can install `@terrazul/ctx-default` and run `tz run @terrazul/ctx-default`
   to generate `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, etc., without editing config files.
2. _As a package author_, I can ship both a `ctx.generate` task and fallback templates; the CLI will
   execute my task or use my templates if the task is missing.
3. _As a teammate_, I can switch between different packages via manifest profiles (`tz apply` for
   static templates, `tz run` for generators) and know exactly which files were written.

## Functional Requirements

1. Manifest
   - `[tasks]` maps task id → YAML/JSON spec path.
   - `[exports]` maps tool key → template path (unchanged).
   - Validation errors when referenced files are missing.

2. Configuration
   - `context.files` (existing) provide output destinations per tool.
   - Add `profile.tools` array with default ordered tools (`claude`, `codex`, `cursor`, `copilot`).
   - Helpers for selecting output targets and preferred tool order.

3. Task Discovery
   - Find a package’s `ctx.generate` spec (if any) in `agent_modules/<pkg>/`.
   - Load spec via YAML/JSON parser + Zod schema.

4. Step Engine
   - Built-in steps (MVP): `facts.v1`, `prompt.v1`, `tool.ask.v1`, `render.template.v1`,
     `fs.write.v1`, `foreach.v1`.
   - Expressions allow `{{ path.to.value }}` interpolation in step inputs.

5. Tool Invocation
   - Support Codex (`codex exec --sandbox read-only --ask-for-approval never`) and Claude
     (`claude -p --output-format json --permission-mode plan --max-turns 1`).
   - Strip ANSI, parse JSON or fenced JSON, map non-zero exit to structured errors.

6. CLI Flow (`tz run <package>`)
   - Resolve package manifest + task.
   - Build execution context using config defaults + CLI flags (`--profile`, `--tool`, `--out`,
     `--dry-run`).
   - Execute task pipeline; on `--dry-run`, print outputs without writing files.
   - If no task exists, fall back to `[exports]` templates in profile order.
   - Respect profile filtering; error if requested profile contains missing packages.

7. Safety & Determinism
   - Tasks cannot execute arbitrary code; only built-in steps are allowed.
   - `tool.ask` runs with read-only flags and timeouts.
   - `fs.write` supports `skipIfExists`; default behaviour is to refuse overwrites unless forced.

## Non-Functional Requirements

- Cross-platform (macOS, Linux, Windows) parity.
- No additional runtime deps beyond existing stack (Handlebars already in use).
- Unit/integration tests must run without calling real Codex/Claude; use fake binaries.
- Performance: pipelines should complete in <10 s with cached tool outputs (excludes tool time).

## Architecture & Component Changes

### 1. Config Enhancements (`src/utils/config.ts`, `src/types/config.ts`)

- Add defaults for `profile.tools` and expose helpers:
  - `computeOutputTargets(config, override?)` → ordered list of tool outputs.
  - `selectPrimaryTool(config, cliOverride?)` → resolves `sourceTool` for `tool.ask`.
- Extend config schema + normalization tests.

### 2. Manifest Utilities (`src/utils/manifest.ts`)

- Provide `listManifestTasks(manifest)` and `validateTaskPath(projectDir, rel)` utilities so the
  runner can reuse manifest metadata without re-parsing files.

### 3. Task Loader (`src/utils/task-loader.ts`)

- Parse YAML/JSON into typed `TaskSpec` (Zod schema).
- Support versioned steps (initially `version: 1`).
- Provide `findTaskInProject(cwd, taskId)` to locate the first package exporting the task.

### 4. Template Helpers (`src/utils/template.ts`)

- Export `interpolate(text, context)` and `renderTemplate(templatePath, context)` using the existing
  Handlebars setup; register minimal helpers (`eq`, `json`).

### 5. Step Engine (`src/core/task-runner.ts`)

- Implement execution loop with context mutation and error handling.
- Steps:
  - `facts.v1` — collect repo metadata (package.json, scripts, directory listing).
  - `prompt.v1` — load a template, interpolate with context, optionally emit debug output.
  - `tool.ask.v1` — call tool-runner, parse structured JSON, merge into context.
  - `render.template.v1` — render Handlebars template with context.
  - `fs.write.v1` — write file (honor `skipIfExists`, `dryRun`).
  - `foreach.v1` — iterate list, execute nested steps with item-scoped context.

### 6. Tool Runner (`src/utils/tool-runner.ts`)

- Wrap `runCommand` to invoke Codex/Claude binaries with safe defaults.
- Implement ANSI stripping, JSON extraction, and structured error reporting.

### 7. CLI Orchestration (`src/commands/run.ts`)

- Replace stub:
  1. Resolve package and optional profile filter.
  2. Load manifest, task spec, and fallback templates.
  3. Build execution context (config defaults + CLI flags).
  4. If task exists → execute via `task-runner` (respect `--dry-run`).
  5. Else → use template fallback (existing `planAndRender`, but filtered to requested package).
- Update help text: `tz run <package> [--profile <name>] [--tool <tool>] [--out <path>] [--dry-run]`.

### 8. Sample Package Fixture (`fixtures/packages/@terrazul/ctx-default/`)

- Include `agents.toml`, `tasks/ctx.generate.yaml`, prompt, and templates for tests.
- Provide README to document usage.

## Implementation Plan (Dependency-Ordered Milestones)

1. **Manifest & Config Enhancements**
   - Extend config schema (`profile.tools`) + helpers and tests.
   - Expose manifest helper functions for tasks/exports.

2. **Task Loading & Template Utilities**
   - Implement YAML/JSON loader, Zod schema, and template interpolation helpers.
   - Unit tests covering parsing success/failure.

3. **Step Engine (without tool.ask)**
   - Implement `facts.v1`, `render.template.v1`, `fs.write.v1`, `foreach.v1`.
   - Integration test: temp project pipeline renders and writes files.

4. **Tool Runner + tool.ask.v1**
   - Add Codex/Claude shims, ANSI stripping, JSON parsing.
   - Unit tests using mocked `runCommand` for success/error scenarios.

5. **CLI Wiring (`tz run <package>`)**
   - Replace stub with task execution + fallback logic.
   - Support CLI flags (`--profile`, `--tool`, `--out`, `--dry-run`).

6. **Assets Fallback & Profiles**
   - When no task present, render first template per tool respecting profile order and `skipIfExists`.
   - Ensure profile validation errors mirror `tz apply` semantics.

7. **Fixture Package & Integration Tests**
   - Create `@terrazul/ctx-default` fixture.
   - Add integration tests that:
     - Run `tz run <package> --dry-run` with fake tool binaries.
     - Verify fallback path when task is absent.

8. **Documentation**
   - Update `AGENTS.md` with new CLI usage, task reference, safety guarantees.
   - Document package authoring guidelines (tasks + exports).

## Testing Strategy

- **Unit Tests**: config helpers, manifest validation, task loader, template interpolation, step
  engine (mock filesystem), tool runner (mock binaries).
- **Integration Tests**: temp workspace with installed fixtures, fake Codex/Claude scripts on PATH,
  `tz run <package>` in dry-run and real-write modes, fallback verification.
- **Regression**: extend existing template renderer/profile tests to ensure backward compatibility.

## Risks & Mitigations

- **Tool availability**: Users may not have local Codex/Claude binaries. Mitigate by checking PATH
  and returning a clear `TOOL_NOT_FOUND` error with remediation guidance.
- **Long-running tool calls**: Enforce timeouts and surface partial responses gracefully.
- **Cross-platform path issues**: Reuse existing `ensureDir`, `agentModulesPath`, and path helpers.
- **Compatibility drift**: Version task schema (`version: 1`) and plan for future backward
  compatibility.

## Open Questions

- Should we cache tool responses for deterministic re-runs (`--cache` flag)?
- Do we need a `--force` flag on `tz run` similar to `tz apply --force` for overwriting outputs?
- How should we surface structured output (stdout vs. written files) during dry-run mode?
