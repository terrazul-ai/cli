import path from 'node:path';

import { valid as isSemverValid } from 'semver';

import { type KeyHint, type SelectableListItem } from './components.js';
import {
  CLAUDE_MCP_ARTIFACT_ID,
  CLAUDE_SUBAGENT_ARTIFACT_ID,
  CODEX_CONFIG_ARTIFACT_ID,
  CODEX_MCP_ARTIFACT_ID,
  OPTION_TOGGLE_CONFIG,
  STEP_CONFIG,
  type OptionToggleId,
} from './extract-wizard-config.js';
import { type WizardState } from './extract-wizard-state.js';
import { buildReviewSummary, getArtifactLabel, type ReviewSummary } from './summary.js';
import {
  getSubagentIdFromSourcePath,
  getSubagentIdFromTemplatePath,
  type ExtractOptions,
  type ExtractPlan,
} from '../../core/extract/orchestrator.js';
import { parseSafePackageName } from '../../utils/path.js';

export interface OptionListItem extends SelectableListItem {
  id: OptionToggleId;
  requiresReanalysis?: boolean;
}

export interface WizardViewModel {
  stepOrder: WizardState['stepOrder'];
  stepIndex: number;
  stepCount: number;
  artifactItems: SelectableListItem[];
  artifactTotalCount: number;
  visibleArtifactCount: number;
  subagentItems: SelectableListItem[];
  subagentTotalCount: number;
  selectedSubagentCount: number;
  mcpItems: SelectableListItem[];
  mcpTotalCount: number;
  selectedMcpCount: number;
  optionItems: OptionListItem[];
  optionSelectedCount: number;
  metadataError: string | null;
  primaryDisabled: boolean;
  actionWarning: string | null;
  reviewSummary: ReviewSummary | null;
}

export function buildWizardViewModel(state: WizardState): WizardViewModel {
  const { plan, selections, availability, options, status, step } = state;

  const artifactItems = buildArtifactItems(plan, availability.artifacts, selections.artifacts);
  const subagentItems = buildSubagentItems(plan, selections.subagents);
  const mcpItems = buildMcpItems(plan, selections.mcpServers);
  const optionItems = buildOptionItems(options);

  const visibleArtifactCount = selections.artifacts.size;
  const metadataError = computeMetadataError(options);
  const primaryDisabled = computePrimaryDisabled(status, step, metadataError, visibleArtifactCount);
  const actionWarning = computeActionWarning(step, metadataError, visibleArtifactCount);

  const stepOrder = state.stepOrder;
  const stepIndex = Math.max(stepOrder.indexOf(state.step), 0);
  const stepCount = stepOrder.length || 1;

  const reviewSummary = plan
    ? buildReviewSummary({
        plan,
        selectedArtifacts: selections.artifacts,
        selectedMcp: selections.mcpServers,
        options,
      })
    : null;

  return {
    stepOrder,
    stepIndex,
    stepCount,
    artifactItems,
    artifactTotalCount: availability.artifacts.length,
    visibleArtifactCount,
    subagentItems,
    subagentTotalCount: availability.subagents.length,
    selectedSubagentCount: selections.subagents.size,
    mcpItems,
    mcpTotalCount: availability.mcpServers.length,
    selectedMcpCount: selections.mcpServers.size,
    optionItems,
    optionSelectedCount: optionItems.filter((item) => item.selected).length,
    metadataError,
    primaryDisabled,
    actionWarning,
    reviewSummary,
  };
}

export function buildActionHints({
  state,
  view,
  logsVisible,
}: {
  state: WizardState;
  view: WizardViewModel;
  logsVisible: boolean;
}): KeyHint[] {
  const stepConfig = STEP_CONFIG[state.step];
  const hints: KeyHint[] = [
    {
      key: 'Enter',
      label: stepConfig.primaryLabel,
      emphasis: 'primary',
      disabled: view.primaryDisabled,
    },
  ];

  if (view.stepIndex > 0) {
    hints.push({ key: 'Shift+Tab', label: 'Back' });
  }

  switch (state.step) {
    case 'artifacts': {
      const total = view.artifactTotalCount;
      hints.push(
        { key: 'Space', label: 'Toggle', disabled: total === 0 },
        { key: 'A', label: 'Select all', disabled: total === 0 },
        { key: 'N', label: 'Select none', disabled: view.visibleArtifactCount === 0 },
      );
      break;
    }
    case 'subagents': {
      const total = view.subagentTotalCount;
      hints.push(
        { key: 'Space', label: 'Toggle', disabled: total === 0 },
        { key: 'A', label: 'Select all', disabled: total === 0 },
        { key: 'N', label: 'Select none', disabled: view.selectedSubagentCount === 0 },
      );
      break;
    }
    case 'mcp': {
      const total = view.mcpTotalCount;
      hints.push(
        { key: 'Space', label: 'Toggle', disabled: total === 0 },
        { key: 'A', label: 'Select all', disabled: total === 0 },
        { key: 'N', label: 'Select none', disabled: view.selectedMcpCount === 0 },
      );
      break;
    }
    case 'options': {
      const total = view.optionItems.length;
      hints.push({ key: 'Space', label: 'Toggle', disabled: total === 0 });
      break;
    }
    case 'metadata': {
      hints.push({ key: 'Tab', label: 'Next field' });
      break;
    }
    case 'preview': {
      hints.push({ key: 'C', label: 'Copy summary', hidden: !view.reviewSummary });
      break;
    }
    default: {
      break;
    }
  }

  hints.push(
    { key: 'V', label: logsVisible ? 'Hide logs' : 'Show logs' },
    { key: '?', label: 'Help' },
  );

  return hints;
}

