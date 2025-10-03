Awesome—here’s a **staged build plan** broken down into **atomic tasks**, with a **file-by-file scaffold** and a **comprehensive test suite** per task so each part is hardened before integration. I keep to your tech stack and suggested libraries, add only what’s necessary in dev-time (Vitest is already included), and avoid external test libs by spinning a tiny in-process dummy server and real tar fixtures.

---

# Milestone Map

- **M0** – Project foundation (tooling, CI, build)
- **M1** – CLI skeleton, config, logging, auth shell
- **M2** – Storage, lockfile, install (end-to-end via dummy API)
- **M3** – SAT resolver, yanked handling, update
- **M4** – Publish / yank / unyank, Claude integration, run
- **M5** – Hardening, performance, distribution

Each Milestone below has:

- **Tasks**
- **Files created/modified**
- **Tests** (unit / integration / e2e)
- **Exit Criteria**

---

## M0 – Project Foundation

### Tasks

1. **Repo bootstrap & build**
2. **TypeScript strict config**
3. **Vitest harness**
4. **CI pipeline (GitHub Actions)**
5. **Consistent scripts & linting (optional)**

### File structure & contents

```
cli/
├─ package.json
├─ tsconfig.json
├─ build.config.mjs                # esbuild (from your spec)
├─ vitest.config.ts
├─ src/
│  └─ index.ts                    # empty entry wired later
├─ tests/
│  ├─ setup/
│  │  ├─ env.ts                   # test env prep (tmp dirs, spies)
│  │  └─ server.ts                # helper to start/stop dummy server per suite
│  └─ unit/
│     └─ smoke.test.ts
└─ .github/
   └─ workflows/ci.yml
```

**Key contents**

- **`package.json`**: from your spec (scripts: `build`, `test`, `prepublishOnly`)
- **`tsconfig.json`**:
  - `"strict": true`, `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"types": ["vitest"]`

- **`vitest.config.ts`**:
  - `test.environment: 'node'`, `setupFiles: ['tests/setup/env.ts']`, coverage thresholds

- **`.github/workflows/ci.yml`**:
- matrix: `os: [ubuntu-latest, macos-latest, windows-latest]`, `node: [22]`
  - jobs: install → build → test

### Tests

**Unit**

- `tests/unit/smoke.test.ts`
  - **Build runs**: `require('../dist/tz.mjs')` exists post-build.
  - **Shebang present** in bundle (first line starts `#!/usr/bin/env node`).
  - **No extraneous deps**: only declared runtime deps in `package.json`.

**Exit Criteria**

- CI green (Linux/macOS/Windows, Node 22)
- `pnpm run build` creates `dist/tz.mjs` with shebang and sourcemap
- `vitest` passes baseline tests

---

## M1 – CLI skeleton, Config, Logging, Auth Shell

### Tasks

1. **CLI wiring with `commander`**: define commands & global `--verbose`
2. **Logger** (`chalk`): levels + verbose mode
3. **User config** (`zod`): read/write `~/.terrazul/config.json` with 0600
4. **Auth shell**: login/logout stubs (manual paste flow + browser open); token shape

### File structure & contents

```
src/
├─ index.ts
├─ commands/
│  ├─ auth.ts
│  ├─ init.ts                    # stub for now
│  ├─ install.ts                 # stub
│  ├─ update.ts                  # stub
│  ├─ publish.ts                 # stub
│  ├─ run.ts                     # stub
│  └─ yank.ts                    # stub (yank/unyank in one file)
├─ utils/
│  ├─ logger.ts
│  ├─ config.ts
│  ├─ auth.ts
│  └─ context.ts
├─ types/
│  ├─ config.ts
│  └─ api.ts
```

**Implementation notes**

- **`utils/config.ts`** guards 0600; warn on looser perms (Unix) and skip warning on Windows
- **`utils/auth.ts`**:
  - Starts localhost callback server (random high port)
  - **Fallback**: paste token; validate prefix `tz_` with `zod`
  - Save `{ token, tokenExpiry, username }` (PATs only; no refresh token)

### Tests

**Unit**

- `tests/unit/utils/config.test.ts`
  - Creates default config when file absent
  - Persists & reads config; preserves unknown keys
  - Enforces/warns for file perms (skip assertion on Windows)

- `tests/unit/utils/logger.test.ts`
  - `info/warn/error` print, `debug` prints only with `--verbose`

- `tests/unit/commands/auth.test.ts`
  - **Login manual flow**: when callback not used, prompt accepts valid token, rejects invalid prefixes
  - Saves PAT token & optional expiry; sets username
  - Logout clears tokens

