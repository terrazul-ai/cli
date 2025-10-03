### 🔷 M6 — `tz uninstall` and `tz validate`

**Prompt**

```text
SYSTEM ROLE
Implement robust package removal (`tz uninstall`) and package validation (`tz validate`). Keep commands thin; put logic in core/utils. Work directly in the repo.

SCOPE
1) tz uninstall [package]
   - Remove ./agent_modules/<pkg> (scoped-safe path).
   - Remove integration symlinks (.claude/agents/*, .claude/commands/*, MCP entries).
   - Update agents.toml ([dependencies] prune if it was a top-level dep).
   - Update agents-lock.toml (remove package; prune transitive deps not required by others).
   - Update TERRAZUL.md to remove references.
   - Idempotent if package is already absent.

2) tz validate
   - zod schema for agents.toml (package name/version/license; semver; dependencies and ranges; compatibility).
   - Filesystem checks: only allowed directories; no executables outside commands.
   - Optional online validation (--offline to skip).
   - Clear errors/warnings; non-zero exit on errors.

FILES TO CREATE/MODIFY
- src/commands/uninstall.ts
- src/commands/validate.ts
- src/core/package-manager.ts (add uninstall orchestration)
- src/utils/manifest.ts (agents.toml helpers, zod schemas)
- src/utils/prune.ts (graph-based pruning of unreferenced transitive deps)
- src/integrations/claude-code.ts (add unlink helpers)
- tests/unit/utils/manifest.test.ts
- tests/unit/utils/prune.test.ts
- tests/integration/uninstall-basic.test.ts
- tests/integration/validate-basic.test.ts
- tests/e2e/m6-uninstall-validate-flow.test.ts

CONSTRAINTS
- No destructive operations outside project dir.
- Lockfile updates must be deterministic.
- Symlink removal cross-platform: Windows junction/copy handling.

EXECUTION CHECKLIST
1) npm ci
2) npm run lint && npm run format:check
3) npm run build
4) Spin up dummy server if validate does online checks; otherwise --offline
5) npm test
6) node dist/tz.mjs uninstall @scope/pkg in a temp project; verify lock/md/links

QUALITY GATE
Run → Lint (0 warnings) → Build → Help → Test → CI green.
```
