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

  it('replaces var assignment with vars lookup', async () => {
    const tpl =
      "{{ var summary = askAgent('Prompt', { json: true }) }}Later: {{ vars.summary.result }}";
    const result = await preprocessTemplate(tpl, baseOptions);
    expect(result.template).not.toContain('var summary');
    expect(result.renderContext.vars.summary).toEqual({ result: 'ok' });
  });
});
