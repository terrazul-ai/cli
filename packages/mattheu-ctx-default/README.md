# @mattheu/ctx-default

Snippet-based default context templates for Terrazul CLI. These templates use the
new `askUser` and `askAgent` helpers directly inside Handlebars files so authors
can gather inputs without YAML task orchestration.

## Included exports

- `AGENTS.md.hbs` – prompts you for repository summary details and renders an
  `AGENTS.md` ready for Codex and other tools.
- `CLAUDE.md.hbs` – captures audience, workflows, and generates proactive
  questions for Claude to ask before making changes.
- `COPILOT.md.hbs` – records guardrails and preferences for GitHub Copilot.
- `cursor.rules.hbs` – establishes editing rules and prompts for Cursor.

Install locally with `tz link packages/mattheu-ctx-default` or publish the
package to reuse across projects.
