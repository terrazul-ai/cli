# Extract Wizard State Separation Implementation Plan

## Overview

Refactor the extract wizard to separate presentation, state management, and domain rules so user-facing selections stay pure while derived artifacts are computed on demand. This delivers a maintainable ViewModel-based architecture, eliminates hidden artifact side-effects, and keeps the review summary aligned with visible picks.

## Current State Analysis

- `ExtractWizard` mixes domain data, UI state, and derived execution metadata in one component, populating `selectedArtifacts` with hidden IDs during plan hydration (`src/ui/extract/ExtractWizard.tsx:266-323`).
- Three `useEffect` blocks then mutate `selectedArtifacts` whenever the plan, options, or subagent selections change, auto-adding hidden IDs such as MCP artifacts (`src/ui/extract/ExtractWizard.tsx:375`, `src/ui/extract/ExtractWizard.tsx:392`, `src/ui/extract/ExtractWizard.tsx:415`).
- The wizard computes selection counts by subtracting hidden IDs because the state set blends visible and hidden artifacts (`src/ui/extract/ExtractWizard.tsx:452-469`, `src/ui/extract/ExtractWizard.tsx:1083-1095`).
- Execution wiring forwards `selectedArtifacts` directly to `ExecuteOptions`, so including hidden entries depends on the mutated UI state (`src/ui/extract/ExtractWizard.tsx:602-618`).
- `buildReviewSummary` displays hidden artifacts if they appear in the selection set, creating mismatches with what the user actually toggled (`src/ui/extract/summary.ts:67-118`).
- UI tests assert today’s blended behavior (e.g., expecting hidden IDs inside `includedArtifacts`), so test fixtures must be updated to align with the new separation (`tests/ui/extract-wizard.test.tsx:181-260`).

## Desired End State

The wizard owns distinct layers: a reducer-driven state module for user intent, a ViewModel builder that projects domain data into UI-friendly structures, and a presentation component that consumes that ViewModel. Hidden artifacts are excluded from the stored user selections and are derived via a pure helper at execution time. Review summaries and UI counts reflect only user-visible choices. Tests validate the new data flow and derived artifact inclusion logic.

### Key Discoveries:

- Initial plan hydration currently seeds hidden artifact IDs; removing this requires rethinking `applyPlan` defaults (`src/ui/extract/ExtractWizard.tsx:266-323`).
- Hidden artifact inclusion logic is deterministic and can be re-expressed as pure functions invoked during execution (`src/ui/extract/ExtractWizard.tsx:375-430`).
- Review summary already filters for visible artifact IDs; we can rely on ViewModel inputs to ensure hidden artifacts never reach that layer (`src/ui/extract/summary.ts:67-116`).

## What We're NOT Doing

- No changes to extract orchestrator domain logic or lockfile handling (`src/core/extract/orchestrator.ts`).
- No redesign of wizard step order or introduction of a state-machine library; we confine scope to ViewModel/reducer separation.
- No CLI UX changes beyond selection state accuracy and summary adjustments.
- No alterations to registry, storage, or artifact discovery pipelines.

## Implementation Approach

Adopt a layered architecture: introduce `extract-wizard-state.ts` for reducer/state setup, `extract-wizard-viewmodel.ts` for step-specific projections, and keep `ExtractWizard.tsx` as a thin Ink presentation component. Create pure helpers to compute derived artifacts and execution payloads. Update summary helpers/tests to focus on user-visible choices, and adjust UI tests to assert the new behavior.

## Phase 1: Establish State & ViewModel Layers

### Overview

Extract user intent state and derived helpers into dedicated modules, define clear types, and migrate the component to consume these abstractions.

### Changes Required:

#### 1. State Management Module

**File**: `src/ui/extract/extract-wizard-state.ts`
**Changes**: Create a reducer-based hook (e.g., `useExtractWizardState`) that manages wizard status, plan data, selections (`artifacts`, `subagents`, `mcpServers`), options, and step navigation. Expose typed actions mirroring existing behaviors (toggle, select all/none, cursor moves, metadata edits, etc.). Preserve optimistic plan reuse logic currently in `applyPlan` and `runAnalysis`.

