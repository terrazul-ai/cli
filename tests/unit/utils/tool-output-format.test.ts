import { describe, it, expect } from 'vitest';

import { formatToolAskOutput } from '../../../src/utils/tool-output';

interface StepResultLike {
  outputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

describe('formatToolAskOutput', () => {
  const baseStep: StepResultLike = {
    outputs: {},
    metadata: { tool: 'claude' },
  };

  it('formats conversation messages when present', () => {
    const step: StepResultLike = {
      ...baseStep,
      outputs: {
        text: 'conversation',
        json: {
          messages: [
            {
              type: 'user',
              message: {
                content: [{ type: 'text', text: 'What is the status?' }],
              },
              parent_tool_use_id: null,
              session_id: 's',
            },
            {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: 'The build is green.' }],
              },
              parent_tool_use_id: null,
              session_id: 's',
            },
          ],
          subtype: 'success',
          result: 'The build is green.',
        },
      },
      metadata: { tool: 'claude' },
    };

    const lines = formatToolAskOutput(step);
    expect(lines).toEqual([
      'claude user: What is the status?',
      'claude assistant: The build is green.',
    ]);
  });

  it('returns result text when no messages available', () => {
    const step: StepResultLike = {
      ...baseStep,
      outputs: {
        text: 'raw text',
        json: {
          subtype: 'success',
          result: 'Final answer',
        },
      },
      metadata: { tool: 'claude' },
    };

    const lines = formatToolAskOutput(step);
    expect(lines).toEqual(['claude result: Final answer']);
  });

  it('highlights max turn errors explicitly', () => {
    const step: StepResultLike = {
      ...baseStep,
      outputs: {
        text: 'json',
        json: {
          subtype: 'error_max_turns',
          num_turns: 4,
        },
      },
      metadata: { tool: 'claude' },
    };

    const lines = formatToolAskOutput(step);
    expect(lines[0]).toContain('reached the safe turn limit');
    expect(lines[0]).toContain('claude');
    expect(lines[0]).toContain('safeMode: false');
    expect(lines[0]).toContain('--no-tool-safe-mode');
  });

  it('falls back to raw text when nothing structured is available', () => {
    const step: StepResultLike = {
      ...baseStep,
      outputs: {
        text: 'raw text output',
      },
      metadata: { tool: 'codex' },
    };

    const lines = formatToolAskOutput(step);
    expect(lines).toEqual(['codex: raw text output']);
  });
});
