Terrazul CLI — Context Generation (Profile priority + multi‑output, No‑Sandbox)

Scope (Keep)
• Command: tz ctx gen (alias: tz context generate)
• Fixed question set (no presets)
• Answer tools: Claude and Codex (we run exactly one of them to get JSON)
• Output tools: any listed in profile; built‑in mappers for: claude, codex, cursor, copilot
• Selection:
• Q&A tool = first available claude/codex in profile.tools priority order (else PATH fallback)
• Outputs = every tool in profile.tools (filtered by --tool if provided)
• Safety: no internal sandbox; rely on tool flags
• Claude: -p --output-format json --permission-mode plan --max-turns 1 --disallowedTools Edit
• Codex: exec --sandbox read-only --ask-for-approval never
• Cross‑platform spawn: src/utils/proc.ts (shell: win32, timeout, env overlay, stdin)
• Overwrite guard: refuse to overwrite existing files (users pass --out only when generating a single tool; for multi‑output, mapping decides)

CLI

tz ctx gen [--tool claude|codex|cursor|copilot] [--out ./path.md] [--dry-run]

    •	--tool: filter which output(s) to produce.
    •	If --tool is claude|codex, also force that as the Q&A tool.
    •	If --tool is cursor|copilot, we still choose a Q&A tool by priority/availability (to get JSON), but only render the requested output.
    •	--out only applies when exactly one output tool is targeted.

⸻

Configuration (Profile)

Extend ~/.terrazul/config.json with profile.tools (priority‑ordered) and context.files (output mapping). env: indirection supported.

Example

{
"registry": "http://localhost:8787",
"cache": { "ttl": 3600, "maxSize": 500 },
"telemetry": false,
"profile": {
"tools": [
{
"type": "codex",
"command": "codex",
"args": ["exec"],
"env": { "OPENAI_API_KEY": "env:OPENAI_API_KEY" }
},
{ "type": "claude", "command": "claude", "model": "claude-sonnet-4-20250514" },
{ "type": "cursor" },
{ "type": "copilot" }
]
},
"context": {
"maxTurns": 1,
"files": {
"claude": "CLAUDE.md",
"codex": "AGENTS.md",
"cursor": ".cursor/rules",
"copilot": ".github/copilot-instructions.md"
}
}
}

⸻

Implementation Plan (priority order)

Each task shows Purpose → Code → Acceptance Criteria → Tests.
Paths are relative to your repo root; adjust imports where your createCLIContext() lives.

⸻

T0 — Types & Config schema (profile, mapping, env indirection)

Purpose: Add profile.tools (priority) & extend context.files mapping to include cursor and copilot.

Files:

src/types/context.ts

export type ToolType = 'claude' | 'codex' | 'cursor' | 'copilot';

export interface ToolSpec {
type: ToolType;
command?: string; // default executable name (e.g., 'claude'/'codex')
args?: string[]; // pre-args (for codex often ['exec'])
model?: string; // claude model hint
env?: Record<string, string>; // supports "env:NAME" indirection
}

export interface ProfileConfig {
tools?: ToolSpec[]; // priority-ordered list
}

export interface ContextFilesMap {
claude?: string;
codex?: string;
cursor?: string;
copilot?: string;
}

export interface ContextConfig {
maxTurns?: number; // hint (we default to 1)
files?: ContextFilesMap; // output file mapping per tool
}

src/types/config.ts (extend)

import type { ProfileConfig, ContextConfig } from './context';

export interface UserConfig {
registry: string;
token?: string;
refreshToken?: string;
tokenExpiry?: number;
username?: string;
cache?: { ttl: number; maxSize: number };
telemetry?: boolean;
profile?: ProfileConfig;
context?: ContextConfig;
}

src/utils/config.ts (Zod schema + env: indirection)

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { UserConfig } from '../types/config';
import type { ToolSpec } from '../types/context';

const ToolSpecSchema = z.object({
type: z.enum(['claude','codex','cursor','copilot']),
command: z.string().optional(),
args: z.array(z.string()).optional(),
model: z.string().optional(),
env: z.record(z.string()).optional(),
});

const ContextFilesSchema = z.object({
claude: z.string().default('CLAUDE.md'),
codex: z.string().default('AGENTS.md'),
cursor: z.string().default('.cursor/rules'),
copilot: z.string().default('.github/copilot-instructions.md'),
}).partial().default({});

