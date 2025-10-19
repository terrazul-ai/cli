# Terrazul CLI Snippet Preprocessor PRD

## 1. Background & Problem Statement

- The existing branch introduced YAML-based tasks (`ctx.generate.yaml`) for orchestrating tool execution and template rendering. While powerful, the approach proved too complex to maintain and reason about.
- We want to keep the ability to run user-configured tools (Claude, Codex, etc.) and populate Handlebars templates, but with a simpler mental model rooted directly in templates.
- The new direction embeds snippet syntax inside `.hbs` files (e.g., `{{ askUser('prompt') }}`, `{{ var x = askAgent('templates/prompt.txt', { json: true }) }}`) and drops YAML orchestration entirely.
- We must port the reusable parts of the previous implementation (tool invocation, config management, safe file handling) into the new CLI project while adding a snippet preprocessor pipeline.

## 2. Objectives & Success Metrics

### Objectives

1. Allow template authors to gather user input (`askUser`) and agent/tool answers (`askAgent`) directly within Handlebars templates.
2. Preserve safe command execution with the existing tool configuration (safe mode defaults, env expansion, output parsing).
3. Maintain secure file write behavior (respect `context.files`, prevent path escapes, support backups).
4. Provide a maintainable, testable implementation that replaces YAML tasks completely.

### Success Metrics

- 100% of existing `ctx.generate` functionality needed for default packages works via templates alone.
- All unit/integration tests for tool invocation, config resolution, and template rendering pass in the new CLI project.
- Authoring experience feedback reports the new snippet syntax as easier to use (qualitative measure during rollout).
- No regressions in safe-mode behavior or destination path validation (verified via automated tests).

## 3. User Stories

1. **Template Author**: “As a template author, I want to embed prompts that collect answers from Claude/Codex so the rendered doc is personalized without writing YAML.”
2. **CLI User**: “As a CLI user, I want `tz run` / `tz apply` to write outputs to the same destinations, honoring my config and keeping me safe from overwriting files unexpectedly.”
3. **Maintainer**: “As a maintainer, I want a modular design (parser, executor, renderer) with clear tests so future helpers (e.g., parallel execution) are easy to add.”

## 4. Scope

### In Scope

- Snippet syntax parsing, execution, and template transformation.
- Porting tool invocation, tool output formatting, and config helper logic from the source branch located at `/Users/mattheumcbarnett/Projects/terrazul`.
- Implementing the new snippet-driven renderer inside the target CLI project at `/Users/mattheumcbarnett/Projects/cli`.
- CLI command updates to rely on the new renderer.
- Comprehensive test coverage (unit + integration).
- Documentation updates for the new snippet syntax.

### Out of Scope

- YAML task execution (`tool.ask`, `facts`, `foreach`, etc.).
- Async Handlebars helper approach (documented as an alternative but not implemented now).
- Parallel execution of multiple `askAgent` snippets (can be revisited later).
- GUI or wizard UX for prompting (current scope is CLI-based prompts).

## 5. Proposed Solution Overview

### Architecture

```
Template (.hbs) ──► Snippet Parser ──► Snippet Executor ──► Template Transformer ──► Handlebars Render
                                        ▲                     │
                                        │                     ▼
                                tool-runner.ts, tool-output.ts, config helpers
```

### File Migration Plan

