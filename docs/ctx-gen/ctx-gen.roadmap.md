Tasklist — ctx‑gen Implementation (self‑reference: cli/docs/ctx-gen/ctx-gen.roadmap.md)

- [x] A1: Extend manifest schema ([tasks], [exports])
  - [x] Add tool error codes (TOOL_NOT_FOUND, TOOL_EXECUTION_FAILED, TOOL_OUTPUT_PARSE_ERROR)
  - [x] Extend manifest read/validate for [tasks]/[exports] (types + Zod)
  - [x] Validate missing referenced files; warn on unknown export keys
- [x] A2: Config defaults for context.files and profile.tools
  - [x] Defaults merge and persistence
  - [x] Helpers: computeOutputTargets(), choosePrimaryAnswerTool()
  - [x] Unit tests for defaults + selection
- [ ] A3: Task loader & registry scanning (loadTaskFile, findTask, findAssets)
- [ ] A4: Template engine + interpolation (utils/template.ts; Handlebars minimal helpers)
- [ ] B1: Step engine (runTask) + steps (facts.v1, prompt.v1, tool.ask.v1, render.template.v1, fs.write.v1, foreach.v1)
- [ ] B2: Safe tool invocation + parsing (utils/tool-runner.ts; ANSI strip; mocked tests)
- [ ] C1: CLI wiring (tz task run <id> + alias tz ctx gen; --tool/--out/--dry-run)
- [ ] C2: Assets fallback when no task exists (first-match wins; warn on duplicates)
- [ ] D1: Tests – Manifest + config (parse [tasks]/[exports], missing refs error, defaults merge)
- [ ] D2: Tests – Template + runner (facts → render → write; skipIfExists)
- [ ] D3: Tests – Tool invocation parsing (Claude JSON, Codex fenced JSON; non-zero exit)
- [ ] D4: Tests – CLI integration (fake tools; dry-run success; assets fallback)
- [ ] E1: Example package fixture @terrazul/ctx-default (tasks/ctx.generate.yaml, prompts, templates)
- [ ] F: tz extract enhancement (optional) — detectors + scaffold (command currently a stub)
- [ ] G: Docs & examples — agents.md updates; step reference; example package "try it"

Awesome—here’s a pragmatic, dependency‑ordered task list you can execute to get from zero to a working ctx generator package that runs through tz.

I’ve grouped tasks into milestones so you can land small PRs with green tests at each step. Each task includes what to build and acceptance criteria.

⸻

Milestone A — Core plumbing in tz (enable packages to ship tasks/assets)

A1. Extend manifest schema: [tasks] and [exports]

Build
• Add optional sections to agents.toml:
• [tasks] → map task id to YAML/JSON spec path.
• [exports] → per‑tool template path keys: codex.template, claude.template, cursor.template, copilot.template.
• Types: extend PackageManifest and Zod schema.
• Error taxonomy: add TOOL_NOT_FOUND, TOOL_EXECUTION_FAILED, TOOL_OUTPUT_PARSE_ERROR.

Acceptance
• Loads/validates manifests with/without [tasks]/[exports].
• Invalid keys under [exports] issue warning, not crash.
• Missing files referenced in [tasks]/[exports] produce validate errors.

⸻

A2. Add config defaults for output file locations + profile tools

Build
• Extend ~/.terrazul/config.json type with:

{
"context": { "files": {
"codex": "AGENTS.md",
"claude": "CLAUDE.md",
"cursor": ".cursor/rules",
"copilot": ".github/copilot-instructions.md"
}},
"profile": { "tools": [ { "type": "codex" }, { "type": "claude" } ] }
}

    •	Merge defaults if context.files or profile.tools absent.
    •	Helper: computeOutputTargets(userCfg, spec.outputs) → list of tools in priority order.
    •	Helper: choosePrimaryAnswerTool(userCfg, override?) → first available among claude|codex.

Acceptance
• readUserConfigFrom() returns merged defaults.
• Unit test covers env override and default merging.

⸻

A3. Task loader & registry scanning

Build
• Loader loadTaskFile(pkgRoot, rel) (YAML/JSON; Zod check).
• Registry utilities:
• findTask(cwd, 'ctx.generate') → first package exporting that task.
• findAssets(cwd) → list of packages exporting templates by tool.

Acceptance
• Given an agent_modules/<pkg> with agents.toml, loader returns parsed spec.
• Registry functions discover tasks/assets in a temp project tree.

⸻

A4. Template engine + string interpolation

Build
• utils/template.ts:
• interpolate(text, context) — simple {{path.to.value}} replacement (safe, no eval).
• Integrate Handlebars (or tiny subset) for render.template.v1 step:
• Register minimal helpers (optional): eq, json.
• Support template selection per tool (pickTemplate(map, tool)).

Acceptance
• Unit: render .hbs with { facts: { name: "x" } } → outputs expected text.
• Works cross‑platform.

⸻

Milestone B — Minimal step engine (no user code, safe tool calls)

B1. Implement step engine + MVP steps

Build
• Core runner runTask(spec, ctx) with a small set of built‑in steps:
• facts.v1 → collect repo facts (package.json, scripts, shallow tree).
• prompt.v1 → load prompt template file + interpolate with given context.
• tool.ask.v1 → call a tool to get structured text/JSON (see B2).
• render.template.v1 → compile & render template with context.
• fs.write.v1 → write to output path, skipIfExists option.
• foreach.v1 → iterate a list and run nested steps.
• (Optional now, later if needed: when.v1, set.v1, fs.copy.v1.)

Acceptance
• Can run a pipeline with facts → render → write (no tool) end‑to‑end in a temp dir.
• All step inputs accept string literals or {{ }} expressions (via interpolate).

