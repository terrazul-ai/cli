import { type ExtractOptions, type ExtractPlan } from '../../core/extract/orchestrator.js';

const ARTIFACT_LABELS: Record<string, string> = {
  'codex.Agents': 'Codex • AGENTS.md',
  'claude.Readme': 'Claude • CLAUDE.md',
  'claude.settings': 'Claude • settings.json',
  'claude.settings.local': 'Claude • settings.local.json',
  'claude.user.settings': 'Claude • user settings',
  'claude.mcp_servers': 'Claude • mcp_servers.json',
  'claude.subagents': 'Claude • agents directory',
  'cursor.rules': 'Cursor • rules',
  copilot: 'GitHub Copilot • instructions',
};

export interface SummaryItem {
  id: string;
  primary: string;
  secondary?: string;
}

export interface SummarySection {
  id: 'artifacts' | 'mcp';
  title: string;
  selectedCount: number;
  totalCount: number;
  items: SummaryItem[];
  emptyLabel: string;
}

export interface DestinationSummary {
  path: string;
  packageName: string;
  version: string;
  dryRun: boolean;
  force: boolean;
}

export interface ReviewSummary {
  sections: SummarySection[];
  destination: DestinationSummary;
}

export interface BuildReviewSummaryParams {
  plan: ExtractPlan;
  selectedArtifacts: Set<string>;
  selectedMcp: Set<string>;
  options: ExtractOptions;
}

export function getArtifactLabel(id: string): string {
  return ARTIFACT_LABELS[id] ?? id;
}

export function getArtifactPreview(id: string): string {
  const label = ARTIFACT_LABELS[id];
  return label ? `${label} (${id})` : id;
}

export function buildReviewSummary({
  plan,
  selectedArtifacts,
  selectedMcp,
  options,
}: BuildReviewSummaryParams): ReviewSummary {
  const artifactOrder = Object.keys(plan.detected);
  const artifactItems: SummaryItem[] = artifactOrder
    .filter((id) => selectedArtifacts.has(id))
    .map((id) => ({
      id,
      primary: getArtifactLabel(id),
      secondary: id,
    }));

  const mcpItems: SummaryItem[] = plan.mcpServers
    .filter((server: { id: string }) => selectedMcp.has(server.id))
    .map(
      (server: { id: string; source: string; name: string; definition: { command: string } }) => ({
        id: server.id,
        primary: `${server.source.toUpperCase()} • ${server.name}`,
        secondary: server.definition.command,
      }),
    );

  const sections: SummarySection[] = [
    {
      id: 'artifacts',
      title: 'Artifacts',
      selectedCount: artifactItems.length,
      totalCount: artifactOrder.length,
      items: artifactItems,
      emptyLabel: artifactOrder.length === 0 ? 'No artifacts detected' : 'No artifacts selected',
    },
    {
      id: 'mcp',
      title: 'MCP Servers',
      selectedCount: mcpItems.length,
      totalCount: plan.mcpServers.length,
      items: mcpItems,
      emptyLabel:
        plan.mcpServers.length === 0 ? 'Plan has no MCP servers' : 'No MCP servers selected',
    },
  ];

  return {
    sections,
    destination: {
      path: options.out,
      packageName: options.name,
      version: options.version,
      dryRun: Boolean(options.dryRun),
      force: Boolean(options.force),
    },
  };
}

export function formatReviewSummaryText(summary: ReviewSummary): string {
  const lines: string[] = [];
  for (const section of summary.sections) {
    const header = `${section.title} • ${section.selectedCount}/${section.totalCount || section.selectedCount} selected`;
    lines.push(header);
    if (section.items.length === 0) {
      lines.push(`  - ${section.emptyLabel}`);
      continue;
    }
    for (const item of section.items) {
      const secondary = item.secondary ? ` (${item.secondary})` : '';
      lines.push(`  - ${item.primary}${secondary}`);
    }
  }
  lines.push(
    'Destination',
    `  - Path: ${summary.destination.path}`,
    `  - Package: ${summary.destination.packageName}@${summary.destination.version}`,
  );
  if (summary.destination.dryRun) {
    lines.push('  - Mode: Dry run');
  }
  if (summary.destination.force) {
    lines.push('  - Overwrite: force enabled');
  }
  return lines.join('\n');
}
