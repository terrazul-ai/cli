Absolutely—that makes perfect sense. Let’s generalize the model so a package can be:
• asset‑only (just ships a CLAUDE.md or AGENTS.md template),
• task‑only (a declarative pipeline that tz executes),
• workflow(s) (one or more tasks composed with control flow),
• or any combination of the above.

Below is a compact, end‑to‑end spec you can drop into your repo. It includes a generic DSL, package export contract, tz runtime changes, and tests. Your existing tz ctx gen simply becomes a well‑known task id (ctx.generate) that any package may provide—but packages are not limited to “questions”; they can render templates directly, call tools with any prompt, or just copy assets.

⸻

1. Concepts (generic, tool‑agnostic)
   • Task: a single declarative pipeline (list of built‑in steps). Think “one job.”
   • Workflow: composition of steps with control flow (foreach, when). For MVP, a workflow is just a task with looping/branching—same file format.
   • Asset: static files (templates, markdown, JSON). Can be rendered (render.template.v1) or copied (fs.copy.v1) by a task, or discovered by tz for direct use.

Everything is data-only. Packages ship no executable code. tz executes only built‑in steps, keeping installs safe and deterministic.

⸻

2. Package export contract

agents.toml additions

[package]
name = "@scope/pkg"
version = "1.0.0"
description = "Example ctx generation + assets"

# 1) Tasks/workflows (id → relative path to YAML/JSON spec)

[tasks]
"ctx.generate" = "tasks/ctx.generate.yaml" # well-known id used by `tz ctx gen`
"my.custom.task" = "tasks/my.custom.task.yaml"

# 2) Optional asset exports (tool → template path)

[exports]
codex.template = "templates/AGENTS.md.hbs"
claude.template = "templates/CLAUDE.md.hbs"
cursor.template = "templates/cursor.rules.hbs"
copilot.template = "templates/copilot.md.hbs"

# 3) Optional capability metadata

[compatibility]
codex = ">=0.9.0"
claude-code = ">=0.2.0"
cursor = ">=1.0.0"
copilot = ">=1.0.0"

[metadata]
tz_spec_version = 1

A package can provide only tasks, only assets, or both. tz ctx gen first tries a task called ctx.generate. If none is found, tz will fall back to rendering assets (if any) with a small default context (e.g., facts).

⸻

3. Generic Task/Workflow DSL (v1)

A single file (YAML or JSON) describing a pipeline of built‑in steps. Not tied to “questions.”

version: 1
id: "ctx.generate" # task id
description: "Generate multi-tool project context artifacts."

targets:
sourceTool: auto # auto|claude|codex (for tool.ask)
outputs: profile # profile|[codex, claude, cursor, copilot]

inputs: # optional CLI-settable parameters
out: null

resources: # arbitrary resources the task needs
promptTemplate: "prompts/generic.md"
outputTemplates:
codex: "templates/AGENTS.md.hbs"
claude: "templates/CLAUDE.md.hbs"
cursor: "templates/cursor.rules.hbs"
copilot: "templates/copilot.md.hbs"

pipeline:

- id: facts
  use: facts.v1
  with:
  include: - package_json - scripts - repo_tree: { depth: 2, roots: ["src","tests","tools"] }

- id: prompt
  use: prompt.v1
  with:
  template: "{{resources.promptTemplate}}"
  context:
  facts: "{{steps.facts.output}}"
  goals: "Summarize repository purpose, tech stack, commands, and risks."
  format: "Return JSON with { answers: [...], notes?: [...] }"
  forTool: "{{targets.sourceTool}}"

- id: ask
  use: tool.ask.v1
  with:
  tool: "{{targets.sourceTool}}"
  prompt: "{{steps.prompt.output}}"
  parse: "auto_json" # claude raw JSON; codex fenced JSON
  safeMode: true # applies read-only / plan mode flags
  outputs:
  answers: "{{ output.json }}" # normalized by tz (not required by DSL)

