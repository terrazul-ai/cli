SYSTEM ROLE
Harden the CLI: error taxonomy and messages, performance (concurrency, cache TTL, streaming hash), security (HTTPS-only except localhost, tarbomb prevention), and distribution polish. Work directly in the repo.

CONTEXT
Errors: map API envelope → `TerrazulError` codes; `--verbose` shows details. Performance: concurrency cap 5; version list cache TTL; streaming SHA-256 during download. Security: enforce HTTPS (except localhost); reject tar symlinks/device nodes/traversal; config perms on Unix. Distribution: pnpm publish readiness; CI smoke for `node dist/tz.mjs --help`; artifact upload.

SCOPE

1. Error taxonomy:
   - `src/core/errors.ts` with codes: NETWORK_ERROR, AUTH_REQUIRED, PACKAGE_NOT_FOUND, VERSION_CONFLICT, VERSION_YANKED, PERMISSION_DENIED, INVALID_PACKAGE, TOKEN_EXPIRED.
   - Map envelopes to errors; user-friendly messages; verbose details when `--verbose`.
2. Performance:
   - Download manager with concurrency cap (5).
   - Registry version list cache with TTL from config.
   - Streamed hashing (avoid full-buffer when possible).
3. Security:
   - Enforce HTTPS for non-local registries.
   - Extend tar safety tests: reject devices/symlinks/traversal.
   - Verify 0600 on config (Unix) and warn if looser.
4. CI/Distribution:
   - Ensure lint/format/build/test order; artifact upload; smoke step.

FILES TO CREATE/MODIFY

- src/core/errors.ts (+ integrate with registry-client, package-manager)
- src/core/registry-client.ts (cache TTL, streaming hash, HTTPS enforcement)
- src/core/package-manager.ts (download concurrency cap)
- tests/unit/core/errors.test.ts
- tests/unit/security/{tar-safety.test.ts,executable-policy.test.ts}
- tests/integration/{network-errors.test.ts,cache-ttl.test.ts,proxy-support.test.ts (optional)}
- tests/perf/many-packages.test.ts (skippable)
- .github/workflows/ci.yml (artifact upload, smoke step)

TESTS

- Errors mapped consistently; `--verbose` shows details.
- Security: reject symlinks/devices/traversal in tar.
- Network errors retried/backoff; clear messages on failure.
- Cache TTL respected; concurrency limit observed.
- Perf sanity: install 10 fixtures within target (skippable on CI).

CONSTRAINTS

- Deterministic behavior; no hidden globals.
- Maintain stable public APIs; update docs (`agents.md`) with error taxonomy and security stance.

EXECUTION CHECKLIST

1. `pnpm ci`
2. `pnpm run lint` & `pnpm run format:check`
3. `pnpm run build` & `node dist/tz.mjs --help`
4. `pnpm test` (include security + error + perf sanity if not skipped)
5. CI green with artifact upload + smoke

QUALITY GATE

- Same global gate; additionally confirm HTTPS enforcement (except localhost) and concurrency cap in tests.
