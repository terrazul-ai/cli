import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as TOML from '@iarna/toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  analyzeExtractSources,
  executeExtract,
  performExtract,
} from '../../../src/core/extract/orchestrator';
import { createLogger } from '../../../src/utils/logger';

interface TempPaths {
  project: string;
  out: string;
  codexConfig: string;
  projectMcp: string;
}

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function setupProject(): Promise<TempPaths> {
  const project = await mkdtemp('tz-plan-proj-');
  const out = await mkdtemp('tz-plan-out-');
  await fs.writeFile(path.join(project, 'AGENTS.md'), `Docs at ${project}/docs`, 'utf8');
  await fs.mkdir(path.join(project, '.claude'), { recursive: true });
  await fs.writeFile(path.join(project, '.claude', 'CLAUDE.md'), `See ${project}/notes`, 'utf8');
  await fs.writeFile(
    path.join(project, '.claude', 'settings.json'),
    JSON.stringify(
      {
        env: { ANTHROPIC_API_KEY: 'secret' },
        permissions: { additionalDirectories: [path.join(project, 'assets')] },
      },
      null,
      2,
    ),
    'utf8',
  );
  await fs.writeFile(
    path.join(project, '.claude', 'mcp_servers.json'),
    JSON.stringify(
      {
        coder: {
          command: path.join(project, 'bin', 'coder'),
          args: ['--workspace', path.join(project, 'workspace')],
          transport: { type: 'stdio' },
          metadata: { keep: 'yes' },
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  await fs.mkdir(path.join(project, '.claude', 'agents'), { recursive: true });
  await fs.writeFile(
    path.join(project, '.claude', 'agents', 'writer.md'),
    `Workspace: ${project}/workspace`,
    'utf8',
  );
  await fs.mkdir(path.join(project, '.cursor', 'rules'), { recursive: true });
  await fs.writeFile(path.join(project, '.cursor', 'rules', 'main.md'), 'rule A', 'utf8');
  await fs.mkdir(path.join(project, '.github'), { recursive: true });
  await fs.writeFile(
    path.join(project, '.github', 'copilot-instructions.md'),
    'help others',
    'utf8',
  );

  const codexConfig = path.join(project, 'codex-config.toml');
  await fs.writeFile(
    codexConfig,
    `
model = "gpt-5-codex"
model_reasoning_effort = "high"
[projects."${project}"]
trust_level = "trusted"
[mcp_servers.embeddings]
command = "${path.join(project, 'bin', 'embeddings')}"
args = ["--model", "${path.join(project, 'models', 'tiny')}"
]
`,
    'utf8',
  );

  const projectMcp = path.join(project, 'project.mcp.json');
  await fs.writeFile(
    projectMcp,
    JSON.stringify(
      {
        mcpServers: {
          search: {
            command: './scripts/search.sh',
            args: ['--index', path.join(project, 'index')],
            env: { SEARCH_KEY: 'abc123' },
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  return { project, out, codexConfig, projectMcp };
}

let paths: TempPaths;

beforeEach(async () => {
  paths = await setupProject();
});

afterEach(async () => {
  const all = [paths.project, paths.out];
  for (const dir of all) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe('analyzeExtractSources', () => {
  it('returns sanitized plan and aggregated MCP servers', async () => {
    const plan = await analyzeExtractSources({
      from: paths.project,
      out: paths.out,
      name: '@you/pkg',
      version: '1.0.0',
      codexConfigPath: paths.codexConfig,
      projectMcpConfigPath: paths.projectMcp,
    });

    expect(plan.projectRoot).toBe(paths.project);
    expect(Object.keys(plan.detected)).toEqual(
      expect.arrayContaining([
        'codex.Agents',
        'claude.Readme',
        'claude.settings',
        'claude.mcp_servers',
        'codex.mcp_config',
      ]),
    );
    expect(plan.manifest.claude?.template).toBe('templates/CLAUDE.md.hbs');
    expect(plan.outputs.some((o) => o.relativePath === 'README.md')).toBe(true);
    const claudeSettings = plan.outputs.find(
      (o) => o.artifactId === 'claude.settings' && o.relativePath.endsWith('settings.json.hbs'),
    );
    expect(claudeSettings).toBeTruthy();
    if (claudeSettings && claudeSettings.format === 'json') {
      const data = claudeSettings.data as Record<string, unknown>;
      expect(JSON.stringify(data)).not.toContain(paths.project);
    }
    expect(plan.mcpServers.map((s) => s.id)).toEqual(
      expect.arrayContaining(['claude:coder', 'codex:embeddings', 'project:search']),
    );
    expect(plan.codexConfigBase).not.toBeNull();
    expect(plan.codexConfigBase?.model).toBe('gpt-5-codex');
    const projectKeys = Object.keys(plan.codexConfigBase?.projects ?? {});
    expect(projectKeys.every((key) => !key.includes(paths.project))).toBe(true);
  });
});

describe('executeExtract', () => {
  it('writes selected artifacts and filters MCP servers', async () => {
    const plan = await analyzeExtractSources({
      from: paths.project,
      out: paths.out,
      name: '@you/pkg',
      version: '1.0.0',
      codexConfigPath: paths.codexConfig,
      projectMcpConfigPath: paths.projectMcp,
    });

    const includedArtifacts = Object.keys(plan.detected);
    const includedMcpServers = plan.mcpServers.map((s) => s.id);
    const logger = createLogger();

    const result = await executeExtract(
      plan,
      {
        from: paths.project,
        out: paths.out,
        name: '@you/pkg',
        version: '1.0.0',
        includedArtifacts,
        includedMcpServers,
      },
      logger,
    );

    const manifest = await fs.readFile(path.join(paths.out, 'agents.toml'), 'utf8');
    expect(manifest).toMatch(/name = "@you\/pkg"/);
    const manifestDoc = TOML.parse(manifest) as Record<string, unknown>;
    const exportsSection = (manifestDoc.exports as Record<string, unknown>) ?? {};
    const codexSection = (exportsSection.codex as Record<string, unknown>) ?? {};
    expect(codexSection.template).toBe('templates/AGENTS.md.hbs');
    expect(codexSection.config).toBe('templates/codex/config.toml.hbs');
    const mcpRaw = JSON.parse(
      await fs.readFile(
        path.join(paths.out, 'templates', 'claude', 'mcp_servers.json.hbs'),
        'utf8',
      ),
    ) as unknown;
    const mcpJson = mcpRaw && typeof mcpRaw === 'object' ? (mcpRaw as Record<string, unknown>) : {};
    expect(Object.keys(mcpJson)).toEqual(['coder', 'embeddings', 'search']);
    expect(JSON.stringify(mcpJson)).not.toContain(paths.project);
    const coder =
      mcpJson.coder && typeof mcpJson.coder === 'object'
        ? (mcpJson.coder as Record<string, unknown>)
        : {};
    expect(coder.transport).toEqual({ type: 'stdio' });
    expect(coder.metadata).toEqual({ keep: 'yes' });
    expect(result.summary.outputs).toEqual(
      expect.arrayContaining([
        'templates/claude/mcp_servers.json.hbs',
        'templates/codex/config.toml.hbs',
      ]),
    );

    const codexToml = await fs.readFile(
      path.join(paths.out, 'templates', 'codex', 'config.toml.hbs'),
      'utf8',
    );
    const codexConfig = TOML.parse(codexToml ?? '') as Record<string, unknown>;
    expect(codexConfig).toHaveProperty('mcp_servers');
    const codexServers = codexConfig.mcp_servers as Record<string, unknown>;
    expect(Object.keys(codexServers)).toEqual(['embeddings']);
    const embeddings =
      codexServers.embeddings && typeof codexServers.embeddings === 'object'
        ? (codexServers.embeddings as Record<string, unknown>)
        : {};
    expect(JSON.stringify(embeddings)).not.toContain(paths.project);

    // Legacy performExtract should still succeed and produce same manifest when everything included
    const legacy = await performExtract(
      {
        from: paths.project,
        out: paths.out,
        name: '@you/pkg',
        version: '1.0.0',
        force: true,
        codexConfigPath: paths.codexConfig,
        projectMcpConfigPath: paths.projectMcp,
      },
      logger,
    );
    expect(legacy.summary.manifest).toEqual(result.summary.manifest);
  });
  it('filters MCP servers when subset selected', async () => {
    const plan = await analyzeExtractSources({
      from: paths.project,
      out: paths.out,
      name: '@you/pkg',
      version: '1.0.0',
      codexConfigPath: paths.codexConfig,
      projectMcpConfigPath: paths.projectMcp,
    });

    const includedArtifacts = Object.keys(plan.detected);
    const includedMcpServers = ['claude:coder', 'project:search'];
    const logger = createLogger();

    await executeExtract(
      plan,
      {
        from: paths.project,
        out: paths.out,
        name: '@you/pkg',
        version: '1.0.0',
        includedArtifacts,
        includedMcpServers,
        force: true,
      },
      logger,
    );

    const mcpRaw = JSON.parse(
      await fs.readFile(
        path.join(paths.out, 'templates', 'claude', 'mcp_servers.json.hbs'),
        'utf8',
      ),
    ) as unknown;
    const mcpJson = mcpRaw && typeof mcpRaw === 'object' ? (mcpRaw as Record<string, unknown>) : {};
    expect(Object.keys(mcpJson)).toEqual(['coder', 'search']);
    const coder =
      mcpJson.coder && typeof mcpJson.coder === 'object'
        ? (mcpJson.coder as Record<string, unknown>)
        : {};
    expect(coder.transport).toEqual({ type: 'stdio' });
    expect(coder.metadata).toEqual({ keep: 'yes' });

    const codexToml = await fs.readFile(
      path.join(paths.out, 'templates', 'codex', 'config.toml.hbs'),
      'utf8',
    );
    const codexConfig = TOML.parse(codexToml ?? '') as Record<string, unknown>;
    expect(codexConfig.mcp_servers ?? {}).toEqual({});
  });
});
