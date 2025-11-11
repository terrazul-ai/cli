import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { generateSnippetId } from '../../../src/utils/snippet-parser';

import type { ParsedAskUserSnippet, ParsedAskAgentSnippet } from '../../../src/types/snippet';

describe('utils/snippet-parser/generateSnippetId', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `tz-snippet-id-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('generates consistent ID for same askUser snippet', async () => {
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

    const id1 = await generateSnippetId(snippet1);
    const id2 = await generateSnippetId(snippet2);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^snippet_[\da-f]{8}$/);
  });

  it('generates different IDs for different questions', async () => {
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

    const id1 = await generateSnippetId(snippet1);
    const id2 = await generateSnippetId(snippet2);

    expect(id1).not.toBe(id2);
  });

  it('generates same ID regardless of variable name', async () => {
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

    const id1 = await generateSnippetId(snippet1);
    const id2 = await generateSnippetId(snippet2);

    expect(id1).toBe(id2);
  });

  it('generates different IDs for different options', async () => {
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

    const id1 = await generateSnippetId(snippet1);
    const id2 = await generateSnippetId(snippet2);

    expect(id1).not.toBe(id2);
  });

  it('generates consistent ID for askAgent snippets', async () => {
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

    const id1 = await generateSnippetId(snippet1);
    const id2 = await generateSnippetId(snippet2);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^snippet_[\da-f]{8}$/);
  });

  it('generates different IDs for file-based vs text prompts', async () => {
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

    const id1 = await generateSnippetId(snippet1);
    const id2 = await generateSnippetId(snippet2);

    expect(id1).not.toBe(id2);
  });

  it('generates different IDs for different askAgent options', async () => {
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

    const id1 = await generateSnippetId(snippet1);
    const id2 = await generateSnippetId(snippet2);

    expect(id1).not.toBe(id2);
  });

  it('generates consistent IDs across askUser and askAgent types', async () => {
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

    const id1 = await generateSnippetId(askUserSnippet);
    const id2 = await generateSnippetId(askAgentSnippet);

    expect(id1).not.toBe(id2);
  });

  // New tests for file-based prompt content hashing
  it('generates different IDs when file content changes', async () => {
    // Create a file with initial content
    const promptFile = path.join(testDir, 'prompt.txt');
    await writeFile(promptFile, 'Initial prompt content', 'utf8');

    const snippet1: ParsedAskAgentSnippet = {
      id: '',
      type: 'askAgent',
      raw: '{{ askAgent("./prompt.txt") }}',
      startIndex: 0,
      endIndex: 30,
      prompt: { kind: 'file', value: './prompt.txt' },
      options: {},
    };

    const id1 = await generateSnippetId(snippet1, testDir);

    // Modify file content
    await writeFile(promptFile, 'Modified prompt content', 'utf8');

    const id2 = await generateSnippetId(snippet1, testDir);

    // IDs should be different because file content changed
    expect(id1).not.toBe(id2);
  });

  it('generates same ID for same file with unchanged content', async () => {
    const content = 'Same prompt content';

    // Create a file
    const promptFile = path.join(testDir, 'prompt.txt');
    await writeFile(promptFile, content, 'utf8');

    const snippet: ParsedAskAgentSnippet = {
      id: '',
      type: 'askAgent',
      raw: '{{ askAgent("./prompt.txt") }}',
      startIndex: 0,
      endIndex: 30,
      prompt: { kind: 'file', value: './prompt.txt' },
      options: {},
    };

    const id1 = await generateSnippetId(snippet, testDir);
    const id2 = await generateSnippetId(snippet, testDir);

    // IDs should be same because file content hasn't changed
    expect(id1).toBe(id2);
  });

  it('falls back to path-only when file does not exist', async () => {
    const snippet: ParsedAskAgentSnippet = {
      id: '',
      type: 'askAgent',
      raw: '{{ askAgent("./nonexistent.txt") }}',
      startIndex: 0,
      endIndex: 35,
      prompt: { kind: 'file', value: './nonexistent.txt' },
      options: {},
    };

    // Should not throw, should fall back to path-only hash
    const id = await generateSnippetId(snippet, testDir);
    expect(id).toMatch(/^snippet_[\da-f]{8}$/);
  });

  it('uses path-only when packageDir is not provided', async () => {
    const snippet: ParsedAskAgentSnippet = {
      id: '',
      type: 'askAgent',
      raw: '{{ askAgent("./prompt.txt") }}',
      startIndex: 0,
      endIndex: 30,
      prompt: { kind: 'file', value: './prompt.txt' },
      options: {},
    };

    // Without packageDir, should fall back to path-only
    const id = await generateSnippetId(snippet);
    expect(id).toMatch(/^snippet_[\da-f]{8}$/);
  });
});
