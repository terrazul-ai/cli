### 🔷 M10 — `tz login` / `tz logout` (top‑level aliases) + docs

**Prompt**

```text
SYSTEM ROLE
Add top-level aliases for authentication: `tz login` and `tz logout`, delegating to `tz auth login/logout`. Update docs and CLI help. Work directly in the repo.

SCOPE
- New commands: src/commands/login.ts and src/commands/logout.ts that simply call into the auth command logic
- Ensure tokens stored in ~/.terrazul/config.json (0600) and default registry URL is saved if absent
- Update help/usage docs in agents.md and README
- Ensure these commands appear in tz --help alongside auth

FILES TO CREATE/MODIFY
- src/commands/login.ts
- src/commands/logout.ts
- src/commands/auth.ts (export helpers if needed)
- tests/integration/auth-aliases.test.ts (login/logout aliases behave identically)
- Update docs: agents.md, README sections for login/logout

CONSTRAINTS
- No functional changes to auth flow; aliases must be exact equivalents
- Respect `TERRAZUL_TOKEN` env override (read-only)

EXECUTION CHECKLIST
1) npm ci
2) npm run lint && npm run format:check
3) npm run build
4) node dist/tz.mjs --help shows login/logout
5) npm test
6) CI green

QUALITY GATE
Run → Lint → Build → Help → Test → CI green.
```
