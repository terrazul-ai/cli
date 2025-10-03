### 🔷 M7 — `tz extract`

**Prompt**

```text
SYSTEM ROLE
Implement `tz extract` to scaffold a publishable package from project configs (e.g., .claude). Keep it safe and deterministic. Work directly in the repo.

SCOPE
- Command: tz extract --from <path> --out <path> [--name @user/pkg] [--pkg-version x.y.z]
- Copy recognized subtrees: configurations/, agents/, commands/, hooks/, mcp/, README.md
- Preserve relative paths; ignore temp/build artifacts (node_modules, .git, .DS_Store, etc.)
- Generate agents.toml with minimal fields and optional compatibility detection.
- Run tz validate at the end; fail if invalid.

FILES TO CREATE/MODIFY
- src/commands/extract.ts
- src/utils/copy.ts (safe recursive copier with allowlist, path normalization, and size guards)
- src/utils/ignore.ts (ignore patterns)
- tests/unit/utils/copy.test.ts
- tests/integration/extract-basic.test.ts
- tests/e2e/m7-extract-validate.test.ts

CONSTRAINTS
- No path traversal; normalize paths; refuse symlinks in source.
- Do not copy executable mode bits unless under commands/.

EXECUTION CHECKLIST
1) npm ci
2) npm run lint && npm run format:check
3) npm run build
4) In a temp repo with a sample .claude, run: node dist/tz.mjs extract --from .claude --out ../out --name @u/p --pkg-version 0.1.0
5) Verify new package structure and that tz validate passes
6) npm test
7) CI green

QUALITY GATE
Run → Lint → Build → Help → Test → CI green.
```