- id: foreach_outputs
  use: foreach.v1
  with:
  list: "{{targets.outputs}}" # profile tools or explicit list
  as: "tool"
  steps:
  - id: render
    use: render.template.v1
    with:
    engine: "handlebars"
    template:
    codex: "{{resources.outputTemplates.codex}}"
    claude: "{{resources.outputTemplates.claude}}"
    cursor: "{{resources.outputTemplates.cursor}}"
    copilot: "{{resources.outputTemplates.copilot}}"
    context:
    answers: "{{ steps.ask.outputs.answers }}"
    facts: "{{ steps.facts.output }}"
  - id: write
    use: fs.write.v1
    with:
    path:
    codex: "{{ context.files.codex }}"
    claude: "{{ context.files.claude }}"
    cursor: "{{ context.files.cursor }}"
    copilot: "{{ context.files.copilot }}"
    content: "{{ steps.render.output }}"
    skipIfExists: true

This task uses tool.ask.v1, but a package could skip it entirely (e.g., asset‑only task that just renders fixed templates from facts).

⸻

4. tz runtime (generic)

4.1 Types

src/types/task.ts

export type ToolType = 'codex' | 'claude' | 'cursor' | 'copilot';

export interface TaskSpecV1 {
version: 1;
id: string;
description?: string;
targets: {
sourceTool: 'auto' | ToolType; // tool for tool.ask.v1
outputs: 'profile' | ToolType[]; // which outputs to emit
};
inputs?: Record<string, unknown>;
resources?: Record<string, unknown>;
pipeline: StepSpec[];
}

export type StepSpec =
| { id: string; use: 'facts.v1'; with?: { include?: any } }
| { id: string; use: 'prompt.v1'; with: { template: string; context?: any; forTool?: any } }
| { id: string; use: 'tool.ask.v1'; with: { tool: any; prompt: any; parse: 'auto_json'|'json'; safeMode?: boolean }, outputs?: Record<string,string> }
| { id: string; use: 'render.template.v1'; with: { engine: 'handlebars'; template: any; context?: any } }
| { id: string; use: 'fs.write.v1'; with: { path: any; content: any; skipIfExists?: boolean } }
| { id: string; use: 'fs.copy.v1'; with: { from: string; to: string; skipIfExists?: boolean } }
| { id: string; use: 'foreach.v1'; with: { list: any; as: string }; steps: StepSpec[] }
| { id: string; use: 'when.v1'; with: { cond: any }; then: StepSpec[]; else?: StepSpec[] }
| { id: string; use: 'set.v1'; with: Record<string, any> };

4.2 Loader

src/core/tasks/loader.ts

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { TaskSpecV1 } from '../../types/task';

const Schema = z.object({
version: z.literal(1),
id: z.string(),
targets: z.object({
sourceTool: z.union([z.literal('auto'), z.enum(['codex','claude','cursor','copilot'])]),
outputs: z.union([z.literal('profile'), z.array(z.enum(['codex','claude','cursor','copilot']))]),
}),
pipeline: z.array(z.any()),
resources: z.record(z.any()).optional(),
inputs: z.record(z.any()).optional(),
});

export async function loadTaskFile(pkgRoot: string, rel: string): Promise<TaskSpecV1> {
const p = join(pkgRoot, rel);
const txt = await readFile(p, 'utf8');
const doc = (await import('yaml')).parse(txt);
const parsed = Schema.parse(doc);
return parsed as TaskSpecV1;
}

4.3 Registry resolver (find tasks or assets)

src/core/tasks/registry.ts

import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { ToolType } from '../../types/task';

export interface InstalledTask { id: string; relPath: string; pkgRoot: string; pkgName: string; }
export interface InstalledAssets { pkgRoot: string; pkgName: string; templates: Partial<Record<ToolType,string>>; }

export async function findTask(cwd: string, id: string): Promise<InstalledTask | null> {
const base = join(cwd, 'agent_modules');
const items = await readdir(base, { withFileTypes: true }).catch(() => []);
for (const e of items) {
if (!e.isDirectory()) continue;
const pkgRoot = join(base, e.name);
const toml = await readToml(join(pkgRoot, 'agents.toml'));
const rel = toml?.tasks?.[id];
if (rel) return { id, relPath: rel, pkgRoot, pkgName: e.name };
}
return null;
}

