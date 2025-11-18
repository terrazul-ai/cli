import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  generateTZMd,
  tzMdExists,
  removeTZMd,
  type PackageInfo,
} from '../../../src/utils/tz-md-generator';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function write(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, 'utf8');
}

describe('utils/tz-md-generator', () => {
  let projectRoot = '';

  beforeEach(async () => {
    projectRoot = await mkdtemp('tz-md-gen');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true }).catch(() => {});
  });

  describe('generateTZMd', () => {
    it('generates TZ.md with @-mentions for rendered files', async () => {
      // Setup: create rendered files
      const pkg1Root = path.join(projectRoot, 'agent_modules', '@test', 'pkg1');
      const pkg2Root = path.join(projectRoot, 'agent_modules', '@test', 'pkg2');

      const file1 = path.join(pkg1Root, 'rendered', 'CLAUDE.md');
      const file2 = path.join(pkg2Root, 'rendered', 'AGENTS.md');

      await write(file1, '# Package 1');
      await write(file2, '# Package 2');

      await write(
        path.join(pkg1Root, 'agents.toml'),
        `[package]\nname = "@test/pkg1"\nversion = "1.0.0"\ndescription = "First package"`,
      );
      await write(
        path.join(pkg2Root, 'agents.toml'),
        `[package]\nname = "@test/pkg2"\nversion = "2.0.0"\ndescription = "Second package"`,
      );

      const packageFiles = new Map<string, string[]>([
        ['@test/pkg1', [file1]],
        ['@test/pkg2', [file2]],
      ]);

      const packages: PackageInfo[] = [
        { name: '@test/pkg1', version: '1.0.0', root: pkg1Root },
        { name: '@test/pkg2', version: '2.0.0', root: pkg2Root },
      ];

      const content = await generateTZMd(projectRoot, packageFiles, packages);

      // Verify content structure
      expect(content).toContain('# Terrazul Package Context');
      expect(content).toContain('## Active Packages');
      expect(content).toContain('### @test/pkg1 (v1.0.0)');
      expect(content).toContain('### @test/pkg2 (v2.0.0)');
      expect(content).toContain('First package');
      expect(content).toContain('Second package');

      // Verify @-mentions use relative paths
      expect(content).toContain('@agent_modules/@test/pkg1/rendered/CLAUDE.md');
      expect(content).toContain('@agent_modules/@test/pkg2/rendered/AGENTS.md');

      // Verify file was written
      const tzMdPath = path.join(projectRoot, '.terrazul', 'TZ.md');
      const written = await fs.readFile(tzMdPath, 'utf8');
      expect(written).toBe(content);
    });

    it('handles empty packageFiles map', async () => {
      const packageFiles = new Map<string, string[]>();
      const packages: PackageInfo[] = [];

      const content = await generateTZMd(projectRoot, packageFiles, packages);

      expect(content).toContain('# Terrazul Package Context');
      expect(content).toContain('No packages have been rendered yet.');
      expect(content).not.toContain('## Active Packages');
    });

    it('supports custom output path', async () => {
      const customPath = path.join(projectRoot, 'custom', 'TZ.md');
      const packageFiles = new Map<string, string[]>();
      const packages: PackageInfo[] = [];

      await generateTZMd(projectRoot, packageFiles, packages, { outputPath: customPath });

      const exists = await fs.stat(customPath).catch(() => null);
      expect(exists).not.toBeNull();
    });

    it('dry run mode does not write file', async () => {
      const packageFiles = new Map<string, string[]>();
      const packages: PackageInfo[] = [];

      const content = await generateTZMd(projectRoot, packageFiles, packages, { dryRun: true });

      expect(content).toContain('# Terrazul Package Context');

      // File should NOT exist
      const tzMdPath = path.join(projectRoot, '.terrazul', 'TZ.md');
      const exists = await fs.stat(tzMdPath).catch(() => null);
      expect(exists).toBeNull();
    });

    it('throws error if referenced file does not exist', async () => {
      const missingFile = path.join(
        projectRoot,
        'agent_modules',
        '@test',
        'pkg1',
        'rendered',
        'MISSING.md',
      );

      const packageFiles = new Map<string, string[]>([['@test/pkg1', [missingFile]]]);

      const packages: PackageInfo[] = [
        {
          name: '@test/pkg1',
          version: '1.0.0',
          root: path.join(projectRoot, 'agent_modules', '@test', 'pkg1'),
        },
      ];

      await expect(generateTZMd(projectRoot, packageFiles, packages)).rejects.toThrow(
        'TZ.md generation failed',
      );
    });

    it('sorts packages alphabetically', async () => {
      const pkgZRoot = path.join(projectRoot, 'agent_modules', '@test', 'z-pkg');
      const pkgARoot = path.join(projectRoot, 'agent_modules', '@test', 'a-pkg');

      const fileZ = path.join(pkgZRoot, 'rendered', 'CLAUDE.md');
      const fileA = path.join(pkgARoot, 'rendered', 'AGENTS.md');

      await write(fileZ, '# Z');
      await write(fileA, '# A');

      await write(
        path.join(pkgZRoot, 'agents.toml'),
        `[package]\nname = "@test/z-pkg"\nversion = "1.0.0"`,
      );
      await write(
        path.join(pkgARoot, 'agents.toml'),
        `[package]\nname = "@test/a-pkg"\nversion = "1.0.0"`,
      );

      const packageFiles = new Map<string, string[]>([
        ['@test/z-pkg', [fileZ]],
        ['@test/a-pkg', [fileA]],
      ]);

      const packages: PackageInfo[] = [
        { name: '@test/z-pkg', version: '1.0.0', root: pkgZRoot },
        { name: '@test/a-pkg', version: '1.0.0', root: pkgARoot },
      ];

      const content = await generateTZMd(projectRoot, packageFiles, packages);

      // @test/a-pkg should appear before @test/z-pkg
      const indexA = content.indexOf('@test/a-pkg');
      const indexZ = content.indexOf('@test/z-pkg');

      expect(indexA).toBeLessThan(indexZ);
    });

    it('handles packages without descriptions', async () => {
      const pkgRoot = path.join(projectRoot, 'agent_modules', '@test', 'no-desc');
      const file = path.join(pkgRoot, 'rendered', 'CLAUDE.md');

      await write(file, '# Package');
      await write(
        path.join(pkgRoot, 'agents.toml'),
        `[package]\nname = "@test/no-desc"\nversion = "1.0.0"`,
      );

      const packageFiles = new Map<string, string[]>([['@test/no-desc', [file]]]);

      const packages: PackageInfo[] = [{ name: '@test/no-desc', version: '1.0.0', root: pkgRoot }];

      const content = await generateTZMd(projectRoot, packageFiles, packages);

      expect(content).toContain('### @test/no-desc (v1.0.0)');
      expect(content).toContain('@agent_modules/@test/no-desc/rendered/CLAUDE.md');
    });

    it('handles multiple files per package', async () => {
      const pkgRoot = path.join(projectRoot, 'agent_modules', '@test', 'multi');
      const file1 = path.join(pkgRoot, 'rendered', 'CLAUDE.md');
      const file2 = path.join(pkgRoot, 'rendered', 'AGENTS.md');

      await write(file1, '# Claude');
      await write(file2, '# Agents');
      await write(
        path.join(pkgRoot, 'agents.toml'),
        `[package]\nname = "@test/multi"\nversion = "1.0.0"`,
      );

      const packageFiles = new Map<string, string[]>([['@test/multi', [file1, file2]]]);

      const packages: PackageInfo[] = [{ name: '@test/multi', version: '1.0.0', root: pkgRoot }];

      const content = await generateTZMd(projectRoot, packageFiles, packages);

      expect(content).toContain('@agent_modules/@test/multi/rendered/CLAUDE.md');
      expect(content).toContain('@agent_modules/@test/multi/rendered/AGENTS.md');
    });
  });

  describe('tzMdExists', () => {
    it('returns true if TZ.md exists', async () => {
      const tzMdPath = path.join(projectRoot, '.terrazul', 'TZ.md');
      await write(tzMdPath, '# Test');

      const exists = await tzMdExists(projectRoot);
      expect(exists).toBe(true);
    });

    it('returns false if TZ.md does not exist', async () => {
      const exists = await tzMdExists(projectRoot);
      expect(exists).toBe(false);
    });

    it('supports custom path', async () => {
      const customPath = path.join(projectRoot, 'custom', 'TZ.md');
      await write(customPath, '# Test');

      const exists = await tzMdExists(projectRoot, customPath);
      expect(exists).toBe(true);
    });
  });

  describe('removeTZMd', () => {
    it('removes TZ.md if it exists', async () => {
      const tzMdPath = path.join(projectRoot, '.terrazul', 'TZ.md');
      await write(tzMdPath, '# Test');

      await removeTZMd(projectRoot);

      const exists = await fs.stat(tzMdPath).catch(() => null);
      expect(exists).toBeNull();
    });

    it('does not throw if TZ.md does not exist', async () => {
      await expect(removeTZMd(projectRoot)).resolves.not.toThrow();
    });

    it('supports custom path', async () => {
      const customPath = path.join(projectRoot, 'custom', 'TZ.md');
      await write(customPath, '# Test');

      await removeTZMd(projectRoot, customPath);

      const exists = await fs.stat(customPath).catch(() => null);
      expect(exists).toBeNull();
    });
  });
});
