import * as TOML from '@iarna/toml';

import { rewritePath, sanitizeEnv, sanitizeMcpServers } from '../sanitize.js';

import type { CodexBaseConfig, MCPServerPlan } from '../types.js';

export interface CodexConfigExtraction {
  servers: MCPServerPlan[];
  base: CodexBaseConfig | null;
}

export function parseCodexMcpServers(
  toml: string,
  projectRootAbs: string,
  origin = '~/.codex/config.toml',
): CodexConfigExtraction {
  let parsed: unknown;
  try {
    parsed = TOML.parse(toml ?? '');
  } catch {
    return { servers: [], base: null };
  }

  const doc = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};

  const base: CodexBaseConfig = {};

  if (typeof doc.model === 'string') {
    base.model = doc.model;
  }

  if (typeof doc.model_reasoning_effort === 'string') {
    base.model_reasoning_effort = doc.model_reasoning_effort;
  }

  const projectsSection = doc.projects;
  if (projectsSection && typeof projectsSection === 'object') {
    const sanitizedProjects: Record<string, Record<string, unknown>> = {};
    for (const [projKey, projValue] of Object.entries(projectsSection as Record<string, unknown>)) {
      if (!projValue || typeof projValue !== 'object') continue;
      const sanitizedKey = rewritePath(projKey, projectRootAbs);
      const sanitizedValue = sanitizeMcpServers(projValue, projectRootAbs) as Record<
        string,
        unknown
      >;
      sanitizedProjects[sanitizedKey] = sanitizedValue;
    }
    if (Object.keys(sanitizedProjects).length > 0) {
      base.projects = sanitizedProjects;
    }
  }

  const section =
    doc.mcp_servers && typeof doc.mcp_servers === 'object' ? doc.mcp_servers : undefined;
  if (!section || typeof section !== 'object') {
    return { servers: [], base: Object.keys(base).length > 0 ? base : null };
  }

  const servers: MCPServerPlan[] = [];

  for (const [name, value] of Object.entries(section as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const commandRaw = record.command;
    if (typeof commandRaw !== 'string' || commandRaw.trim() === '') continue;

    const argsRaw = Array.isArray(record.args) ? record.args : [];
    const envRaw = record.env && typeof record.env === 'object' ? record.env : undefined;

    const sanitizedArgs = argsRaw
      .filter((arg): arg is string => typeof arg === 'string')
      .map((arg) => rewritePath(arg, projectRootAbs));
    const sanitizedEnv = sanitizeEnv(
      envRaw
        ? Object.fromEntries(
            Object.entries(envRaw as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : undefined,
    );

    const sanitizedCommand = rewritePath(commandRaw, projectRootAbs);
    const config: Record<string, unknown> = { command: sanitizedCommand };
    if (sanitizedArgs.length > 0) config.args = sanitizedArgs;
    if (sanitizedEnv && Object.keys(sanitizedEnv).length > 0) config.env = sanitizedEnv;

    servers.push({
      id: `codex:${name}`,
      source: 'codex',
      name,
      origin,
      definition: {
        command: sanitizedCommand,
        args: sanitizedArgs,
        env: sanitizedEnv ?? {},
      },
      config,
    });
  }

  return {
    servers: servers.sort((a, b) => a.id.localeCompare(b.id)),
    base: Object.keys(base).length > 0 ? base : null,
  };
}

export function renderCodexConfig(base: CodexBaseConfig | null, servers: MCPServerPlan[]): string {
  const doc: TOML.JsonMap = {};
  if (base?.model) doc.model = base.model;
  if (base?.model_reasoning_effort) doc.model_reasoning_effort = base.model_reasoning_effort;
  if (base?.projects && Object.keys(base.projects).length > 0) {
    doc.projects = base.projects as TOML.JsonMap;
  }

  const codexServers = servers.filter((server) => server.source === 'codex');
  if (codexServers.length > 0) {
    const map: Record<string, unknown> = {};
    for (const server of codexServers) {
      const def = server.config ?? {
        command: server.definition.command,
        ...(server.definition.args.length > 0 ? { args: server.definition.args } : {}),
        ...(Object.keys(server.definition.env).length > 0 ? { env: server.definition.env } : {}),
      };
      map[server.name] = structuredClone(def);
    }
    doc.mcp_servers = map as TOML.JsonMap;
  }

  const serialized = TOML.stringify(doc ?? {});
  return serialized.endsWith('\n') ? serialized : `${serialized}\n`;
}
