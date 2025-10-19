# Dynamic askAgent Prompt Interpolation PRD

## 1. Background & Motivation

- Template authors want to chain snippet answers together. Today `askAgent` only accepts literal strings or prompt files, so you cannot incorporate runtime values (e.g., user answers, earlier agent output) into subsequent prompts.
- Packages already rely on `vars.*` during final Handlebars rendering, so aligning prompt construction with that mental model lowers friction and unlocks richer flows.
- Enabling interpolation keeps snippets expressive without reintroducing YAML orchestration.

## 2. Goals

- Allow text-based `askAgent` snippets to reference prior snippet values (`vars`/`snippets`) before invoking a tool.
- Preserve current safety defaults (single-turn directive, safeMode, schema validation, caching) and compatibility for existing templates.
- Maintain sequential execution so variable assignments continue to work predictably.

### Non-Goals

- Changing prompt resolution for file-based prompts (remain raw file contents).
- Adding parallel snippet execution or async Handlebars helpers.
- Introducing new snippet syntax beyond existing `var`, `askUser`, and `askAgent` forms.

## 3. User Stories

1. **Template Author**: “I can capture a user’s answer with `askUser` and reuse it inside a later `askAgent` prompt without creating a separate file.”
2. **CLI User**: “Running `tz run` or `tz apply` still behaves deterministically; only prompt content changes based on prior answers.”
3. **Maintainer**: “Code changes are localized (parser untouched) and covered by unit + integration tests.”

## 4. Requirements

- Textual prompts must interpolate using the latest snippet execution context before tool invocation.
- Interpolation exposes both `vars` (variable assignments) and `snippets` (raw results) namespaces.
- Prompt caching keys on the final interpolated string to avoid stale lookups.
- Feature must be gated to text prompts; file prompts are read verbatim with no interpolation.
- Errors (missing vars, schema failures) propagate through existing `SnippetValue.error` plumbing.
- Dry-run mode mirrors runtime behavior (prompts still interpolate even if we skip file writes).

## 5. Solution Overview

1. **Prompt Preparation**
   - After resolving the base prompt (`text` vs. `file`), text prompts pass through the Handlebars `interpolate` helper with a lightweight context `{ vars, snippets }` derived from the current execution state.
   - File prompts bypass interpolation and use their raw contents.
2. **Execution Flow Adjustments**
   - `executeSnippets` keeps sequential iteration; after each snippet resolves a value, append it to the execution context so subsequent prompts can access it.
   - `buildCacheKey` uses the post-interpolation prompt string to ensure cache accuracy.
3. **Logging & Reporting**
   - Emit the pre-interpolation prompt in snippet events for clarity, plus optionally the final prompt when verbose logging is enabled (future enhancement).

## 6. Detailed Design

### 6.1 Updated Prompt Resolution

- Modify `runAskAgent` in `src/core/snippet-executor.ts`:
  1. Resolve base string (existing logic).
  2. If kind is `text`, call `interpolate` with new context and treat the result as the final prompt.
  3. Apply `enforceSingleTurnDirective` and invoke `invokeTool` as today.
- Keep dedent + file resolution logic untouched.

### 6.2 Execution Context Handling

- No parser changes; variables still recorded when snippets execute.
- Ensure the context object passed to `interpolate` reflects the latest `context.vars` and `context.snippets` maps after each snippet.

### 6.3 Caching Strategy

- Update `buildCacheKey` to incorporate the interpolated prompt string (replacing the base prompt) so memoization respects differing substitutions.
- Continue including tool type, JSON flag, schema references, safeMode, and timeout settings.

### 6.4 Error Surfacing

- Missing variables render as empty strings per Handlebars defaults; consider documenting recommended `{{#if vars.name}}` presence checks in templates.
- Existing schema and parsing errors propagate via `TerrazulError` → `SnippetValue.error` with no additional handling.

## 7. Testing Strategy

- **Unit**: Expand `tests/unit/core/snippet-preprocessor.test.ts` with a case where the second `askAgent` includes `{{ vars.answer }}` and verify `invokeTool` receives the substituted text.
- **Integration**: Add an integration test (e.g., `tests/integration/snippets/dynamic-prompts.test.ts`) that runs `tz apply --dry-run` on a fixture package demonstrating chained prompts.
- **Regression**: Re-run existing snippet parser/executor suites to ensure no regressions for basic prompts, JSON output, and schema validation.

## 8. Rollout & Migration

- Backward compatible; existing templates keep working because literal prompts produce identical output when no `{{ }}` placeholders are present.
- Document the new capability in `docs/tools_in_packages/cli-snippet-preprocessor-prd.md` and the default package README.
- Encourage authors to escape literal `{{` via Handlebars raw blocks (`{{{{raw}}}}`) when needed.

## 9. Open Questions

- Should verbose logging show the final interpolated prompt (potentially containing secrets)? Current plan keeps logging the base prompt only. - thats fine.
- Do we need an opt-out flag for templates that prefer literal handling? (Deferred until authors request.) NO

## 10. Risks & Mitigations

- **Risk**: Sensitive user input may appear in logs if we add verbose prompt output. Mitigation: keep logs at current behavior for now; add redaction if future requirements arise.
- **Risk**: Interpolation errors silently producing empty strings. Mitigation: document best-practice guard clauses (`{{#if vars.answer}}`) and explore an optional “strict” mode in follow-up work.
- **Risk**: Cache misses increase due to dynamic prompts. Mitigation: caching still deduplicates identical substitutions; overhead is limited to string hashing.