**Integration**

- `tests/integration/cli-help.test.ts`
  - `tz --help` shows all commands and descriptions

- `tests/integration/auth-roundtrip.test.ts`
  - Simulates login with paste; config updated; `tz auth logout` invalidates tokens

**Exit Criteria**

- `tz --help` prints full command list
- `tz auth login/logout` write and clear config correctly
- Config file 0600 on Unix; Windows tolerant

---

## M2 – Storage, Lockfile, Install (E2E with Dummy API)

### Tasks

1. **Storage Manager** (`tar`, SHA-256 hashing, extract, CAS caching)
2. **Lockfile** (`@iarna/toml` read/write `agents-lock.toml`)
3. **Registry Client** (dummy API JSON protocol + tarball redirects, token passthrough)
4. **`tz init`** (agents.toml writer, `.gitignore` update, detect `.claude/`)
5. **`tz install`** (install a package or all deps; generate `TERRAZUL.md`; basic resolver placeholder)
6. **Dummy Registry Server** (fixtures, in-process for tests)

### File structure & contents

```
src/
├─ core/
│  ├─ storage.ts
│  ├─ lock-file.ts
│  ├─ registry-client.ts
│  ├─ package-manager.ts          # orchestrates install
│  └─ errors.ts
├─ utils/
│  ├─ fs.ts                       # exists(), symlink helpers (cross-platform)
│  ├─ hash.ts                     # sha256 helpers
│  └─ terrazul-md.ts              # generator
tools/
├─ dummy-registry.ts              # can be spawned for manual testing
├─ make-fixtures.ts               # build tarball fixtures
fixtures/
├─ packages/
│  └─ @terrazul/starter/
│     └─ 1.0.0.tgz
└─ work/
   └─ @terrazul/starter/          # source for the tar fixture
      ├─ agents/test-writer.yaml
      └─ configurations/main.md
```

**Implementation notes**

- **Storage security**:
  - Verify SHA-256 of tarball (reject on mismatch)
  - Tar extraction: prevent **path traversal** (no `..`, no absolute paths)

- **Lockfile**:
  - `integrity: "sha256-<base64>"` (store base64; compute from hex)
  - Merge existing lockfile packages on partial installs

- **Package Manager**:
  - Parallel downloads (up to 5); simple `Promise.allSettled` batching
  - For M2, resolver returns the single requested version from dummy API

- **TERRAZUL.md**:
  - Follows your template; lists installed packages

### Tests

**Unit**

- `tests/unit/core/storage.test.ts`
  - `store()` returns stable hash for same content
  - `verify()` true/false on correct/incorrect content
  - `extractTarball()` extracts expected files
  - Rejects tar with files escaping dest (e.g., `../evil`)
  - Handles empty tar gracefully (no crash)

- `tests/unit/core/lock-file.test.ts`
  - Reads/writes TOML; preserves `metadata`
  - Merges new packages without losing existing
  - Integrity value uses `sha256-` and base64 payload

- `tests/unit/core/registry-client.test.ts`
  - Follows redirects for tarball URL
  - Sends `Authorization` when token present
  - On 401 without refresh token → throws `AUTH_REQUIRED`
  - Tolerates dummy API returning `success: true` or raw payload

- `tests/unit/utils/terrazul-md.test.ts`
  - Generates expected header and entries

**Integration**

- `tests/integration/init.test.ts`
  - `tz init` creates minimal `agents.toml`; updates `.gitignore`
  - Detects `.claude/` (if created) and writes compatibility

- `tests/integration/install-single.test.ts`
  - Points CLI `registry` to **in-process dummy server**
  - `tz install @terrazul/starter@^1.0.0`:
    - Creates `agent_modules` with extracted files
    - Writes `agents-lock.toml` with `resolved`, `integrity`, `version`
    - Writes `TERRAZUL.md`

- `tests/integration/install-from-agents-toml.test.ts`
  - `agents.toml` with `[dependencies]` works without explicit arg

- `tests/integration/integrity-mismatch.test.ts`
  - Corrupt tarball fixture → install fails with clear message; no partial state

**E2E**

- `tests/e2e/m2-install-flow.test.ts`
  - `tz init` → add dep → `tz install` → verify content & lockfile & md

**Exit Criteria**

- Full install flow works against dummy API
- Tampered tarballs rejected
- Lockfile and md generation deterministic

---

## M3 – SAT Resolver, Yanked Handling, Update

### Tasks

1. **DependencyResolver** (minisat + semver)
2. **Yanked handling** (skip by default; allow from lock)
3. **`tz update`** (compute plan, `--dry-run`, atomic replace)
4. **Changelog preview** (optional: from dummy API `releaseNotes` field if present)