| Action                       | File(s)                                                                                                                                                                                                        | Notes                                                                                                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Port (copy verbatim)**     | `cli/src/utils/tool-runner.ts`<br>`cli/src/utils/tool-output.ts` _(source: `/Users/mattheumcbarnett/Projects/terrazul/cli/...` → target: `/Users/mattheumcbarnett/Projects/cli/src/utils/...`)_                | Keep implementations unchanged to retain established safe-mode behavior and output formatting.                                                                                                                              |
| **Port (selective extract)** | `cli/src/utils/config.ts` _(source: `/Users/mattheumcbarnett/Projects/terrazul/cli/src/utils/config.ts`)_                                                                                                      | Bring over `ToolSpec` definitions, defaults (`DEFAULT_COMMANDS`, `DEFAULT_PROFILE_TOOLS`), `normalizeToolSpec()`, `computeOutputTargets()`, `selectPrimaryTool()`, and env helpers; omit YAML-specific logic.               |
| **Extract & Rehost**         | `cli/src/core/task-runner.ts` → new `cli/src/core/destinations.ts` _(source: `/Users/mattheumcbarnett/Projects/terrazul/cli/src/core/task-runner.ts`)_                                                         | Move `resolveWritePath`, `ensureFileDestination`, `safeResolveWithin`, `DIRECTORY_DEFAULT_FILENAMES`, and related helpers to support safe output writes in `/Users/mattheumcbarnett/Projects/cli/src/core/destinations.ts`. |
| **Refactor**                 | `cli/src/commands/run.ts`, `cli/src/commands/apply.ts` \*(source repo) → `/Users/mattheumcbarnett/Projects/cli/src/commands/...`                                                                               | Preserve CLI option handling and manifest lookup; replace YAML task invocation with calls into the snippet renderer + destination utilities.                                                                                |
| **Create (new)**             | `cli/src/types/snippet.ts` _(target repo)_                                                                                                                                                                     | Define snippet types (`ParsedSnippet`, `SnippetArgs`, `SnippetResult`, `ExecutionContext`).                                                                                                                                 |
| **Create (new)**             | `cli/src/utils/snippet-parser.ts` _(target repo)_                                                                                                                                                              | Implement layered regex parsing for `askUser`, `askAgent`, and `var` syntax, returning `ParsedSnippet[]`.                                                                                                                   |
| **Create (new)**             | `cli/src/core/snippet-executor.ts` _(target repo)_                                                                                                                                                             | Execute snippets sequentially, invoking `inquirer` and `invokeTool()`, and populate execution context maps.                                                                                                                 |
| **Create (new)**             | `cli/src/core/snippet-preprocessor.ts` _(target repo)_                                                                                                                                                         | Orchestrate parser + executor, rewrite template with placeholders, and return transformed template plus context.                                                                                                            |
| **Modify**                   | `cli/src/utils/template.ts` _(target repo)_                                                                                                                                                                    | Add `renderTemplateWithSnippets()` (or equivalent) that runs the preprocessor and merges context before Handlebars interpolation.                                                                                           |
| **Modify (templates)**       | `cli/packages/*/templates/*.hbs` _(target repo)_                                                                                                                                                               | Update package templates to use the new snippet syntax (`askUser`, `askAgent`, `var`).                                                                                                                                      |
| **Add Tests**                | `cli/tests/unit/snippet-parser.test.ts`<br>`cli/tests/unit/snippet-executor.test.ts`<br>`cli/tests/unit/destinations.test.ts`<br>`cli/tests/integration/template-preprocessing.test.ts` _(target repo)_        | Ensure coverage for parser edge cases, executor behaviors, destination safety, and end-to-end rendering.                                                                                                                    |
| **Exclude / Remove**         | YAML artifacts (`cli/src/core/task-runner.ts` pipeline portions, `cli/src/utils/task-loader.ts`, `cli/src/core/task-fallback.ts`, `cli/src/types/task.ts`, `cli/packages/*/tasks/*.yaml`) _(source repo only)_ | These files are deliberately left out in the new CLI project; functionality superseded by template snippets.                                                                                                                |

1. **Snippet Parser**: Scans template text for supported snippet patterns and produces a structured execution plan.
2. **Snippet Executor**: Runs snippets sequentially, calling:
   - `inquirer` prompts for `askUser`.
   - `invokeTool()` for `askAgent`, using existing safe-mode logic and config-provided tool specs.
3. **Template Transformer**: Replaces snippet source in the template with handlebars-friendly placeholders (e.g., `{{vars.answerId}}`).
4. **Renderer**: Calls `handlebars.compile()` with augmented context (snippet results + variables) to render the final output.

### Reused Modules

- `cli/src/utils/tool-runner.ts`: Keeps command invocation, safe arguments, env expansion, JSON parsing.
- `cli/src/utils/tool-output.ts`: Provides consistent formatting for logged tool results (used by CLI commands).
- `cli/src/utils/config.ts`: Portions that define `ToolSpec`, tool defaults, `computeOutputTargets()`, `selectPrimaryTool()`, and destination resolution.
- Safe write/path helpers currently inside `task-runner.ts` (to be extracted into a dedicated module, e.g., `core/destinations.ts`).

### CLI Integration

- `tz run` / `tz apply` modules call a new renderer facade (e.g., `renderPackageTemplates`) that:
  - Loads the template file.
  - Runs the snippet preprocessing pipeline with `PreprocessOptions` derived from user config and manifest data.
  - Writes outputs using the existing destination safety logic.

## 6. Detailed Design

### 6.1 Snippet Syntax Specification

