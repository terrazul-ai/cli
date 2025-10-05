import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeExtractSources, type ExtractOptions } from '../../src/core/extract/orchestrator';
import { ensureBuilt } from '../helpers/cli';
import { createTempProject } from '../helpers/project';

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replaceAll(/\u001B\[[\d;?]*[ -/]*[@-~]/g, '');
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const pythonAvailable = (() => {
  if (process.platform === 'win32') return false;
  try {
    const result = spawnSync('python3', ['--version']);
    return result.status === 0;
  } catch {
    return false;
  }
})();

const PY_BRIDGE = `
import os, pty, sys, select
cmd = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
else:
    try:
        while True:
            r, _, _ = select.select([fd, sys.stdin], [], [])
            if fd in r:
                data = os.read(fd, 4096)
                if not data:
                    break
                os.write(sys.stdout.fileno(), data)
            if sys.stdin in r:
                data = os.read(sys.stdin.fileno(), 4096)
                if not data:
                    os.close(fd)
                    break
                os.write(fd, data)
    finally:
        os.close(fd)
`;

function slugifySegment(input: string): string {
  const lower = input.toLowerCase();
  const collapsed = lower.replaceAll(/[^\da-z]+/g, '-');
  const trimmedStart = collapsed.replaceAll(/^-+/g, '');
  const trimmed = trimmedStart.replaceAll(/-+$/g, '');
  const normalized = trimmed;
  return normalized || 'package';
}

describe('tz extract (interactive wizard)', () => {
  const interactiveIt = pythonAvailable ? it : it.skip;

  interactiveIt.skip(
    'completes the wizard and writes selected outputs',
    async () => {
      const cli = await ensureBuilt();
      const project = await createTempProject('tz-extract-interactive');

      await project.addCodexAgents('# Codex Agents');
      await project.addClaudeReadme('# Claude Rules');
      await project.setClaudeSettings({
        env: { ANTHROPIC_API_KEY: 'secret' },
        permissions: { additionalDirectories: [path.join(project.root, 'docs')] },
      });
      await project.setClaudeMcp({
        search: { command: './scripts/search.sh', args: ['--port', '7001'] },
      });
      await project.addCursorRulesFile('rules.md', 'rule body');

      const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-home-'));
      const codexDir = path.join(codexHome, '.codex');
      await fs.mkdir(codexDir, { recursive: true });
      const codexConfigPath = path.join(codexDir, 'config.toml');
      await fs.writeFile(
        codexConfigPath,
        [
          '[mcp_servers.searcher]',
          `command = "${path.join(project.root, 'bin', 'searcher').replaceAll('\\', '/')}"`,
          'args = ["--dataset", "{{PROJECT_ROOT}}/dataset"]',
        ].join('\n'),
        'utf8',
      );

      const suffix = '-custom';
      const expectedOutDir = path.join(project.root, `my-first-package${suffix}`);

      const baseOptions: ExtractOptions = {
        from: project.root,
        out: path.join(project.root, 'my-first-package'),
        name: `@local/${slugifySegment(path.basename(project.root) || 'project')}`,
        version: '1.0.0',
        includeClaudeLocal: false,
        includeClaudeUser: false,
        force: false,
        dryRun: false,
        codexConfigPath,
      };
      const plan = await analyzeExtractSources(baseOptions);
      const planPath = path.join(project.root, 'precomputed-plan.json');
      await fs.writeFile(planPath, JSON.stringify(plan), 'utf8');

      const output: string[] = [];
      const child = spawn('python3', ['-u', '-c', PY_BRIDGE, process.execPath, cli, 'extract'], {
        cwd: project.root,
        env: {
          ...process.env,
          HOME: codexHome,
          TZ_EXTRACT_PRECOMPUTE_PLAN: '1',
          TZ_EXTRACT_PLAN_PATH: planPath,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (data: string) => {
        output.push(data);
      });
      child.stderr.on('data', (data: string) => {
        output.push(data);
      });

      const waitForText = async (text: string, timeoutMs = 60_000): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const combined = stripAnsi(output.join(''));
          if (combined.includes(text)) return;
          await wait(50);
        }
        throw new Error(
          `Timed out waiting for text: ${text}. Output: ${stripAnsi(output.join(''))}`,
        );
      };

      const exitPromise = new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', (code) => resolve(code));
      });

      await waitForText('Step 1/6', 180_000);
      child.stdin.write('\t');
      await waitForText('Step 2/6');
      child.stdin.write('\t');
      await waitForText('Step 3/6');
      child.stdin.write(suffix);
      await waitForText(`my-first-package${suffix}`);
      child.stdin.write('\t');
      await waitForText('Step 4/6');
      child.stdin.write('\t');
      await wait(50);
      child.stdin.write('\t');
      await waitForText('Step 5/6');
      child.stdin.write('\t');
      await waitForText('Step 6/6');
      child.stdin.write('\r');

      const exitCode = await exitPromise;
      expect(exitCode).toBe(0);

      const finalOutput = stripAnsi(output.join(''));
      const resolvedOutDir = await fs.realpath(expectedOutDir);
      expect(finalOutput).toContain(`Extracted → ${resolvedOutDir}`);

      const manifestPath = path.join(resolvedOutDir, 'agents.toml');
      const manifest = await fs.readFile(manifestPath, 'utf8');
      const base = path
        .basename(project.root)
        .replaceAll(/[^\dA-Za-z-]/g, '-')
        .toLowerCase();
      expect(manifest).toContain(`name = "@local/${base}"`);
      expect(manifest).toContain('version = "1.0.0"');

      const expectedFiles = [
        path.join(resolvedOutDir, 'agents.toml'),
        path.join(resolvedOutDir, 'templates', 'AGENTS.md.hbs'),
        path.join(resolvedOutDir, 'templates', 'CLAUDE.md.hbs'),
        path.join(resolvedOutDir, 'templates', 'claude', 'settings.json.hbs'),
        path.join(resolvedOutDir, 'templates', 'claude', 'mcp_servers.json.hbs'),
        path.join(resolvedOutDir, 'templates', 'cursor.rules.hbs'),
        path.join(resolvedOutDir, 'README.md'),
      ];

      for (const file of expectedFiles) {
        await fs.stat(file);
      }
    },
    180_000,
  );
});
