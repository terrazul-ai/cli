import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureBuilt, run } from '../../helpers/cli';

describe('integration: dynamic askAgent prompts', () => {
  let cli = '';
  let tmpHome = '';
  let tmpProj = '';
  let stubDir = '';
  let logPath = '';
  let counterPath = '';
  let stubCommand = '';
  let stubScriptPath = '';
  let argLogPath = '';
  let stubArgs: string[] = [];

  beforeAll(async () => {
    cli = await ensureBuilt();
  });

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-dyn-home-'));
    tmpProj = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-dyn-proj-'));
    stubDir = path.join(tmpHome, 'bin');
    await fs.mkdir(stubDir, { recursive: true });
    logPath = path.join(tmpProj, 'claude-prompts.log');
    counterPath = path.join(tmpProj, 'claude-counter.txt');
    await fs.writeFile(logPath, '', 'utf8');
    await fs.writeFile(counterPath, '0', 'utf8');

    stubScriptPath = path.join(stubDir, 'claude-stub.cjs');
    const stubScript = `
const fs = require('node:fs');

if (process.env.CLAUDE_STUB_ARG_LOG) {
  try {
    fs.writeFileSync(process.env.CLAUDE_STUB_ARG_LOG, JSON.stringify(process.argv.slice(2)));
  } catch (error) {
    fs.writeFileSync(
      process.env.CLAUDE_STUB_ARG_LOG,
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    );
  }
}

const input = fs.readFileSync(0, 'utf8');
if (process.env.CLAUDE_STUB_LOG) {
  fs.appendFileSync(process.env.CLAUDE_STUB_LOG, input + '\\n@@@END_PROMPT@@@\\n', 'utf8');
}

const counterFile = process.env.CLAUDE_STUB_COUNTER;
let index = 0;
if (counterFile) {
  if (fs.existsSync(counterFile)) {
    const raw = fs.readFileSync(counterFile, 'utf8');
    index = Number.parseInt(raw, 10) || 0;
  }
  fs.writeFileSync(counterFile, String(index + 1));
}

const outputs = (process.env.CLAUDE_STUB_OUTPUTS || 'First result|Second result').split('|');
const chosen = outputs[Math.min(index, outputs.length - 1)];
process.stdout.write(chosen);
`;
    await fs.writeFile(stubScriptPath, stubScript.trimStart(), 'utf8');
    stubCommand = process.execPath;
    stubArgs = [stubScriptPath];

    const cfgDir = path.join(tmpHome, '.terrazul');
    await fs.mkdir(cfgDir, { recursive: true });
    const config = {
      registry: 'https://registry.invalid',
      cache: { ttl: 3600, maxSize: 500 },
      telemetry: false,
      profile: {
        tools: [{ type: 'claude', command: stubCommand, args: stubArgs }],
      },
      context: {
        files: {
          claude: 'CLAUDE.md',
          codex: 'AGENTS.md',
          cursor: '.cursor/rules.mdc',
          copilot: '.github/copilot-instructions.md',
        },
      },
    };
    await fs.writeFile(path.join(cfgDir, 'config.json'), JSON.stringify(config, null, 2));

    const pkgRoot = path.join(tmpProj, 'agent_modules', '@fixtures', 'dynamic');
    await fs.mkdir(path.join(pkgRoot, 'templates'), { recursive: true });
    const pkgManifest = `
[package]
name = "@fixtures/dynamic"
version = "0.1.0"

[exports.claude]
template = "templates/CLAUDE.md.hbs"
`;
    await fs.writeFile(path.join(pkgRoot, 'agents.toml'), pkgManifest.trimStart(), 'utf8');

    const template = `
# Dynamic Prompt Demo

{{ var first = askAgent('Provide initial value') }}
{{ askAgent('Use {{ vars.first }} and {{ snippets.snippet_0 }} to craft final output') }}
`;
    await fs.writeFile(
      path.join(pkgRoot, 'templates', 'CLAUDE.md.hbs'),
      template.trimStart(),
      'utf8',
    );

    const projectManifest = `
[package]
name = "@project/demo"
version = "0.0.1"

[exports.claude]
template = "ignored"
`;
    await fs.writeFile(path.join(tmpProj, 'agents.toml'), projectManifest.trimStart(), 'utf8');
  });

  afterEach(async () => {
    await fs.rm(tmpProj, { recursive: true, force: true });
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('passes interpolated values to askAgent during apply --dry-run', async () => {
    const env = {
      ...process.env,
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      CLAUDE_STUB_LOG: logPath,
      CLAUDE_STUB_COUNTER: counterPath,
      CLAUDE_STUB_OUTPUTS: 'First result|Second result',
    };
    const { stdout } = await run('node', [cli, 'apply', '--dry-run'], { cwd: tmpProj, env });
    expect(stdout).toMatch(/apply \(dry-run\): would write \d+ files/);

    const rawLog = await fs.readFile(logPath, 'utf8');
    const prompts = rawLog
      .split('\n@@@END_PROMPT@@@\n')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('Provide initial value');
    expect(prompts[1]).toContain('Use First result and First result to craft final output');
  });

  it('disables safe mode when requested', async () => {
    argLogPath = path.join(tmpProj, 'claude-args.json');
    const env = {
      ...process.env,
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      CLAUDE_STUB_COUNTER: counterPath,
      CLAUDE_STUB_OUTPUTS: 'Result',
      CLAUDE_STUB_ARG_LOG: argLogPath,
    };
    await run('node', [cli, 'apply', '--dry-run', '--no-tool-safe-mode'], { cwd: tmpProj, env });
    const rawArgs = JSON.parse(await fs.readFile(argLogPath, 'utf8')) as string[];
    expect(rawArgs).not.toContain('--permission-mode');
    expect(rawArgs).not.toContain('--max-turns');
  });
});