export function computeIncludedArtifacts(
  plan: ExtractPlan | null,
  selections: WizardState['selections'],
  options: ExtractOptions,
): string[] {
  const included = new Set(selections.artifacts);
  if (!plan) {
    return [...included];
  }

  if (plan.mcpServers.length > 0 && plan.detected[CLAUDE_MCP_ARTIFACT_ID]) {
    included.add(CLAUDE_MCP_ARTIFACT_ID);
  }

  if (selections.subagents.size > 0 && plan.detected[CLAUDE_SUBAGENT_ARTIFACT_ID]) {
    included.add(CLAUDE_SUBAGENT_ARTIFACT_ID);
  }

  const hasCodexServer = plan.mcpServers.some((server) => server.source === 'codex');
  const codexAvailable = hasCodexServer || Boolean(plan.codexConfigBase);
  const shouldIncludeCodex = Boolean(options.includeCodexConfig) && codexAvailable;
  if (shouldIncludeCodex) {
    if (plan.detected[CODEX_MCP_ARTIFACT_ID]) {
      included.add(CODEX_MCP_ARTIFACT_ID);
    }
    if (plan.detected[CODEX_CONFIG_ARTIFACT_ID]) {
      included.add(CODEX_CONFIG_ARTIFACT_ID);
    }
  }

  return [...included];
}

function buildArtifactItems(
  plan: ExtractPlan | null,
  availableArtifactIds: string[],
  selectedArtifacts: Set<string>,
): SelectableListItem[] {
  if (!plan) return [];
  return availableArtifactIds.map((id) => {
    const detectedEntry = plan.detected[id];
    const detail = Array.isArray(detectedEntry)
      ? detectedEntry.join(', ')
      : (detectedEntry as string | undefined);
    return {
      id,
      label: getArtifactLabel(id),
      detail: detail ?? undefined,
      selected: selectedArtifacts.has(id),
    } satisfies SelectableListItem;
  });
}

function buildSubagentItems(
  plan: ExtractPlan | null,
  selectedSubagents: Set<string>,
): SelectableListItem[] {
  if (!plan) return [];

  const detailMap = new Map<string, string>();
  const detected = plan.detected[CLAUDE_SUBAGENT_ARTIFACT_ID];
  if (Array.isArray(detected)) {
    for (const abs of detected) {
      const id = getSubagentIdFromSourcePath(abs);
      const rel = path.relative(plan.projectRoot, abs).split(path.sep).join('/');
      if (id) {
        detailMap.set(id, rel);
      }
    }
  }

  const outputs = plan.outputs.filter(
    (output) => output.artifactId === CLAUDE_SUBAGENT_ARTIFACT_ID,
  );
  if (outputs.length > 0) {
    const items: SelectableListItem[] = [];
    for (const output of outputs) {
      const id = getSubagentIdFromTemplatePath(output.relativePath);
      if (!id) continue;
      items.push({
        id,
        label: id,
        detail: detailMap.get(id),
        selected: selectedSubagents.has(id),
      });
    }
    return items;
  }

  return [...detailMap.entries()].map(([id, rel]) => ({
    id,
    label: id,
    detail: rel,
    selected: selectedSubagents.has(id),
  }));
}

function buildMcpItems(
  plan: ExtractPlan | null,
  selectedMcpServers: Set<string>,
): SelectableListItem[] {
  if (!plan) return [];
  return plan.mcpServers.map((server) => ({
    id: server.id,
    label: `${server.source.toUpperCase()} • ${server.name}`,
    detail: `${server.definition.command} ${server.definition.args.join(' ')}`.trim(),
    selected: selectedMcpServers.has(server.id),
  }));
}

function buildOptionItems(options: ExtractOptions): OptionListItem[] {
  return OPTION_TOGGLE_CONFIG.map((config) => ({
    id: config.id,
    label: config.label,
    detail: config.detail,
    requiresReanalysis: config.requiresReanalysis,
    selected: Boolean(options[config.id as keyof ExtractOptions]),
  }));
}

function computeMetadataError(options: ExtractOptions): string | null {
  try {
    parseSafePackageName(options.name.trim());
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  if (!isSemverValid(options.version.trim())) {
    return 'Version must be valid semver (e.g., 0.0.0)';
  }

  return null;
}

function computePrimaryDisabled(
  status: WizardState['status'],
  step: WizardState['step'],
  metadataError: string | null,
  visibleArtifactCount: number,
): boolean {
  if (status === 'executing' || status === 'analyzing') return true;
  if (step === 'artifacts') return visibleArtifactCount === 0;
  if (step === 'metadata') return Boolean(metadataError);
  if (step === 'preview') return visibleArtifactCount === 0 || Boolean(metadataError);
  return false;
}

function computeActionWarning(
  step: WizardState['step'],
  metadataError: string | null,
  visibleArtifactCount: number,
): string | null {
  if (step === 'artifacts' && visibleArtifactCount === 0) {
    return 'Select at least one artifact to continue';
  }
  if (step === 'metadata' && metadataError) {
    return metadataError;
  }
  if (step === 'preview' && visibleArtifactCount === 0) {
    return 'Select at least one artifact before extracting';
  }
  return null;
}
