Absolutely—here’s what happens end‑to‑end when you run tz extract (from an existing project) and then tz publish (from the newly created package).

I’ll use a concrete example so you can visualize files and outputs. Adjust paths/names as you like.

⸻

1. Run tz extract

### Interactive wizard (default)

If you run `tz extract` in a TTY without flags, the CLI renders an Ink wizard that guides you through:

- choosing the source directory (defaults to the current working directory),
- toggling detected artifacts and MCP servers,
- confirming output path, package metadata, and optional sanitization toggles,
- previewing the generated manifest before execution.

Press `Tab` to move between steps, `Enter`/`Space` to toggle selections, and `Esc` to cancel. The wizard reuses the underlying analysis APIs, so nothing is written until you confirm the preview.

### Flag-driven mode (CI / scripts)

Example project before extracting

~/code/my-app/
├─ package.json
├─ AGENTS.md # Codex context (optional)
├─ .claude/
│ ├─ CLAUDE.md # Claude context (optional)
│ ├─ settings.json # project-level Claude settings (shared)
│ ├─ mcp_servers.json # MCP servers (optional)
│ └─ agents/
│ └─ reviewer.md # subagent(s) (optional)
└─ .github/
└─ copilot-instructions.md # GitHub Copilot (optional)

Command

cd ~/code/my-app
tz extract --no-interactive \
 --from . \
 --out ../my-ctx \
 --name @you/my-ctx \
 --pkg-version 1.0.0

Flags you might add:
• --include-claude-local to also template .claude/settings.local.json
• --include-claude-user to also template the project‑scoped portion of ~/.claude.json or ~/.claude/settings.json
• --dry-run to preview without writing anything
• Omit `--no-interactive` to fall back to the wizard even in scripts (e.g., when running locally with TTY attached)

What tz extract does step‑by‑step 1. Detects known artifacts in --from:
• Codex: AGENTS.md (root or .codex/AGENTS.md)
• Claude: CLAUDE.md, .claude/settings.json, .claude/mcp\*servers.json, .claude/agents/\*\*/\_
• Cursor: .cursor/rules (file or directory—directory concatenates only _.txt and _.mdc deterministically)
• Copilot: .github/copilot-instructions.md 2. Sanitizes & templatizes sensitive values:
• In Claude settings JSON:
• All env entries become placeholders:
{"ANTHROPIC_API_KEY":"{{ env.ANTHROPIC_API_KEY }}"} (never copy real keys)
• Absolute paths within the project become {{ PROJECT_ROOT }}/…
• Absolute paths under your home become {{ HOME }}/…
• Other absolute paths become {{ replace_me }}
• Potentially risky script fields (e.g., apiKeyHelper, awsAuthRefresh, awsCredentialExport) are kept but set to "{{ replace_me }}"
• In MCP servers JSON:
• Rewrites pathy args the same way as above
• Claude subagents (.claude/agents/\*.md):
• Copied as templates; if a subagent embeds absolute paths, those get rewritten with placeholders too
• No secrets or machine‑specific paths are copied verbatim. 3. Writes a reusable package in --out (assets‑only, no executables):

../my-ctx/
├─ agents.toml
├─ README.md
└─ templates/
├─ AGENTS.md.hbs # if AGENTS.md existed
├─ CLAUDE.md.hbs # if CLAUDE.md existed
├─ cursor.rules.hbs # if Cursor rules existed
├─ copilot.md.hbs # if Copilot existed
└─ claude/
├─ settings.json.hbs # from .claude/settings.json (sanitized)
├─ mcp_servers.json.hbs # sanitized
└─ agents/
└─ reviewer.md.hbs

    4.	Generates agents.toml with export mappings:

[package]
name = "@you/my-ctx"
version = "1.0.0"
description = "Extracted AI context package"
license = "MIT"

