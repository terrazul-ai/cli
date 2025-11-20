import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  injectPackageContext,
  removePackageContext,
  hasPackageContext,
  type PackageInfo,
} from '../../../src/utils/context-file-injector';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function write(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, 'utf8');
}

describe('utils/context-file-injector', () => {
  let projectRoot = '';

  beforeEach(async () => {
    projectRoot = await mkdtemp('tz-injector');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true }).catch(() => {});
  });

  describe('injectPackageContext', () => {
    it('injects package context into new file', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      const packageFiles = new Map([
        ['@test/pkg1', [path.join(projectRoot, 'agent_modules/@test/pkg1/CLAUDE.md')]],
      ]);
      const packages: PackageInfo[] = [
        {
          name: '@test/pkg1',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules/@test/pkg1'),
        },
      ];

      const result = await injectPackageContext(filePath, projectRoot, packageFiles, packages);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('<!-- terrazul:begin -->');
      expect(content).toContain('@agent_modules/@test/pkg1/CLAUDE.md');
      expect(content).toContain('<!-- terrazul:end -->');
    });

    it('injects package context into existing file with content', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(filePath, '# Existing Content\n\nSome text here.');

      const packageFiles = new Map([
        ['@test/pkg1', [path.join(projectRoot, 'agent_modules/@test/pkg1/CLAUDE.md')]],
      ]);
      const packages: PackageInfo[] = [
        {
          name: '@test/pkg1',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules/@test/pkg1'),
        },
      ];

      const result = await injectPackageContext(filePath, projectRoot, packageFiles, packages);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('# Existing Content');
      expect(content).toContain('@agent_modules/@test/pkg1/CLAUDE.md');
    });

    it('is idempotent - does not modify if already injected', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      const packageFiles = new Map([
        ['@test/pkg1', [path.join(projectRoot, 'agent_modules/@test/pkg1/CLAUDE.md')]],
      ]);
      const packages: PackageInfo[] = [
        {
          name: '@test/pkg1',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules/@test/pkg1'),
        },
      ];

      // First injection
      const result1 = await injectPackageContext(filePath, projectRoot, packageFiles, packages);
      expect(result1.modified).toBe(true);
      const content1 = await fs.readFile(filePath, 'utf8');

      // Second injection with same data
      const result2 = await injectPackageContext(filePath, projectRoot, packageFiles, packages);
      expect(result2.modified).toBe(false);
      const content2 = await fs.readFile(filePath, 'utf8');

      expect(content1).toBe(content2);
    });

    it('filters out non-context files (agents/, commands/, MCP configs)', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      const packageFiles = new Map([
        [
          '@test/pkg1',
          [
            path.join(projectRoot, 'agent_modules/@test/pkg1/CLAUDE.md'),
            path.join(projectRoot, 'agent_modules/@test/pkg1/agents/foo.md'),
            path.join(projectRoot, 'agent_modules/@test/pkg1/commands/bar.md'),
            path.join(projectRoot, 'agent_modules/@test/pkg1/mcp-config.json'),
          ],
        ],
      ]);
      const packages: PackageInfo[] = [
        {
          name: '@test/pkg1',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules/@test/pkg1'),
        },
      ];

      const result = await injectPackageContext(filePath, projectRoot, packageFiles, packages);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');

      // Should include CLAUDE.md
      expect(content).toContain('@agent_modules/@test/pkg1/CLAUDE.md');

      // Should NOT include other files
      expect(content).not.toContain('agents/foo.md');
      expect(content).not.toContain('commands/bar.md');
      expect(content).not.toContain('mcp-config.json');
    });

    it('supports dry run mode', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      const packageFiles = new Map([
        ['@test/pkg1', [path.join(projectRoot, 'agent_modules/@test/pkg1/CLAUDE.md')]],
      ]);
      const packages: PackageInfo[] = [
        {
          name: '@test/pkg1',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules/@test/pkg1'),
        },
      ];

      const result = await injectPackageContext(filePath, projectRoot, packageFiles, packages, {
        dryRun: true,
      });

      expect(result.modified).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content).toContain('@agent_modules/@test/pkg1/CLAUDE.md');

      // File should not exist (dry run)
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it('handles multiple packages sorted alphabetically', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      const packageFiles = new Map([
        ['@test/zebra', [path.join(projectRoot, 'agent_modules/@test/zebra/CLAUDE.md')]],
        ['@test/apple', [path.join(projectRoot, 'agent_modules/@test/apple/CLAUDE.md')]],
        ['@test/middle', [path.join(projectRoot, 'agent_modules/@test/middle/CLAUDE.md')]],
      ]);
      const packages: PackageInfo[] = [
        {
          name: '@test/zebra',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules/@test/zebra'),
        },
        {
          name: '@test/apple',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules/@test/apple'),
        },
        {
          name: '@test/middle',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules/@test/middle'),
        },
      ];

      const result = await injectPackageContext(filePath, projectRoot, packageFiles, packages);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');

      // Check order (should be alphabetical)
      const appleIndex = content.indexOf('@agent_modules/@test/apple/CLAUDE.md');
      const middleIndex = content.indexOf('@agent_modules/@test/middle/CLAUDE.md');
      const zebraIndex = content.indexOf('@agent_modules/@test/zebra/CLAUDE.md');

      expect(appleIndex).toBeLessThan(middleIndex);
      expect(middleIndex).toBeLessThan(zebraIndex);
    });
  });

  describe('removePackageContext', () => {
    it('removes package context from file', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      const packageFiles = new Map([
        ['@test/pkg1', [path.join(projectRoot, 'agent_modules/@test/pkg1/CLAUDE.md')]],
      ]);
      const packages: PackageInfo[] = [
        {
          name: '@test/pkg1',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules/@test/pkg1'),
        },
      ];

      await injectPackageContext(filePath, projectRoot, packageFiles, packages);

      const result = await removePackageContext(filePath);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).not.toContain('<!-- terrazul:begin -->');
      expect(content).not.toContain('@agent_modules/@test/pkg1/CLAUDE.md');
    });

    it('preserves existing content when removing context', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(filePath, '# Existing Content\n\nSome text here.');

      const packageFiles = new Map([
        ['@test/pkg1', [path.join(projectRoot, 'agent_modules/@test/pkg1/CLAUDE.md')]],
      ]);
      const packages: PackageInfo[] = [
        {
          name: '@test/pkg1',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules/@test/pkg1'),
        },
      ];

      await injectPackageContext(filePath, projectRoot, packageFiles, packages);

      const result = await removePackageContext(filePath);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('# Existing Content');
      expect(content).toContain('Some text here');
      expect(content).not.toContain('terrazul:begin');
    });

    it('returns false if no context block is present', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(filePath, '# Content without terrazul block');

      const result = await removePackageContext(filePath);

      expect(result.modified).toBe(false);
    });
  });

  describe('hasPackageContext', () => {
    it('returns true if context is present', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      const packageFiles = new Map([
        ['@test/pkg1', [path.join(projectRoot, 'agent_modules/@test/pkg1/CLAUDE.md')]],
      ]);
      const packages: PackageInfo[] = [
        {
          name: '@test/pkg1',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules/@test/pkg1'),
        },
      ];

      await injectPackageContext(filePath, projectRoot, packageFiles, packages);

      const result = await hasPackageContext(filePath);

      expect(result).toBe(true);
    });

    it('returns false if context is not present', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(filePath, '# Content without terrazul block');

      const result = await hasPackageContext(filePath);

      expect(result).toBe(false);
    });

    it('returns false if file does not exist', async () => {
      const filePath = path.join(projectRoot, 'NONEXISTENT.md');

      const result = await hasPackageContext(filePath);

      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty package files map', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      const packageFiles = new Map<string, string[]>();
      const packages: PackageInfo[] = [];

      const result = await injectPackageContext(filePath, projectRoot, packageFiles, packages);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('<!-- terrazul:begin -->');
      expect(content).toContain('<!-- terrazul:end -->');
      // Should have no @-mentions
      expect(content).not.toContain('@agent_modules');
    });

    it('handles package with no CLAUDE.md/AGENTS.md files', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      const packageFiles = new Map([
        [
          '@test/pkg1',
          [
            // Only non-context files
            path.join(projectRoot, 'agent_modules/@test/pkg1/agents/foo.md'),
            path.join(projectRoot, 'agent_modules/@test/pkg1/commands/bar.md'),
          ],
        ],
      ]);
      const packages: PackageInfo[] = [
        {
          name: '@test/pkg1',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules/@test/pkg1'),
        },
      ];

      const result = await injectPackageContext(filePath, projectRoot, packageFiles, packages);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      // Should have markers but no @-mentions
      expect(content).toContain('<!-- terrazul:begin -->');
      expect(content).not.toContain('@agent_modules/@test/pkg1');
    });
  });
});