export async function findAssets(cwd: string): Promise<InstalledAssets[]> {
const out: InstalledAssets[] = [];
const base = join(cwd, 'agent_modules');
const items = await readdir(base, { withFileTypes: true }).catch(() => []);
for (const e of items) {
if (!e.isDirectory()) continue;
const pkgRoot = join(base, e.name);
const toml = await readToml(join(pkgRoot, 'agents.toml'));
const ex = toml?.exports || {};
const templates = {
codex: ex['codex.template'],
claude: ex['claude.template'],
cursor: ex['cursor.template'],
copilot: ex['copilot.template'],
};
if (Object.values(templates).some(Boolean)) out.push({ pkgRoot, pkgName: e.name, templates });
}
return out;
}

async function readToml(path: string) {
const txt = await readFile(path, 'utf8').catch(() => null);
if (!txt) return null;
return (await import('@iarna/toml')).parse(txt) as any;
}

4.4 Tool selection & outputs

src/utils/tool-resolve.ts

import type { ToolType } from '../types/task';
import { runCommand } from './proc';

export interface ToolSpec { type: ToolType; command: string; args?: string[]; model?: string; }

export async function choosePrimaryAnswerTool(userCfg: any, override?: ToolType): Promise<ToolSpec> {
const preferred: ToolType[] =
override ? [override] :
userCfg?.profile?.tools?.map((t: any) => t.type).filter((t: ToolType) => t === 'claude' || t === 'codex') ??
['claude','codex'];

for (const t of preferred) {
const cmd = t === 'claude' ? 'claude' : 'codex';
const r = await runCommand(process.platform === 'win32' ? 'where' : 'which', [cmd]).catch(() => ({ exitCode: -1 }));
if (r.exitCode === 0) return { type: t, command: cmd, args: t === 'codex' ? ['exec'] : [] };
}
throw new Error('TOOL_NOT_FOUND: Need claude or codex for tool.ask.v1');
}

export function computeOutputTargets(userCfg: any, specOutputs: 'profile' | ToolType[]): ToolType[] {
if (Array.isArray(specOutputs)) return specOutputs;
const prof = (userCfg?.profile?.tools ?? []).map((t: any) => t.type) as ToolType[];
const dedup = Array.from(new Set(prof.filter(t => ['codex','claude','cursor','copilot'].includes(t))));
return dedup.length ? dedup : ['codex','claude']; // default
}

4.5 Tool invocation (safe flags)

src/utils/tool-runner.ts

import { runCommand } from './proc';

export interface ToolSpec { type: 'codex'|'claude'; command: string; args?: string[]; model?: string; }

export async function spawnAnswerTool(tool: ToolSpec, prompt: string, cwd: string): Promise<string> {
if (tool.type === 'claude') {
const args = ['-p', '--output-format', 'json', '--permission-mode', 'plan', '--max-turns', '1', prompt];
const { exitCode, stdout, stderr } = await runCommand(tool.command, args, { cwd, timeoutMs: 180_000 });
if (exitCode !== 0) throw new Error(`TOOL_EXECUTION_FAILED (claude): ${stderr || stdout}`.trim());
return stdout;
} else {
const args = [...(tool.args ?? ['exec']), '--sandbox', 'read-only', '--ask-for-approval', 'never', prompt];
const { exitCode, stdout, stderr } = await runCommand(tool.command, args, { cwd, timeoutMs: 180_000 });
if (exitCode !== 0) throw new Error(`TOOL_EXECUTION_FAILED (codex): ${stderr || stdout}`.trim());
return stdout;
}
}

export function parseAnswerOutput(type: 'codex'|'claude', text: string): any {
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]_m/g, '');
const clean = stripAnsi(text);
if (type === 'claude') return JSON.parse(clean);
const m = /```json\s_([\s\S]_?)\s_```/im.exec(clean) || /---BEGIN JSON---\s*([\s\S]*?)\s\*---END JSON---/im.exec(clean);
if (!m) throw new Error('TOOL_OUTPUT_PARSE_ERROR (codex): fenced JSON not found');
return JSON.parse(m[1]);
}

4.6 Runner (generic)

src/core/tasks/runner.ts