const UserConfigSchema = z.object({
registry: z.string().url().default('http://localhost:8787'),
cache: z.object({ ttl: z.number().default(3600), maxSize: z.number().default(500) }).default({}),
telemetry: z.boolean().default(false),
profile: z.object({ tools: z.array(ToolSpecSchema).optional() }).partial().default({}),
context: z.object({
maxTurns: z.number().int().positive().optional(),
files: ContextFilesSchema
}).partial().default({}),
}).partial().default({});

export function configPath(customHome?: string) {
const home = customHome ?? homedir();
return join(home, '.terrazul', 'config.json');
}

export async function readUserConfigFrom(file: string): Promise<UserConfig> {
try {
const cfg = UserConfigSchema.parse(JSON.parse(await fs.readFile(file, 'utf8'))) as unknown as UserConfig;
// ensure default files map
cfg.context ??= {};
cfg.context.files = { claude: 'CLAUDE.md', codex: 'AGENTS.md', cursor: '.cursor/rules', copilot: '.github/copilot-instructions.md', ...(cfg.context.files ?? {}) };
return cfg;
} catch {
return {
registry: 'http://localhost:8787',
cache: { ttl: 3600, maxSize: 500 },
telemetry: false,
context: { files: { claude: 'CLAUDE.md', codex: 'AGENTS.md', cursor: '.cursor/rules', copilot: '.github/copilot-instructions.md' } },
profile: { tools: [] }
} as UserConfig;
}
}

export async function readUserConfig(customHome?: string) {
return readUserConfigFrom(configPath(customHome));
}

/\*_ Resolve "env:NAME" indirection at spawn time. _/
export function expandEnvVars(envSpec?: Record<string, string>) {
if (!envSpec) return undefined;
const out: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(envSpec)) {
out[k] = v.startsWith('env:') ? process.env[v.slice(4)] : v;
}
return out;
}

AC:
• Zod accepts the example config; context.files defaults merged if partially specified.

Tests: tests/unit/config.profile.spec.ts

import { describe, it, expect } from 'vitest';
import { readUserConfigFrom } from '../../src/utils/config';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('config: profile.tools + files', () => {
it('parses profile tools and merges default files', async () => {
const dir = await mkdtemp(join(tmpdir(), 'tz-cfg-'));
const file = join(dir, 'config.json');
await writeFile(file, JSON.stringify({
profile: { tools: [{ type: 'codex', command: 'codex', args: ['exec'] }, { type: 'cursor' }, { type: 'copilot' }] },
context: { files: { claude: 'C.md' } }
}));
const cfg = await readUserConfigFrom(file);
expect(cfg.profile?.tools?.[0].type).toBe('codex');
// @ts-ignore
expect(cfg.context.files.claude).toBe('C.md');
// @ts-ignore
expect(cfg.context.files.cursor).toBe('.cursor/rules'); // default
});
});

⸻

T1 — Tool resolution from profile priority (choose Q&A tool)

Purpose: Choose the first available answer tool (claude/codex) per profile.tools order; else PATH fallback.

File: src/utils/tool-resolve.ts

import type { UserConfig } from '../types/config';
import type { ToolSpec, ToolType } from '../types/context';
import { runCommand } from './proc';
import { ErrorCode } from '../core/errors';

export const ANSWER_TOOLS: ToolType[] = ['claude', 'codex'];

export function isAnswerTool(t: ToolType) {
return ANSWER_TOOLS.includes(t);
}

async function isCmdAvailable(cmd: string): Promise<boolean> {
const whichCmd = process.platform === 'win32' ? 'where' : 'which';
const { exitCode } = await runCommand(whichCmd, [cmd]).catch(() => ({ exitCode: -1, stdout: '', stderr: '' }));
return exitCode === 0;
}

