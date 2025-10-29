interface StepResultLike {
  metadata?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

type JsonRecord = Record<string, unknown>;

function extractSegmentText(segment: unknown): string {
  if (!segment || typeof segment !== 'object') {
    return typeof segment === 'string' ? segment : '';
  }
  if ('text' in segment && typeof (segment as JsonRecord).text === 'string') {
    return (segment as JsonRecord).text as string;
  }
  if ('value' in segment && typeof (segment as JsonRecord).value === 'string') {
    return (segment as JsonRecord).value as string;
  }
  return '';
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((segment) => extractSegmentText(segment))
      .filter((segment) => segment.length > 0)
      .join(' ')
      .trim();
  }
  if (content && typeof content === 'object') {
    if ('text' in content && typeof (content as JsonRecord).text === 'string') {
      return (content as JsonRecord).text as string;
    }
    if ('content' in content) {
      return extractMessageText((content as JsonRecord).content);
    }
  }
  return '';
}

function normalizeToolName(tool: unknown): string {
  if (typeof tool === 'string' && tool.trim().length > 0) {
    return tool;
  }
  return 'tool.ask';
}

function formatMessageLine(tool: string, message: JsonRecord): string | undefined {
  const role = typeof message.type === 'string' ? message.type : 'message';
  const messagePayload = message.message as JsonRecord | undefined;
  const text = messagePayload
    ? extractMessageText(messagePayload.content)
    : extractMessageText(message.content);
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return `${tool} ${role}: ${trimmed}`;
}

function hasConversationLines(lines: string[]): boolean {
  return lines.some((line) => /\buser\b|\bassistant\b/.test(line));
}

function formatError(tool: string, json: JsonRecord): string | undefined {
  const subtype = typeof json.subtype === 'string' ? json.subtype : undefined;
  if (subtype === 'error_max_turns') {
    const turns = typeof json.num_turns === 'number' ? json.num_turns : undefined;
    const suffix = turns === undefined ? '' : ` after ${turns} turns`;
    return `${tool} reached the safe turn limit${suffix}. Set safeMode: false on the package's tool.ask.v1 step or re-run tz with --no-tool-safe-mode to allow additional turns.`;
  }
  if (subtype === 'error_during_execution') {
    return `${tool} failed while executing the task. Inspect tool output for details.`;
  }
  if (json.error && typeof json.error === 'string') {
    return `${tool} error: ${json.error}`;
  }
  return undefined;
}

export function formatToolAskOutput(step: StepResultLike): string[] {
  const outputs = step.outputs ?? {};
  const text = typeof outputs.text === 'string' ? outputs.text.trim() : '';
  const tool = normalizeToolName(step.metadata?.tool);
  const json = outputs.json as JsonRecord | undefined;
  const lines: string[] = [];

  if (json && typeof json === 'object') {
    const errorLine = formatError(tool, json);
    if (errorLine) {
      lines.push(errorLine);
      return lines;
    }

    const messages = Array.isArray(json.messages) ? (json.messages as JsonRecord[]) : undefined;
    if (messages) {
      for (const message of messages) {
        const formatted = formatMessageLine(tool, message);
        if (formatted) {
          lines.push(formatted);
        }
      }
    }

    if (!hasConversationLines(lines)) {
      const resultText = typeof json.result === 'string' ? json.result.trim() : '';
      if (resultText.length > 0) {
        lines.push(`${tool} result: ${resultText}`);
      }
    }
  }

  if (lines.length === 0) {
    if (text.length > 0) {
      lines.push(`${tool}: ${text}`);
    } else {
      lines.push(`${tool}: (no output)`);
    }
  }

  return lines;
}
