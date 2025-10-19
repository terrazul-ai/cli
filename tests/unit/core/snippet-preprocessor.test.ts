import inquirer from 'inquirer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preprocessTemplate } from '../../../src/core/snippet-preprocessor';
import * as toolRunner from '../../../src/utils/tool-runner';

import type { ToolSpec } from '../../../src/types/context';
import type { ExecuteSnippetsOptions } from '../../../src/types/snippet';

type ToolRunnerModule = typeof toolRunner;

const defaultTool: ToolSpec = { type: 'claude', command: 'claude' };

const baseOptions: ExecuteSnippetsOptions = {
  projectDir: '/tmp/project',
  packageDir: '/tmp/package',
  currentTool: defaultTool,
  availableTools: [defaultTool],
  toolSafeMode: true,
  verbose: false,
  dryRun: true,
};

vi.mock('inquirer', () => {
  const prompt = vi.fn();
  return {
    default: {
      prompt,
    },
  };
});

vi.mock('../../../src/utils/tool-runner', async () => {
  const actual = await vi.importActual<ToolRunnerModule>('../../../src/utils/tool-runner');
  return {
    ...actual,
    invokeTool: vi.fn().mockResolvedValue({
      command: 'claude',
      args: [],
      stdout: 'placeholder',
      stderr: '',
    }),
  };
});

const promptMock = vi.mocked(inquirer.prompt);
const invokeToolMock = vi.mocked(toolRunner.invokeTool);

describe('snippet preprocessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    promptMock.mockResolvedValue({ value: 'Answer' });
    invokeToolMock.mockResolvedValue({
      command: 'claude',
      args: [],
      stdout: '{"result":"ok"}',
      stderr: '',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns original template when no snippets present', async () => {
    const tpl = 'Hello {{project.name}}';
    const result = await preprocessTemplate(tpl, baseOptions);
    expect(result.template).toBe(tpl);
    expect(result.parsed).toHaveLength(0);
  });

  it('replaces inline snippet with snippets map reference', async () => {
    const tpl = "Start {{ askUser('Question?') }} End";
    const result = await preprocessTemplate(tpl, baseOptions);
    expect(result.template).toContain('{{{ snippets.snippet_0.value }}}');
    expect(result.renderContext.snippets.snippet_0?.value).toBe('Answer');
  });

  it('preserves whitespace control markers when replacing inline snippets', async () => {
    const tpl = "Line A\n{{~ askAgent('Prompt') ~}}\nLine C";
    const result = await preprocessTemplate(tpl, baseOptions);
    const expected = 'Line A\n{{{~ snippets.snippet_0.value ~}}}\nLine C';
    expect(result.template).toBe(expected);
  });

  it('supports dash whitespace control markers when replacing inline snippets', async () => {
    const tpl = "Alpha\n{{- askAgent('Prompt') -}}\nOmega";
    const result = await preprocessTemplate(tpl, baseOptions);
    const expected = 'Alpha\n{{{- snippets.snippet_0.value -}}}\nOmega';
    expect(result.template).toBe(expected);
  });

  it('trims whitespace for var snippets with tilde controls', async () => {
    const tpl = "{{~ var summary = askAgent('Prompt') ~}}\nHeading";
    const result = await preprocessTemplate(tpl, baseOptions);
    expect(result.template).toBe('Heading');
  });

  it('trims whitespace for var snippets with dash controls', async () => {
    const tpl = "Intro\n{{- var summary = askAgent('Prompt') -}}\nBody";
    const result = await preprocessTemplate(tpl, baseOptions);
    expect(result.template).toBe('IntroBody');
  });

  it('replaces var assignment with vars lookup', async () => {
    const tpl =
      "{{ var summary = askAgent('Prompt', { json: true }) }}Later: {{ vars.summary.result }}";
    const result = await preprocessTemplate(tpl, baseOptions);
    expect(result.template).not.toContain('var summary');
    expect(result.renderContext.vars.summary).toEqual({ result: 'ok' });
  });

  it('interpolates askAgent prompts with vars and snippets context', async () => {
    promptMock.mockResolvedValueOnce({ value: 'Echo' });
    const tpl = `
      {{ var answer = askUser('Your name?') }}
      {{ askAgent('Use {{ vars.answer }} and {{ snippets.snippet_0 }} in prompt', { json: true }) }}
    `;
    await preprocessTemplate(tpl, baseOptions);
    const call = invokeToolMock.mock.calls[0]?.[0];
    expect(call?.prompt).toContain('Echo');
    expect(call?.prompt).toContain('Use Echo and Echo in prompt');
  });
});