/\*_ Return the first available claude/codex entry from profile; else from PATH. _/
export async function choosePrimaryAnswerTool(cfg: UserConfig, force?: ToolType): Promise<ToolSpec> {
const requested = force && isAnswerTool(force) ? force : undefined;
const list = (cfg.profile?.tools ?? []) as ToolSpec[];

// If forced to an answer tool, honor it using its spec if present, else create a minimal spec
if (requested) {
const fromProfile = list.find(t => t.type === requested);
const spec: ToolSpec = fromProfile ?? { type: requested };
const cmd = spec.command ?? requested;
if (await isCmdAvailable(cmd)) return spec;
const e = new Error(`Requested tool '${requested}' not found on PATH`);
(e as any).code = ErrorCode.TOOL_NOT_FOUND;
throw e;
}

// Profile priority
for (const t of list) {
if (!isAnswerTool(t.type)) continue;
const cmd = t.command ?? t.type;
if (await isCmdAvailable(cmd)) return t;
}

// PATH fallback
if (await isCmdAvailable('claude')) return { type: 'claude' };
if (await isCmdAvailable('codex')) return { type: 'codex', args: ['exec'] };

const e = new Error('No supported answer tool found on PATH (install Claude or Codex).');
(e as any).code = ErrorCode.TOOL_NOT_FOUND;
throw e;
}

/\*_ Targets to render: if --tool specified, just that one; otherwise every tool listed in profile (unique by type). _/
export function computeOutputTargets(cfg: UserConfig, onlyTool?: ToolType): ToolType[] {
if (onlyTool) return [onlyTool];
const types = (cfg.profile?.tools ?? []).map(t => t.type);
return Array.from(new Set(types.length ? types : [])); // empty if no profile.tools
}

AC:
• Honors profile priority; supports --tool force for Q&A if claude|codex.
• Returns empty output target list if no profile tools; orchestrator will decide fallback (see T4).

Tests: tests/unit/tool-resolve.spec.ts

import { describe, it, expect, vi, afterEach } from 'vitest';
import { choosePrimaryAnswerTool, computeOutputTargets } from '../../src/utils/tool-resolve';
import \* as proc from '../../src/utils/proc';

describe('tool resolve', () => {
afterEach(() => vi.restoreAllMocks());

it('picks first available from profile priority', async () => {
const cfg: any = { profile: { tools: [{ type: 'codex', command: 'codex' }, { type: 'claude', command: 'claude' }] } };
const spy = vi.spyOn(proc, 'runCommand');
// "which codex" fails, "which claude" passes
spy.mockResolvedValueOnce({ stdout:'', stderr:'', exitCode: 1 } as any);
spy.mockResolvedValueOnce({ stdout:'', stderr:'', exitCode: 0 } as any);
const spec = await choosePrimaryAnswerTool(cfg);
expect(spec.type).toBe('claude');
});

it('force --tool claude requires availability', async () => {
const cfg: any = { profile: { tools: [] } };
const spy = vi.spyOn(proc, 'runCommand').mockResolvedValueOnce({ stdout:'', stderr:'', exitCode: 0 } as any); // which claude OK
const spec = await choosePrimaryAnswerTool(cfg, 'claude' as any);
expect(spec.type).toBe('claude');
});

it('computeOutputTargets returns all profile types in order (unique)', () => {
const cfg: any = { profile: { tools: [{type:'codex'},{type:'cursor'},{type:'copilot'},{type:'codex'}] } };
expect(computeOutputTargets(cfg)).toEqual(['codex','cursor','copilot']);
expect(computeOutputTargets(cfg,'claude' as any)).toEqual(['claude']);
});
});

⸻

T2 — Tool runner (spawn with write‑blocking flags; respect profile command/args/env/model)

Purpose: Spawn Claude/Codex with safe flags; respect spec.command, spec.args, spec.model, spec.env.

File: src/utils/tool-runner.ts

import { runCommand } from '../utils/proc';
import { stripAnsi } from '../utils/ansi';
import { ErrorCode } from '../core/errors';
import type { ToolSpec, ToolType } from '../types/context';
import { expandEnvVars } from '../utils/config';

export type AnswerToolType = 'claude' | 'codex';

export function isAnswerToolType(t: ToolType): t is AnswerToolType {
return t === 'claude' || t === 'codex';
}

export async function spawnAnswerTool(
spec: ToolSpec, // must be claude or codex
prompt: string,
cwd: string
): Promise<string> {
if (!isAnswerToolType(spec.type)) {
const e = new Error(`Unsupported answer tool: ${spec.type}`);
(e as any).code = ErrorCode.TOOL_EXECUTION_FAILED;
throw e;
}
const cmd = spec.command ?? spec.type;
const env = expandEnvVars(spec.env);
const args: string[] = [];

if (spec.type === 'claude') {
args.push('-p', '--output-format', 'json', '--permission-mode', 'plan', '--max-turns', '1', '--disallowedTools', 'Edit');
if (spec.model) { args.push('--model', spec.model); }
args.push(prompt);
} else {
// codex
const pre = spec.args ?? ['exec'];
args.push(...pre, '--sandbox', 'read-only', '--ask-for-approval', 'never', prompt);
}

const { stdout, stderr, exitCode } = await runCommand(cmd, args, { cwd, env, timeoutMs: 180_000 });
if (exitCode !== 0) {
const e = new Error(`${cmd} failed: ${(stderr || stdout).trim()}`);
(e as any).code = ErrorCode.TOOL_EXECUTION_FAILED;
throw e;
}
return stdout;
}