```ts
// extract-wizard-state.ts sketch
export interface WizardSelections {
  artifacts: Set<string>; // visible only
  subagents: Set<string>;
  mcpServers: Set<string>;
}

export interface WizardState {
  status: 'idle' | 'analyzing' | 'executing' | 'completed' | 'error';
  plan: ExtractPlan | null;
  selections: WizardSelections;
  options: ExtractOptions;
  cursors: {
    /* artifact, subagent, mcp, option indices */
  };
  step: StepId;
  metadataFocus: 0 | 1;
  error?: string;
}
```

#### 2. ViewModel Module

**File**: `src/ui/extract/extract-wizard-viewmodel.ts`
**Changes**: Provide pure functions like `buildWizardViewModel(state)` and step-specific helpers (`buildArtifactStepViewModel`). These should compute selectable lists, button states, key hints, and human-readable counts. Ensure visible artifact filtering happens here, not in component state.

```ts
export function buildArtifactStepViewModel(
  plan: ExtractPlan,
  selections: WizardSelections,
): ArtifactStepVM {
  const visibleArtifacts = getVisibleArtifactIds(plan);
  return {
    items: visibleArtifacts.map((id) => ({
      id,
      label: getArtifactLabel(id),
      detail: artifactDetail(plan, id),
      selected: selections.artifacts.has(id),
    })),
    selectedCount: selections.artifacts.size,
    totalCount: visibleArtifacts.length,
    canProceed: selections.artifacts.size > 0,
  };
}
```

#### 3. Types & Utilities

**File**: `src/ui/extract/types.ts` (new) or augment existing constants file if shared types are needed for both state and viewmodel.
**Changes**: Centralize `StepId`, `OptionToggleId`, and shared interfaces to avoid circular imports while keeping presentation lean.

### Success Criteria:

#### Automated Verification:

- [ ] Type checks pass: `pnpm run typecheck`
- [ ] Linting passes: `pnpm run lint:fix`
- [ ] Unit tests updated/added for new state utilities: `pnpm test tests/unit/`
- [ ] UI test suite runs clean: `pnpm test tests/ui/`

#### Manual Verification:

- [ ] Developer can navigate the wizard with the same key bindings and observe identical step flow.
- [ ] Toggling options/subagents/MCP servers behaves as before.

---

## Phase 2: Derived Artifact Computation & Execution Wiring

### Overview

Introduce pure helpers that derive hidden artifacts at execution time and ensure the reducer keeps only visible selections.

### Changes Required:

#### 1. Derived Artifact Helper

**File**: `src/ui/extract/extract-wizard-domain.ts`
**Changes**: Add `computeIncludedArtifacts(plan, selections, options)` encapsulating hidden artifact rules previously scattered across `useEffect` hooks. This function should return a Set including visible selections plus derived IDs (subagents, MCP artifacts, Codex config) using the same detection logic as today.

```ts
export function computeIncludedArtifacts(
  plan: ExtractPlan,
  selections: WizardSelections,
  options: ExtractOptions,
): Set<string> {
  const included = new Set(selections.artifacts);
  if (selections.subagents.size > 0) included.add(CLAUDE_SUBAGENT_ARTIFACT_ID);
  if (selections.mcpServers.size > 0 && plan.mcpServers.length > 0)
    included.add(CLAUDE_MCP_ARTIFACT_ID);
  if (options.includeCodexConfig && hasCodex(plan)) {
    if (plan.detected[CODEX_MCP_ARTIFACT_ID]) included.add(CODEX_MCP_ARTIFACT_ID);
    if (plan.detected[CODEX_CONFIG_ARTIFACT_ID]) included.add(CODEX_CONFIG_ARTIFACT_ID);
  }
  return included;
}
```

#### 2. Execution Payload Builder

**File**: `src/ui/extract/extract-wizard-domain.ts`
**Changes**: Add `buildExecuteOptions(baseOptions, selections, plan)` returning the `ExecuteOptions` object, invoking `computeIncludedArtifacts` and casting sets to arrays. Ensure `includedSubagentFiles` uses `selections.subagents`.

#### 3. Remove Side-Effect Hooks

**File**: `src/ui/extract/ExtractWizard.tsx`
**Changes**: Delete the three `useEffect` blocks that mutate `selectedArtifacts`. Replace `handleExecute` logic to call `buildExecuteOptions`. Ensure visible artifact counts come straight from the ViewModel (no hidden filtering).

### Success Criteria:

#### Automated Verification:

- [ ] New domain helper unit tests validate derived artifact rules.
- [ ] UI tests assert `computeIncludedArtifacts` outcomes by inspecting `execute` call arguments.

