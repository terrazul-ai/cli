import * as TOML from '@iarna/toml';

import { rewritePath, sanitizeEnv } from '../sanitize';

import type { MCPServerPlan } from '../types';

export function parseCodexMcpServers(
  toml: string,
  projectRootAbs: string,
  origin = '~/.codex/config.toml',
): MCPServerPlan[] {
  let parsed: unknown;
  try {
    parsed = TOML.parse(toml ?? '');
  } catch {
    return [];
  }

  const section =
    parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>).mcp_servers
      : undefined;
  if (!section || typeof section !== 'object') return [];

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

    servers.push({
      id: `codex:${name}`,
      source: 'codex',
      name,
      origin,
      definition: {
        command: rewritePath(commandRaw, projectRootAbs),
        args: sanitizedArgs,
        env: sanitizedEnv ?? {},
      },
    });
  }

  return servers.sort((a, b) => a.id.localeCompare(b.id));
}
