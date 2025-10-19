import { executeSnippets } from './snippet-executor.js';
import { parseSnippets } from '../utils/snippet-parser.js';

import type {
  ParsedSnippet,
  PreprocessOptions,
  PreprocessResult,
  RenderableSnippetContext,
  SnippetExecutionContext,
} from '../types/snippet.js';

interface Replacement {
  start: number;
  end: number;
  text: string;
}

export async function preprocessTemplate(
  template: string,
  options: PreprocessOptions,
): Promise<PreprocessResult> {
  const parsed = parseSnippets(template);
  if (parsed.length === 0) {
    const emptyExecution: SnippetExecutionContext = { snippets: {}, vars: {} };
    return {
      template,
      parsed,
      execution: emptyExecution,
      renderContext: { snippets: {}, vars: {} },
    };
  }

  const execution = await executeSnippets(parsed, options);
  const replacements = buildReplacements(parsed);
  const transformed = applyReplacements(template, replacements);
  const renderContext = buildRenderableContext(parsed, execution);

  return {
    template: transformed,
    parsed,
    execution,
    renderContext,
  };
}

function buildReplacements(parsed: ParsedSnippet[]): Replacement[] {
  return parsed.map((snippet) => {
    if (snippet.varName) {
      return {
        start: snippet.startIndex,
        end: snippet.endIndex,
        text: '',
      };
    }
    return {
      start: snippet.startIndex,
      end: snippet.endIndex,
      text: `{{{ snippets.${snippet.id}.value }}}`,
    };
  });
}

function applyReplacements(template: string, replacements: Replacement[]): string {
  let result = template;
  const ordered = [...replacements].sort((a, b) => b.start - a.start);
  for (const replacement of ordered) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  return result;
}

function buildRenderableContext(
  parsed: ParsedSnippet[],
  execution: SnippetExecutionContext,
): RenderableSnippetContext {
  const snippetValues: Record<string, { value: unknown }> = {};
  const varValues: Record<string, unknown> = { ...execution.vars };

  for (const snippet of parsed) {
    const entry = execution.snippets[snippet.id];
    if (!entry) continue;
    const placeholder = entry.error ? `(error: ${entry.error.message})` : (entry.value ?? '');
    snippetValues[snippet.id] = { value: placeholder };
    if (snippet.varName) {
      varValues[snippet.varName] = entry.error ? placeholder : entry.value;
    }
  }

  return { snippets: snippetValues, vars: varValues };
}