### File structure & contents

```
src/core/
├─ dependency-resolver.ts
└─ package-manager.ts             # extended to call resolver and update
src/commands/
├─ update.ts                      # real implementation
└─ install.ts                     # uses resolver now
```

**Implementation notes**

- Build CNF: **AtMostOne** per package; **implications** for dependencies
- Prefer-latest: minisat decision order (semver desc)
- When lockfile pins a yanked version & `allowYankedFromLock` → permit with warning
- Update command:
  - Reads lockfile & constraints
  - Determines newer compatible versions (excluding yanked)
  - Shows plan; on non-dry: download, verify, replace atomically (temp dir → swap)
  - Update lockfile + TERRAZUL.md

### Tests

**Unit**

- `tests/unit/core/dependency-resolver-basic.test.ts`
  - Resolves simple independent packages within semver

- `tests/unit/core/dependency-resolver-conflict.test.ts`
  - Package A needs C@^2, Package B needs C@^3 → solver returns conflict

- `tests/unit/core/dependency-resolver-transitive.test.ts`
  - Handles transitive deps and range narrowing

- `tests/unit/core/dependency-resolver-yanked.test.ts`
  - Yanked versions excluded unless present in lock
  - Emits warning when installing yanked from lock

**Integration**

- `tests/integration/update-dry-run.test.ts`
  - Shows plan without writing changes

- `tests/integration/update-happy-path.test.ts`
  - With dummy API exposing v1.0.0 and v1.1.0, lock @1.0.0 → updates to 1.1.0

- `tests/integration/update-yanked-skip.test.ts`
  - v1.1.0 yanked → stays at 1.0.0; clear message

- `tests/integration/resolution-multi-packages.test.ts`
  - Multiple deps & transitive deps resolved consistently; lock merges

**E2E**

- `tests/e2e/m3-update-flow.test.ts`
  - `init → install → update` with constrained ranges and a yanked version scenario

**Exit Criteria**

- SAT solver covers independent, transitive, and conflict cases
- Update respects semver and yanked policy
- Dry-run accurate; real run atomic (no half-updated trees if interrupted)

---

## M4 – Publish / Yank / Unyank, Claude Integration, Run

### Tasks

1. **`tz publish`** (validate structure; create tarball; POST to dummy API)
2. **`tz yank` / `tz unyank`** (toggle flags; audit reason optional)
3. **Claude integration** (symlink `agents/`, `commands/`, update `.claude/settings.local.json` for MCP)
4. **`tz run`** (aggregate MCP and spawn Claude Code with `--mcp-config`)
5. **Security checks** for publish:
   - **No executable code** in package payload (block `.js/.sh` unless under `commands/` and flagged as non-exec), or ensure no executable bits in tar

### File structure & contents

```
src/integrations/
├─ base.ts
├─ claude-code.ts
└─ detector.ts
src/commands/
├─ publish.ts
├─ yank.ts              # supports --unyank
└─ run.ts
tools/
└─ more-fixtures/      # for publish tests (package skeletons)
```

**Implementation notes**

- Claude symlinks:
  - `agents/*` → `.claude/agents/`
  - `commands/*` → `.claude/commands/`
  - Merge MCP servers into `.claude/settings.local.json`

- Cross-platform linking:
  - Prefer symlink; on Windows fallback to junction or copy (config option)

### Tests

**Unit**

- `tests/unit/integrations/claude-code.test.ts`
  - Creates links for agents/commands when present
  - Updates settings.local.json with MCP servers (merge behavior)
  - Idempotent linking (re-run doesn’t duplicate)

- `tests/unit/commands/publish-validate.test.ts`
  - Reject missing `agents.toml`
  - Reject executable files outside allowed dirs
  - Accept minimal valid structure

**Integration**

- `tests/integration/publish-roundtrip.test.ts`
  - `tz publish` → dummy API stores tarball & metadata → `tz install` can fetch it

- `tests/integration/yank-unyank.test.ts`
  - `tz yank @scope/pkg@1.0.0` hides version from resolver; `tz unyank` restores it

- `tests/integration/run-claude.test.ts`
  - With installed packages containing MCP configs, generates settings and spawns a **mock** Claude (spawn a dummy script) with correct `--mcp-config` flags

**E2E**

- `tests/e2e/m4-publish-install-run.test.ts`
  - Publish → Install → Run (end-to-end with Claude link creation)

**Exit Criteria**

