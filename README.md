<h1 align="center">Terrazul CLI (`tz`)</h1>

<p align="center"><code>npm i -g @terrazul/cli</code></p>

<p align="center"><strong>Terrazul CLI</strong> is the package manager for AI agent configurations. Ship reproducible Claude Code, Cursor, Gemini, and MCP setups with deterministic installs, secure packaging, and profile-aware rendering.</p>

---

## Quickstart

### Install `tz`

#### pnpm / npm (when published)

```shell
pnpm i -g @terrazul/cli
# or
npm i -g @terrazul/cli
```

---

## Why Terrazul CLI

- **Deterministic installs**: SAT-based resolver + content-addressable store deliver reproducible `agents-lock.toml` snapshots.
- **Multi-tool ready**: Generates Claude Code, Cursor, Gemini, and MCP wiring with a single install step.
- **Secure-by-default**: Rejects path traversal, strips exec bits, and keeps yanked versions out of fresh resolutions.
- **Offline-first**: Local cache mirrors upstream packages so rebuilds succeed without a network connection.
- **Profile-aware**: `tz add --profile focus` keeps workspace manifests scoped to targeted workflows.
- **Team-friendly**: Environment switching, staging tokens, and deterministic outputs keep collaborators in sync.

---

## Key Concepts & Files

- `agents.toml`: Project manifest with dependencies, compatibility rules, and profiles.
- `agents-lock.toml`: Deterministic dependency graph with integrity hashes and yanked metadata.
- `agent_modules/`: Extracted package payloads linked into local tool directories.
- `~/.terrazul/cache/` and `~/.terrazul/store/`: Content-addressable caches for fast reinstalls.
- `TERRAZUL.md`: Human-readable snapshot of the active manifest, regenerated on every install/update.

---

## Command Tour

- `tz init`: Bootstrap manifests, `.gitignore`, and optional Claude scaffolding.
- `tz add <pkg@range>`: Resolve, verify, and extract packages; updates profiles and lockfile.
- `tz install`: Install every dependency declared in `agents.toml`, refresh the lockfile, and render templates.
- `tz update [pkg]`: Plan or apply upgrades to the latest compatible non-yanked versions.
- `tz uninstall <pkg>`: Remove packages, clean symlinks, prune profiles, and refresh docs.
- `tz run -- [args...]`: Launch integrations (e.g., Claude Code) with generated MCP configs and optional profiles.
- `tz extract`: Launches an Ink-powered wizard (TTY default) to select artifacts and MCP servers; add `--no-interactive` for script-friendly flag mode.
- `tz cache prefetch`: Download SEA binaries for specific targets into `~/.terrazul/cache/sea` so cold starts work offline.
- `tz link` / `tz unlink`: Register local development packages and swap between linked and registry versions.
- `tz env *`: Manage registry endpoints and active environments without editing config files.
- `tz auth login|logout`: Manage tokens per environment.

See `tz --help` for the full command catalog and flags.

### `tz extract` Wizard Layout

- **Top bar** conveys the wizard name, step progress, and verb-oriented title (e.g., `Extract • Step 3/6 — Choose Output Directory`).
- **Body** opens with concise instructions and structured content (selection lists, counters, validation hints).
- **Action bar** keeps the primary action first (`Enter • Continue` or `Enter • Extract package`) and lists secondary shortcuts in a stable order (`Shift+Tab`, `Space`, `A`, `N`, `V`, `?`, `C`).
- **Status bar** only appears during background work, animating a spinner while analyzing or executing plans.
- **Log drawer** starts hidden; press `V` to reveal recent log lines or hide them again.
- **Review step** groups artifacts, MCP servers, and destination with counts and offers a clipboard-friendly summary via `C`.

---

## Switch registries & authenticate

```shell
# List known registries and the active target
tz env list

# Point at staging (https://staging.api.terrazul.com)
tz env use staging

# Log in (supports ChatGPT token or API key)
tz auth login
```

Tokens are stored per environment in `~/.terrazul/config.json` with 0600 permissions. Use `tz env` commands to rotate between staging, production, or local dummy registries without editing the config file by hand.

### Configure staging in `~/.terrazul/config.json`

If you prefer to edit the config directly, create `~/.terrazul/config.json` (or update the existing file) with the staging registry URL and cache defaults:

