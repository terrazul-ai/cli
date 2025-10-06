# ADR 0005: Template Rendering with Handlebars

Date: 2025-09-11

## Status

Accepted

## Context

- We extract project AI configuration files (e.g., `.claude/` and `CLAUDE.md`) into package templates using the `tz extract` command. Templates are saved as `.hbs` files under `templates/` inside a package.
- We install these packages to `agent_modules/` with `tz add` but lacked a step to render these templates into actual files in a consumer project (e.g., `./CLAUDE.md`, `./.claude/settings.local.json`).
- We need a deterministic, portable renderer that supports variable interpolation across multiple packages and outputs to well-known destinations.

## Decision

- Introduce a small, focused template renderer built on the `handlebars` library to process `.hbs` files packaged under `templates/`.
- Add a new `tz apply` command that scans installed packages and renders their templates into the project root. It supports `--force` (overwrite) and `--dry-run` flags.
- Integrate an optional apply step into `tz add` (enabled by default, disable with `--no-apply`). The install-time apply skips existing files by default; users can re-run `tz apply --force` to overwrite.

## Rationale

- Handlebars is mature, widely used, secure by default for basic interpolation, and small enough for our use. It avoids bringing in a heavier runtime engine and aligns with our goal of simple text templating.
- Keeping the renderer as core logic (pure functions + file I/O) makes it testable and cross-platform.
- `tz apply` provides explicit control for users and CI; the install integration smooths the most common workflow while remaining safe.

## Details

- New module: `src/core/template-renderer.ts` which:
  - Builds a render plan from package manifests (`agents.toml` → `[exports]`).
  - Supports known keys: `template`, `settings`, `settingsLocal`, `mcpServers`, and `subagentsDir` (Claude).
  - Maps template paths under `templates/` to destinations using user config defaults (`context.files`) and known locations for Claude assets.
  - Renders with a context containing `project`, `pkg`, `env`, `now`, and `files`.

- New command: `tz apply [package] [--force] [--dry-run]`.
- `tz add` adds `--no-apply` and `--apply-force` options and applies templates for newly installed packages when enabled.

## Alternatives Considered

- Custom mini-templating: less capability, more maintenance, no ecosystem.
- EJS/Mustache: comparable but Handlebars’ block helpers and escaping semantics are a better fit should we extend.
- Rendering by default always overwriting: unsafe for user changes.

## Consequences

- Runtime dependency added: `handlebars@^4.7.8`.
- Unit tests added for template rendering paths and overwrite policy.
- Better out-of-the-box UX: install → apply without extra commands.
