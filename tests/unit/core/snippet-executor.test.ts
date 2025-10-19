import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import inquirer from 'inquirer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeSnippets } from '../../../src/core/snippet-executor';
import { parseSnippets } from '../../../src/utils/snippet-parser';
import * as toolRunner from '../../../src/utils/tool-runner';

import type { ToolSpec } from '../../../src/types/context';
import type { ExecuteSnippetsOptions } from '../../../src/types/snippet';

type ToolRunnerModule = typeof toolRunner;

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

vi.mock('../../../src/utils/tool-runner', async () => {
  const actual = await vi.importActual<ToolRunnerModule>('../../../src/utils/tool-runner');
  return {
    ...actual,
    invokeTool: vi.fn(),
  };
});

const promptMock = vi.mocked(inquirer.prompt);
const invokeToolMock = vi.mocked(toolRunner.invokeTool);

describe('snippet executor', () => {
  let projectDir = '';
  let packageDir = '';
  const defaultTool: ToolSpec = { type: 'claude', command: 'claude' };

  function makeOptions(overrides: Partial<ExecuteSnippetsOptions> = {}): ExecuteSnippetsOptions {
    return {
      projectDir,
      packageDir,
      currentTool: defaultTool,
      availableTools: [],
      toolSafeMode: true,
      verbose: false,
      ...overrides,
    };
  }

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-snippet-exec-'));
    packageDir = path.join(projectDir, 'agent_modules', 'pkg');
    await fs.mkdir(packageDir, { recursive: true });
    promptMock.mockReset();
    invokeToolMock.mockReset();
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('resolves askUser prompts via inquirer', async () => {
    promptMock.mockResolvedValueOnce({ value: 'Alice' });
    const snippets = parseSnippets("{{ askUser('Name?') }}");
    const context = await executeSnippets(snippets, makeOptions());
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(context.snippets.snippet_0.value).toBe('Alice');
  });

  it('calls invokeTool for askAgent snippets with inline prompt', async () => {
    invokeToolMock.mockResolvedValueOnce({
      command: 'claude',
      args: [],
      stdout: 'Completed result',
      stderr: '',
    });
    const snippets = parseSnippets("{{ askAgent('Summarize this repo') }}");
    const context = await executeSnippets(snippets, makeOptions());
    expect(invokeToolMock).toHaveBeenCalledTimes(1);
    expect(invokeToolMock.mock.calls[0]?.[0]?.prompt).toContain('Summarize this repo');
    expect(invokeToolMock.mock.calls[0]?.[0]?.prompt).toContain(
      'Respond with your best possible answer',
    );
    expect(context.snippets.snippet_0.value).toBe('Completed result');
  });

  it('detects file-based prompts relative to package directory', async () => {
    const promptPath = path.join(packageDir, 'prompts', 'summary.txt');
    await fs.mkdir(path.dirname(promptPath), { recursive: true });
    await fs.writeFile(promptPath, 'File based prompt', 'utf8');
    invokeToolMock.mockResolvedValueOnce({
      command: 'claude',
      args: [],
      stdout: 'ok',
      stderr: '',
    });
    const snippets = parseSnippets("{{ askAgent('prompts/summary.txt') }}");
    await executeSnippets(snippets, makeOptions());
    const call = invokeToolMock.mock.calls[0]?.[0];
    expect(call?.prompt).toContain('File based prompt');
  });

  it('caches repeated askAgent snippets by prompt and options', async () => {
    invokeToolMock.mockResolvedValue({
      command: 'claude',
      args: [],
      stdout: 'cached',
      stderr: '',
    });
    const snippets = parseSnippets(`
      {{ askAgent('Summarize this repo') }}
      {{ askAgent('Summarize this repo') }}
    `);
    const context = await executeSnippets(snippets, makeOptions());
    expect(invokeToolMock).toHaveBeenCalledTimes(1);
    expect(context.snippets.snippet_0.value).toBe('cached');
    expect(context.snippets.snippet_1.value).toBe('cached');
  });

  it('parses JSON output when json flag is true', async () => {
    invokeToolMock.mockResolvedValueOnce({
      command: 'claude',
      args: [],
      stdout: '{"result":"ok"}',
      stderr: '',
    });
    const snippets = parseSnippets("{{ askAgent('Prompt', { json: true }) }}");
    const context = await executeSnippets(snippets, makeOptions());
    expect(context.snippets.snippet_0.value).toEqual({ result: 'ok' });
  });

  it('validates JSON output via schema reference', async () => {
    const schemaDir = path.join(projectDir, 'schemas');
    await fs.mkdir(schemaDir, { recursive: true });
    const schemaFile = path.join(schemaDir, 'summary-schema.mjs');
    await fs.writeFile(
      schemaFile,
      `
        import { z } from 'zod';
        export const SummarySchema = z.object({ result: z.string() });
        export default SummarySchema;
      `,
      'utf8',
    );

    invokeToolMock.mockResolvedValueOnce({
      command: 'claude',
      args: [],
      stdout: '{"result":"done"}',
      stderr: '',
    });

    const snippets = parseSnippets(
      "{{ askAgent('Prompt', { json: true, schema: { file: './schemas/summary-schema.mjs', exportName: 'SummarySchema' } }) }}",
    );
    const context = await executeSnippets(snippets, makeOptions());
    expect(context.snippets.snippet_0.value).toEqual({ result: 'done' });
  });

  it('captures schema validation errors', async () => {
    const schemaFile = path.join(projectDir, 'summary-schema.mjs');
    await fs.writeFile(
      schemaFile,
      `
        import { z } from 'zod';
        export default z.object({ result: z.string() });
      `,
      'utf8',
    );
    invokeToolMock.mockResolvedValueOnce({
      command: 'claude',
      args: [],
      stdout: '{"other":"value"}',
      stderr: '',
    });
    const snippets = parseSnippets(
      "{{ askAgent('Prompt', { json: true, schema: './summary-schema.mjs' }) }}",
    );
    const context = await executeSnippets(snippets, makeOptions());
    expect(context.snippets.snippet_0.error?.message).toContain('Schema validation failed');
  });

  it('uses overridden tool specification when provided', async () => {
    invokeToolMock.mockResolvedValueOnce({
      command: 'codex',
      args: [],
      stdout: 'ok',
      stderr: '',
    });
    const codexSpec: ToolSpec = { type: 'codex', command: 'codex', args: ['exec'] };
    const snippets = parseSnippets("{{ askAgent('Prompt', { tool: 'codex' }) }}");
    await executeSnippets(snippets, makeOptions({ availableTools: [codexSpec] }));
    const call = invokeToolMock.mock.calls[0]?.[0];
    expect(call?.tool.type).toBe('codex');
    expect(call?.tool.args).toEqual(['exec']);
  });

  it('records errors when schema is provided without json flag', async () => {
    const schemaFile = path.join(projectDir, 'schema.mjs');
    await fs.writeFile(
      schemaFile,
      `
        import { z } from 'zod';
        export default z.object({ value: z.string() });
      `,
      'utf8',
    );
    invokeToolMock.mockResolvedValueOnce({
      command: 'claude',
      args: [],
      stdout: 'plain text',
      stderr: '',
    });
    const snippets = parseSnippets("{{ askAgent('Prompt', { schema: './schema.mjs' }) }}");
    const context = await executeSnippets(snippets, makeOptions());
    expect(context.snippets.snippet_0.error?.message).toMatch(/requires json: true/);
  });

  it('interpolates askAgent prompts with current vars and snippets', async () => {
    promptMock.mockResolvedValueOnce({ value: 'Delta' });
    invokeToolMock
      .mockResolvedValueOnce({
        command: 'claude',
        args: [],
        stdout: 'First result',
        stderr: '',
      })
      .mockResolvedValueOnce({
        command: 'claude',
        args: [],
        stdout: 'Second',
        stderr: '',
      });

    const snippets = parseSnippets(`
      {{ var answer = askUser('Name?') }}
      {{ var analysis = askAgent('Initial prompt') }}
      {{ askAgent('Follow up with {{ vars.answer }} and {{ snippets.snippet_1 }}') }}
    `);
    await executeSnippets(snippets, makeOptions());
    expect(invokeToolMock).toHaveBeenCalledTimes(2);
    const secondCall = invokeToolMock.mock.calls[1]?.[0];
    expect(secondCall?.prompt).toContain('Delta');
    expect(secondCall?.prompt).toContain('First result');
  });

  it('interpolates file-based askAgent prompts with current context', async () => {
    promptMock.mockResolvedValueOnce({ value: 'Echo' });
    invokeToolMock
      .mockResolvedValueOnce({
        command: 'claude',
        args: [],
        stdout: 'Primary answer',
        stderr: '',
      })
      .mockResolvedValueOnce({
        command: 'claude',
        args: [],
        stdout: 'Follow up',
        stderr: '',
      });

    const promptPath = path.join(packageDir, 'prompts', 'follow-up.txt');
    await fs.mkdir(path.dirname(promptPath), { recursive: true });
    await fs.writeFile(
      promptPath,
      'Respond using {{ vars.answer }} and {{ snippets.snippet_1 }}',
      'utf8',
    );

    const snippets = parseSnippets(`
      {{ var answer = askUser('Name?') }}
      {{ var analysis = askAgent('Initial prompt') }}
      {{ askAgent('prompts/follow-up.txt') }}
    `);
    await executeSnippets(snippets, makeOptions());

    expect(invokeToolMock).toHaveBeenCalledTimes(2);
    const followUpCall = invokeToolMock.mock.calls[1]?.[0];
    expect(followUpCall?.prompt).toContain('Echo');
    expect(followUpCall?.prompt).toContain('Primary answer');
  });

  it('prefers parsed result payload when json option is false', async () => {
    invokeToolMock.mockResolvedValueOnce({
      command: 'claude',
      args: [],
      stdout: JSON.stringify({
        type: 'result',
        result: 'Plain summary',
        duration_ms: 100,
      }),
      stderr: '',
    });
    const snippets = parseSnippets("{{ askAgent('Prompt without json flag') }}");
    const context = await executeSnippets(snippets, makeOptions());
    expect(context.snippets.snippet_0.value).toBe('Plain summary');
  });

  it('falls back to result_parsed when available', async () => {
    invokeToolMock.mockResolvedValueOnce({
      command: 'claude',
      args: [],
      stdout: JSON.stringify({
        type: 'result',
        result_parsed: { summary: 'Structured' },
      }),
      stderr: '',
    });
    const snippets = parseSnippets("{{ askAgent('Prompt again') }}");
    const context = await executeSnippets(snippets, makeOptions());
    expect(context.snippets.snippet_0.value).toEqual({ summary: 'Structured' });
  });
});
