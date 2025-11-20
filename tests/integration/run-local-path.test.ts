import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Helper to run CLI commands
 */
async function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      } else {
        reject(new Error(`Command failed with exit code ${code}\n${stderr}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Helper to setup a local test package
 */
async function setupLocalPackage(pkgPath: string, name: string, version: string) {
  // Create package structure
  await fs.mkdir(path.join(pkgPath, 'templates'), { recursive: true });

  // Create agents.toml
  const manifest = `[package]
name = "${name}"
version = "${version}"
description = "Local test package"

[exports.claude]
template = "templates/CLAUDE.md.hbs"
`;
  await fs.writeFile(path.join(pkgPath, 'agents.toml'), manifest);

  // Create template
  const template = `# Claude Instructions\n\nLocal package test: {{ project.name }}`;
  await fs.writeFile(path.join(pkgPath, 'templates', 'CLAUDE.md.hbs'), template);
}

describe('tz run <local-path>', () => {
  let tmpHome: string;
  let tmpProj: string;
  let tmpPkg: string;
  let cli: string;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-run-local-home-'));
    tmpProj = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-run-local-proj-'));
    tmpPkg = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-run-local-pkg-'));

    // Setup config
    const cfgDir = path.join(tmpHome, '.terrazul');
    await fs.mkdir(cfgDir, { recursive: true });
    const cfg = {
      registry: 'http://localhost:9999',
      cache: { ttl: 3600, maxSize: 500 },
      telemetry: false,
    };
    await fs.writeFile(path.join(cfgDir, 'config.json'), JSON.stringify(cfg, null, 2));

    // Create local package
    await setupLocalPackage(tmpPkg, '@local/testpkg', '0.1.0');

    cli = path.join(process.cwd(), 'dist', 'tz.mjs');
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
    await fs.rm(tmpProj, { recursive: true, force: true }).catch(() => {});
    await fs.rm(tmpPkg, { recursive: true, force: true }).catch(() => {});
  });

  it('runs package from absolute path', async () => {
    const env = {
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      TZ_SKIP_SPAWN: 'true',
    };
    await run('node', [cli, 'init', '--name', '@e2e/local-path'], {
      cwd: tmpProj,
      env,
    });

    // Run with absolute path
    await run('node', [cli, 'run', tmpPkg], { cwd: tmpProj, env });

    // Verify rendering to agent_modules
    const agentModules = path.join(tmpProj, 'agent_modules', '@local', 'testpkg');
    const renderedClaudeMd = path.join(agentModules, 'CLAUDE.md');

    // Check rendered file exists
    const exists = await fs
      .access(renderedClaudeMd)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    // Verify rendered content
    const renderedContent = await fs.readFile(renderedClaudeMd, 'utf8');
    expect(renderedContent).toContain('Local package test: @e2e/local-path');

    // Verify @-mention in project CLAUDE.md
    const projectClaudeMd = await fs.readFile(path.join(tmpProj, 'CLAUDE.md'), 'utf8');
    expect(projectClaudeMd).toContain('@agent_modules/@local/testpkg/CLAUDE.md');
  });

  it('runs package from relative path', async () => {
    const env = {
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      TZ_SKIP_SPAWN: 'true',
    };
    await run('node', [cli, 'init', '--name', '@e2e/rel-path'], {
      cwd: tmpProj,
      env,
    });

    // Create package in subdirectory
    const relPkgPath = path.join(tmpProj, 'my-package');
    await setupLocalPackage(relPkgPath, '@local/relpkg', '0.2.0');

    // Run with relative path
    await run('node', [cli, 'run', './my-package'], { cwd: tmpProj, env });

    // Verify rendering to agent_modules
    const renderedClaudeMd = path.join(tmpProj, 'agent_modules', '@local', 'relpkg', 'CLAUDE.md');
    const renderedContent = await fs.readFile(renderedClaudeMd, 'utf8');
    expect(renderedContent).toContain('Local package test');

    // Verify @-mention in project CLAUDE.md
    const projectClaudeMd = await fs.readFile(path.join(tmpProj, 'CLAUDE.md'), 'utf8');
    expect(projectClaudeMd).toContain('@agent_modules/@local/relpkg/CLAUDE.md');
  });

  it('runs package from tilde path', async () => {
    const env = {
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      TZ_SKIP_SPAWN: 'true',
    };
    await run('node', [cli, 'init', '--name', '@e2e/tilde-path'], {
      cwd: tmpProj,
      env,
    });

    // Create package in home directory
    const homePkgPath = path.join(tmpHome, 'my-package');
    await setupLocalPackage(homePkgPath, '@local/tildepkg', '0.3.0');

    // Run with tilde path
    const tildeSpec = `~/my-package`;
    await run('node', [cli, 'run', tildeSpec], { cwd: tmpProj, env });

    // Verify rendering to agent_modules
    const renderedClaudeMd = path.join(tmpProj, 'agent_modules', '@local', 'tildepkg', 'CLAUDE.md');
    const renderedContent = await fs.readFile(renderedClaudeMd, 'utf8');
    expect(renderedContent).toContain('Local package test');

    // Verify @-mention in project CLAUDE.md
    const projectClaudeMd = await fs.readFile(path.join(tmpProj, 'CLAUDE.md'), 'utf8');
    expect(projectClaudeMd).toContain('@agent_modules/@local/tildepkg/CLAUDE.md');
  });

  it('errors on non-existent path', async () => {
    const env = {
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      TZ_SKIP_SPAWN: 'true',
    };
    await run('node', [cli, 'init', '--name', '@e2e/bad-path'], {
      cwd: tmpProj,
      env,
    });

    try {
      await run('node', [cli, 'run', '/nonexistent/path'], {
        cwd: tmpProj,
        env,
      });
      expect.fail('Should have thrown error');
    } catch (error) {
      expect((error as Error).message).toMatch(/not found|does not exist/i);
    }
  });

  it('errors on path without agents.toml', async () => {
    const env = {
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      TZ_SKIP_SPAWN: 'true',
    };
    await run('node', [cli, 'init', '--name', '@e2e/no-manifest'], {
      cwd: tmpProj,
      env,
    });

    // Create directory without manifest
    const emptyPath = path.join(tmpHome, 'empty-dir');
    await fs.mkdir(emptyPath, { recursive: true });

    try {
      await run('node', [cli, 'run', emptyPath], { cwd: tmpProj, env });
      expect.fail('Should have thrown error');
    } catch (error) {
      expect((error as Error).message).toMatch(/invalid package|agents\.toml/i);
    }
  });

  it('does not update lockfile for local packages', async () => {
    const env = {
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      TZ_SKIP_SPAWN: 'true',
    };
    await run('node', [cli, 'init', '--name', '@e2e/no-lock'], {
      cwd: tmpProj,
      env,
    });

    // Check if lockfile exists (init doesn't create one)
    const lockPath = path.join(tmpProj, 'agents-lock.toml');
    const lockExistsBefore = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false);

    // Run local package
    await run('node', [cli, 'run', tmpPkg], { cwd: tmpProj, env });

    // Lockfile should still not exist after running local package
    const lockExistsAfter = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false);

    expect(lockExistsAfter).toBe(lockExistsBefore);
    expect(lockExistsAfter).toBe(false); // Should be false since init doesn't create lockfile
  });

  it('re-renders on every run (no caching for local packages)', async () => {
    const env = {
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      TZ_SKIP_SPAWN: 'true',
    };
    await run('node', [cli, 'init', '--name', '@e2e/always-render'], {
      cwd: tmpProj,
      env,
    });

    // First run
    await run('node', [cli, 'run', tmpPkg], { cwd: tmpProj, env });

    // Check rendered file in agent_modules
    const renderedClaudeMd = path.join(tmpProj, 'agent_modules', '@local', 'testpkg', 'CLAUDE.md');
    const firstStat = await fs.stat(renderedClaudeMd);
    const firstMtime = firstStat.mtimeMs;
    const firstContent = await fs.readFile(renderedClaudeMd, 'utf8');
    expect(firstContent).toContain('Local package test');

    // Wait to ensure different mtime
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Update template
    const newTemplate = `# Updated\n\nChanged content: {{ project.name }}`;
    await fs.writeFile(path.join(tmpPkg, 'templates', 'CLAUDE.md.hbs'), newTemplate);

    // Second run
    await run('node', [cli, 'run', tmpPkg], { cwd: tmpProj, env });

    // Verify rendered file was updated
    const secondStat = await fs.stat(renderedClaudeMd);
    expect(secondStat.mtimeMs).toBeGreaterThan(firstMtime);

    const content = await fs.readFile(renderedClaudeMd, 'utf8');
    expect(content).toContain('Updated');
    expect(content).toContain('Changed content');
  });
});
