import { z } from 'zod';

// Zod schemas for nested profile/context config used by CLI context generation.
// Keep these colocated with UserConfigSchema to avoid cross-file schema imports.
export const DEFAULT_ENVIRONMENTS = {
  production: { registry: 'https://api.terrazul.com' },
  staging: { registry: 'https://staging.api.terrazul.com' },
} as const;

const EnvironmentConfigSchema = z
  .object({
    registry: z.string().min(1),
    token: z.string().optional(),
    tokenExpiry: z.number().int().positive().optional(),
    username: z.string().optional(),
  })
  .strict();
const ToolSpecSchema = z.object({
  type: z.enum(['claude', 'codex', 'cursor', 'copilot']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  model: z.string().optional(),
  env: z.record(z.string()).optional(),
});

const ContextFilesSchema = z
  .object({
    claude: z.string().default('CLAUDE.md'),
    codex: z.string().default('AGENTS.md'),
    cursor: z.string().default('.cursor/rules'),
    copilot: z.string().default('.github/copilot-instructions.md'),
  })
  .partial()
  .default({});

export const UserConfigSchema = z.object({
  registry: z.string().default('https://api.terrazul.com'),
  token: z.string().optional(),
  tokenExpiry: z.number().int().positive().optional(),
  username: z.string().optional(),
  environment: z.string().default('production'),
  environments: z.record(EnvironmentConfigSchema).default({ ...DEFAULT_ENVIRONMENTS }),
  cache: z
    .object({
      ttl: z.number().int().nonnegative().default(3600),
      maxSize: z.number().int().nonnegative().default(500),
    })
    .default({ ttl: 3600, maxSize: 500 }),
  telemetry: z.boolean().default(false),
  profile: z
    .object({
      tools: z.array(ToolSpecSchema).optional(),
    })
    .partial()
    .default({}),
  context: z
    .object({
      maxTurns: z.number().int().positive().optional(),
      files: ContextFilesSchema,
    })
    .partial()
    .default({}),
});

export type UserConfig = z.infer<typeof UserConfigSchema>;
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;
export type EnvironmentName = string;