export function parseAnswerOutput(tool: AnswerToolType, text: string): any {
const clean = stripAnsi(text);

if (tool === 'claude') {
try { return JSON.parse(clean); } catch {
const e = new Error('Claude output is not valid JSON');
(e as any).code = ErrorCode.TOOL_OUTPUT_PARSE_ERROR;
throw e;
}
}

const fence = /`json\s*([\s\S]*?)\s*`/im.exec(clean)
|| /---BEGIN JSON---\s*([\s\S]*?)\s\*---END JSON---/im.exec(clean);
if (fence) {
try { return JSON.parse(fence[1]); } catch {
const e = new Error('Codex fenced JSON failed to parse');
(e as any).code = ErrorCode.TOOL_OUTPUT_PARSE_ERROR;
throw e;
}
}

try { return JSON.parse(clean); } catch {}
const e = new Error('Could not find JSON in Codex output');
(e as any).code = ErrorCode.TOOL_OUTPUT_PARSE_ERROR;
throw e;
}

AC:
• Honors spec.command, spec.args, spec.env, spec.model.
• Uses safe flags; errors have proper codes.

Tests: tests/unit/tool-runner.flags.spec.ts

import { describe, it, expect, vi, afterEach } from 'vitest';
import \* as proc from '../../src/utils/proc';
import { spawnAnswerTool, parseAnswerOutput } from '../../src/utils/tool-runner';

describe('spawnAnswerTool flags & args', () => {
afterEach(() => vi.restoreAllMocks());

it('claude: plan mode, model, json', async () => {
const spy = vi.spyOn(proc, 'runCommand').mockResolvedValue({ stdout: '{"answers":[]}', stderr:'', exitCode:0 });
await spawnAnswerTool({ type:'claude', command:'claude', model:'claude-sonnet-4-20250514' }, 'PROMPT', process.cwd());
const args = spy.mock.calls[0][1];
expect(args).toEqual(expect.arrayContaining(['-p','--output-format','json','--permission-mode','plan','--max-turns','1','--disallowedTools','Edit','--model','claude-sonnet-4-20250514']));
expect(args.at(-1)).toBe('PROMPT');
});

it('codex: pre-args + read-only + never approvals', async () => {
const spy = vi.spyOn(proc, 'runCommand').mockResolvedValue({ stdout: "`json\n{\"answers\":[]}\n`", stderr:'', exitCode:0 });
await spawnAnswerTool({ type:'codex', command:'codex', args:['exec'] }, 'PROMPT', process.cwd());
const args = spy.mock.calls[0][1];
expect(args.slice(0,1)).toEqual(['exec']);
expect(args).toEqual(expect.arrayContaining(['--sandbox','read-only','--ask-for-approval','never']));
expect(args.at(-1)).toBe('PROMPT');
});

it('parseAnswerOutput tolerates ANSI and fenced JSON', () => {
const text = '\x1b[32mOK\x1b[0m\n`json\n{"answers":[]}\n`';
expect(parseAnswerOutput('codex', text)).toEqual({ answers: [] });
});
});

⸻

T3 — Renderers for all output tools

Purpose: Convert Q&A JSON into tool‑specific docs.

File: src/utils/context-render.ts

export interface QA { id: string; question: string; answer: string }
export interface QAResult { answers: QA[]; notes?: string[] }

export function renderClaude(data: QAResult): string {
const lines = ['# Project Context for Claude', '> Generated by `tz ctx gen`.'];
for (const a of data.answers) {
lines.push(`\n## ${title(a.id)}\n\n**Q:** ${a.question}\n\n**A:** ${a.answer.trim()}`);
}
if (data.notes?.length) lines.push('\n---\n### Notes', ...data.notes.map(n => `- ${n}`));
return lines.join('\n');
}