- Publish flow produces tarball matching integrity on install
- Yank/unyank policy enforced in resolver
- Claude integration consistently links and launches with aggregated MCP

---

## M5 – Hardening, Performance, Distribution

### Tasks

1. **Error taxonomy** (`TerrazulError`, user-friendly messages, `--verbose` details)
2. **Performance** (parallel downloads cap; cache TTL; hashing during stream)
3. **Security** (tarbomb prevention, executable checks, HTTPS-only except localhost)
4. **Distribution** (pnpm publish checklist; brew/scoop manifests—later)
5. **CI enhancements** (artifact upload, smoke test `npx`)

### File structure & contents

```
src/core/errors.ts           # define ErrorCode, TerrazulError
tests/unit/core/errors.test.ts
tests/perf/                  # optional simple perf checks
.github/workflows/ci.yml     # add matrix, artifact upload
```

### Tests

**Unit**

- `tests/unit/core/errors.test.ts`
  - Map API error envelope to `TerrazulError` variants
  - `--verbose` prints stack/details; default prints short message

- `tests/unit/security/tar-safety.test.ts`
  - Reject absolute paths, `..`, symlink entries inside tar, special devices

- `tests/unit/security/executable-policy.test.ts`
  - Publish rejects executable bits unless allowed; install ensures extracted files non-exec by default

**Integration**

- `tests/integration/network-errors.test.ts`
  - Simulate timeouts / 5xx: retry with backoff; fail gracefully with actionable messages

- `tests/integration/cache-ttl.test.ts`
  - Version list cached up to TTL; refreshed after TTL

- `tests/integration/proxy-support.test.ts` (optional)
  - Honors `HTTP_PROXY/HTTPS_PROXY/NO_PROXY` envs (skip on CI if complex)

**Perf (sanity, not micro-bench)**

- `tests/perf/many-packages.test.ts`
  - Install 10 small fixtures concurrently completes under expected thresholds (skippable locally)

**Exit Criteria**

- Clear, consistent errors with actionable advice
- No tarbombs; no executable code leaks
- Reasonable performance with concurrency & cache

---

# Detailed Test Catalog (Full List)

Below is a consolidated list you can drop into your tracker. Test names map 1:1 to files described above.

### Utils / Core

- **Config**
  - Creates default config on first run
  - Reads existing config and preserves unknown props
  - Writes with 0600 perms (Unix), warns on loosened perms
  - Loads env override `TERRAZUL_TOKEN` (read-only; does not persist)

- **Logger**
  - Prints expected prefixes (`info`, `warn`, `error`)
  - `debug` only when `--verbose`

- **Hash**
  - SHA-256 hex and base64 helpers produce stable outputs

- **FS helpers**
  - `exists()` handles files/dirs
  - Symlink creation cross-platform; on Windows fallback behavior tested with stubs

- **Storage**
  - `store()` writes into CAS path structure
  - `retrieve()` returns exact bytes
  - `verify()` correct/incorrect
  - `extractTarball()` nominal case
  - Rejects tar with: absolute paths, `../`, symlink members, special files
  - Handles duplicate file entries (last-wins or reject according to policy)
  - Preserves file modes (but clears exec bits unless allowed)

- **Lockfile**
  - Round-trip TOML read/write
  - Merges new entries without dropping existing
  - `integrity` format `sha256-<base64>`
  - Writes deterministic ordering

- **Registry Client**
  - Adds `Authorization` header when token present
  - Handles redirect JSON → URL → binary fetch
  - Converts API error envelope to `TerrazulError`
  - 401 → `AUTH_REQUIRED` (no refresh flow for CLI PATs)

- **Errors**
  - Maps: `PACKAGE_NOT_FOUND`, `VERSION_CONFLICT`, `VERSION_YANKED`, `PERMISSION_DENIED`, `NETWORK_ERROR`, `INVALID_PACKAGE`, `TOKEN_EXPIRED`, `AUTH_REQUIRED`
  - `--verbose` shows `details` and stack

### Dependency Resolver

- **Basic**
  - Single package resolves to max satisfying version

- **Multiple independent**
  - A@^1, B@^2 both resolved

- **Transitive**
  - A → C@^2, B → C@^2 (shared)
  - A → C@^2, B → C@^3 (conflict) → error with conflict info

- **Prefer latest**
  - Chooses highest compatible according to semver

- **Yanked handling**
  - Yanked versions excluded by default
  - If lock pins yanked and `allowYankedFromLock=true` → allowed with warning

- **Edge ranges**
  - `~`, `^`, exact, `>=`, `<`, pre-release handling

- **No candidates**
  - Range excludes all → `VERSION_CONFLICT` style error

