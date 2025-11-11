import { describe, it, expect } from 'vitest';

import { generateSnippetId } from '../../../src/utils/snippet-parser';

import type { ParsedAskUserSnippet, ParsedAskAgentSnippet } from '../../../src/types/snippet';

describe('utils/snippet-parser/generateSnippetId', () => {
  it('generates consistent ID for same askUser snippet', () => {
    const snippet1: ParsedAskUserSnippet = {
      id: '',
      type: 'askUser',
      raw: '{{ askUser("What is your name?") }}',
      startIndex: 0,
      endIndex: 34,
      question: 'What is your name?',
      options: {},
    };

    const snippet2: ParsedAskUserSnippet = {
      id: '',
      type: 'askUser',
      raw: '{{ askUser("What is your name?") }}',
      startIndex: 0,
      endIndex: 34,
      question: 'What is your name?',
      options: {},
    };

    const id1 = generateSnippetId(snippet1);
    const id2 = generateSnippetId(snippet2);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^snippet_[\da-f]{8}$/);
  });

  it('generates different IDs for different questions', () => {
    const snippet1: ParsedAskUserSnippet = {
      id: '',
      type: 'askUser',
      raw: '{{ askUser("What is your name?") }}',
      startIndex: 0,
      endIndex: 34,
      question: 'What is your name?',
      options: {},
    };

    const snippet2: ParsedAskUserSnippet = {
      id: '',
      type: 'askUser',
      raw: '{{ askUser("What is your age?") }}',
      startIndex: 0,
      endIndex: 33,
      question: 'What is your age?',
      options: {},
    };

    const id1 = generateSnippetId(snippet1);
    const id2 = generateSnippetId(snippet2);

    expect(id1).not.toBe(id2);
  });

  it('generates same ID regardless of variable name', () => {
    const snippet1: ParsedAskUserSnippet = {
      id: '',
      type: 'askUser',
      raw: '{{ var x = askUser("Question") }}',
      startIndex: 0,
      endIndex: 32,
      question: 'Question',
      options: {},
      varName: 'x',
    };

    const snippet2: ParsedAskUserSnippet = {
      id: '',
      type: 'askUser',
      raw: '{{ var y = askUser("Question") }}',
      startIndex: 0,
      endIndex: 32,
      question: 'Question',
      options: {},
      varName: 'y',
    };

    const id1 = generateSnippetId(snippet1);
    const id2 = generateSnippetId(snippet2);

    expect(id1).toBe(id2);
  });

  it('generates different IDs for different options', () => {
    const snippet1: ParsedAskUserSnippet = {
      id: '',
      type: 'askUser',
      raw: '{{ askUser("Question", { default: "A" }) }}',
      startIndex: 0,
      endIndex: 43,
      question: 'Question',
      options: { default: 'A' },
    };

    const snippet2: ParsedAskUserSnippet = {
      id: '',
      type: 'askUser',
      raw: '{{ askUser("Question", { default: "B" }) }}',
      startIndex: 0,
      endIndex: 43,
      question: 'Question',
      options: { default: 'B' },
    };

    const id1 = generateSnippetId(snippet1);
    const id2 = generateSnippetId(snippet2);

    expect(id1).not.toBe(id2);
  });

  it('generates consistent ID for askAgent snippets', () => {
    const snippet1: ParsedAskAgentSnippet = {
      id: '',
      type: 'askAgent',
      raw: '{{ askAgent("Generate README") }}',
      startIndex: 0,
      endIndex: 33,
      prompt: { kind: 'text', value: 'Generate README' },
      options: {},
    };

    const snippet2: ParsedAskAgentSnippet = {
      id: '',
      type: 'askAgent',
      raw: '{{ askAgent("Generate README") }}',
      startIndex: 0,
      endIndex: 33,
      prompt: { kind: 'text', value: 'Generate README' },
      options: {},
    };

    const id1 = generateSnippetId(snippet1);
    const id2 = generateSnippetId(snippet2);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^snippet_[\da-f]{8}$/);
  });

  it('generates different IDs for file-based vs text prompts', () => {
    const snippet1: ParsedAskAgentSnippet = {
      id: '',
      type: 'askAgent',
      raw: '{{ askAgent("prompt.txt") }}',
      startIndex: 0,
      endIndex: 28,
      prompt: { kind: 'file', value: 'prompt.txt' },
      options: {},
    };

    const snippet2: ParsedAskAgentSnippet = {
      id: '',
      type: 'askAgent',
      raw: '{{ askAgent("prompt.txt") }}',
      startIndex: 0,
      endIndex: 28,
      prompt: { kind: 'text', value: 'prompt.txt' },
      options: {},
    };

    const id1 = generateSnippetId(snippet1);
    const id2 = generateSnippetId(snippet2);

    expect(id1).not.toBe(id2);
  });

  it('generates different IDs for different askAgent options', () => {
    const snippet1: ParsedAskAgentSnippet = {
      id: '',
      type: 'askAgent',
      raw: '{{ askAgent("Prompt", { tool: "claude" }) }}',
      startIndex: 0,
      endIndex: 44,
      prompt: { kind: 'text', value: 'Prompt' },
      options: { tool: 'claude' },
    };

    const snippet2: ParsedAskAgentSnippet = {
      id: '',
      type: 'askAgent',
      raw: '{{ askAgent("Prompt", { tool: "codex" }) }}',
      startIndex: 0,
      endIndex: 43,
      prompt: { kind: 'text', value: 'Prompt' },
      options: { tool: 'codex' },
    };

    const id1 = generateSnippetId(snippet1);
    const id2 = generateSnippetId(snippet2);

    expect(id1).not.toBe(id2);
  });

  it('generates consistent IDs across askUser and askAgent types', () => {
    // These should have different IDs because they're different types
    const askUserSnippet: ParsedAskUserSnippet = {
      id: '',
      type: 'askUser',
      raw: '{{ askUser("Prompt") }}',
      startIndex: 0,
      endIndex: 23,
      question: 'Prompt',
      options: {},
    };

    const askAgentSnippet: ParsedAskAgentSnippet = {
      id: '',
      type: 'askAgent',
      raw: '{{ askAgent("Prompt") }}',
      startIndex: 0,
      endIndex: 24,
      prompt: { kind: 'text', value: 'Prompt' },
      options: {},
    };

    const id1 = generateSnippetId(askUserSnippet);
    const id2 = generateSnippetId(askAgentSnippet);

    expect(id1).not.toBe(id2);
  });
});
