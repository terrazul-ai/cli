SYSTEM ROLE
Implement storage (CAS + safe tar extraction), lockfile, registry client (dummy API), `tz init`, and `tz add` end‑to‑end with a dummy registry and real tar fixtures. Work directly in the repo.

CONTEXT
Security: block path traversal/symlinks; SHA‑256 integrity. Lockfile: deterministic TOML with `sha256-<base64>`. Dummy registry returns JSON then redirect to CDN URL for tarball bytes.

SCOPE

1. Storage Manager:
   - CAS by SHA‑256; `store`, `retrieve`, `verify`, `getPackagePath`, `extractTarball` (reject absolute/`..`/symlink/device entries).
2. Lockfile:
   - read/write/merge `agents-lock.toml` with deterministic order and `integrity`.
3. Registry Client (dummy):
   - GET package info, versions; GET tarball metadata (`{url}`) → fetch binary; bearer auth if token exists; refresh stub.
4. `tz init`:
   - Create `agents.toml`; detect `.claude/` and set compatibility; update `.gitignore` (`agent_modules/`).
5. `tz add [@scope/name@range]?`:
   - If no arg, read `[dependencies]` from `agents.toml`.
   - Temporary resolver: pick highest satisfying version from dummy API (full SAT comes in M3).
   - Download → verify → extract to `agent_modules/`.
   - Write/merge lockfile; generate `TERRAZUL.md`.
6. Dummy registry & fixtures:
   - `tools/dummy-registry.ts`
   - `tools/make-fixtures.ts` + `fixtures/work/**` → `fixtures/packages/@terrazul/starter/1.0.0.tgz`.

FILES TO CREATE/MODIFY

- src/core/{storage.ts,lock-file.ts,registry-client.ts,package-manager.ts,errors.ts}
- src/utils/{fs.ts,hash.ts,terrazul-md.ts}
- src/commands/{init.ts (real), add.ts (real)}
- tools/{dummy-registry.ts,make-fixtures.ts}
- fixtures/{work/\*\*,packages/@terrazul/starter/1.0.0.tgz}
- tests/unit/core/{storage.test.ts,lock-file.test.ts,registry-client.test.ts}
- tests/unit/utils/terrazul-md.test.ts
- tests/integration/{init.test.ts,install-single.test.ts,install-from-agents-toml.test.ts,integrity-mismatch.test.ts}
- tests/e2e/m2-install-flow.test.ts

ALLOWED RUNTIME DEPENDENCIES
@iarna/toml, tar (plus those from M1).

TESTS

- Storage: store/retrieve/verify; extract; reject absolute/`..`/symlink/device; duplicate entries policy.
- Lockfile: round-trip; merge; deterministic order; integrity string.
- Registry client: auth header; JSON redirect to CDN; 401 behavior (no refresh).
- Init/Install flows; integrity mismatch aborts cleanly; re-run idempotent.

CONSTRAINTS

- No executable code from tar; reject symlink/device entries.
- HTTPS-only for non-local registries; allow `http://localhost:*` for dummy.

EXECUTION CHECKLIST

1. `pnpm ci`
2. `node tools/make-fixtures.ts`
3. Start dummy server: `node tools/dummy-registry.ts`
4. Point registry to `http://localhost:8787` in `~/.terrazul/config.json`
5. `pnpm run lint` & `pnpm run format:check`
6. `pnpm run build`
7. In a temp dir: `node dist/tz.mjs init` → then `node dist/tz.mjs install @terrazul/starter@^1.0.0`
8. Verify `agents-lock.toml`, `TERRAZUL.md`, and installed files
9. `pnpm test` (unit + integration + e2e)
10. CI green (matrix)

QUALITY GATE

- Same global gate (lint/format/build/help/test/CI), plus fixture build and dummy server smoke run.
