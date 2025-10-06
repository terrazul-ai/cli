### 🔷 M8 — `tz link` and `tz unlink`

**Prompt**

```text
SYSTEM ROLE
Implement local development linking: `tz link` (global register + project link) and `tz unlink`. Ensure cross-platform symlink behavior. Work directly in the repo.

SCOPE
- Global link registry: ~/.terrazul/links.json (map name -> absolute path)
- In package dir: `tz link` registers the package (reads agents.toml for name)
- In project dir: `tz link @scope/pkg` creates symlink/junction/copy in agent_modules/
- Record linked state in agents.toml (e.g., [linked] "@scope/pkg" = true)
- `tz unlink [@scope/pkg]` removes symlink and updates registry and agents.toml
- Idempotent and safe if already linked/unlinked

FILES TO CREATE/MODIFY
- src/commands/link.ts
- src/commands/unlink.ts
- src/utils/links.ts (read/write links.json; validate paths; resolve package names)
- src/utils/symlink.ts (create/remove symlink; Windows fallback to junction/copy)
- Modify src/commands/add.ts to skip CDN install if dep is marked linked
- tests/unit/utils/{links.test.ts,symlink.test.ts}
- tests/integration/{link-register.test.ts,link-project.test.ts,unlink.test.ts}
- tests/e2e/m8-link-unlink-flow.test.ts

CONSTRAINTS
- Never overwrite real package directories; refuse to link over non-empty dirs unless --force.
- Windows: prefer junction; fallback to copy if privileges insufficient; mark in logs.

EXECUTION CHECKLIST
1) npm ci
2) npm run lint && npm run format:check
3) npm run build
4) In a temp local package: node dist/tz.mjs link (register)
5) In a temp project: node dist/tz.mjs link @scope/pkg; verify symlink and agents.toml linked flag
6) node dist/tz.mjs unlink @scope/pkg; verify cleanup
7) npm test
8) CI green

QUALITY GATE
Run → Lint → Build → Help → Test → CI green.
```
