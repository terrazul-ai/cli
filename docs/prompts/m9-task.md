### 🔷 M9 — `tz unyank` (distinct command)

**Prompt**

```text
SYSTEM ROLE
Split `unyank` into a distinct top-level command and keep `tz yank` focused on yanking. Implement API calls and user messaging. Work directly in the repo.

SCOPE
- New command: tz unyank [package@version]
- Calls POST /packages/v1/{name}/unyank/{version}; requires auth
- Update help text and error messages
- Update resolver/install behavior (already skip yanked; unyank makes versions visible again)
- Maintain compatibility with prior `tz yank --unyank` as a hidden/legacy alias

FILES TO CREATE/MODIFY
- src/commands/unyank.ts
- src/commands/yank.ts (remove --unyank, add deprecation note/hidden alias)
- src/core/registry-client.ts (add unyank call)
- tests/integration/unyank-basic.test.ts
- tests/e2e/m9-yank-unyank-visibility.test.ts
- Update docs in agents.md and CLI help

CONSTRAINTS
- Auth required with meaningful error messages
- Do not change lockfile behavior; only visibility for new resolutions

EXECUTION CHECKLIST
1) npm ci
2) npm run lint && npm run format:check
3) npm run build
4) Start dummy registry
5) Smoke: yank a version; verify resolver hides it; run tz unyank; verify resolver sees it
6) npm test
7) CI green

QUALITY GATE
Run → Lint → Build → Help → Test → CI green.
```
