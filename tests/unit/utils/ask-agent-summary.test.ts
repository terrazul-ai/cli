import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ErrorCode, TerrazulError } from '../../../src/core/errors';
import { generateAskAgentSummary } from '../../../src/utils/ask-agent-summary';
import * as toolRunner from '../../../src/utils/tool-runner';

import type { ToolExecution } from '../../../src/utils/tool-runner';

type ToolRunnerModule = typeof toolRunner;

vi.mock('../../../src/utils/tool-runner', async () => {
  const actual = await vi.importActual<ToolRunnerModule>('../../../src/utils/tool-runner');
  return {
    ...actual,
    invokeTool: vi.fn(),
  };
});

const invokeToolMock = vi.mocked(toolRunner.invokeTool);

describe('generateAskAgentSummary', () => {
  beforeEach(() => {
    invokeToolMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('generates a concise summary from valid prompt', async () => {
    const mockToolExecution: ToolExecution = {
      command: 'claude',
      args: ['-p', '--output-format', 'json', '--model', 'claude-haiku-4-5'],
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Generate authentication module',
      }),
      stderr: '',
    };
    invokeToolMock.mockResolvedValueOnce(mockToolExecution);

    const prompt =
      'Create a comprehensive authentication system with JWT tokens, password hashing using bcrypt, and session management';
    const summary = await generateAskAgentSummary(prompt);

    expect(summary).toBe('Generate authentication module');
    expect(invokeToolMock).toHaveBeenCalledTimes(1);

    const callArgs = invokeToolMock.mock.calls[0]?.[0];
    expect(callArgs?.tool.type).toBe('claude');
    expect(callArgs?.tool.model).toBe('claude-haiku-4-5');
    expect(callArgs?.prompt).toContain('Generate a brief title for this AI task in 5-7 words');
    expect(callArgs?.prompt).toContain(prompt);
    expect(callArgs?.timeoutMs).toBe(10_000);
  });

  it('falls back to truncated prompt when tool execution fails with TOOL_NOT_FOUND', async () => {
    invokeToolMock.mockRejectedValueOnce(
      new TerrazulError(ErrorCode.TOOL_NOT_FOUND, "Command 'claude' not found in PATH", {
        command: 'claude',
      }),
    );

    const longPrompt = 'A'.repeat(100);
    const summary = await generateAskAgentSummary(longPrompt);

    expect(summary).toBe('A'.repeat(80) + '...');
    expect(summary.length).toBe(83); // 80 chars + '...'
  });

  it('falls back to truncated prompt when tool execution fails with TOOL_EXECUTION_FAILED', async () => {
    invokeToolMock.mockRejectedValueOnce(
      new TerrazulError(ErrorCode.TOOL_EXECUTION_FAILED, "Tool 'claude' exited with code 1", {
        stderr: 'Authentication failed',
        stdout: '',
      }),
    );

    const prompt = 'Create a user management system with RBAC'; // 42 chars, no truncation
    const summary = await generateAskAgentSummary(prompt);

    expect(summary).toBe(prompt); // Short enough, no truncation needed
  });

  it('falls back to truncated prompt on timeout (generic error)', async () => {
    invokeToolMock.mockRejectedValueOnce(new Error('Timeout exceeded'));

    const prompt = 'Short prompt';
    const summary = await generateAskAgentSummary(prompt);

    expect(summary).toBe('Short prompt');
  });

  it('truncates long prompts in fallback to 80 characters', async () => {
    invokeToolMock.mockRejectedValueOnce(new Error('Network error'));

    const longPrompt =
      'This is a very long prompt that exceeds eighty characters and should be truncated properly with ellipsis at the end for display purposes';
    const summary = await generateAskAgentSummary(longPrompt);

    // Should truncate at word boundary before 80 chars or at 80 chars
    expect(summary.length).toBeLessThanOrEqual(83); // 80 + '...'
    expect(summary).toContain('...');
    expect(summary).toMatch(/^This is a very long prompt/);
  });

  it('does not add ellipsis when prompt is exactly 80 characters', async () => {
    invokeToolMock.mockRejectedValueOnce(new Error('Failed'));

    const exactPrompt = 'A'.repeat(80);
    const summary = await generateAskAgentSummary(exactPrompt);

    expect(summary).toBe(exactPrompt);
    expect(summary.length).toBe(80);
  });

  it('handles empty stdout gracefully', async () => {
    const mockToolExecution: ToolExecution = {
      command: 'claude',
      args: [],
      stdout: '',
      stderr: '',
    };
    invokeToolMock.mockResolvedValueOnce(mockToolExecution);

    const prompt = 'Analyze this codebase';
    const summary = await generateAskAgentSummary(prompt);

    // Empty stdout should fall back to truncated prompt
    expect(summary).toBe('Analyze this codebase');
  });

  it('trims whitespace from tool output', async () => {
    const mockToolExecution: ToolExecution = {
      command: 'claude',
      args: [],
      stdout: JSON.stringify({
        result: '  Generate API endpoints  ',
      }),
      stderr: '',
    };
    invokeToolMock.mockResolvedValueOnce(mockToolExecution);

    const prompt = 'Create REST API endpoints for user management';
    const summary = await generateAskAgentSummary(prompt);

    expect(summary).toBe('Generate API endpoints');
  });

  it('uses correct tool specification for claude-haiku-4-5', async () => {
    const mockToolExecution: ToolExecution = {
      command: 'claude',
      args: [],
      stdout: JSON.stringify({ result: 'Summary' }),
      stderr: '',
    };
    invokeToolMock.mockResolvedValueOnce(mockToolExecution);

    await generateAskAgentSummary('Test prompt');

    const callArgs = invokeToolMock.mock.calls[0]?.[0];
    expect(callArgs?.tool).toEqual({
      type: 'claude',
      command: 'claude',
      model: 'claude-haiku-4-5',
    });
    expect(callArgs?.safeMode).toBe(true);
  });

  it('respects 10 second timeout', async () => {
    const mockToolExecution: ToolExecution = {
      command: 'claude',
      args: [],
      stdout: JSON.stringify({ result: 'Result' }),
      stderr: '',
    };
    invokeToolMock.mockResolvedValueOnce(mockToolExecution);

    await generateAskAgentSummary('Test');

    const callArgs = invokeToolMock.mock.calls[0]?.[0];
    expect(callArgs?.timeoutMs).toBe(10_000);
  });

  it('includes system prompt in tool invocation', async () => {
    const mockToolExecution: ToolExecution = {
      command: 'claude',
      args: [],
      stdout: JSON.stringify({ result: 'Build user auth' }),
      stderr: '',
    };
    invokeToolMock.mockResolvedValueOnce(mockToolExecution);

    const userPrompt = 'Build a complete user authentication system';
    await generateAskAgentSummary(userPrompt);

    const callArgs = invokeToolMock.mock.calls[0]?.[0];
    expect(callArgs?.prompt).toContain('Generate a brief title for this AI task in 5-7 words');
    expect(callArgs?.prompt).toContain('Prompt:');
    expect(callArgs?.prompt).toContain(userPrompt);
  });

  describe('improved fallback behavior', () => {
    it('collapses multi-line prompts to single line in fallback', async () => {
      invokeToolMock.mockRejectedValueOnce(new Error('Failed'));

      const multiLinePrompt = `You are to write a summary
      of the key areas I can investigate
      in this authentication system`;
      const summary = await generateAskAgentSummary(multiLinePrompt);

      // Should collapse newlines and extra spaces to single space
      expect(summary).not.toContain('\n');
      expect(summary).toMatch(/^You are to write a summary of the key areas/);
    });

    it('truncates at word boundaries when possible', async () => {
      invokeToolMock.mockRejectedValueOnce(new Error('Failed'));

      const longPrompt =
        'Create a comprehensive authentication system with JWT tokens and password hashing using bcrypt for maximum security';
      const summary = await generateAskAgentSummary(longPrompt);

      // Should truncate at word boundary - last character before "..." should not be in middle of word
      // The summary should end with a complete word followed by "..."
      const beforeEllipsis = summary.slice(0, -3); // Remove "..."
      const lastChar = beforeEllipsis.at(-1);
      expect(lastChar).toMatch(/[A-Za-z]/); // Should end with a letter (complete word)
      expect(summary.length).toBeLessThanOrEqual(83); // 80 + '...'
      expect(summary).toContain('Create a comprehensive authentication');
    });

    it('truncates at 80 characters for long prompts', async () => {
      invokeToolMock.mockRejectedValueOnce(new Error('Failed'));

      const longPrompt = 'A'.repeat(150);
      const summary = await generateAskAgentSummary(longPrompt);

      expect(summary).toBe('A'.repeat(80) + '...');
      expect(summary.length).toBe(83); // 80 + '...'
    });

    it('preserves prompts shorter than 80 characters', async () => {
      invokeToolMock.mockRejectedValueOnce(new Error('Failed'));

      const shortPrompt = 'Analyze this codebase for security vulnerabilities';
      const summary = await generateAskAgentSummary(shortPrompt);

      expect(summary).toBe(shortPrompt);
      expect(summary).not.toContain('...');
    });

    it('handles prompts with exactly 80 characters', async () => {
      invokeToolMock.mockRejectedValueOnce(new Error('Failed'));

      const exactPrompt = 'A'.repeat(80);
      const summary = await generateAskAgentSummary(exactPrompt);

      expect(summary).toBe(exactPrompt);
      expect(summary.length).toBe(80);
      expect(summary).not.toContain('...');
    });

    it('returns "Processing..." for empty prompts', async () => {
      invokeToolMock.mockRejectedValueOnce(new Error('Failed'));

      const summary = await generateAskAgentSummary('');

      expect(summary).toBe('Processing...');
    });

    it('returns "Processing..." for whitespace-only prompts', async () => {
      invokeToolMock.mockRejectedValueOnce(new Error('Failed'));

      const summary = await generateAskAgentSummary('   \n\n  \t  ');

      expect(summary).toBe('Processing...');
    });

    it('trims whitespace before checking length', async () => {
      invokeToolMock.mockRejectedValueOnce(new Error('Failed'));

      const promptWithWhitespace = '  Short prompt  ';
      const summary = await generateAskAgentSummary(promptWithWhitespace);

      expect(summary).toBe('Short prompt');
      expect(summary).not.toContain('...');
    });
  });
});
