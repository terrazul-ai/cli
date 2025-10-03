# CLI Staging Environment Tasklist

## Summary

- Goal: Enable Terrazul CLI to switch between production and staging registries with environment-aware auth.
- Owner: Codex Assistant (GPT-5)
- Date Started: 2025-09-16

## Tasks

- [x] Confirm staging registry base URL and capabilities from Swagger docs
- [x] Extend config schema with named environments (production, staging) and migration for legacy configs
- [x] Update CLI context to resolve registry/token from active environment or env vars
- [x] Persist login/logout tokens per environment and keep legacy fields in sync
- [x] Add `tz env` command to list/use/create environments with documentation updates
- [x] Expand/adjust unit tests for config/env handling and add command coverage
- [x] Run targeted unit tests (config/auth/env) and relevant integration smoke if needed

## Notes

- Maintain backwards compatibility for existing `config.json` files without `environments`
- Respect `TERRAZUL_REGISTRY` and `TERRAZUL_TOKEN` overrides for CI/local runs
- Ensure staging defaults to `https://staging.api.terrazul.com`