import type { TaskSpecV1, ToolType } from '../../types/task';
import { readFile, writeFile, mkdir, stat, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { interpolate, pickTemplate } from '../../utils/template';
import { collectRepoFacts } from '../../utils/repo-facts';
import { choosePrimaryAnswerTool, computeOutputTargets } from '../../utils/tool-resolve';
import { spawnAnswerTool, parseAnswerOutput } from '../../utils/tool-runner';

export interface TaskContext {
cwd: string;
pkgRoot: string;
userCfg: any;
cli: { onlyTool?: ToolType; out?: string | null };
resources: Record<string, any>;
steps: Record<string, any>;
targets: { sourceTool: ToolType; outputs: ToolType[] };
contextFiles: Record<ToolType,string>;
}

const exists = (p: string) => stat(p).then(()=>true).catch(()=>false);
const ensureDir = (p: string) => mkdir(dirname(p), { recursive: true });

export async function runTask(spec: TaskSpecV1, ctx: TaskContext) {
for (const step of spec.pipeline) {
switch (step.use) {
case 'facts.v1': {
ctx.steps[step.id] = { output: await collectRepoFacts(ctx.cwd) };
break;
}
case 'prompt.v1': {
const tpl = await readPkg(ctx, step.with.template);
const prompt = interpolate(tpl, {
...ctx,
...(step.with.context || {}),
forTool: interpolate(String(step.with.forTool ?? ctx.targets.sourceTool), ctx),
});
ctx.steps[step.id] = { output: prompt };
break;
}
case 'tool.ask.v1': {
const forced = resolveScalar(ctx, step.with.tool);
const primary = await choosePrimaryAnswerTool(ctx.userCfg, forced as any);
const prompt = resolveScalar(ctx, step.with.prompt);
const raw = await spawnAnswerTool(primary, prompt, ctx.cwd);
const json = parseAnswerOutput(primary.type, raw);
ctx.steps[step.id] = { output: raw, outputs: { json } };
break;
}
case 'render.template.v1': {
const template = pickTemplate(resolveValue(ctx, step.with.template), ctx.cli.onlyTool || ctx.targets.outputs[0] || 'codex');
const tpl = await readPkg(ctx, template);
const rendered = interpolate(tpl, {
...ctx,
...(step.with.context || {}),
answers: ctx.steps['tool.ask.v1']?.outputs?.json?.answers
? normalizeAnswers(ctx.steps['tool.ask.v1'].outputs.json)
: ctx.steps['ask']?.outputs?.answers ?? {},
});
ctx.steps[step.id] = { output: rendered };
break;
}
case 'fs.write.v1': {
const pathMap = resolveValue(ctx, step.with.path);
let path = typeof pathMap === 'string' ? pathMap : pathMap[ctx.cli.onlyTool || ctx.targets.outputs[0]];
if (!path) {
// fall back to contextFiles map
const target = (ctx.cli.onlyTool || ctx.targets.outputs[0]) as ToolType;
path = ctx.contextFiles[target];
}
const content = resolveScalar(ctx, step.with.content) ?? ctx.steps['render']?.output;
await ensureDir(path);
if (step.with.skipIfExists && await exists(path)) break;
await writeFile(path, content, 'utf8');
ctx.steps[step.id] = { output: path };
break;
}
case 'fs.copy.v1': {
const from = join(ctx.pkgRoot, resolveScalar(ctx, step.with.from));
const to = join(ctx.cwd, resolveScalar(ctx, step.with.to));
await ensureDir(to);
if (!(step.with.skipIfExists && await exists(to))) await cp(from, to, { recursive: true });
ctx.steps[step.id] = { output: to };
break;
}
case 'foreach.v1': {
const list = Array.isArray(step.with.list) ? step.with.list : ctx.targets.outputs;
for (const tool of list) {
ctx.cli.onlyTool = tool as ToolType;
for (const sub of (step as any).steps) {
await runTask({ ...spec, pipeline: [sub] }, ctx);
}
}
ctx.cli.onlyTool = undefined;
break;
}
case 'when.v1': {
const cond = !!resolveValue(ctx, step.with.cond);
const branch = cond ? step.then : step.else || [];
for (const s of branch) await runTask({ ...spec, pipeline: [s] }, ctx);
break;
}
case 'set.v1': {
Object.assign(ctx, step.with || {});
ctx.steps[step.id] = { output: step.with };
break;
}
default:
throw new Error(`Unsupported step: ${step.use}`);
}
}
return ctx;
}

// helpers
async function readPkg(ctx: TaskContext, rel: string) { return readFile(join(ctx.pkgRoot, rel), 'utf8'); }
function resolveScalar(ctx: any, val: any) { return typeof val === 'string' ? interpolate(val, ctx) : val; }
function resolveValue(ctx: any, val: any) { return typeof val === 'string' ? interpolate(val, ctx) : val; }
function normalizeAnswers(parsed: any): Record<string, { question?: string; answer: string }> {
const out: Record<string, any> = {};
const arr = parsed?.answers ?? [];
for (const a of arr) out[a.id] = { question: a.question, answer: a.answer };
return out;
}

⸻

5. CLI wiring (generic + ctx alias)
   • tz task run <taskId> [--tool <tool>] [--out <path>] — generic runner
   • tz ctx gen [--tool <tool>] [--out <path>] — alias for tz task run ctx.generate

MVP: keep tz ctx gen and add tz task run for power users.

⸻

6. Defaults & config

Extend config to include context file mapping for all tools:

{
"context": {
"files": {
"codex": "AGENTS.md",
"claude": "CLAUDE.md",
"cursor": ".cursor/rules",
"copilot": ".github/copilot-instructions.md"
}
},
"profile": {
"tools": [
{ "type": "codex", "command": "codex", "args": ["exec"], "env": { "OPENAI_API_KEY": "env:OPENAI_API_KEY" } },
{ "type": "claude", "command": "claude" },
{ "type": "cursor" },
{ "type": "copilot" }
]
}
}

tz will emit outputs for every tool in the profile order (unless --tool is passed, which limits to one).

⸻

7. Example packages

A) Asset‑only package