| Pattern                                                         | Description                                                          | Example                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| `{{ askUser('Question?') }}`                                    | Inline user prompt returning string.                                 | `{{ askUser('What is your name?') }}`                   |
| `{{ askUser('Question?', { default: 'Anon' }) }}`               | Optional JSON-style options (default, placeholder).                  | `{{ askUser('Team?', { default: 'Platform' }) }}`       |
| `{{ askAgent('templates/prompt.txt') }}`                        | Invoke primary tool with prompt (inline text or file path).          | `{{ askAgent('prompts/summary.txt') }}`                 |
| `{{ askAgent('prompt text', { json: true, tool: 'claude' }) }}` | Request JSON parse and/or tool override.                             | `{{ askAgent('summarize this repo', { json: true }) }}` |
| `{{ var summary = askAgent(...) }}`                             | Assign snippet result to a variable for reuse.                       | `{{ var audit = askAgent('prompts/audit.txt') }}`       |
| `{{ summary.key }}`                                             | Use assigned variable later in template.                             | `{{ audit.result }}`                                    |
| `{{ askAgent("""long\nprompt""") }}`                            | Triple-quoted literal for multi-line prompts without separate files. | `{{ askAgent("""Summarize:\n{{facts}}""") }}`           |

Notes:

- Variable names must match `/^\w+$/`.
- Options object syntax mirrors JSON (double-quoted keys/strings); parser will use `JSON.parse`.
- For `askAgent(..., { json: true })`, the executor returns parsed JSON; otherwise trimmed string output.
- Triple-quoted strings treat interior newlines literally; parser must normalize indentation akin to template text.
- Future extension hooks: support structured output validation (`schema`) and parallel execution hints.

### 6.2 Parser Module (`cli/src/utils/snippet-parser.ts`)

- Inputs: raw template string.
- Outputs: ordered list of `ParsedSnippet` containing:
  - `id`: unique identifier (`snippet_0`, `snippet_1`, …).
  - `type`: `'askUser' | 'askAgent'`.
  - `raw`: original snippet text.
  - `startIndex`/`endIndex`.
  - `args`: typed argument payload (question, default, prompt, json flag, tool override, var name).
- Responsibilities:
  - Use layered regex matching (most specific → least) for different syntax forms.
  - Parse options via `JSON.parse` with error wrapping (`TerrazulError`).
  - Recognize triple-quoted multi-line literals and convert them to raw string payloads (preserving newline characters).
  - Reject unsupported constructs with descriptive errors.

### 6.3 Snippet Executor (`cli/src/core/snippet-executor.ts`)

- Inputs: `ParsedSnippet[]`, execution options (projectDir, packageDir, currentTool spec, available tools, safeMode flag).
- Process:
  - Maintain an in-memory cache keyed by `{ toolType, promptText, jsonFlag, schemaId }` to avoid duplicate `askAgent` invocations during a single render.
  - Execute snippets sequentially to preserve ordering and allow variables to depend on previous results.
  - For `askUser`:
    - Use `inquirer.prompt` (single input) with optional default.
    - Store result as string.
  - For `askAgent`:
    - Resolve prompt text:
      - Inline string → use directly.
      - Relative path (e.g., `templates/...`, `prompts/...`) → read from package directory.
    - Determine tool spec:
      - Use `tool` override if provided.
      - Otherwise use current tool (from profile or `--tool` override).
    - Consult cache before execution; if miss, call `invokeTool()` with safe-mode flag and store result.
    - Parse output with `parseToolOutput()` using `json` flag to select mode.
    - If snippet specifies `schema`, validate parsed data via Zod (or compatible) schema to surface structured-output issues early.
    - Return validated JSON or trimmed text; cache stores post-validation value.
  - Capture errors per snippet and include `error` field so renderers can surface issues gracefully.
  - Maintain `ExecutionContext` (two maps):
    - `snippets[id] = { value, error }`.
    - `vars[name] = value` for variable assignments.

### 6.4 Snippet Preprocessor (`cli/src/core/snippet-preprocessor.ts`)

- Orchestrates the pipeline:
  1. Parse snippets.
  2. Execute them.
  3. Replace snippet raw text with placeholder expressions:
     - `{{ snippets.snippet_0.value }}` for inline forms.
     - `{{ vars.varName }}` for `var` assignments.
  4. Return transformed template string + execution context for merging into render context.
- Replacement occurs in reverse index order to avoid offset issues.

### 6.5 Renderer Integration (`cli/src/utils/template.ts`)

- Extend existing module with:
  - `renderTemplateWithSnippets(templatePath, baseContext, options)`:
    1. Read raw template.
    2. If `enableSnippets`, call preprocessor with `PreprocessOptions`.
    3. Merge contexts:
       ```ts
       const fullContext = {
         ...baseContext,
         snippets: execContext.snippets,
         vars: execContext.vars,
       };
       ```
    4. Call `interpolate()` (existing Handlebars compiler) with the transformed template and full context.
