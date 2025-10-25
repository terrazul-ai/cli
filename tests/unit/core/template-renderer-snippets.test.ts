import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import inquirer from 'inquirer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../../../src/core/errors';
import { planAndRender } from '../../../src/core/template-renderer';
import * as toolRunner from '../../../src/utils/tool-runner';

type ToolRunnerModule = typeof toolRunner;

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
    invokeTool: vi.fn(),
  };
});

const promptMock = vi.mocked(inquirer.prompt);
const invokeToolMock = vi.mocked(toolRunner.invokeTool);

describe('template renderer snippets integration', () => {
  let projectRoot = '';
  let agentModules = '';
  let pkgRoot = '';

  beforeAll(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-snippets-'));
    agentModules = path.join(projectRoot, 'agent_modules');
    pkgRoot = path.join(agentModules, '@test', 'demo');
    await fs.mkdir(path.join(pkgRoot, 'templates'), { recursive: true });

    await fs.writeFile(
      path.join(projectRoot, 'agents.toml'),
      `\n[package]\nname = "@test/project"\nversion = "0.1.0"\n`,
      'utf8',
    );

    await fs.writeFile(
      path.join(pkgRoot, 'agents.toml'),
      `\n[package]\nname = "@test/demo"\nversion = "1.0.0"\n\n[exports.codex]\ntemplate = "templates/AGENTS.md.hbs"\n`,
      'utf8',
    );

    const templateBody = `# Preview

User: {{ askUser('Your name?', { placeholder: 'Jane Doe' }) }}
{{ var summary = askAgent('Provide summary', { json: true }) }}
Summary: {{ vars.summary.result }}`;
    await fs.writeFile(path.join(pkgRoot, 'templates', 'AGENTS.md.hbs'), templateBody, 'utf8');
  });

  afterAll(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    promptMock.mockResolvedValue({ value: 'Alice' });
    invokeToolMock.mockResolvedValue({
      command: 'claude',
      args: [],
      stdout: '{"result":"All good"}',
      stderr: '',
    });
    await fs.rm(path.join(projectRoot, 'AGENTS.md'), { force: true });
  });

  it('renders templates with snippet inputs', async () => {
    const res = await planAndRender(projectRoot, agentModules, {
      force: true,
      packageName: '@test/demo',
      tool: 'claude',
    });

    expect(res.written).toHaveLength(1);
    const outputPath = res.written[0];
    const contents = await fs.readFile(outputPath, 'utf8');
    expect(contents).toContain('User: Alice');
    expect(contents).toContain('Summary: All good');
    expect(invokeToolMock).toHaveBeenCalledTimes(1);
    expect(promptMock).toHaveBeenCalledTimes(1);
  });

  it('propagates snippet execution failures as errors', async () => {
    invokeToolMock.mockRejectedValueOnce(new Error('tool crashed'));

    await expect(
      planAndRender(projectRoot, agentModules, {
        force: true,
        packageName: '@test/demo',
        tool: 'claude',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.TOOL_EXECUTION_FAILED,
      message: expect.stringContaining('tool crashed'),
    });

    await expect(fs.readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).rejects.toThrow();
  });

  it('forwards askUser placeholder hints to prompts', async () => {
    await planAndRender(projectRoot, agentModules, {
      force: true,
      packageName: '@test/demo',
      tool: 'claude',
    });

    expect(promptMock).toHaveBeenCalledTimes(1);
    const [questions] = promptMock.mock.calls[0];
    const question = Array.isArray(questions) ? questions[0] : questions;
    expect(question).toBeDefined();
    expect(typeof question.transformer).toBe('function');
    const transformed = question.transformer?.('', { value: '' }, { isFinal: false });
    expect(transformed).toContain('Jane Doe');
  });
});