```json
{
  "registry": "https://staging.api.terrazul.com",
  "token": "tz_eM94WWtBUtF1DbuojEOvRko1TU088vIK",
  "cache": { "ttl": 3600, "maxSize": 500 },
  "telemetry": false
}
```

Restart any running `tz` processes so they reload the updated configuration. Future `tz env use` commands will migrate this legacy single-registry config into the newer environment-aware layout automatically.

## Built-in safety nets

- Every destructive operation (install overwrite, update with `--apply-force`, apply with `--force`) snapshots files into `.tz-backup/<timestamp>/...` at your project root.
- Lockfiles capture exact tarball hashes (`sha256-<base64>`) to guarantee reproducible installs, even offline.

---

## Local Development

This directory builds the CLI distributed in releases. Clone the repo and run:

```shell
pnpm install
pnpm run build     # produces dist/tz.mjs (ESM bundle with shebang & require shim)
pnpm test          # vitest suite (unit + integration scaffolding)
pnpm run lint      # ESLint (max warnings = 0)
pnpm run format    # Prettier
pnpm run test:sea  # optional: smoke the Node SEA workflow
```

To install a local SEA binary for manual testing:

```shell
pnpm run sea:install -- --as tz --dest /usr/local/bin
```

### SEA release verification

- Staged npm packages now target **Node 20+**. The release workflow rewrites `engines.node` to `>=20.0.0` and ships an ESM launcher (`bin/app.mjs`).
- Run the local verification tool before publishing to confirm metadata, compressed assets, and launcher compatibility:

  ```shell
  pnpm tsx tools/verify-sea-package.ts \
    --release-version 0.0.0-dev \
    --run-id <gha-run-id> \
    --workflow-url https://github.com/terrazul-ai/terrazul/actions/runs/<gha-run-id> \
    --gh $(pwd)/path/to/gh-stub-or-binary \
    --node20 $(nvm which 20)
  ```

  Use `--keep-stage` to inspect the staged package directory and `--skip-launch` if the current platform binary is unavailable.

- `workflow_dispatch` runs of `cli-sea-release.yml` perform staging and smoke tests but intentionally skip the final `npm publish` step.

Any semantic commit that touches `cli/` triggers CI to lint, build, test, and produce release artifacts.

---

## SEA Distribution Basics

- SEA binaries are downloaded on demand. The first launcher execution fetches the `{platform, arch}` binary described in `dist/manifest.json`, verifies its SHA-256, decompresses it into `~/.terrazul/cache/sea/<version>/<target>/`, and reuses the cached copy for future runs (including fully offline invocations).
- GitHub Releases host the authoritative compressed binaries plus `manifest.json`. The manifest provides deterministic URLs, sizes, and digests so provenance checks remain intact.
- Administrators can pre-seed caches on CI agents or air-gapped environments with `tz cache prefetch --targets linux-x64,win32-x64` and copy the populated cache directory.
- Override paths during testing or CI with `TERRAZUL_SEA_MANIFEST`, `TERRAZUL_SEA_CACHE_DIR`, and `TERRAZUL_SEA_BASE_URL`. See [`docs/sea-distribution.md`](docs/sea-distribution.md) for advanced usage and troubleshooting.

---

## Documentation & Specs

- [AGENTS.md](../AGENTS.md): Working agreement for agent metadata and memory files.
- [CLAUDE.md](../CLAUDE.md): Claude Code integration details and MCP wiring.
- [CLI Tech Spec](../techspecs/cli.md): Architecture, dependency resolver design, storage layout.
- [docs/](./docs): ADRs, command walkthroughs, and internal tooling notes.
- [Product requirements](../prds): High-level goals for the Terrazul platform.

---

## Feedback & Support

- File bugs or feature requests in [GitHub Issues](https://github.com/terrazul-ai/terrazul/issues).
- For staging token resets or registry access, reach out through your Terrazul support channel.
- Join internal Terrazul Slack `#cli` for roadmap updates and release coordination.

---

## License

Licensing will be published alongside the first public release. Until then, Terrazul CLI is available for internal evaluation only.

---

## Release Automation

- Release Please runs on pushes to `main` that touch `cli/` using the `RELEASE_PLEASE_TOKEN` PAT so downstream SEA packaging and npm publish fire automatically.
- To cut a new release, land at least one conventional commit under `cli/`, merge the generated `chore(main): release …` PR, and let the automation handle tagging plus artifact publication.
- After the release workflow completes, verify the new bundle locally with `node dist/tz.mjs --version`; it should print the tag that was just published.