@vendor/assets-ctx/
├─ agents.toml
└─ templates/
├─ AGENTS.md.hbs
└─ CLAUDE.md.hbs

No tasks. tz ctx gen falls back to “render assets”: tz renders templates/_ to context.files._ using {facts} only (or empty context). Great for opinionated, text‑only guidance.

B) Task‑only package

@terrazul/ctx-default/
├─ agents.toml # tasks.ctx.generate = tasks/ctx.generate.yaml
├─ tasks/ctx.generate.yaml
├─ prompts/generic.md
└─ templates/... # per-tool outputs

Uses tool.ask.v1 to get structured answers and renders templates.

C) Mixed (recommended)

Ship both task and templates, so advanced users can run the task, while others can adopt templates.

⸻

8. Tests (Vitest)

These are tight, fast tests covering loader, runner, assets fallback, and tool invocation stubs.

A) Loader

tests/unit/tasks.loader.spec.ts

import { describe, it, expect } from 'vitest';
import { loadTaskFile } from '../../src/core/tasks/loader';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('task loader', () => {
it('parses a generic v1 task', async () => {
const root = await mkdtemp(join(tmpdir(),'tz-task-'));
await mkdir(join(root,'tasks'),{recursive:true});
await writeFile(join(root,'tasks/t.yaml'), `version: 1
id: "x.y"
targets: { sourceTool: auto, outputs: [codex, claude] }
resources: { promptTemplate: "p.hbs" }
pipeline: []`, 'utf8');
const spec = await loadTaskFile(root, 'tasks/t.yaml');
expect(spec.id).toBe('x.y');
expect(spec.targets.outputs).toEqual(['codex','claude']);
});
});

B) Runner (generic, no ask)

tests/unit/tasks.runner.asset.spec.ts