export function renderCodex(data: QAResult): string {
const get = (id: string) => data.answers.find(a => a.id === id)?.answer || '';
return [
'# AGENTS.md',
'> Generated by `tz ctx gen`.',
'\n## Overview\n', get('purpose'),
'\n## Tech & Libraries\n', get('libs'),
'\n## Build & Test\n', get('build_test'),
'\n## Architecture & Conventions\n', get('architecture'),
'\n## Contributor Guidelines (Top 3)\n', get('guidelines'),
'\n## Risks & Constraints\n', get('risks')
].join('\n');
}

/\*_ Cursor: .cursor/rules — plain rules list; keep it concise and neutral _/
export function renderCursor(data: QAResult): string {
const get = (id: string) => data.answers.find(a => a.id === id)?.answer || '';
return [
'# Cursor Rules',
'# Generated by tz ctx gen',
'',
'## Purpose',
bulletize(get('purpose')),
'',
'## Tech & Libraries',
bulletize(get('libs')),
'',
'## Build & Test',
bulletize(get('build_test')),
'',
'## Architecture',
bulletize(get('architecture')),
'',
'## Guidelines',
bulletize(get('guidelines')),
'',
'## Risks',
bulletize(get('risks'))
].join('\n');
}

/\*_ Copilot: .github/copilot-instructions.md — short imperative guidance _/
export function renderCopilot(data: QAResult): string {
const get = (id: string) => data.answers.find(a => a.id === id)?.answer || '';
return [
'# Copilot Instructions',
'> Generated by `tz ctx gen`.',
'',
'## What this repo is',
get('purpose'),
'',
'## Technologies to prefer',
get('libs'),
'',
'## How to build and test',
get('build_test'),
'',
'## Conventions to follow',
get('architecture'),
'',
'## Contributor guidelines (top 3)',
get('guidelines'),
'',
'## Risks and constraints',
get('risks')
].join('\n');
}

function title(id: string) {
switch (id) {
case 'purpose': return 'Purpose';
case 'libs': return 'Languages & Libraries';
case 'build_test': return 'Build & Test';
case 'architecture': return 'Architecture & Conventions';
case 'guidelines': return 'Contributor Guidelines';
case 'risks': return 'Risks & Constraints';
default: return id;
}
}

function bulletize(s: string) {
const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
return lines.length ? lines.map(l => `- ${l}`).join('\n') : '-';
}

AC:
• Deterministic content for claude, codex, cursor, copilot.

Tests: tests/unit/context-render.spec.ts (inline snapshots for each renderer).

⸻

T4 — Orchestrator: single Q&A → multi‑output

Purpose: Run one answer tool → parse JSON → render all outputs listed in profile.tools (or filtered by --tool).

File: src/core/context.ts

import { collectRepoFacts } from '../utils/repo-facts';
import { buildPrompt } from '../utils/context-prompt';
import { choosePrimaryAnswerTool, computeOutputTargets } from '../utils/tool-resolve';
import { spawnAnswerTool, parseAnswerOutput, isAnswerToolType } from '../utils/tool-runner';
import { renderClaude, renderCodex, renderCursor, renderCopilot } from '../utils/context-render';
import { join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { UserConfig } from '../types/config';
import type { ToolType } from '../types/context';
import { ErrorCode } from './errors';

export interface GeneratedDoc { tool: ToolType; filename: string; content: string; }

export async function generateContextAll(
{ cwd, onlyTool, out }: { cwd: string; onlyTool?: ToolType; out?: string; },
cfg: UserConfig
): Promise<{ primary: ToolType; docs: GeneratedDoc[] }> {
const facts = await collectRepoFacts(cwd);

// Outputs to produce
let targets = computeOutputTargets(cfg, onlyTool);
if (targets.length === 0) {
// no profile tools configured → default to [primary answer tool]
const primarySpec = await choosePrimaryAnswerTool(cfg, undefined);
targets = [primarySpec.type];
}

// Choose Q&A tool
const forcedAnswer = onlyTool && isAnswerToolType(onlyTool) ? onlyTool : undefined;
const primarySpec = await choosePrimaryAnswerTool(cfg, forcedAnswer);
const prompt = buildPrompt(facts, primarySpec.type);
const raw = await spawnAnswerTool(primarySpec, prompt, cwd);
const json = parseAnswerOutput(primarySpec.type, raw);

if (!json?.answers || !Array.isArray(json.answers)) {
const e = new Error('Tool returned invalid JSON: missing answers[]');
(e as any).code = ErrorCode.TOOL_OUTPUT_PARSE_ERROR;
throw e;
}

// Render each target
const mappedFiles = cfg.context?.files ?? { claude:'CLAUDE.md', codex:'AGENTS.md', cursor:'.cursor/rules', copilot:'.github/copilot-instructions.md' };
const docs: GeneratedDoc[] = [];
for (const t of targets) {
const filename = out && targets.length === 1
? join(cwd, out)
: join(cwd, (mappedFiles as any)[t] ?? `${t.toUpperCase()}.md`);

    const content =
      t === 'claude'  ? renderClaude(json)  :
      t === 'codex'   ? renderCodex(json)   :
      t === 'cursor'  ? renderCursor(json)  :
      t === 'copilot' ? renderCopilot(json) :
      (() => { throw new Error(`Unsupported output tool: ${t}`); })();

    // Ensure parent dir exists (for .cursor, .github) — actual write happens in command
    await mkdir(dirname(filename), { recursive: true });
    docs.push({ tool: t, filename, content });

}

return { primary: primarySpec.type, docs };
}

AC:
• Picks Q&A tool from profile priority / PATH.
• Produces one GeneratedDoc per target tool with directories created.
• If --tool is non‑answer (cursor|copilot), still picks an answer tool by priority for Q&A.

Tests: tests/integration/context.orchestrator.multi.int.spec.ts (stub runner; assert multiple docs)

import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateContextAll } from '../../src/core/context';