[exports]
codex.template = "templates/AGENTS.md.hbs"
claude.template = "templates/CLAUDE.md.hbs"
claude.settings = "templates/claude/settings.json.hbs"
claude.subagentsDir = "templates/claude/agents"
claude.mcpServers = "templates/claude/mcp_servers.json.hbs"
cursor.template = "templates/cursor.rules.hbs"
copilot.template = "templates/copilot.md.hbs"

[metadata]
tz_spec_version = 1

    5.	Safety & ergonomics:
    •	If --out already exists and isn’t empty, the command refuses to overwrite (you’ll get a clear error).
    •	--dry-run prints a “plan”: which files would be templated and the resulting export map—no writes happen.
    •	Runs are deterministic (same inputs → same outputs).

Example snippet from templates/claude/settings.json.hbs:

{
"env": {
"ANTHROPIC_API_KEY": "{{ env.ANTHROPIC_API_KEY }}",
"OTEL_METRICS_EXPORTER": "{{ env.OTEL_METRICS_EXPORTER }}"
},
"permissions": {
"additionalDirectories": [
"{{ PROJECT_ROOT }}/docs",
"{{ replace_me }}"
]
}
}

⸻

2. Run tz publish

Now switch into the newly created package directory and publish it to the dummy registry (v0):

cd ../my-ctx
tz publish

What tz publish does step‑by‑step 1. Validates the package:
• Must contain agents.toml with [package] name and version
• Only allowed asset directories (templates/, agents/, mcp/, etc.)
• Refuses unexpected executables; clears exec bits during tar creation anyway 2. Builds a deterministic tarball:
• Uses a stable entry order, portable & noMtime options to keep bytes stable
• Includes only the whitelisted files/directories 3. Computes integrity:
• Calculates sha256-<base64> and sha256Hex of the tarball 4. Publishes to the configured registry (~/.terrazul/config.json → registry):
• POSTs the tarball to the dummy endpoint (no auth in v0)
• Registry stores the blob (e.g., on its CDN path) and responds with a tarball URL 5. Outputs a confirmation:
• Logs Published @you/my-ctx@1.0.0
• Logs Tarball: <cdn-url>
• You can now install it in any project via tz add @you/my-ctx@1.0.0

Want to double‑check without uploading?
Run tz publish --dry-run to see { size, sha256 } for the tarball and the exact file list, without making any network calls.

⸻

(Optional) Quick verification after publish

From another project (or a fresh temp dir):

mkdir -p ~/code/another-app && cd ~/code/another-app
echo '[package]\nname="another-app"\nversion="0.0.0"' > agents.toml
tz add @you/my-ctx@1.0.0

This will:
• Resolve to your newly published version
• Download and verify the tarball
• Extract safely into the local store, then link to ./agent_modules/@you/my-ctx/
• Add an entry under agents-lock.toml with version/resolved/integrity
• Update TERRAZUL.md with the installed package

⸻

Common Qs & edge cases
• What if .claude/settings.local.json or user‑level ~/.claude.json contains secrets?
They’re never copied as raw values. If you pass --include-claude-local / --include-claude-user, those files are still sanitized—env values become {{ env.X }}, and absolute paths are placeholdered or relativized.
• What if my project has only one tool (say, Claude) and no Codex/Cursor/Copilot files?
agents.toml will include only the exports that exist. The others are omitted.
• Can I overwrite an existing package folder when extracting?
Not by default. Create a clean --out or delete the old one, or run --dry-run to preview the plan first.
• Does publish require auth?
In v0/dummy it doesn’t. For production, we’ll wire tz login and enforce tokens.

⸻

TL;DR
• tz extract turns your project’s AI context (Claude/Codex/Cursor/Copilot) into a portable, sanitized, assets‑only package with a clean agents.toml export map.
• tz publish validates, tars, hashes, and uploads that package to the dummy registry, returning a CDN URL.
• You can then tz add it anywhere—fast, deterministic, and safe.
