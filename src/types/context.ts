export type ToolType = 'claude' | 'codex' | 'cursor' | 'copilot';

export interface ToolSpec {
  type: ToolType;
  command?: string;
  args?: string[];
  model?: string;
  // Values may be literal or "env:NAME" indirection; resolved at spawn time
  env?: Record<string, string>;
}

export interface ProfileConfig {
  // Priority-ordered list of tools
  tools?: ToolSpec[];
}

export interface ContextFilesMap {
  claude?: string;
  codex?: string;
  cursor?: string;
  copilot?: string;
}

export interface ContextConfig {
  maxTurns?: number;
  files?: ContextFilesMap;
}