import { describe, it, expect } from 'vitest';
import { runTask } from '../../src/core/tasks/runner';
import type { TaskSpecV1 } from '../../src/types/task';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('runTask: asset-only render', () => {
it('renders template without tool.ask', async () => {
const root = await mkdtemp(join(tmpdir(),'tz-asset-'));
await writeFile(join(root,'T.hbs'), '# OUT\nFacts: {{steps.facts.output.name}}', 'utf8');

    const spec: TaskSpecV1 = {
      version: 1, id: 'render.only',
      targets: { sourceTool: 'auto', outputs: ['codex'] as any },
      resources: {}, pipeline: [
        { id: 'facts', use: 'facts.v1' },
        { id: 'render', use: 'render.template.v1', with: { engine: 'handlebars', template: 'T.hbs', context: {} } },
        { id: 'write', use: 'fs.write.v1', with: { path: '{{ context.files.codex }}', content: '{{ steps.render.output }}', skipIfExists: false } }
      ]
    };

    const ctx = {
      cwd: root, pkgRoot: root, userCfg: { context: { files: { codex: join(root,'AGENTS.md') } } },
      cli: {}, resources: {}, steps: {},
      targets: { sourceTool: 'codex', outputs: ['codex'] },
      contextFiles: { codex: join(root,'AGENTS.md') } as any
    };

    await runTask(spec, ctx as any);
    const out = await (await import('node:fs/promises')).readFile(join(root,'AGENTS.md'),'utf8');
    expect(out).toMatch(/^# OUT/);
    await rm(root,{recursive:true,force:true});

});
});

C) Runner with tool.ask.v1 (mocked)

tests/unit/tasks.runner.ask.spec.ts

import { describe, it, expect, vi } from 'vitest';
import { runTask } from '../../src/core/tasks/runner';
import type { TaskSpecV1 } from '../../src/types/task';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/utils/tool-resolve', () => ({
choosePrimaryAnswerTool: vi.fn(async () => ({ type: 'codex', command: 'codex', args: ['exec'] })),
computeOutputTargets: vi.fn(),
}));
vi.mock('../../src/utils/tool-runner', () => ({
spawnAnswerTool: vi.fn(async () => "`json\n{\"answers\":[{\"id\":\"purpose\",\"question\":\"q\",\"answer\":\"a\"}]}\n`"),
parseAnswerOutput: vi.fn((t:any,s:string)=>({ answers:[{id:'purpose',question:'q',answer:'a'}] })),
}));

describe('runTask: ask + render', () => {
it('generates output using tool.ask and templates', async () => {
const root = await mkdtemp(join(tmpdir(),'tz-ask-'));
await writeFile(join(root,'P.hbs'), 'PROMPT {{forTool}} {{steps.facts.output.name}}', 'utf8');
await writeFile(join(root,'O.hbs'), '# OUT\n{{answers.purpose.answer}}', 'utf8');

    const spec: TaskSpecV1 = {
      version: 1, id: 'ctx.generate',
      targets: { sourceTool: 'auto', outputs: ['codex'] as any },
      resources: { promptTemplate: 'P.hbs' },
      pipeline: [
        { id: 'facts', use: 'facts.v1' },
        { id: 'prompt', use: 'prompt.v1', with: { template: 'P.hbs', context: {}, forTool: '{{targets.sourceTool}}' } },
        { id: 'ask', use: 'tool.ask.v1', with: { tool: '{{targets.sourceTool}}', prompt: '{{steps.prompt.output}}', parse: 'auto_json', safeMode: true } },
        { id: 'render', use: 'render.template.v1', with: { engine: 'handlebars', template: 'O.hbs', context: {} } },
        { id: 'write', use: 'fs.write.v1', with: { path: '{{ context.files.codex }}', content: '{{ steps.render.output }}', skipIfExists: true } }
      ]
    };

    const ctx = {
      cwd: root, pkgRoot: root, userCfg: { context: { files: { codex: join(root,'AGENTS.md') } } },
      cli: {}, resources: {}, steps: {},
      targets: { sourceTool: 'codex', outputs: ['codex'] },
      contextFiles: { codex: join(root,'AGENTS.md') } as any
    };

    await runTask(spec, ctx as any);
    const out = await (await import('node:fs/promises')).readFile(join(root,'AGENTS.md'),'utf8');
    expect(out).toMatch(/# OUT/);
    expect(out).toMatch(/\ba\b/);
    await rm(root,{recursive:true,force:true});

});
});

D) Assets fallback

tests/unit/tasks.assets.fallback.spec.ts

import { describe, it, expect } from 'vitest';
import { findAssets } from '../../src/core/tasks/registry';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('assets fallback', () => {
it('finds exported templates in installed packages', async () => {
const root = await mkdtemp(join(tmpdir(),'tz-assets-'));
const mod = join(root,'agent_modules','pkg');
await mkdir(mod,{recursive:true});
await writeFile(join(mod,'agents.toml'),
`[package]\nname="pkg"\n\n[exports]\ncodex.template="templates/AGENTS.md.hbs"\n`, 'utf8');
await mkdir(join(mod,'templates'),{recursive:true});
await writeFile(join(mod,'templates/AGENTS.md.hbs'), '# AGENTS\n', 'utf8');
const found = await findAssets(root);
expect(found[0].templates.codex).toBe('templates/AGENTS.md.hbs');
});
});