#### Manual Verification:

- [ ] Running the wizard with Codex config enabled includes the same artifacts as before (confirm via logs or dry-run output).
- [ ] Selecting/deselecting subagents reflects correctly in final execution payload.

---

## Phase 3: Presentation Component Simplification

### Overview

Refactor `ExtractWizard.tsx` to consume the new state hook and ViewModel, slimming the component down to rendering logic and event wiring.

### Changes Required:

#### 1. Component Rewrite

**File**: `src/ui/extract/ExtractWizard.tsx`
**Changes**: Replace direct `useState`/`useEffect` usage with the reducer hook (`useExtractWizardState`). Map user inputs (keypresses, button actions) to dispatches. Inject ViewModel data into Ink components for list rendering, counts, and action hints. Remove `visibleArtifactCount` calculations; use ViewModel fields instead.

#### 2. Log Panel Integration

Keep log handling (`pushLog`, `LogPanel`) in the component but ensure state updates come from the reducer (e.g., storing `logsVisible` centrally if useful).

#### 3. Metadata Validation

Move validation logic into ViewModel or state hook so the component just displays computed warnings/errors.

### Success Criteria:

#### Automated Verification:

- [ ] UI tests still cover keyboard navigation and execution flows.
- [ ] Snapshot or frame assertions updated for new count text (no hidden artifacts).

#### Manual Verification:

- [ ] Key hint bar renders identical labels/disabled states during manual walkthrough.
- [ ] Wizard prevents progression when required selections are absent, matching prior behavior.

---

## Phase 4: Summary & Test Updates

### Overview

Adjust review summary helpers and all related tests to align with user-visible selections and the new state architecture.

### Changes Required:

#### 1. Summary Helper

**File**: `src/ui/extract/summary.ts`
**Changes**: Update `buildReviewSummary` to rely on the filtered visible artifacts list (already available) without expecting hidden IDs in the selection Set. Remove placeholder entries for hidden artifacts (e.g., the special case inserting `claude.mcp_servers`).

#### 2. Summary Tests

**File**: `tests/ui/extract-summary.test.tsx`
**Changes**: Adjust fixtures so selected artifacts exclude hidden IDs; verify counts reflect only visible selections and Codex inclusion logic now comes from options/plan rather than presence in `selectedArtifacts`.

#### 3. Wizard UI Tests

**File**: `tests/ui/extract-wizard.test.tsx`
**Changes**: Update expectations for `execOptions.includedArtifacts` to confirm derived helper output (visible + derived) despite state holding only visible IDs. Adjust assertions for selection count text to match the simplified `{selected}/{total}` display.

### Success Criteria:

#### Automated Verification:

- [ ] Updated tests pass, showing derived artifacts appear in execution options even though state holds only visible IDs.

#### Manual Verification:

- [ ] Review summary screen shows only user-visible artifact entries while execution still bundles hidden dependencies.

---

## Testing Strategy

### Unit Tests:

- Cover `computeIncludedArtifacts` with permutations of MCP servers, Codex availability, subagent selections, and options flags.
- Test reducer actions in `extract-wizard-state.ts` to ensure toggles/select-all behaviors work without mutating original sets.

### Integration Tests:

- Extend existing Ink UI tests to simulate toggling Codex config/subagents and confirm `execute` receives derived artifacts.
- Add regression test ensuring clearing selections removes derived artifacts from execution payload.

### Manual Testing Steps:

1. Run `tz extract` on a project with MCP servers; select/deselect Codex options and confirm final output (with `--dry-run`) mirrors prior behavior.
2. Verify subagent selection adds/removes the corresponding artifact in the output package when running a real extract.
3. Check review summary displays only visible artifacts and reflects Codex inclusion via separate messaging.

## Performance Considerations

Pure helper functions and memoized ViewModel builders should keep render performance consistent. Avoid re-creating large Sets inside render by memoizing derived data based on stable dependencies.

## Migration Notes

No persisting state or external APIs are impacted. Existing extract runs continue to produce identical outputs because derived artifacts remain included at execution time. Developers should adjust any external scripts or snapshots that depended on hidden IDs being present in UI state.

## References

- Current wizard implementation: `src/ui/extract/ExtractWizard.tsx`
- Summary helper and tests: `src/ui/extract/summary.ts`, `tests/ui/extract-summary.test.tsx`
- UI integration tests: `tests/ui/extract-wizard.test.tsx`
