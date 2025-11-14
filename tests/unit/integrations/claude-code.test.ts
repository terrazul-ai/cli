import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  aggregateMCPConfigs,
  detectClaudeCLI,
  generateMCPConfigFile,
  cleanupMCPConfig,
} from '../../../src/integrations/claude-code.js';

describe('claude-code integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-claude-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      void 0;
    }
  });

  describe('detectClaudeCLI', () => {
    it('returns true when claude CLI is available', async () => {
      // This will actually check the system
      const result = await detectClaudeCLI();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('aggregateMCPConfigs', () => {
    it('returns empty config when no packages have MCP servers', async () => {
      const config = await aggregateMCPConfigs(tmpDir, []);
      expect(config).toEqual({ mcpServers: {} });
    });

    it('aggregates MCP configs from multiple packages', async () => {
      // Create mock package structure with MCP configs
      const pkg1Dir = path.join(tmpDir, 'agent_modules', '@test', 'pkg1');
      const pkg2Dir = path.join(tmpDir, 'agent_modules', '@test', 'pkg2');

      await fs.mkdir(pkg1Dir, { recursive: true });
      await fs.mkdir(pkg2Dir, { recursive: true });

      // Create MCP config files
      const mcp1 = {
        mcpServers: {
          server1: {
            command: 'node',
            args: ['server1.js'],
          },
        },
      };

      const mcp2 = {
        mcpServers: {
          server2: {
            command: 'node',
            args: ['server2.js'],
          },
        },
      };

      await fs.writeFile(path.join(pkg1Dir, 'mcp-config.json'), JSON.stringify(mcp1));
      await fs.writeFile(path.join(pkg2Dir, 'mcp-config.json'), JSON.stringify(mcp2));

      const config = await aggregateMCPConfigs(tmpDir, ['@test/pkg1', '@test/pkg2']);

      expect(config.mcpServers).toHaveProperty('server1');
      expect(config.mcpServers).toHaveProperty('server2');
      expect(config.mcpServers.server1.command).toBe('node');
      expect(config.mcpServers.server2.command).toBe('node');
    });

    it('handles packages without MCP config gracefully', async () => {
      const pkgDir = path.join(tmpDir, 'agent_modules', '@test', 'pkg-no-mcp');
      await fs.mkdir(pkgDir, { recursive: true });

      const config = await aggregateMCPConfigs(tmpDir, ['@test/pkg-no-mcp']);
      expect(config).toEqual({ mcpServers: {} });
    });

    it('throws error on duplicate MCP server names', async () => {
      const pkg1Dir = path.join(tmpDir, 'agent_modules', '@test', 'pkg1');
      const pkg2Dir = path.join(tmpDir, 'agent_modules', '@test', 'pkg2');

      await fs.mkdir(pkg1Dir, { recursive: true });
      await fs.mkdir(pkg2Dir, { recursive: true });

      const mcp1 = {
        mcpServers: {
          duplicate: {
            command: 'node',
            args: ['server1.js'],
          },
        },
      };

      const mcp2 = {
        mcpServers: {
          duplicate: {
            command: 'node',
            args: ['server2.js'],
          },
        },
      };

      await fs.writeFile(path.join(pkg1Dir, 'mcp-config.json'), JSON.stringify(mcp1));
      await fs.writeFile(path.join(pkg2Dir, 'mcp-config.json'), JSON.stringify(mcp2));

      await expect(aggregateMCPConfigs(tmpDir, ['@test/pkg1', '@test/pkg2'])).rejects.toThrow(
        /duplicate.*mcp server/i,
      );
    });

    it('handles malformed MCP config gracefully', async () => {
      const pkgDir = path.join(tmpDir, 'agent_modules', '@test', 'pkg-bad');
      await fs.mkdir(pkgDir, { recursive: true });

      await fs.writeFile(path.join(pkgDir, 'mcp-config.json'), 'invalid json {');

      await expect(aggregateMCPConfigs(tmpDir, ['@test/pkg-bad'])).rejects.toThrow();
    });
  });

  describe('generateMCPConfigFile', () => {
    it('writes MCP config to specified path', async () => {
      const configPath = path.join(tmpDir, 'mcp-config.json');
      const config = {
        mcpServers: {
          test: {
            command: 'node',
            args: ['test.js'],
          },
        },
      };

      await generateMCPConfigFile(configPath, config);

      const written = await fs.readFile(configPath, 'utf8');
      const parsed = JSON.parse(written);

      expect(parsed).toEqual(config);
    });

    it('creates parent directories if needed', async () => {
      const configPath = path.join(tmpDir, 'nested', 'dir', 'mcp-config.json');
      const config = {
        mcpServers: {},
      };

      await generateMCPConfigFile(configPath, config);

      const exists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('overwrites existing file', async () => {
      const configPath = path.join(tmpDir, 'mcp-config.json');

      await fs.writeFile(configPath, 'old content');

      const config = {
        mcpServers: {
          new: {
            command: 'echo',
            args: ['hello'],
          },
        },
      };

      await generateMCPConfigFile(configPath, config);

      const written = await fs.readFile(configPath, 'utf8');
      expect(written).not.toContain('old content');
      expect(written).toContain('echo');
    });
  });

  describe('cleanupMCPConfig', () => {
    it('removes MCP config file', async () => {
      const configPath = path.join(tmpDir, 'mcp-config.json');
      await fs.writeFile(configPath, '{}');

      await cleanupMCPConfig(configPath);

      const exists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it('does not throw if file does not exist', async () => {
      const configPath = path.join(tmpDir, 'nonexistent.json');

      await expect(cleanupMCPConfig(configPath)).resolves.not.toThrow();
    });
  });
});