vi.mock('../../src/utils/tool-resolve', async (orig) => {
const m = await orig();
return {
...m,
choosePrimaryAnswerTool: vi.fn(async (cfg, force) => force ? { type: force } : { type: 'codex' }),
};
});
vi.mock('../../src/utils/tool-runner', () => ({
spawnAnswerTool: vi.fn(async () => "`json\n{\"answers\":[{\"id\":\"purpose\",\"question\":\"q\",\"answer\":\"a\"}]}\n`"),
parseAnswerOutput: vi.fn((t: any, s: string) => ({ answers: [{ id: 'purpose', question: 'q', answer: 'a' }] })),
isAnswerToolType: (x: any) => x === 'claude' || x === 'codex'
}));

const cfg: any = {
profile: { tools: [{type:'codex'},{type:'cursor'},{type:'copilot'},{type:'claude'}] },
context: { files: { claude:'CLAUDE.md', codex:'AGENTS.md', cursor:'.cursor/rules', copilot:'.github/copilot-instructions.md' } }
};

describe('generateContextAll', () => {
afterEach(() => vi.resetAllMocks());

it('produces a doc per target in profile order', async () => {
const { primary, docs } = await generateContextAll({ cwd: process.cwd() }, cfg);
expect(primary).toBe('codex'); // mocked
const names = docs.map(d => d.tool);
expect(names).toEqual(['codex','cursor','copilot','claude']);
expect(docs.find(d=>d.tool==='codex')!.filename.endsWith('AGENTS.md')).toBe(true);
expect(docs.find(d=>d.tool==='cursor')!.filename.endsWith('.cursor/rules')).toBe(true);
expect(docs.find(d=>d.tool==='copilot')!.filename.endsWith('.github/copilot-instructions.md')).toBe(true);
expect(docs.find(d=>d.tool==='claude')!.filename.endsWith('CLAUDE.md')).toBe(true);
});

it('onlyTool filters outputs and forces Q&A when answer tool', async () => {
const { primary, docs } = await generateContextAll({ cwd: process.cwd(), onlyTool: 'claude' as any }, cfg);
expect(primary).toBe('claude');
expect(docs.map(d=>d.tool)).toEqual(['claude']);
});

it('onlyTool cursor filters outputs but still chooses Q&A by priority', async () => {
const { primary, docs } = await generateContextAll({ cwd: process.cwd(), onlyTool: 'cursor' as any }, cfg);
expect(primary).toBe('codex'); // mocked
expect(docs.map(d=>d.tool)).toEqual(['cursor']);
});
});

⸻

T5 — CLI wiring (multi‑output, overwrite guard per file)

Purpose: Expose tz ctx gen and tz context generate; support multi‑output; refuse per‑file overwrite; show dry‑run output.

File: src/commands/context.ts

