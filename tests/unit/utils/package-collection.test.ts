import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  collectPackageFilesFromAgentModules,
  collectFilesRecursively,
} from '../../../src/utils/package-collection.js';

describe('package-collection', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-pkg-collection-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('collectFilesRecursively', () => {
    it('should return empty array for non-existent directory', async () => {
      const nonExistent = path.join(tmpDir, 'does-not-exist');
      const result = await collectFilesRecursively(nonExistent);
      expect(result).toEqual([]);
    });

    it('should collect files from a flat directory', async () => {
      const testDir = path.join(tmpDir, 'flat');
      await fs.mkdir(testDir);
      await fs.writeFile(path.join(testDir, 'file1.txt'), 'content1');
      await fs.writeFile(path.join(testDir, 'file2.md'), 'content2');

      const result = await collectFilesRecursively(testDir);
      expect(result).toHaveLength(2);
      expect(result).toContain(path.join(testDir, 'file1.txt'));
      expect(result).toContain(path.join(testDir, 'file2.md'));
    });

    it('should recursively collect files from nested directories', async () => {
      const testDir = path.join(tmpDir, 'nested');
      await fs.mkdir(testDir);
      await fs.mkdir(path.join(testDir, 'subdir'));
      await fs.mkdir(path.join(testDir, 'subdir', 'deep'));

      await fs.writeFile(path.join(testDir, 'root.txt'), 'root');
      await fs.writeFile(path.join(testDir, 'subdir', 'sub.txt'), 'sub');
      await fs.writeFile(path.join(testDir, 'subdir', 'deep', 'deep.txt'), 'deep');

      const result = await collectFilesRecursively(testDir);
      expect(result).toHaveLength(3);
      expect(result).toContain(path.join(testDir, 'root.txt'));
      expect(result).toContain(path.join(testDir, 'subdir', 'sub.txt'));
      expect(result).toContain(path.join(testDir, 'subdir', 'deep', 'deep.txt'));
    });

    it('should ignore directories and only return files', async () => {
      const testDir = path.join(tmpDir, 'mixed');
      await fs.mkdir(testDir);
      await fs.mkdir(path.join(testDir, 'emptydir'));
      await fs.writeFile(path.join(testDir, 'file.txt'), 'content');

      const result = await collectFilesRecursively(testDir);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(path.join(testDir, 'file.txt'));
    });
  });

  describe('collectPackageFilesFromAgentModules', () => {
    it('should return empty maps when agent_modules does not exist', async () => {
      const result = await collectPackageFilesFromAgentModules(tmpDir);
      expect(result.packageFiles.size).toBe(0);
      expect(result.packageInfos).toHaveLength(0);
    });

    it('should collect unscoped package with manifest', async () => {
      const agentModules = path.join(tmpDir, 'agent_modules');
      const pkgDir = path.join(agentModules, 'simple-pkg');

      await fs.mkdir(agentModules);
      await fs.mkdir(pkgDir);
      await fs.writeFile(path.join(pkgDir, 'file1.md'), 'content');
      await fs.writeFile(
        path.join(pkgDir, 'agents.toml'),
        `[package]\nname = "@test/simple-pkg"\nversion = "1.0.0"\n`,
      );

      const result = await collectPackageFilesFromAgentModules(tmpDir);

      expect(result.packageFiles.size).toBe(1);
      expect(result.packageFiles.has('simple-pkg')).toBe(true);
      expect(result.packageFiles.get('simple-pkg')).toHaveLength(2);

      expect(result.packageInfos).toHaveLength(1);
      expect(result.packageInfos[0].name).toBe('simple-pkg');
      expect(result.packageInfos[0].version).toBe('1.0.0');
      expect(result.packageInfos[0].root).toBe(pkgDir);
    });

    it('should collect scoped package with manifest', async () => {
      const agentModules = path.join(tmpDir, 'agent_modules');
      const scopeDir = path.join(agentModules, '@scope');
      const pkgDir = path.join(scopeDir, 'pkg-name');

      await fs.mkdir(agentModules);
      await fs.mkdir(scopeDir);
      await fs.mkdir(pkgDir);
      await fs.writeFile(path.join(pkgDir, 'file1.md'), 'content');
      await fs.writeFile(
        path.join(pkgDir, 'agents.toml'),
        `[package]\nname = "@scope/pkg-name"\nversion = "2.0.0"\n`,
      );

      const result = await collectPackageFilesFromAgentModules(tmpDir);

      expect(result.packageFiles.size).toBe(1);
      expect(result.packageFiles.has('@scope/pkg-name')).toBe(true);
      expect(result.packageFiles.get('@scope/pkg-name')).toHaveLength(2);

      expect(result.packageInfos).toHaveLength(1);
      expect(result.packageInfos[0].name).toBe('@scope/pkg-name');
      expect(result.packageInfos[0].version).toBe('2.0.0');
      expect(result.packageInfos[0].root).toBe(pkgDir);
    });

    it('should collect multiple packages (scoped and unscoped)', async () => {
      const agentModules = path.join(tmpDir, 'agent_modules');

      // Unscoped package
      const pkg1Dir = path.join(agentModules, 'pkg1');
      await fs.mkdir(agentModules);
      await fs.mkdir(pkg1Dir);
      await fs.writeFile(path.join(pkg1Dir, 'file1.md'), 'content');
      await fs.writeFile(
        path.join(pkg1Dir, 'agents.toml'),
        `[package]\nname = "@test/pkg1"\nversion = "1.0.0"\n`,
      );

      // Scoped package
      const scopeDir = path.join(agentModules, '@myorg');
      const pkg2Dir = path.join(scopeDir, 'pkg2');
      await fs.mkdir(scopeDir);
      await fs.mkdir(pkg2Dir);
      await fs.writeFile(path.join(pkg2Dir, 'file2.md'), 'content');
      await fs.writeFile(
        path.join(pkg2Dir, 'agents.toml'),
        `[package]\nname = "@myorg/pkg2"\nversion = "3.0.0"\n`,
      );

      const result = await collectPackageFilesFromAgentModules(tmpDir);

      expect(result.packageFiles.size).toBe(2);
      expect(result.packageFiles.has('pkg1')).toBe(true);
      expect(result.packageFiles.has('@myorg/pkg2')).toBe(true);

      expect(result.packageInfos).toHaveLength(2);
      const names = result.packageInfos.map((p) => p.name);
      expect(names).toContain('pkg1');
      expect(names).toContain('@myorg/pkg2');
    });

    it('should skip packages with no files', async () => {
      const agentModules = path.join(tmpDir, 'agent_modules');
      const emptyPkgDir = path.join(agentModules, 'empty-pkg');

      await fs.mkdir(agentModules);
      await fs.mkdir(emptyPkgDir);
      // No files in this package

      const result = await collectPackageFilesFromAgentModules(tmpDir);

      expect(result.packageFiles.size).toBe(0);
      expect(result.packageInfos).toHaveLength(0);
    });

    it('should skip non-directory entries in agent_modules', async () => {
      const agentModules = path.join(tmpDir, 'agent_modules');
      await fs.mkdir(agentModules);
      await fs.writeFile(path.join(agentModules, 'some-file.txt'), 'content');

      const pkgDir = path.join(agentModules, 'valid-pkg');
      await fs.mkdir(pkgDir);
      await fs.writeFile(path.join(pkgDir, 'file.md'), 'content');
      await fs.writeFile(
        path.join(pkgDir, 'agents.toml'),
        `[package]\nname = "@test/valid-pkg"\nversion = "1.0.0"\n`,
      );

      const result = await collectPackageFilesFromAgentModules(tmpDir);

      expect(result.packageFiles.size).toBe(1);
      expect(result.packageFiles.has('valid-pkg')).toBe(true);
    });

    it('should handle package without version in manifest', async () => {
      const agentModules = path.join(tmpDir, 'agent_modules');
      const pkgDir = path.join(agentModules, 'no-version');

      await fs.mkdir(agentModules);
      await fs.mkdir(pkgDir);
      await fs.writeFile(path.join(pkgDir, 'file.md'), 'content');
      await fs.writeFile(
        path.join(pkgDir, 'agents.toml'),
        `[package]\nname = "@test/no-version"\n`,
      );

      const result = await collectPackageFilesFromAgentModules(tmpDir);

      expect(result.packageInfos).toHaveLength(1);
      expect(result.packageInfos[0].name).toBe('no-version');
      expect(result.packageInfos[0].version).toBeUndefined();
    });

    it('should handle nested files in packages', async () => {
      const agentModules = path.join(tmpDir, 'agent_modules');
      const pkgDir = path.join(agentModules, 'nested-pkg');
      const subDir = path.join(pkgDir, 'agents');

      await fs.mkdir(agentModules);
      await fs.mkdir(pkgDir);
      await fs.mkdir(subDir);
      await fs.writeFile(path.join(pkgDir, 'root.md'), 'root');
      await fs.writeFile(path.join(subDir, 'nested.md'), 'nested');
      await fs.writeFile(
        path.join(pkgDir, 'agents.toml'),
        `[package]\nname = "@test/nested-pkg"\nversion = "1.0.0"\n`,
      );

      const result = await collectPackageFilesFromAgentModules(tmpDir);

      expect(result.packageFiles.size).toBe(1);
      const files = result.packageFiles.get('nested-pkg');
      expect(files).toHaveLength(3);
      expect(files).toContain(path.join(pkgDir, 'root.md'));
      expect(files).toContain(path.join(subDir, 'nested.md'));
      expect(files).toContain(path.join(pkgDir, 'agents.toml'));
    });
  });
});
