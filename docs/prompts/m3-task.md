SYSTEM ROLE
Implement a SAT-based dependency resolver using minisat + semver, full yanked-version policy, and the `tz update` command with dry-run and atomic replace. Wire install to use the resolver. Work directly in the repo.

CONTEXT
CNF: var per (pkg, version); AtMostOne per package; dependency implications; at-least-one for roots. Prefer latest via decision order (semver desc). Yanked policy: skip by default; allow yanked only if pinned by lock (warn). Update must be atomic (temp dir → swap).

SCOPE

1. DependencyResolver (`src/core/dependency-resolver.ts`):
   - Build constraints from registry data; solve with minisat; select versions.
   - Options: skipYanked=true, allowYankedFromLock=true, preferLatest=true.
   - Return `ResolvedDependencies` map + warnings/conflicts.
2. Wire `install` to resolver.
3. `tz update [package]? [--dry-run]`:
   - Plan vs lock & semver constraints.
   - Dry-run prints plan; real run downloads, verifies, extracts to temp, swaps atomically; updates lockfile & `TERRAZUL.md`.
   - Never update to yanked versions.

FILES TO CREATE/MODIFY

- src/core/dependency-resolver.ts
- src/commands/update.ts (real)
- src/commands/install.ts (switch to resolver)
- tests/unit/core/dependency-resolver-{basic,transitive,conflict,prefer-latest,yanked,no-candidates}.test.ts
- tests/integration/update-{dry-run,happy-path,yanked-skip,multi-package,atomic-swap}.test.ts
- tests/e2e/m3-update-flow.test.ts

ALLOWED RUNTIME DEPENDENCIES
minisat, semver (plus prior).

TESTS

- Resolver: basic, transitive, conflict, prefer-latest, yanked handling, no candidates.
- Update: dry-run accuracy; atomic swap; lockfile updated; no yanked selected for new installs/updates.

CONSTRAINTS

- No hidden globals; resolver uses DI for registry and logger.
- Keep commands thin.

EXECUTION CHECKLIST

1. `pnpm ci`
2. Start dummy registry
3. `pnpm run lint` & `pnpm run format:check`
4. `pnpm run build`
5. In a temp project:
   - `node dist/tz.mjs install` (uses SAT)
   - `node dist/tz.mjs update --dry-run` → plan shown
   - `node dist/tz.mjs update` → atomic update; lockfile updated
6. Verify no yanked in new resolutions
7. `pnpm test` (unit + integration + e2e)
8. CI green (matrix)

QUALITY GATE

- Same global gate; ensure resolver tests cover conflicts and transitive dependencies.
