import { afterEach, describe, expect, it, vi } from 'vitest';

import * as proc from '../../src/utils/proc';
import { invokeTool, parseToolOutput, stripAnsi } from '../../src/utils/tool-runner';

import type { RunResult } from '../../src/utils/proc';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tool-runner', () => {
  it('invokes codex with safe arguments', async () => {
    const spy = vi.spyOn(proc, 'runCommand').mockResolvedValue({
      stdout: '{"answers":[]}',
      stderr: '',
      exitCode: 0,
    } as RunResult);

    const result = await invokeTool({
      tool: { type: 'codex', command: 'codex', args: ['exec'] },
      prompt: 'Explain',
      cwd: '/tmp/project',
    });

    expect(spy).toHaveBeenCalledWith(
      'codex',
      ['exec', '--sandbox', 'read-only'],
      expect.objectContaining({ cwd: '/tmp/project', input: 'Explain' }),
    );
    expect(result.stdout).toContain('answers');
  });

  it('passes configured model flag to claude', async () => {
    const spy = vi.spyOn(proc, 'runCommand').mockResolvedValue({
      stdout: '{"result":"ok"}',
      stderr: '',
      exitCode: 0,
    } as RunResult);

    await invokeTool({
      tool: { type: 'claude', command: 'claude', model: 'sonnet' },
      prompt: 'Explain',
      cwd: '/tmp/project',
    });

    expect(spy).toHaveBeenCalledWith(
      'claude',
      [
        '-p',
        '--output-format',
        'json',
        '--permission-mode',
        'plan',
        '--max-turns',
        '100',
        '--model',
        'sonnet',
      ],
      expect.objectContaining({ cwd: '/tmp/project', input: 'Explain' }),
    );
  });

  it('skips --model flag when model is default', async () => {
    const spy = vi.spyOn(proc, 'runCommand').mockResolvedValue({
      stdout: '{"result":"ok"}',
      stderr: '',
      exitCode: 0,
    } as RunResult);

    await invokeTool({
      tool: { type: 'claude', command: 'claude', model: 'default' },
      prompt: 'Explain',
      cwd: '/tmp/project',
    });

    const args = spy.mock.calls[0]?.[1] ?? [];
    expect(args).not.toContain('--model');
    expect(args).not.toContain('default');
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
  });

  it('expands spec env vars before invoking tool', async () => {
    const spy = vi.spyOn(proc, 'runCommand').mockResolvedValue({
      stdout: '{"result":"ok"}',
      stderr: '',
      exitCode: 0,
    } as RunResult);

    process.env.TZ_FAKE_TOKEN = 'from-env';

    await invokeTool({
      tool: {
        type: 'codex',
        command: 'codex',
        args: ['exec', '--sandbox', 'custom'],
        env: {
          TOKEN: 'env:TZ_FAKE_TOKEN',
          REGION: 'us-east-1',
        },
      },
      prompt: 'Explain',
      cwd: '/tmp/project',
    });

    const call = spy.mock.calls[0];
    expect(call?.[2]?.env).toMatchObject({ TOKEN: 'from-env', REGION: 'us-east-1' });
    delete process.env.TZ_FAKE_TOKEN;
  });

  it('overrides conflicting claude flags when safe mode is enabled', async () => {
    const spy = vi.spyOn(proc, 'runCommand').mockResolvedValue({
      stdout: '{"result":"ok"}',
      stderr: '',
      exitCode: 0,
    } as RunResult);

    await invokeTool({
      tool: {
        type: 'claude',
        command: 'claude',
        args: ['--permission-mode', 'execute', '--max-turns', '42'],
      },
      prompt: 'Explain',
      cwd: '/tmp/project',
    });

    const args = spy.mock.calls[0]?.[1] ?? [];
    expect(args).toContain('--permission-mode');
    expect(args).toContain('plan');
    expect(args).toContain('--max-turns');
    expect(args).toContain('100');
    expect(args).not.toContain('execute');
    expect(args).not.toContain('42');
  });

  it('skips safe-mode defaults when safe mode is disabled', async () => {
    const spy = vi.spyOn(proc, 'runCommand').mockResolvedValue({
      stdout: '{"result":"ok"}',
      stderr: '',
      exitCode: 0,
    } as RunResult);

    await invokeTool({
      tool: { type: 'claude', command: 'claude' },
      prompt: 'Explain',
      cwd: '/tmp/project',
      safeMode: false,
    });

    const args = spy.mock.calls[0]?.[1] ?? [];
    expect(args).not.toContain('--permission-mode');
    expect(args).not.toContain('plan');
    expect(args).not.toContain('--max-turns');
    expect(args).not.toContain('100');
  });

  it('parses fenced JSON output', () => {
    const parsed = parseToolOutput('```json\n{"answers":["ok"]}\n```');
    expect(parsed).toEqual({ answers: ['ok'] });
  });

  it('parses JSON embedded in result field and exposes answers', () => {
    const output = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '```json\n{"answers":[{"id":"one","answer":"ok"}]}\n```',
    });
    const parsed = parseToolOutput(output) as Record<string, unknown>;
    expect(parsed).toBeTruthy();
    const answers = parsed?.answers as Array<Record<string, string>>;
    expect(Array.isArray(answers)).toBe(true);
    expect(answers[0]?.answer).toBe('ok');
    const nested = parsed?.result_parsed as Record<string, unknown>;
    expect(nested?.answers).toEqual([{ id: 'one', answer: 'ok' }]);
  });

  it('strips ANSI sequences before parsing', () => {
    const raw = '\u001B[32m{"data":true}\u001B[0m';
    expect(stripAnsi(raw)).toBe('{"data":true}');
    const parsed = parseToolOutput(raw, 'json');
    expect(parsed).toEqual({ data: true });
  });

  it('throws on non-zero exit code', async () => {
    vi.spyOn(proc, 'runCommand').mockResolvedValue({
      stdout: '',
      stderr: 'failure',
      exitCode: 1,
    } as RunResult);

    await expect(
      invokeTool({ tool: { type: 'claude', command: 'claude' }, prompt: 'Hi', cwd: '/tmp' }),
    ).rejects.toMatchObject({ code: 'TOOL_EXECUTION_FAILED' });
  });
});