### Commands

- **init**
  - Creates `agents.toml` basic manifest
  - Adds `agent_modules/` to `.gitignore` (idempotent)
  - Detects `.claude/` and writes `[compatibility]`

- **install**
  - From explicit spec (`@scope/pkg@^1`) and from `agents.toml`
  - Writes `agents-lock.toml` with all required fields
  - Verifies SHA-256 mismatch → aborts with cleanup (no half-written dir)
  - Creates `TERRAZUL.md` listing installed packages
  - Parallel downloads cap observed (5)
  - Re-running is idempotent (no duplicate work if versions unchanged)

- **update**
  - `--dry-run` prints planned changes, no FS writes
  - Updates to latest compatible (non-yanked)
  - Atomic directory replacement (temp dir swap)
  - Lockfile regenerated with new integrity values

- **publish**
  - Validates package structure (required dirs & files)
  - Rejects executable code outside allowed paths
  - Tarball size within sane bounds (guard)
  - API success returns version & integrity

- **yank / unyank**
  - Yank hides version from new resolutions
  - Existing lock can still install (with warning)
  - Unyank restores visibility

- **run**
  - Aggregates MCP configs across installed packages
  - Updates `.claude/settings.local.json` (merge keys)
  - Spawns **Claude Code** (mocked) with `--mcp-config` flags
  - Forwards additional args

### Security

- **Tar traversal & symlinks** (see Storage)
- **Executable policy** on publish/install
- **HTTPS-only** enforced unless `registry` is `http://localhost:*`
- **Token file perms** & secrets never printed

### Performance (sanity)

- Install 10 small packages in ≤ \~3s on CI Linux (skippable threshold)
- Cold fetch latency bound respected with fake delay server (optional)

### Cross-platform

- Windows symlink fallback (junction/copy) path tested with stub
- Path normalization (`\` vs `/`) during tar extraction and linking

### Telemetry (if/when enabled later)

- Opt-in default false; respect config flag (basic test)

---

# Test Utilities & Fixtures

- **Dummy Server** (`tests/setup/server.ts`)
  - Starts per-suite (random port), exposes endpoints:
    - `/packages/v1/:name`
    - `/packages/v1/:name/versions`
    - `/packages/v1/:name/tarball/:version` → returns `{ url }`
    - `/cdn/:scope/:version.tgz` → serves tar bytes
    - `/packages/v1/:name/publish` (accepts tar, stores to `fixtures/packages`)
    - `/packages/v1/:name/yank/:version`, `/unyank/:version`

- **Fixtures** (`fixtures/work/...`) built by `tools/make-fixtures.ts`
  - Minimal starter package; variants to simulate:
    - Corrupt tarball
    - Tar with traversal attempt
    - Tar with symlink member
    - Package with transitive deps metadata

- **Command Runner Helper**
  - Spawn `node dist/tz.mjs` inside a temp dir
  - Captures `stdout/stderr`, exit code
  - Helpers to set env (`TERRAZUL_TOKEN`, proxy vars), cwd, registry URL

---

# CI & Quality Gates

- **Matrix**: Ubuntu, macOS, Windows × Node 18/20
- **Cache**: `~/.pnpm-store` (if pnpm) or npm cache; esbuild cache optional
- **Artifacts**: Upload `dist/tz.mjs` for smoke download
- **Smoke**: `node dist/tz.mjs --help` and a single local install test with dummy server
- **Coverage**: Gate ≥85% lines, ≥80% branches across `src/core`, `src/utils`, `src/commands`

---

# Practical Next Steps (you can start immediately)

1. Implement **M0/M1** files as laid out and get CI green.
2. Add **dummy registry** and **fixtures**; wire **M2** install E2E.
3. Implement **DependencyResolver** and port `install/update` to it (**M3**).
4. Add **publish/yank/run** and Claude links (**M4**).
5. Harden with **M5** tests and ship `0.1.0`.

If you want, I can also provide ready-to-copy **Vitest test templates** for a couple of the trickier suites (e.g., storage tar security and dependency resolver CNF encoding).

---

## Release Automation Notes (2025-10-01)

- `cli-sea-release.yml` now triggers only when a GitHub release is published (or dispatched manually) to avoid duplicate uploads clobbering SEA assets.
- `cli-release.yml` and the SEA workflow both publish to npm via GitHub’s trusted publisher flow; no `NPM_TOKEN` secret is needed and provenance is always enabled.
- When you need to re-run a release, use `gh workflow run cli-release.yml --ref <tag>` (and the SEA workflow if you need binaries) so the single-run guarantee holds.
