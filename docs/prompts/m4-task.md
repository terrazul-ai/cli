SYSTEM ROLE
Implement package publishing to the dummy registry, yanking/unyanking, Claude Code integration (symlinks & MCP settings merge), and `tz run` to launch Claude with aggregated MCP configs. Work directly in the repo.

CONTEXT
Publish: validate structure, no executable code outside allowed dirs, tarball build, upload to dummy API. Yank/Unyank: visibility flips; existing locks can still install (warn). Claude integration: link `agents/` and `commands/` to `.claude/*`; update `.claude/settings.local.json` with merged `mcpServers` idempotently. Run: aggregate MCP configs and spawn Claude (`--mcp-config`); mock binary in tests.

SCOPE

1. `tz publish`:
   - Validate with zod + presence checks; enforce executable policy (block or strip exec bits).
   - `tar.c` to create tarball; compute SHA-256; POST to dummy API.
2. `tz yank @pkg@version` and `tz yank --unyank @pkg@version`.
3. Integrations:
   - `src/integrations/claude-code.ts`: create links; merge MCP servers; idempotent; Windows fallback (junction/copy) for symlinks.
4. `tz run -- [args...]`:
   - Aggregate MCP from `agent_modules/*/mcp/`; spawn mock Claude with proper flags.

FILES TO CREATE/MODIFY

- src/commands/{publish.ts,yank.ts,run.ts}
- src/integrations/{base.ts,claude-code.ts,detector.ts}
- tests/unit/integrations/claude-code.test.ts
- tests/unit/commands/publish-validate.test.ts
- tests/integration/{publish-roundtrip.test.ts,yank-unyank.test.ts,run-claude.test.ts}
- tests/e2e/m4-publish-install-run.test.ts
- tools/more-fixtures/\*\* (publishable packages)

ALLOWED RUNTIME DEPENDENCIES
tar, zod (plus prior).

TESTS

- Publish validates and uploads; install can fetch published artifact.
- Yank hides from resolver; lock allows install with warning; unyank restores.
- Claude links created; MCP merged without duplication; run spawns mock with correct flags.

CONSTRAINTS

- Security: reject tar symlinks/traversal; enforce executable policy.
- Cross-platform linking: Windows fallback behavior.

EXECUTION CHECKLIST

1. `pnpm ci`
2. Start dummy registry
3. `pnpm run lint` & `pnpm run format:check`
4. `pnpm run build`
5. Publish smoke: `node dist/tz.mjs publish` from valid package → then install it.
6. Yank/Unyank smoke: yanked version excluded from new resolutions; unyank restores.
7. Claude integration: after install, `node dist/tz.mjs run -- --version` (mocked); verify `.claude/settings.local.json` and links.
8. `pnpm test` (unit + integration + e2e)
9. CI green (matrix)

QUALITY GATE

- Same global gate; ensure integration tests assert idempotent link creation and MCP merge.
