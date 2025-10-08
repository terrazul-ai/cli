import { getPlanSubagentIds, type ExtractPlan } from '../../core/extract/orchestrator.js';

export const CLAUDE_SUBAGENT_ARTIFACT_ID = 'claude.subagents';
export const CLAUDE_MCP_ARTIFACT_ID = 'claude.mcp_servers';
export const CODEX_MCP_ARTIFACT_ID = 'codex.mcp_servers';
export const CODEX_CONFIG_ARTIFACT_ID = 'codex.config';

export const HIDDEN_ARTIFACT_IDS: ReadonlySet<string> = new Set([
  CLAUDE_SUBAGENT_ARTIFACT_ID,
  CLAUDE_MCP_ARTIFACT_ID,
  CODEX_MCP_ARTIFACT_ID,
  CODEX_CONFIG_ARTIFACT_ID,
]);

export type StepId =
  | 'artifacts'
  | 'subagents'
  | 'mcp'
  | 'output'
  | 'metadata'
  | 'options'
  | 'preview';

export type OptionToggleId =
  | 'includeClaudeLocal'
  | 'includeClaudeUser'
  | 'includeCodexConfig'
  | 'dryRun'
  | 'force';

export interface OptionToggleConfig {
  id: OptionToggleId;
  label: string;
  detail: string;
  requiresReanalysis?: boolean;
}

export const OPTION_TOGGLE_CONFIG: OptionToggleConfig[] = [
  {
    id: 'includeClaudeLocal',
    label: 'Include .claude/settings.local.json',
    detail: 'Adds user-specific Claude configuration to the bundle.',
    requiresReanalysis: true,
  },
  {
    id: 'includeClaudeUser',
    label: 'Include Claude user settings',
    detail: 'Copies user-scoped Claude settings alongside package assets.',
    requiresReanalysis: true,
  },
  {
    id: 'includeCodexConfig',
    label: 'Include ~/.codex/config.toml',
    detail: 'Adds user-specific Codex configuration to the bundle.',
    requiresReanalysis: true,
  },
  {
    id: 'dryRun',
    label: 'Dry run',
    detail: 'Preview actions without writing to disk.',
  },
  {
    id: 'force',
    label: 'Force overwrite',
    detail: 'Overwrite non-empty directories in the destination.',
  },
];

export interface StepConfig {
  title: string;
  instruction: string;
  primaryLabel: string;
}

export const STEP_CONFIG: Record<StepId, StepConfig> = {
  artifacts: {
    title: 'Select Artifacts',
    instruction: 'Choose which detected artifacts to include. Use ↑/↓ to move, Space to toggle.',
    primaryLabel: 'Continue',
  },
  subagents: {
    title: 'Select Claude Agent Files',
    instruction: 'Toggle Claude agent files from .claude/agents to include in the package.',
    primaryLabel: 'Continue',
  },
  mcp: {
    title: 'Select MCP Servers',
    instruction: 'Choose MCP servers to bundle with this extract.',
    primaryLabel: 'Continue',
  },
  output: {
    title: 'Choose Output Directory',
    instruction: 'Confirm or update the destination directory for the extracted package.',
    primaryLabel: 'Continue',
  },
  metadata: {
    title: 'Confirm Package Metadata',
    instruction: 'Review and update the package name and version before continuing.',
    primaryLabel: 'Continue',
  },
  options: {
    title: 'Toggle Options',
    instruction: 'Enable optional behaviors for this run. Use ↑/↓ to move, Space to toggle.',
    primaryLabel: 'Continue',
  },
  preview: {
    title: 'Review & Extract',
    instruction: 'Double-check selections before extracting the package.',
    primaryLabel: 'Extract package',
  },
};

export function computeStepOrder(plan: ExtractPlan | null): StepId[] {
  const order: StepId[] = ['artifacts'];
  if (plan && getPlanSubagentIds(plan).length > 0) {
    order.push('subagents');
  }
  if (plan && plan.mcpServers.length > 0) {
    order.push('mcp');
  }
  order.push('output', 'metadata', 'options', 'preview');
  return order;
}

export function isHiddenArtifactId(id: string): boolean {
  return HIDDEN_ARTIFACT_IDS.has(id);
}