⸻

B2. Safe tool invocation (Claude/Codex) + parsing

Build
• utils/tool-runner.ts:
• Codex: codex exec --sandbox read-only --ask-for-approval never "<prompt>"
• Parse fenced JSON (```json or BEGIN/END JSON).
• Claude: claude -p --output-format json --permission-mode plan --max-turns 1 "<prompt>"
• Parse raw JSON.
• Strip ANSI codes before parsing.
• Use existing runCommand (shell on Windows; timeout; env overlay support).

Acceptance
• Unit tests (mock runCommand) for success + non‑zero exit + invalid output.
• No writes occur to the repo in integration dry‑run (we are read‑only by flags).

⸻

Milestone C — Wire it into CLI and fallback flows

C1. CLI: tz task run <taskId> (generic) + tz ctx gen (alias)

Build
• Command task run:
• Find task by id across installed packages.
• Build a TaskContext with:
• targets.sourceTool = auto (or CLI --tool to force).
• targets.outputs = profile (resolved to list via config).
• contextFiles = mapping from config defaults.
• Run the task via runner.
• Command ctx gen:
• Alias: task run ctx.generate.
• Flags: --tool, --out (optional single‑tool override), --dry-run.

Acceptance
• If a task exists, running tz ctx gen --dry-run prints rendered content (no file writes).
• Non‑dry run writes expected files; refuses overwrite if file exists (warn & non‑zero exit).

⸻

C2. Assets fallback (packages with [exports] only)

Build
• If no ctx.generate task found:
• For each tool in profile order:
• If any installed package exports a template for that tool, render it with {facts} and write to context.files[tool] (skip if exists).
• Combine outputs if multiple packages export the same tool? MVP: first match wins; log a warning on duplicates.

Acceptance
• With only an asset‑only package installed, tz ctx gen writes AGENTS.md/CLAUDE.md etc. from templates.

⸻

Milestone D — Tests you must land before shipping

Keep them small & fast. No real tools/network.

D1. Manifest + config
• Parse manifests with tasks/exports.
• Validate missing referenced files → error.
• Config defaults merged; profile.tools ordering preserved.

D2. Template + runner (no tool)
• Render template with facts.v1.
• fs.write.v1 respects skipIfExists.

D3. Tool invocation + parsing (mocked)
• Claude JSON parse, Codex fenced JSON parse.
• Errors on non‑zero exit; ANSI stripped.

D4. CLI integration (fake tools)
• Put a fake codex and fake claude script on PATH that prints canned outputs.
• tz ctx gen --dry-run succeeds using fake tools.
• Assets fallback path works when no task exists.

⸻

Milestone E — Build your ctx generator package

With the above in tz, you can now author and ship a package that implements the generic workflow.

E1. Create package skeleton (in fixtures/ for tests, later publish)

@terrazul/ctx-default/
├─ agents.toml
├─ README.md
├─ tasks/ctx.generate.yaml
├─ prompts/generic.md
└─ templates/
├─ AGENTS.md.hbs
├─ CLAUDE.md.hbs
├─ cursor.rules.hbs
└─ copilot.md.hbs

    •	agents.toml:

[package]
name = "@terrazul/ctx-default"
version = "1.0.0"

[tasks]
"ctx.generate" = "tasks/ctx.generate.yaml"

[exports]
codex.template = "templates/AGENTS.md.hbs"
claude.template = "templates/CLAUDE.md.hbs"
cursor.template = "templates/cursor.rules.hbs"
copilot.template = "templates/copilot.md.hbs"

    •	tasks/ctx.generate.yaml: the generic pipeline (facts → prompt → tool.ask → render → write).
    •	prompts/generic.md: instruct tool to return structured JSON (Claude raw; Codex fenced).
    •	Templates render the sections you want (overview, tech, build/test, architecture, guidelines, risks).

Acceptance
• Install the package into a temp project (as a dev fixture by copying under agent_modules/…).
• tz ctx gen --dry-run prints content using fake tools; real run writes files to default targets.

⸻

Milestone F — (Optional) tz extract enhancement

Only if you want a turnkey way to turn an existing project’s configs into an asset‑only or mixed package.

    •	Add detector for AGENTS.md, .claude/CLAUDE.md, .cursor/rules, .github/copilot-instructions.md.
    •	Copy them into a new package’s templates/ and wire via [exports].
    •	Optional --with-task to scaffold the generic ctx.generate task + prompt.

Acceptance
• Running tz extract --with-task produces a ready‑to‑install package directory.

⸻

Milestone G — Docs & examples
• Update agents.md with:
• Manifest additions.
• Task runner step reference (one pager).
• How tz ctx gen resolves task vs. exports.
• Safe invocation flags and “no repo writes” guarantee.
• Add an example package folder in repo (or link to a separate repo) and a short “try it” section.

⸻

Quick dependency graph 1. A1 → A2 → A3 → A4 (schema, config, loader, templates) 2. B1 → B2 (runner → tool calls) 3. C1 → C2 (cli → fallback) 4. D1–D4 (tests across the above) 5. E1 (author ctx package) 6. F (optional extract) 7. G (docs)

⸻

What you can ship first (smallest viable slice)
• A1, A2, A3, A4, B1 (facts/render/write only), C1 (CLI), D1–D3 minimal
→ lets you ship asset‑only packages ([exports]) that render templates to files.
• Add B2 later to enable tool.ask and turn it into a true generator.

⸻

If you want, I can also turn this into a checklist with file paths you can paste into a GitHub Project board (one card per task) or generate a starter branch diff for Milestones A+B.