⸻

9. CLI behavior (MVP)
   • tz ctx gen:
   1. Find task ctx.generate in installed packages (first match wins).
   2. If found → runTask (multi‑output per profile unless --tool).
   3. Else → assets fallback: for each tool in profile, if any package exports a template for that tool, render it with {facts} and write to context.files[tool] (skip if exists).
      • tz task run <taskId>:
      • Finds and runs the named task using the same engine (allows arbitrary tasks—e.g., docs.generate, readme.sync, mcp.merge—all code‑free).

⸻

10. Why this satisfies your goals
    • Generic: Not tied to “questions”. A task can query a tool with any prompt, render any templates, or just copy files.
    • Composable: foreach, when, set allow declarative composition without code.
    • Safe: No user code runs. Tool calls are read‑only/plan‑mode.
    • Extensible: Add step types later (e.g., json.merge.v1, yaml.patch.v1) without breaking packages.
    • Multitool: Outputs generated for every tool in profile (codex/cursor/claude/copilot), with per‑tool templates.

If you want, I can turn this into a single patch (files+tests) you can apply directly.

Totally. Here are canonical file trees you can use right now. They’re compatible with everything we’ve laid out (non‑executable packages, [tasks] + [exports] in agents.toml, tz runner, assets fallback).

⸻

1. Generic (asset‑only) package

Ships ready‑to‑render context files for one or more tools. No tasks/workflows required.

@scope/your-context/
├─ agents.toml
├─ README.md
└─ templates/
├─ AGENTS.md.hbs # Codex
├─ CLAUDE.md.hbs # Claude Code
├─ cursor.rules.hbs # Cursor (single consolidated rules file)
└─ copilot.md.hbs # GitHub Copilot repo instructions

agents.toml (asset‑only)

[package]
name = "@scope/your-context"
version = "1.0.0"
description = "Opinionated context templates for multiple tools"
license = "MIT"

[exports]
codex.template = "templates/AGENTS.md.hbs"
claude.template = "templates/CLAUDE.md.hbs"
cursor.template = "templates/cursor.rules.hbs"
copilot.template = "templates/copilot.md.hbs"

[metadata]
tz_spec_version = 1

How tz uses it
• tz ctx gen (no task found) → assets fallback:
• Renders each exported template with a minimal context (e.g., { facts }).
• Writes to configured context.files.\* paths (e.g., AGENTS.md, CLAUDE.md, .cursor/rules, .github/copilot-instructions.md).
• Great when you just want to standardize text/rules and don’t need to call tools.

⸻

2. Workflow (task) package

Ships a declarative task that tz executes (no user code). Can also include assets for rendering.

@terrazul/ctx-default/
├─ agents.toml
├─ README.md
├─ tasks/
│ └─ ctx.generate.yaml # Generic pipeline (facts → prompt → tool.ask → render → write)
├─ prompts/
│ └─ generic.md # Prompt template used by the task
├─ templates/
│ ├─ AGENTS.md.hbs # Codex output template
│ ├─ CLAUDE.md.hbs # Claude output template
│ ├─ cursor.rules.hbs # Cursor output template
│ └─ copilot.md.hbs # Copilot output template
└─ resources/
├─ questions.json # Optional: structured questions (or any JSON resource)
└─ partials/ # Optional: reusable template fragments (if you add a partials helper)
└─ \_shared.hbs

agents.toml (workflow + assets)

[package]
name = "@terrazul/ctx-default"
version = "1.0.0"
description = "Task-based context generation for multiple tools"
license = "MIT"

[tasks]
"ctx.generate" = "tasks/ctx.generate.yaml" # Used by `tz ctx gen`

[exports] # Optional (lets tz render templates directly, or used by the task)
codex.template = "templates/AGENTS.md.hbs"
claude.template = "templates/CLAUDE.md.hbs"
cursor.template = "templates/cursor.rules.hbs"
copilot.template = "templates/copilot.md.hbs"