import { Command } from 'commander';
import { generateContextAll } from '../core/context';
import { writeFile, stat } from 'node:fs/promises';
// Adjust to where your DI lives:
import { createCLIContext } from '../utils/context'; // or wherever you expose it

export function registerContextCommand(program: Command) {
function handlerFactory() {
return async (opts: any) => {
const ctx = await createCLIContext();
const { logger } = ctx;
try {
const cfg = await ctx.config.load();
const only = opts.tool as any | undefined;
const res = await generateContextAll({ cwd: process.cwd(), onlyTool: only, out: opts.out }, cfg);

        if (opts.dryRun) {
          logger.info(`Primary Q&A tool: ${res.primary}`);
          for (const doc of res.docs) {
            logger.info(`\n--- [${doc.tool}] → ${doc.filename}\n${doc.content}`);
          }
          logger.info(`\n(dry run) → would write ${res.docs.length} file(s).`);
          return;
        }

        let failures = 0;
        for (const doc of res.docs) {
          const exists = await stat(doc.filename).then(()=>true).catch(()=>false);
          if (exists) {
            logger.error(`Refusing to overwrite existing file: ${doc.filename}. Use --tool to target a single output and --out to choose another path.`);
            failures++;
            continue;
          }
          await writeFile(doc.filename, doc.content, 'utf8');
          logger.info(`Wrote [${doc.tool}] → ${doc.filename}`);
        }
        if (failures > 0) process.exitCode = 1;
      } catch (e: any) {
        ctx.logger.error(e?.message ?? String(e));
        process.exitCode = 1;
      }
    };

}

const group = new Command('ctx').description('Context utilities');
group.command('gen')
.description('Generate context files for tools in your profile')
.option('--tool <tool>', 'claude|codex|cursor|copilot')
.option('--out <path>', 'output file path (only when --tool is provided)')
.option('--dry-run', 'print instead of writing', false)
.action(handlerFactory());
program.addCommand(group);

const long = new Command('context').description('Generate or manage AI context');
long.command('generate')
.description('Generate context files for tools in your profile')
.option('--tool <tool>', 'claude|codex|cursor|copilot')
.option('--out <path>', 'output file path (only when --tool is provided)')
.option('--dry-run', 'print instead of writing', false)
.action(handlerFactory());
program.addCommand(long);
}

AC:
• --dry-run prints all outputs with headers.
• Without --dry-run, writes each file, skips existing with an error, exits non‑zero if any were skipped.
• --out allowed only when exactly one output tool is targeted (handled in orchestrator; it uses out only in that case).

Tests (CLI with fake CLIs): tests/integration/cli.ctx-gen.profile.int.spec.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Minimal fake Codex that writes unless flags present; our flags prevent it.
const codexJS = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2).join(' ');
if (!(args.includes('--sandbox read-only') && args.includes('--ask-for-approval never'))) {
  fs.writeFileSync('HACK.tmp','bad');
}
console.log("```json\\n{\\"answers\\":[{\\"id\\":\\"purpose\\",\\"question\\":\\"q\\",\\"answer\\":\\"a\\"}]}\\n```");`;
const claudeJS = `#!/usr/bin/env node
process.stdout.write(JSON.stringify({answers:[{id:"purpose",question:"q",answer:"a"}]}));`;

import { chmod, mkdir, writeFile as writeF } from 'node:fs/promises';
async function setupBin(root: string, which: Array<'codex'|'claude'>) {
const bin = join(root, 'bin'); await mkdir(bin, { recursive: true });
async function shim(name: string, js: string) {
const jsPath = join(bin, `${name}.js`); await writeF(jsPath, js, 'utf8');
const sh = join(bin, name);
await writeF(sh, `#!/usr/bin/env sh\nexec node "$(dirname "$0")/${name}.js" "$@"\n`, 'utf8');
await chmod(sh, 0o755);
const cmd = join(bin, `${name}.cmd`); await writeF(cmd, `@echo off\r\nnode "%~dp0\\${name}.js" %*\r\n`, 'utf8');
}
if (which.includes('codex')) await shim('codex', codexJS);
if (which.includes('claude')) await shim('claude', claudeJS);
return bin;
}
function envWithBin(bin: string) {
const sep = process.platform === 'win32' ? ';' : ':';
return { ...process.env, PATH: `${bin}${sep}${process.env.PATH ?? ''}` };
}
function runCli(cwd: string, env: NodeJS.ProcessEnv, args: string[]) {
return new Promise<{ code: number|null; stdout: string; stderr: string }>((res) => {
const child = spawn(process.execPath, [join(process.cwd(), 'dist', 'tz.js'), ...args], { cwd, env });
let stdout = '', stderr = '';
child.stdout.on('data', d => stdout += String(d));
child.stderr.on('data', d => stderr += String(d));
child.on('close', code => res({ code, stdout, stderr }));
});
}