- Keep current helpers registration (`eq`, `json`, `findById`).

### 6.6 Destination Safety & File Writes

- Extract from `task-runner.ts` the utilities that ensure:
  - `resolveWritePath()` respects `context.files` mapping.
  - `ensureFileDestination()` handles directories/symlinks and chooses default filenames per tool.
  - `safeResolveWithin()` prevents path traversal.
- Repackage into `cli/src/core/destinations.ts` (new) and reuse in both `run` and `apply` flows.

### 6.7 CLI Command Updates

- `cli/src/commands/run.ts` and `cli/src/commands/apply.ts`:
  - Remove references to YAML task execution (`runTask`, `buildFallbackTaskSpec`).
  - Instead, determine the set of templates per package (from manifest exports or default file list) and call the new renderer for each.
  - Keep logging of tool outputs using `formatToolAskOutput()` for verbose mode.
  - Respect existing flags (`--tool`, `--profile`, `--dry-run`, `--force`, `--no-tool-safe-mode`).

### 6.8 Error Handling

- Parser: throw `TerrazulError(ErrorCode.INVALID_ARGUMENT, message)` for malformed snippets/options.
- Executor: wrap I/O errors (`FILE_NOT_FOUND`, `TOOL_EXECUTION_FAILED`, etc.) for clarity.
- Renderer: bubble up `TerrazulError` to CLI command which already formats user-friendly output.
- When snippet execution fails, renderers should insert placeholder text (e.g., `(error: message)`) so the template does not crash. Logging should include the snippet ID and error.

### 6.9 Extensibility Hooks

- Snippet parser design allows additional helpers (e.g., `askAgentParallel`, `loadFact`) by adding new regex patterns and execution handlers.
- Executor can later batch specific snippets with `Promise.all()` if we add metadata for parallel groups.
- Context merging leaves room for additional namespaces (`facts`, `resources`) if needed.

## 7. Implementation Plan & Milestones

| Phase                      | Duration | Deliverables                                                                                                                                                                                                                                              |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Foundations             | Week 1   | - Port `tool-runner.ts`, `tool-output.ts`, config helpers.<br>- Extract destination safety utilities into `core/destinations.ts`.<br>- Update imports to compile in new CLI project.                                                                      |
| 2. Parser + Types          | Week 2   | - Create `types/snippet.ts`.<br>- Implement `snippet-parser.ts` with TDD, including triple-quoted literal support.<br>- Unit tests for all supported syntaxes and error cases.                                                                            |
| 3. Executor                | Week 3   | - Implement `snippet-executor.ts` using `invokeTool()`.<br>- Add per-render caching and optional schema validation (Zod) for `askAgent`.<br>- Mocked unit tests verifying prompts, tool calls, caching hits/misses, schema enforcement, error capture.    |
| 4. Preprocessor + Renderer | Week 4   | - Implement `snippet-preprocessor.ts` and integrate with `template.ts`.<br>- Update CLI commands to call new renderer.<br>- Integration tests for end-to-end flow (`tz run`, `tz apply`) covering caching reuse and schema validation happy-path/failure. |
| 5. Cleanup & Docs          | Week 5   | - Remove YAML task artifacts.<br>- Update docs/examples (`cli/packages/...` templates).<br>- Write usage guide for new snippet syntax.<br>- Final regression test pass.                                                                                   |

## 8. Testing Strategy

- **Unit Tests**:
  - Parser: synthetic templates covering all snippet forms, triple-quoted literals, malformed JSON, overlapping snippets.
  - Executor: mocks for `inquirer`, `invokeTool`, JSON parsing, schema validation success/failure, caching (ensure duplicate prompts hit cache).
  - Destination utilities: path resolution, symlink handling, fallback filenames.
- **Integration Tests**:
  - Render sample package templates with combined `askUser` + `askAgent`, including multi-line prompts and schema-validated outputs.
  - `run` command ensures outputs written to configured paths, obeying `--dry-run`/`--force`.
  - Error scenario: missing prompt file yields handled error placeholder.
  - Caching scenario: repeated `askAgent` snippet verified to avoid multiple tool invocations (spy on `invokeTool`).
- **Manual Verification**:
  - Run against `cli/packages/mattheu-ctx-default` to ensure parity with previous YAML-driven behavior.
  - Check verbose logging for tool results using `formatToolAskOutput`.
