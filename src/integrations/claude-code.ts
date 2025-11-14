import { exec as execCallback, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { ErrorCode, TerrazulError } from '../core/errors.js';
import { agentModulesPath } from '../utils/path.js';

const exec = promisify(execCallback);

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * Detect if Claude CLI is available in the system PATH
 */
export async function detectClaudeCLI(): Promise<boolean> {
  try {
    await exec('claude --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Aggregate MCP server configs from multiple packages
 */
export async function aggregateMCPConfigs(
  projectRoot: string,
  packageNames: string[],
): Promise<MCPConfig> {
  const aggregated: MCPConfig = {
    mcpServers: {},
  };

  for (const pkgName of packageNames) {
    try {
      const pkgPath = agentModulesPath(projectRoot, pkgName);
      const mcpConfigPath = path.join(pkgPath, 'mcp-config.json');

      // Check if MCP config exists
      try {
        await fs.access(mcpConfigPath);
      } catch {
        // No MCP config for this package, skip
        continue;
      }

      // Read and parse MCP config
      const content = await fs.readFile(mcpConfigPath, 'utf8');
      const config = JSON.parse(content) as MCPConfig;

      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        continue;
      }

      // Merge servers, checking for duplicates
      for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
        if (aggregated.mcpServers[serverName]) {
          throw new TerrazulError(
            ErrorCode.CONFIG_INVALID,
            `Duplicate MCP server name '${serverName}' found in package ${pkgName}`,
          );
        }
        aggregated.mcpServers[serverName] = serverConfig;
      }
    } catch (error) {
      if (error instanceof TerrazulError) {
        throw error;
      }
      // Re-throw JSON parse errors or other issues
      throw new TerrazulError(
        ErrorCode.CONFIG_INVALID,
        `Failed to read MCP config from ${pkgName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return aggregated;
}

/**
 * Generate MCP config file at specified path
 */
export async function generateMCPConfigFile(configPath: string, config: MCPConfig): Promise<void> {
  // Ensure parent directory exists
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });

  // Write config as JSON
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Clean up temporary MCP config file
 */
export async function cleanupMCPConfig(configPath: string): Promise<void> {
  try {
    await fs.unlink(configPath);
  } catch {
    // Ignore errors if file doesn't exist
  }
}

/**
 * Spawn Claude Code CLI with MCP config
 */
export async function spawnClaudeCode(
  mcpConfigPath: string,
  additionalArgs: string[] = [],
  cwd?: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = ['--mcp-config', mcpConfigPath, '--strict-mcp-config', ...additionalArgs];
    const workingDir = cwd || process.cwd();

    // Log the full command for debugging
    console.log(`Executing: claude ${args.join(' ')}`);
    console.log(`Working directory: ${workingDir}`);

    const child = spawn('claude', args, {
      cwd: workingDir,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new TerrazulError(
            ErrorCode.TOOL_NOT_FOUND,
            'Claude CLI not found. Install it from https://claude.com/code',
          ),
        );
      } else {
        reject(error);
      }
    });

    child.on('exit', (code) => {
      resolve(code ?? 0);
    });
  });
}
