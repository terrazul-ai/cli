SYSTEM ROLE
You are a senior TypeScript/Node CLI engineer. Implement the CLI command skeleton, dependency-injected context, user config management with zod, logger, and an auth shell. Keep commands thin; logic in core/utils. Work directly in the repo.

CONTEXT
Commands (stubs now, real later): init, install, update, publish, auth, run, yank. TypeScript/ESM source → single-file ESM bundle. TS strict.

SCOPE

1. CLI wiring (commander) with global `--verbose`.
2. DI context: `createCLIContext(opts)` exposing logger, config (read/write), registry client stub, storage stub, resolver stub.
3. Logger (chalk): info/warn/error/debug (debug gated by `--verbose`).
4. User config (zod):
   - `~/.terrazul/config.json`; defaults; 0600 perms (Unix).
   - `TERRAZUL_TOKEN` env override (read-only).
5. Auth shell:
   - `tz auth login`: localhost callback server OR manual paste fallback.
   - CLI uses long-lived Personal Access Tokens (PATs) only (no refresh tokens).
   - Validate `tz_` tokens; persist value + optional expiry + username.
   - `tz auth logout`: clear tokens.

FILES TO CREATE/MODIFY

- src/index.ts
- src/commands/{init.ts,install.ts,update.ts,publish.ts,auth.ts,run.ts,yank.ts} (stubs with help text)
- src/utils/{context.ts,logger.ts,config.ts,auth.ts}
- src/types/{config.ts,api.ts}
- tests/unit/utils/{config.test.ts,logger.test.ts}
- tests/unit/commands/auth.test.ts
- tests/integration/{cli-help.test.ts,auth-roundtrip.test.ts}

ALLOWED RUNTIME DEPENDENCIES
commander, chalk, inquirer, zod.

TESTS

- Config: defaults, read/write, 0600 perms (Unix), env override.
- Logger: verbosity gating.
- Auth: manual paste flow; logout clears tokens.
- Auth: manual paste flow accepts `tz_` tokens; logout clears tokens.
- CLI help lists all commands.

CONSTRAINTS

- Commands do orchestration only.
- No real network calls yet; registry client is stubbed.

EXECUTION CHECKLIST

1. `pnpm ci`
2. `pnpm run lint` & `pnpm run format:check`
3. `pnpm run build`
4. `node dist/tz.mjs --help` shows all commands
5. `pnpm test` passes (unit+integration)
6. CI green (matrix)

QUALITY GATE

- Same as M0 (lint/format/build/help/test/CI), with special attention to config perms on Unix and non-interactive auth tests.
