# SEA Distribution Guide

Terrazul CLI now ships a small npm package that contains the launcher (`bin/app.mjs`) and a versioned manifest (`dist/manifest.json`). Platform-specific SEA binaries are published to GitHub Releases and fetched on demand the first time the launcher executes.

## How the Launcher Works

1. Load `dist/manifest.json` (or a manifest override) and resolve the current `{platform, arch}` target.
2. Download the matching `.zst` archive, retrying with exponential backoff up to three times.
3. Verify the archive against the manifest `sha256` and stream it into a temporary location.
4. Decompress into `~/.terrazul/cache/sea/<cliVersion>/<target>/tz-<target>` and mark the binary executable.
5. Execute the cached binary. Subsequent launches reuse the cached file without network access.
6. If the download fails, the launcher falls back to the most recent cached version for the target and surfaces an actionable warning.

## Manifest Structure

`dist/manifest.json` is generated during the release pipeline via `pnpm exec tsx tools/build-sea-manifest.ts`. The schema reserves room for future signatures and mirrors the assets uploaded to GitHub Releases:

```json
{
  "schemaVersion": 1,
  "cliVersion": "0.3.1",
  "cdn": { "baseUrl": "https://github.com/terrazul-ai/terrazul/releases/download/cli-v0.3.1" },
  "targets": {
    "linux-x64": {
      "url": "https://.../tz-linux-x64.zst",
      "size": 123456,
      "sha256": "…"
    }
  }
}
```

The release workflow uploads the manifest alongside every `.zst`, `.tar.gz`, and `.zip` asset to keep provenance intact.

## Cache Layout

SEA binaries live under `~/.terrazul/cache/sea/<cliVersion>/<target>/` and are named `tz-<target>` (with `.exe` on Windows). The cache is safe to copy between machines and persists across CLI upgrades. Use `TERRAZUL_SEA_CACHE_DIR` to point the launcher at a different cache root when needed (e.g., CI workspaces or sandboxed environments).

## Pre-Seeding with `tz cache prefetch`

Administrators can warm caches ahead of time:

```shell
# Fetch binaries for linux-x64 and win32-x64 into the default cache
tz cache prefetch --targets linux-x64,win32-x64 --base-url https://mirror.internal/terrazul

# Stage a manifest override and cache location for air-gapped transfer
tz cache prefetch \
  --cli-version 3.1.4 \
  --targets linux-x64 \
  --manifest /mnt/offline/manifest.json \
  --cache-dir /mnt/offline/cache
```

The command reuses the same manifest loader and validation logic as the launcher, emitting a summary of the cached targets. Run it during image creation, CI setup, or prior to unplugging a workstation.

## Environment Overrides

| Variable                       | Purpose                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `TERRAZUL_SEA_MANIFEST`        | Absolute path to a manifest file (defaults to `dist/manifest.json` packaged with the CLI).                        |
| `TERRAZUL_SEA_BASE_URL`        | Override `cdn.baseUrl` for all downloads (useful for mirrors, local integration tests, or air-gapped staging).    |
| `TERRAZUL_SEA_CACHE_DIR`       | Override the root cache directory.                                                                                |
| `TERRAZUL_SEA_SKIP_DECOMPRESS` | Test-only flag that copies `.zst` archives verbatim (used by integration tests; **do not enable in production**). |

## Offline & Air-Gapped Workflows

1. On a connected machine, run `tz cache prefetch --targets <list>` with the manifest that matches the desired CLI version.
2. Copy both the manifest and the populated cache directory to the offline host.
3. Set `TERRAZUL_SEA_MANIFEST` and `TERRAZUL_SEA_CACHE_DIR` to the transferred locations.
4. Run `tz --version` to verify the cached binary executes without network access.

## Troubleshooting

- **Hash mismatch**: The launcher aborts without touching the cache. Regenerate the manifest to ensure the digest reflects the uploaded artifact or re-upload the binary.
- **Unsupported target**: Verify the manifest includes the `{platform, arch}` pair. Update the release pipeline if a new target was introduced.
- **Repeated downloads**: Confirm the cache directory is writable and not being wiped between runs. Check for aggressive sandboxing on CI agents.
- **Custom mirrors**: When serving binaries from a custom CDN, keep the filenames identical (`tz-<target>.zst`) so the manifest URLs stay consistent.

For deeper details, see [`tools/build-sea-manifest.ts`](../tools/build-sea-manifest.ts) and the release workflow (`.github/workflows/cli-sea-release.yml`).