describe('tz ctx gen (profile multi-output)', () => {
let work!: string;
beforeAll(async () => { work = await mkdtemp(join(tmpdir(), 'tz-ctx-')); });
afterAll(async () => { await rm(work, { recursive: true, force: true }); });

it('dry-run prints all outputs and prevents codex writes', async () => {
const bin = await setupBin(work, ['codex']);
const env = envWithBin(bin);
// Write config with profile tools (codex + cursor + copilot)
await writeFile(join(work, 'config.json'), JSON.stringify({
profile: { tools: [{type:'codex', command:'codex'}, {type:'cursor'}, {type:'copilot'}] },
context: { files: { claude:'CLAUDE.md', codex:'AGENTS.md', cursor:'.cursor/rules', copilot:'.github/copilot-instructions.md' } }
}), 'utf8');

    // Assume your CLI reads ~/.terrazul/config.json; we can set HOME to work and place it there
    // (adapt to your config loader if needed)
    const terHome = join(work, '.terrazul'); await mkdir(terHome, { recursive: true });
    await writeFile(join(terHome, 'config.json'), await (await import('node:fs/promises')).readFile(join(work, 'config.json')));

    const { code, stdout } = await runCli(work, env, ['ctx','gen','--dry-run']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Primary Q&A tool: codex/);
    expect(stdout).toMatch(/--- \[codex] → .*AGENTS\.md/);
    expect(stdout).toMatch(/--- \[cursor] → .*\.cursor\/rules/);
    expect(stdout).toMatch(/--- \[copilot] → .*\.github\/copilot-instructions\.md/);
    await expect(stat(join(work, 'HACK.tmp'))).rejects.toBeTruthy();

});

it('refuses overwrite per file', async () => {
const bin = await setupBin(work, ['codex']);
const env = envWithBin(bin);
// Create existing AGENTS.md and .github folder
await writeFile(join(work, 'AGENTS.md'), 'existing', 'utf8');
const cfgPath = join(work, '.terrazul', 'config.json'); // from previous test
const { code, stdout } = await runCli(work, env, ['ctx','gen']);
expect(code).toBe(1);
expect(stdout).toMatch(/Refusing to overwrite/);
});
});

⸻

T6 — Docs

Add to agents.md:

### Context generation (profile-aware, read‑only)

Generate context files for every tool listed in your profile:

```bash
tz ctx gen [--tool claude|codex|cursor|copilot] [--out ./path.md] [--dry-run]

	•	Primary Q&A tool: The first available claude or codex from profile.tools (priority order). You can force it with --tool claude|codex.
	•	Outputs: By default, one file per tool listed in profile.tools. Use --tool to generate a single output and optionally --out to choose its path.
	•	Default file mapping (override in config context.files):
	•	claude → CLAUDE.md
	•	codex  → AGENTS.md
	•	cursor → .cursor/rules
	•	copilot → .github/copilot-instructions.md
	•	Safety: tz runs the external tool with read‑only/print‑only flags:
	•	Claude: -p --output-format json --permission-mode plan --max-turns 1 --disallowedTools Edit
	•	Codex: exec --sandbox read-only --ask-for-approval never
	•	Overwrite guard: If a target file exists, tz refuses to overwrite it and continues with others; the command exits non‑zero if any were skipped.

---

# Acceptance Summary

- Profile priority respected for Q&A tool; PATH fallback works.
- One run produces **multiple files** (Codex/Cursor/Copilot/Claude) per profile, or a **single** file with `--tool`.
- Claude/Codex always run with **write‑blocking flags**; tests confirm a “write‑happy” fake Codex cannot write.
- Overwrite guard enforced per file; non‑zero exit when any outputs were skipped due to existing files.
- Unit tests cover config parsing, tool resolution, proc/ansi, prompt, runner flags & parsing, renderers; integration tests cover multi‑output & overwrite behavior.

---

```
