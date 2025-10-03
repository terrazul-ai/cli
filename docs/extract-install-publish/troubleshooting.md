Troubleshooting — tz extract

Common issues, causes, and quick fixes when running `tz extract`.

Output path exists and is a file

- Symptom: "Output path exists and is a file: <path>. Choose a directory path or remove the file."
- Why: `--out` points to a regular file, not a directory.
- Fix: Pick a different directory path or delete/rename the file.

Output directory not empty

- Symptom: "Output directory not empty: <path>. Re-run with --force or choose an empty directory."
- Why: `--out` already contains files.
- Fix: Run with `--force` to overwrite, or specify a new/empty directory.

No recognized inputs found

- Symptom: "No recognized inputs found under <path>. Ensure at least one exists..."
- Why: Nothing to extract in `--from`.
- Fix: Add at least one of:
  - `AGENTS.md`, `.codex/AGENTS.md`
  - `.claude/CLAUDE.md`, `.claude/settings.json`, `.claude/mcp_servers.json`, `.claude/agents/**/*.md`
  - `.cursor/rules` (file or dir)
  - `.github/copilot-instructions.md`

Malformed JSON in .claude files

- Symptom: Sanitized templates look empty.
- Why: Source JSON was invalid; extractor falls back to `{}`.
- Fix: Correct the JSON in `.claude/settings.json` or `.claude/mcp_servers.json` and re-run.

Secrets or absolute paths in outputs

- Behavior: Secrets are never copied; env is templated as `{{ env.KEY }}`. Absolute paths are replaced with `{{ PROJECT_ROOT }}/…`, `{{ HOME }}/…`, or `{{ replace_me }}`.
- Tip: After extraction, search templates for `{{ replace_me }}` to fill in project-specific values.

Include local/user settings

- Behavior: Local (`.claude/settings.local.json`) and user (`~/.claude.json`) settings are excluded by default.
- Fix: Add flags as needed:
  - `--include-claude-local`
  - `--include-claude-user`

Verbose logs

- Tip: Add `-v/--verbose` for more details on detected inputs and outputs.

Exit codes and taxonomy (relevant)

- FILE_EXISTS (1): Output conflicts (`--out` is a file or non-empty).
- INVALID_ARGUMENT (1): No recognized inputs.
- UNKNOWN_ERROR (1): Unexpected errors; re-run with `--verbose` or file an issue.
