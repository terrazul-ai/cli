import { rewritePath, sanitizeEnv } from '../sanitize.js';

import type { MCPServerPlan } from '../types.js';

export function parseProjectMcpServers(
  json: unknown,
  projectRootAbs: string,
  origin = '.mcp.json',
): MCPServerPlan[] {
  let parsed: unknown = json;
  if (typeof json === 'string') {
    try {
      parsed = JSON.parse(json);
    } catch {
      return [];
    }
  }

  if (!parsed || typeof parsed !== 'object') return [];
  const rootRecord = parsed as Record<string, unknown>;
  const serversSection = rootRecord.mcpServers;
  if (!serversSection || typeof serversSection !== 'object') return [];

  const servers: MCPServerPlan[] = [];

  for (const [name, value] of Object.entries(serversSection as Record<string, unknown>)) {
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
      id: `project:${name}`,
      source: 'project',
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
