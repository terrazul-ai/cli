import path from 'node:path';

import type { CLIContext } from './context.js';
import type { PreprocessResult } from '../types/snippet.js';

export interface SnippetExecutionSummary {
  source: string;
  dest: string;
  output: string;
  preprocess: PreprocessResult;
}

export function reportSnippetExecutions(
  executions: SnippetExecutionSummary[],
  logger: CLIContext['logger'],
): void {
  if (executions.length === 0) return;
  for (const exec of executions) {
    const { preprocess, dest } = exec;
    for (const snippet of preprocess.parsed) {
      const result = preprocess.execution.snippets[snippet.id];
      if (!result) continue;
      const targetLabel = path.relative(process.cwd(), dest);
      if (result.error) {
        logger.warn(
          `snippet ${snippet.id} (${snippet.type}) in ${targetLabel} failed: ${result.error.message}`,
        );
        continue;
      }
      if (!logger.isVerbose()) continue;
      const preview = formatSnippetValue(result.value);
      logger.info(`snippet ${snippet.id} (${snippet.type}) → ${preview}`);
    }
  }
}

export function formatSnippetValue(value: unknown): string {
  if (value === null || value === undefined) return '(empty)';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed || '(empty)';
  }
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized.length > 200 ? `${serialized.slice(0, 197)}…` : serialized;
  } catch {
    return String(value);
  }
}
