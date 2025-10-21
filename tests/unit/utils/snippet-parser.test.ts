import { describe, expect, it } from 'vitest';

import { parseSnippets } from '../../../src/utils/snippet-parser';

describe('snippet parser', () => {
  it('parses askUser without options', () => {
    const tpl = "Intro {{ askUser('What is your name?') }} content";
    const snippets = parseSnippets(tpl);
    expect(snippets).toHaveLength(1);
    const snippet = snippets[0];
    expect(snippet.type).toBe('askUser');
    expect(snippet.question).toBe('What is your name?');
    expect(snippet.options.default).toBeUndefined();
  });

  it('parses askUser with options', () => {
    const tpl = "{{ askUser('Team?', { default: 'Platform', placeholder: 'Team name' }) }}";
    const [snippet] = parseSnippets(tpl);
    expect(snippet.type).toBe('askUser');
    expect(snippet.options).toEqual({
      default: 'Platform',
      placeholder: 'Team name',
    });
  });

  it('handles whitespace control tildes around snippets', () => {
    const tpl = "{{~ askUser('Trimmed?') ~}}";
    const [snippet] = parseSnippets(tpl);
    expect(snippet.type).toBe('askUser');
    expect(snippet.question).toBe('Trimmed?');
  });

  it('parses triple-mustache askAgent snippets', () => {
    const tpl = "{{{ askAgent('Summarize this repo') }}}";
    const [snippet] = parseSnippets(tpl);
    if (snippet.type !== 'askAgent') throw new Error('expected askAgent snippet');
    expect(snippet.prompt.kind).toBe('text');
    expect(snippet.prompt.value).toBe('Summarize this repo');
  });

  it('parses askAgent inline prompt with options', () => {
    const tpl =
      "{{ askAgent('Summarize this repo', { json: true, tool: 'claude', safeMode: false, timeoutMs: 120000 }) }}";
    const [snippet] = parseSnippets(tpl);
    if (snippet.type !== 'askAgent') throw new Error('expected askAgent snippet');
    expect(snippet.prompt.kind).toBe('text');
    expect(snippet.prompt.value).toBe('Summarize this repo');
    expect(snippet.options).toMatchObject({
      json: true,
      tool: 'claude',
      safeMode: false,
      timeoutMs: 120_000,
    });
  });

  it('detects file prompt form for relative paths', () => {
    const tpl = "{{ askAgent('templates/summary.txt') }}";
    const [snippet] = parseSnippets(tpl);
    if (snippet.type !== 'askAgent') throw new Error('expected askAgent snippet');
    expect(snippet.prompt.kind).toBe('file');
    expect(snippet.prompt.value).toBe('templates/summary.txt');
  });

  it('supports variable assignment with triple-quoted literal', () => {
    const tpl = `
    {{ var summary = askAgent(""" 
      Summarize the repository.
        Include highlights.
    """, { json: true }) }}
    `;
    const [snippet] = parseSnippets(tpl);
    if (snippet.type !== 'askAgent') throw new Error('expected askAgent snippet');
    expect(snippet.varName).toBe('summary');
    expect(snippet.prompt.kind).toBe('text');
    expect(snippet.prompt.value).toBe('Summarize the repository.\n  Include highlights.');
    expect(snippet.options.json).toBe(true);
  });

  it('parses schema option as string path', () => {
    const tpl = "{{ askAgent('Prompt', { json: true, schema: './schemas/summary.schema.js' }) }}";
    const [snippet] = parseSnippets(tpl);
    if (snippet.type !== 'askAgent') throw new Error('expected askAgent snippet');
    expect(snippet.options.schema).toEqual({ file: './schemas/summary.schema.js' });
  });

  it('parses schema option as object with export name', () => {
    const tpl =
      "{{ askAgent('Prompt', { json: true, schema: { file: './schemas/summary.js', exportName: 'SummarySchema' } }) }}";
    const [snippet] = parseSnippets(tpl);
    if (snippet.type !== 'askAgent') throw new Error('expected askAgent snippet');
    expect(snippet.options.schema).toEqual({
      file: './schemas/summary.js',
      exportName: 'SummarySchema',
    });
  });

  it('ignores non-snippet handlebars expressions', () => {
    const tpl = '{{project.name}} {{#if condition}}{{/if}}';
    const snippets = parseSnippets(tpl);
    expect(snippets).toHaveLength(0);
  });

  it('throws on unsupported askAgent option keys', () => {
    const tpl = "{{ askAgent('Prompt', { unexpected: true }) }}";
    expect(() => parseSnippets(tpl)).toThrow(/Unsupported askAgent option/);
  });

  it('throws on invalid variable name', () => {
    const tpl = "{{ var summary-text = askAgent('Prompt') }}";
    expect(() => parseSnippets(tpl)).toThrow(/Invalid variable name/);
  });

  it('throws on duplicate variable names', () => {
    const tpl = `
      {{ var result = askAgent('Prompt one') }}
      {{ var result = askAgent('Prompt two') }}
    `;
    expect(() => parseSnippets(tpl)).toThrow(/already defined/);
  });

  it('throws when json option is not boolean', () => {
    const tpl = "{{ askAgent('Prompt', { json: 'true' }) }}";
    expect(() => parseSnippets(tpl)).toThrow(/json option must be boolean/);
  });

  it('throws on malformed snippet call', () => {
    const tpl = '{{ askUser }}';
    expect(() => parseSnippets(tpl)).toThrow(/Malformed snippet/);
  });
});
