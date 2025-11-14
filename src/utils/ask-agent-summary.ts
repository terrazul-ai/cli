import { invokeTool, parseToolOutput } from './tool-runner.js';

import type { ToolSpec } from '../types/context.js';

/**
 * Maximum length for truncated prompts in fallback scenario
 */
const MAX_PROMPT_LENGTH = 80;

/**
 * Timeout for summary generation (10 seconds)
 */
const SUMMARY_TIMEOUT_MS = 10_000;

/**
 * Generates a concise summary of an askAgent prompt by calling Claude Haiku 4.5.
 * Falls back to truncating the original prompt if summary generation fails.
 *
 * @param prompt - The original askAgent prompt to summarize
 * @returns A concise summary (5-7 words) or truncated prompt on failure
 *
 * @example
 * ```typescript
 * const summary = await generateAskAgentSummary(
 *   'Create a comprehensive authentication system with JWT and bcrypt'
 * );
 * // Returns: "Build authentication with JWT"
 * ```
 */
export async function generateAskAgentSummary(prompt: string): Promise<string> {
  // Fallback function to truncate prompt intelligently
  const fallbackSummary = (): string => {
    // Collapse multi-line prompts and normalize whitespace
    const singleLine = prompt.replaceAll(/\s+/g, ' ').trim();

    // Return "Processing..." for empty prompts
    if (singleLine.length === 0) {
      return 'Processing...';
    }

    // Return as-is if short enough
    if (singleLine.length <= MAX_PROMPT_LENGTH) {
      return singleLine;
    }

    // Try to truncate at word boundary
    const truncated = singleLine.slice(0, MAX_PROMPT_LENGTH);
    const lastSpaceIndex = truncated.lastIndexOf(' ');

    // If we found a space and it's not too early (at least 70% of max length),
    // truncate there to avoid cutting words
    if (lastSpaceIndex > MAX_PROMPT_LENGTH * 0.7) {
      return `${truncated.slice(0, lastSpaceIndex)}...`;
    }

    // Otherwise truncate at max length
    return `${truncated}...`;
  };

  try {
    // Create tool spec for Claude Haiku 4.5
    const tool: ToolSpec = {
      type: 'claude',
      command: 'claude',
      model: 'claude-haiku-4-5',
    };

    // Build system prompt for summary generation
    const systemPrompt = `Generate a brief title for this AI task in 5-7 words.
The title should encapsulate what the prompt is attempting to do and should have no line breaks. Be concise and capture the core action.

<example>
Prompt: """What is the name of the repository"""?
Output: Determining repository name
</example>

<example>
Prompt: """You are to write a summary of this repo structure and services.

Here's an example:

<example>
This repository contains the web frontend, backend services, serverless functions, and supporting tools for SillyRobotCards. Key domains include:
- **Repo Structure**: fe/ (Next.js), be/ (Express), shared-api/ (types), db/ (migrations), lambdas/ (AWS functions)
- **Backend Services**: Domain-driven structure under be/src/services/<feature>/ with *.service.ts, *.sql.ts, *.types.ts, *.scheduler.ts
- **Frontend Domains**: Feature domains under fe/domains/ with shared components in fe/components/
- **Image Generation**: Multiple providers gated behind feature flags (FLUX, OpenAI, Qwen, Nano Banana)
- **Database**: PostgreSQL with Knex migrations and query builder
- **Testing**: Vitest for both FE and BE with comprehensive test suites
</example>

Return the summary in markdown format following the example EXACTLY.."""
Output: Analyzing project structure
</example>

<example>
Prompt: """
You are to write a summary of the key areas I can investigate.

Here's an example:

<example>
- Frontend stack, domains, routing, analytics
- Backend services, routers, SQL/Knex, schedulers
- Image generation handlers and feature flags
- Shared API usage across FE/BE
- Database schema and migrations
- Testing patterns and fixtures (FE and BE)
</example>

Return the summary in markdown format following the example EXACTLY."""
Output: Determining key research arieas
</example>


Prompt: """${prompt}"""`;

    // Invoke the tool with timeout
    const result = await invokeTool({
      tool,
      prompt: systemPrompt,
      cwd: process.cwd(),
      safeMode: true,
      timeoutMs: SUMMARY_TIMEOUT_MS,
    });

    // Parse the JSON output from Claude CLI
    const parsed = parseToolOutput(result.stdout, 'auto_json');

    // Extract the result field from the parsed output
    let summary = '';
    if (parsed && typeof parsed === 'object' && 'result' in parsed) {
      summary = String(parsed.result).trim();
    } else if (typeof parsed === 'string') {
      summary = parsed.trim();
    }

    // If empty, fall back to truncated prompt
    if (!summary) {
      return fallbackSummary();
    }

    return summary;
  } catch {
    // On any error (tool not found, execution failed, timeout, etc.),
    // fall back to truncated prompt
    return fallbackSummary();
  }
}