[compatibility]
codex = ">=0.9.0"
claude-code = ">=0.2.0"
cursor = ">=1.0.0"
copilot = ">=1.0.0"

[metadata]
tz_spec_version = 1

tasks/ctx.generate.yaml (generic, not “questions”‑bound)

version: 1
id: "ctx.generate"
description: "Generate multi-tool context artifacts."

targets:
sourceTool: auto # auto|claude|codex (tool.ask source)
outputs: profile # emit for every tool in user profile (codex/cursor/claude/copilot)

resources:
promptTemplate: "prompts/generic.md"
outputTemplates:
codex: "templates/AGENTS.md.hbs"
claude: "templates/CLAUDE.md.hbs"
cursor: "templates/cursor.rules.hbs"
copilot: "templates/copilot.md.hbs"

pipeline:

- id: facts
  use: facts.v1

- id: prompt
  use: prompt.v1
  with:
  template: "{{resources.promptTemplate}}"
  context:
  facts: "{{steps.facts.output}}"
  goals: "Summarize repository purpose, tech stack, commands, architecture, risks."
  format: "Return JSON: { answers: [...], notes?: [...] }"
  forTool: "{{targets.sourceTool}}"

- id: ask
  use: tool.ask.v1
  with:
  tool: "{{targets.sourceTool}}"
  prompt: "{{steps.prompt.output}}"
  parse: "auto_json"
  safeMode: true # claude plan-mode, codex read-only
  outputs:
  answers: "{{ output.json }}"

- id: foreach_outputs
  use: foreach.v1
  with: { list: "{{targets.outputs}}", as: "tool" }
  steps:
  - id: render
    use: render.template.v1
    with:
    engine: "handlebars"
    template:
    codex: "{{resources.outputTemplates.codex}}"
    claude: "{{resources.outputTemplates.claude}}"
    cursor: "{{resources.outputTemplates.cursor}}"
    copilot: "{{resources.outputTemplates.copilot}}"
    context:
    answers: "{{ steps.ask.outputs.answers }}"
    facts: "{{ steps.facts.output }}"
  - id: write
    use: fs.write.v1
    with:
    path:
    codex: "{{ context.files.codex }}"
    claude: "{{ context.files.claude }}"
    cursor: "{{ context.files.cursor }}"
    copilot: "{{ context.files.copilot }}"
    content: "{{ steps.render.output }}"
    skipIfExists: true

How tz uses it
• tz ctx gen: 1. Finds the task ctx.generate in installed packages, 2. Executes the pipeline with safe tool flags (no repo writes), 3. Renders one output per tool in the user’s profile (codex/cursor/claude/copilot).
• If no task exists, tz falls back to rendering any exported templates.

⸻

3. Other valid shapes (you’re not limited to just two)
   • Task‑only:

@scope/task-only/
├─ agents.toml
└─ tasks/
└─ my.task.yaml

Useful for non‑context automations (e.g., docs.sync, readme.generate, mcp.merge).

    •	Single‑tool asset:

@scope/claude-rules/
├─ agents.toml
└─ templates/
└─ CLAUDE.md.hbs

Only exports a Claude template; tz will write CLAUDE.md.

    •	Mixed + extras (if you bundle agents/MCP configs):

@org/standards/
├─ agents.toml
├─ tasks/...
├─ templates/...
├─ mcp/ # JSON configs referenced by other packages/tools
└─ configurations/ # Plain markdown/json assets (non-executable)

⸻

4. Minimum requirements & conventions
   • Required file: agents.toml
   • Then choose one (or both):
   • [tasks] → at least one task spec file under tasks/
   • [exports] → at least one template file under templates/
   • No executable code in packages; keep content to markdown/JSON/templates/config.
   • Task IDs: use domain.verb (e.g., ctx.generate, docs.sync).
   • Templates: keep them tool‑specific and map via [exports].

⸻

TL;DR
• Generic (asset‑only) = agents.toml + templates/… (maps to [exports]).
• Workflow (task) = agents.toml + tasks/… (+ usually prompts/ + templates/), run by tz’s built‑in step engine.

Both shapes are first‑class and can be mixed freely.