- **Test Tooling**: Continue using Vitest; share fixtures where possible. Mock external commands only where necessary (tool runner already abstracted).

## 9. Rollout Plan

1. Complete implementation behind the scenes; no gating flag needed because YAML logic is already removed in the new repo.
2. Update example package templates and README to demonstrate new snippets.
3. Notify template authors via internal changelog and provide migration guide (YAML → template snippets).
4. Monitor feedback; plan follow-up iteration for advanced helpers if demanded.

## 10. Risks & Mitigations

| Risk                                                              | Impact                                | Mitigation                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Parser misinterprets template content (false positives).          | Broken rendering, unexpected prompts. | Strict regex patterns, unit tests with typical markdown/Handlebars constructs, escape hatch instructions.                |
| Sequential execution slows large templates with many agent calls. | Poor performance for heavy workflows. | Document limitation, design parser to support future parallel extension, consider detection + warning if >N agent calls. |
| Tool invocation regressions (safe mode, env).                     | Security or functionality issues.     | Rely on proven `tool-runner.ts` implementation, add regression tests mirroring previous branch.                          |
| Variable collisions (`vars` namespace).                           | Unexpected overwrites.                | Enforce simple variable naming rules and document best practices; consider warnings on duplicate names.                  |
| CLI command refactor introduces regressions.                      | `tz run`/`apply` break.               | Integration tests + comparison runs with existing packages before merge.                                                 |

## 11. Implementation To‑Do List

- **Setup & Foundations**
- [x] Copy `cli/src/utils/tool-runner.ts` into new CLI repo.
- [x] Copy `cli/src/utils/tool-output.ts` into new CLI repo.
- [x] Extract destination utilities from `task-runner.ts` and create `cli/src/core/destinations.ts`.
- [x] Port required helpers from `cli/src/utils/config.ts` (ToolSpec, defaults, selectors).
- [x] Install `inquirer` and add type definitions.

- **Snippet Types & Parser**
- [x] Create `cli/src/types/snippet.ts` with all interfaces.
- [x] Implement `snippet-parser.ts` supporting simple, options, var assignments, and triple-quoted literals.
- [x] Add unit tests covering valid/invalid cases, escaping, overlapping snippets.

- **Executor & Caching**
- [x] Implement `snippet-executor.ts` with sequential execution.
- [x] Add per-render cache keyed by prompt/tool/options.
- [x] Integrate optional Zod schema validation for `askAgent`.
- [x] Unit tests mocking `invokeTool`, verifying caching hits/misses, schema success/failure, error capture.

- **Preprocessor & Renderer**
- [x] Implement `snippet-preprocessor.ts` orchestrating parser + executor + placeholder substitution.
- [x] Extend `cli/src/utils/template.ts` with `renderTemplateWithSnippets`.
- [x] Ensure context merging exposes `snippets` and `vars`.
- [x] Unit tests for preprocessor transformations and renderer integration.

- **CLI Integration**
- [x] Refactor `cli/src/commands/run.ts` to call snippet renderer and destination helpers.
- [x] Refactor `cli/src/commands/apply.ts` similarly.
- [x] Update logging to keep verbose tool output formatting.

- **Templates & Fixtures**
- [x] Update default package templates (`cli/packages/mattheu-ctx-default/templates`) to new snippet syntax.
  - [ ] Adjust fixtures/tests referencing old YAML pipelines.

- **Testing & Validation**
  - [ ] Integration tests for end-to-end `tz run` with multi-line prompts and caching.
  - [ ] Integration tests for `tz apply` respecting `--dry-run` / `--force`.
  - [ ] Regression tests ensuring safe destination handling.
  - [ ] Manual smoke test with sample repo to confirm outputs.

- **Documentation & Cleanup**
  - [ ] Write usage guide for snippet syntax (README / docs).
  - [ ] Remove YAML-specific files and references from repo.
  - [ ] Record changelog entry announcing snippet-based workflow.

## 11. Open Questions (Resolved)

1. **Multi-line prompt shorthand**: Implement triple-quoted (or equivalent) literal support in v1 so authors can embed long prompts without external files.
2. **Sensitive answer masking**: Defer; current logging can display raw input, and we will revisit masking when confidentiality requirements emerge.
3. **Structured-output validation**: Include optional schema validation (e.g., Zod) in v1 for `askAgent` JSON results to catch malformed tool responses early.
4. **Prompt result caching**: Add per-render caching keyed by prompt hash + tool options to avoid duplicate `askAgent` executions in the same run.
5. **Localization**: Defer localization strategy for `askUser` prompts until broader i18n requirements materialize.
