import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type CreateOptions,
  createPackageScaffold,
  deriveDefaultPackageName,
  generateManifest,
  getPackageDirName,
} from '../../../src/core/package-creator';
import { normalizeConfig } from '../../../src/utils/config';

import type { CLIContext } from '../../../src/utils/context';
import type { Logger } from '../../../src/utils/logger';

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  isVerbose: () => false,
};

async function makeTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'tz-create-test-'));
}

async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

describe('createPackageScaffold', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await makeTempDir();
  });

  afterEach(async () => {
    await removeDir(tmpRoot);
  });

  it('creates the expected scaffold with minimal options', async () => {
    const targetDir = path.join(tmpRoot, 'my-agents');
    const options: CreateOptions = {
      name: '@alice/my-agents',
      description: '',
      license: 'MIT',
      version: '0.0.0',
      targetDir,
      tools: [],
      includeExamples: false,
      includeHooks: false,
      dryRun: false,
    };

    const result = await createPackageScaffold(options, noopLogger);

    expect(result.targetDir).toBe(targetDir);
    expect(result.created).toEqual(
      expect.arrayContaining([
        path.join(targetDir, 'agents.toml'),
        path.join(targetDir, 'README.md'),
        path.join(targetDir, '.gitignore'),
        path.join(targetDir, 'agents'),
        path.join(targetDir, 'commands'),
        path.join(targetDir, 'configurations'),
        path.join(targetDir, 'mcp'),
      ]),
    );

    const manifest = await fs.readFile(path.join(targetDir, 'agents.toml'), 'utf8');
    expect(manifest).toContain('[package]');
    expect(manifest).toContain('name = "@alice/my-agents"');
    expect(manifest).not.toContain('[compatibility]');

    const directories = ['agents', 'commands', 'configurations', 'mcp'];
    for (const dir of directories) {
      const stat = await fs.stat(path.join(targetDir, dir));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it('writes compatibility entries, example blocks, and hooks directory when requested', async () => {
    const targetDir = path.join(tmpRoot, 'demo-agents');
    const options: CreateOptions = {
      name: '@demo/agents-pack',
      description: 'Demo description',
      license: 'Apache-2.0',
      version: '1.2.3',
      targetDir,
      tools: ['claude', 'codex', 'cursor', 'copilot'],
      includeExamples: true,
      includeHooks: true,
      dryRun: false,
    };

    const result = await createPackageScaffold(options, noopLogger);
    expect(result.created).toEqual(
      expect.arrayContaining([
        path.join(targetDir, 'hooks'),
        path.join(targetDir, 'templates', 'CLAUDE.md.hbs'),
        path.join(targetDir, 'templates', 'AGENTS.md.hbs'),
        path.join(targetDir, 'templates', 'cursor.rules.mdc.hbs'),
        path.join(targetDir, 'templates', 'COPILOT.md.hbs'),
      ]),
    );

    const manifest = await fs.readFile(path.join(targetDir, 'agents.toml'), 'utf8');
    expect(manifest).toContain('[compatibility]');
    expect(manifest).toMatch(/claude\s*=\s*"\*"/);
    expect(manifest).toMatch(/codex\s*=\s*"\*"/);
    expect(manifest).toMatch(/cursor\s*=\s*"\*"/);
    expect(manifest).toMatch(/copilot\s*=\s*"\*"/);
    expect(manifest).toContain('[exports.claude]');
    expect(manifest).toContain('template = "templates/CLAUDE.md.hbs"');
    expect(manifest).toContain('[exports.codex]');
    expect(manifest).toContain('[exports.cursor]');
    expect(manifest).toContain('[exports.copilot]');

    const readme = await fs.readFile(path.join(targetDir, 'README.md'), 'utf8');
    expect(readme).toContain('# @demo/agents-pack');
    expect(readme).toContain('Demo description');
    expect(readme).toContain('Apache-2.0');
  });

  it('performs no filesystem writes when dryRun is true', async () => {
    const targetDir = path.join(tmpRoot, 'dry-run');
    const options: CreateOptions = {
      name: '@demo/dry-run',
      description: 'Dry run only',
      license: 'MIT',
      version: '0.0.1',
      targetDir,
      tools: ['cursor'],
      includeExamples: false,
      includeHooks: false,
      dryRun: true,
    };

    const result = await createPackageScaffold(options, noopLogger);
    expect(result.created).toEqual(
      expect.arrayContaining([
        path.join(targetDir, 'agents.toml'),
        path.join(targetDir, 'README.md'),
        path.join(targetDir, '.gitignore'),
        path.join(targetDir, 'templates', 'cursor.rules.mdc.hbs'),
      ]),
    );

    await expect(fs.stat(targetDir)).rejects.toThrow();
    expect(result.summary.fileCount).toBeGreaterThan(0);
  });
});

describe('helper utilities', () => {
  it('derives directory names from package names', () => {
    expect(getPackageDirName('@alice/my-agents')).toBe('my-agents');
    expect(getPackageDirName('plain-name')).toBe('plain-name');
  });

  it('generates manifest text with selected tools and metadata', () => {
    const manifest = generateManifest({
      name: '@demo/pkg',
      description: 'Sample manifest',
      license: 'MIT',
      version: '0.0.0',
      targetDir: '/tmp/demo',
      tools: ['claude', 'cursor'],
      includeExamples: false,
      includeHooks: false,
      dryRun: false,
    });
    expect(manifest).toContain('[package]');
    expect(manifest).toContain('name = "@demo/pkg"');
    expect(manifest).toContain('[compatibility]');
    expect(manifest).toMatch(/claude\s*=\s*"\*"/);
    expect(manifest).toMatch(/cursor\s*=\s*"\*"/);
    expect(manifest).toContain('[exports.claude]');
    expect(manifest).toContain('[exports.cursor]');
  });

  it('derives default package names from profile usernames and cwd', async () => {
    const cwd = '/projects/My Awesome Project';
    const config = normalizeConfig({
      username: 'alice',
    });
    const ctx = {
      config: {
        load: () => Promise.resolve(config),
      },
      logger: {
        debug: () => {},
      },
    } as unknown as Pick<CLIContext, 'config' | 'logger'>;

    const name = await deriveDefaultPackageName(ctx, cwd);
    expect(name).toBe('@alice/my-awesome-project');
  });

  it('falls back to @local scope when username missing', async () => {
    const cwd = '/projects/Nameless';
    const config = normalizeConfig({});
    const ctx = {
      config: {
        load: () => Promise.resolve(config),
      },
      logger: {
        debug: () => {},
      },
    } as unknown as Pick<CLIContext, 'config' | 'logger'>;

    const name = await deriveDefaultPackageName(ctx, cwd);
    expect(name).toBe('@local/nameless');
  });
});
