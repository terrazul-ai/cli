Great question. To generate an AGENTS.md like the one you showed, you want a fixed question set that cleanly maps to each section of that doc. Below is a coverage‑complete question set (with stable ids) you can drop into your QUESTIONS array. Each question is phrased so Claude/Codex can answer purely from repo facts you provide (e.g., package.json, scripts, minimal file tree, config files). When a fact is unknown, the tool should answer N/A.

I’ve also included:
• A section map (which question populates which part of AGENTS.md),
• A prompting style (bullets, code fences) that yields the structure you want,
• A ready‑to‑paste TypeScript constant you can use in buildPrompt,
• A tiny sample JSON output.

⸻

Fixed question set (IDs, exact wording, and purpose)

Format: id — “question text” (→ AGENTS.md section)

Overview 1. repo_purpose — “In 2–3 sentences, what is this repository and who is it for?”
→ §0 What is this repo? 2. value_props — “List up to 7 headline value propositions (e.g., performance, safety, determinism, tool‑compatibility, offline). For each: **Name**: one sentence.”
→ §0 bullet list (Fast/Safe/Deterministic/Tool‑agnostic/Offline‑first…)

Goals, Principles 3. goals — “List concrete goals for the current version (bullets, imperative, 1 line each).”
→ §1 Goals (v0) 4. non_goals — “List explicit non‑goals or out‑of‑scope items (bullets).”
→ §1 Non‑Goals (v0) 5. design_principles — “List design principles that guide the repo (bullets; e.g., Functional Core/Imperative Shell, Security by design, DI, Offline‑first, Performance, Portability, Developer‑first UX).”
→ §2 Design Principles

Structure 6. repo_layout — “Produce a concise 1–3‑level directory tree of key files and folders (use a fenced text or bash block), then 1‑line notes per top‑level folder.”
→ §3 Repository Layout (tree + comments)

Tech stack & toolchain 7. runtime_language — “State the runtime(s) and language(s) with minimum versions (e.g., Node 22.x, TypeScript strict), and TypeScript→ESM bundle bundling policy.”
→ §4 Runtime & Language 8. core_deps — “List core runtime dependencies with a brief role each (bullets).”
→ §4 Core Dependencies 9. dev_deps — “List dev/build/test dependencies with a brief role each (bullets).”
→ §4 Dev Dependencies 10. lint_format — “Describe lint/format policy (linters used, zero‑warnings rule, Prettier interop, scripts to run).”
→ §4 Linting & Formatting

Domains & commands 11. domain_breakdown — “Summarize responsibilities of the main source domains: commands/, core/, integrations/, utils/, types/ (1–3 lines each).”
→ §5 Core Domains 12. command_catalog — “List the CLI commands and 1‑line descriptions (bullets). Include notable flags/aliases if present.”
→ §12 Commands (overview) 13. command_acceptance_criteria — “For these commands: uninstall, extract, link, unlink, validate, unyank, login/logout—summarize ‘Purpose’, ‘Behavior’ (numbered), and ‘Acceptance Criteria’ (bullets). Use concise language.”
→ §12 Command details

Build & distribution 14. build_distribution — “Explain how the binary is built (esbuild to single-file ESM with shebang) and how distributions are shipped (pnpm publish, optional SEA binaries, naming convention). Include minimal code block if helpful.”
→ §6 Build & Distribution

Config & auth 15. config_auth — “Describe configuration path and key fields (JSON sample), token handling, env overrides, and auth flow (high‑level). Keep secrets redaction in mind.”
→ §7 Configuration & Auth

Package & lockfile 16. package_format — “Describe agents.toml structure with a short example and what each top‑level section means.”
→ §8 agents.toml 17. lockfile_format — “Describe agents-lock.toml structure, integrity scheme (sha256-<base64>), deterministic ordering, and metadata fields.”
→ §8 agents-lock.toml

Storage, resolve, registry 18. storage_manager — “Explain cache/layout (CAS), safe extraction policies (no traversal/symlinks), and permissions behavior.”
→ §9 Storage Manager 19. resolver_semver_sat — “Describe dependency resolution: CNF encoding, AtMostOne constraints, dependency implications, prefer‑latest heuristic, yanked handling rules.”
→ §10 Dependency Resolver 20. registry_client_api — “Summarize registry base URL, HTTPS policy, auth headers, and key endpoints with brief descriptions.”
→ §11 Registry Client & API

Security & testing 21. security_considerations — “List security considerations/policies as bullets (package validation, tar safety, token security, network policy, yanked handling).”
→ §13 Security Considerations 22. testing_strategy — “Explain test strategy: test types, key coverage goals, notable test utilities (dummy registry, temp dirs), and perf sanity.”
→ §14 Testing Strategy

DX, CI, workflow 23. quickstart — “Provide a short local development quickstart: install, build, start dummy registry, configure CLI, minimal commands to try. Use fenced bash blocks.”
→ §15 Local Development Quickstart 24. ci_quality — “Describe CI matrix, steps, smoke tests, SEA jobs, and coverage gates. Add lint/format hints if applicable.”
→ §16 CI & Quality Gates (+ formatting notes) 25. contrib_workflow — “Explain contribution workflow: PR expectations, tests/docs/ADRs, keeping commands thin, JSDoc expectations.”
→ §17 Contribution Workflow 26. conventional_commits — “Document Conventional Commits policy: types, scopes, breaking changes, examples, and Release Please behavior.”
→ §Conventional Commits + Release Automation

Roadmap & errors 27. roadmap — “List milestones with 1‑line descriptions, and note each ships with code+tests+docs.”
→ §18 Roadmap 28. error_taxonomy — “List the error enum with names only (no stack traces), and note mapping to user messages/exit codes.”
→ §19 Error Taxonomy

Maintenance 29. update_policy — “State maintenance guidance: keep AGENTS.md, test catalog, and ADRs in sync with changes.”
→ §Keep this file up to date

⸻

Prompting style constraints (so answers render like your example)
• Bullets where appropriate. One line per bullet.
• Short code blocks for trees/config/snippets:
• Use ```text for directory trees
•

    •	```toml for agents.toml
    •




    •	No speculation: derive only from provided facts; otherwise write N/A.
    •	Tone: imperative, neutral, succinct.

⸻

Ready‑to‑paste TypeScript QUESTIONS constant

Replace your current small set with this; keep your existing JSON schema (answers[{id,question,answer}]).

export const QUESTIONS = [
{ id: 'repo_purpose', prompt: 'In 2–3 sentences, what is this repository and who is it for?' },
{ id: 'value_props', prompt: 'List up to 7 headline value propositions (e.g., performance, safety, determinism, tool-compatibility, offline). For each: **Name**: one sentence.' },

{ id: 'goals', prompt: 'List concrete goals for the current version (bullets, imperative, 1 line each).' },
{ id: 'non_goals', prompt: 'List explicit non-goals or out-of-scope items (bullets).' },
{ id: 'design_principles', prompt: 'List design principles that guide the repo (bullets; e.g., Functional Core/Imperative Shell, Security by design, DI, Offline-first, Performance, Portability, Developer-first UX).' },

{ id: 'repo_layout', prompt: 'Produce a concise 1–3-level directory tree of key files and folders (use a fenced text or bash block), then 1-line notes per top-level folder.' },

{ id: 'runtime_language', prompt: 'State the runtime(s) and language(s) with minimum versions (e.g., Node 22.x, TypeScript strict), and TypeScript→ESM bundle bundling policy.' },
{ id: 'core_deps', prompt: 'List core runtime dependencies with a brief role each (bullets).' },
{ id: 'dev_deps', prompt: 'List dev/build/test dependencies with a brief role each (bullets).' },
{ id: 'lint_format', prompt: 'Describe lint/format policy (linters used, zero-warnings rule, Prettier interop, scripts to run).' },

{ id: 'domain_breakdown', prompt: 'Summarize responsibilities of the main source domains: commands/, core/, integrations/, utils/, types/ (1–3 lines each).' },
{ id: 'command_catalog', prompt: 'List the CLI commands and 1-line descriptions (bullets). Include notable flags/aliases if present.' },
{ id: 'command_acceptance_criteria', prompt: 'For these commands: uninstall, extract, link, unlink, validate, unyank, login/logout—summarize Purpose, Behavior (numbered), and Acceptance Criteria (bullets). Be concise.' },

{ id: 'build_distribution', prompt: 'Explain how the binary is built (esbuild to single-file ESM with shebang) and how distributions are shipped (pnpm publish, optional SEA binaries, naming convention). Include minimal code block if helpful.' },

{ id: 'config_auth', prompt: 'Describe configuration path and key fields (JSON sample), token handling, env overrides, and auth flow. Keep secrets redaction in mind.' },

{ id: 'package_format', prompt: 'Describe agents.toml structure with a short example and what each top-level section means.' },
{ id: 'lockfile_format', prompt: 'Describe agents-lock.toml structure, integrity scheme (sha256-<base64>), deterministic ordering, and metadata fields.' },

{ id: 'storage_manager', prompt: 'Explain cache/layout (CAS), safe extraction policies (no traversal/symlinks), and permissions behavior.' },
{ id: 'resolver_semver_sat', prompt: 'Describe dependency resolution: CNF encoding, AtMostOne constraints, dependency implications, prefer-latest heuristic, yanked handling rules.' },
{ id: 'registry_client_api', prompt: 'Summarize registry base URL, HTTPS policy, auth headers, and key endpoints with brief descriptions.' },

{ id: 'security_considerations', prompt: 'List security considerations/policies as bullets (package validation, tar safety, token security, network policy, yanked handling).' },
{ id: 'testing_strategy', prompt: 'Explain test strategy: test types, key coverage goals, notable test utilities (dummy registry, temp dirs), and perf sanity.' },

{ id: 'quickstart', prompt: 'Provide a short local development quickstart: install, build, start dummy registry, configure CLI, minimal commands to try. Use fenced bash blocks.' },
{ id: 'ci_quality', prompt: 'Describe CI matrix, steps, smoke tests, SEA jobs, and coverage gates. Add lint/format hints if applicable.' },
{ id: 'contrib_workflow', prompt: 'Explain contribution workflow: PR expectations, tests/docs/ADRs, keeping commands thin, JSDoc expectations.' },
{ id: 'conventional_commits', prompt: 'Document Conventional Commits policy: types, scopes, breaking changes, examples, and Release Please behavior.' },

{ id: 'roadmap', prompt: 'List milestones with 1-line descriptions, and note each ships with code+tests+docs.' },
{ id: 'error_taxonomy', prompt: 'List the error enum with names only, and note mapping to user messages/exit codes.' },

{ id: 'update_policy', prompt: 'State maintenance guidance: keep AGENTS.md, test catalog, and ADRs in sync with changes.' },
] as const;

You can keep your single JSON schema:

{ "answers":[{ "id":"...", "question":"...", "answer":"..." }], "notes":["..."] }

The renderer formats the answers into the full AGENTS.md.

⸻

Section map (how each id fills AGENTS.md)
• §0 What is this repo? → repo_purpose, value_props
• §1 Goals & Non‑Goals → goals, non_goals
• §2 Design Principles → design_principles
• §3 Repository Layout → repo_layout
• §4 Technology Stack & Libraries → runtime_language, core_deps, dev_deps, lint_format
• §5 Core Domains → domain_breakdown
• §6 Build & Distribution → build_distribution
• §7 Configuration & Auth → config_auth
• §8 Package Format & Lockfile → package_format, lockfile_format
• §9 Storage Manager → storage_manager
• §10 Dependency Resolver → resolver_semver_sat
• §11 Registry Client & API → registry_client_api
• §12 Commands → command_catalog, command_acceptance_criteria
• §13 Security Considerations → security_considerations
• §14 Testing Strategy → testing_strategy
• §15 Local Development Quickstart → quickstart
• §16 CI & Quality Gates → ci_quality
• §17 Contribution Workflow → contrib_workflow
• Conventional Commits → conventional_commits
• §18 Roadmap → roadmap
• §19 Error Taxonomy → error_taxonomy
• Update policy → update_policy

⸻

Small example of expected JSON (truncated)

{
"answers": [
{
"id": "repo_purpose",
"question": "In 2–3 sentences, what is this repository and who is it for?",
"answer": "Terrazul CLI (`tz`) is a Node.js + TypeScript command‑line tool for managing AI agent configuration packages (markdown/JSON, non‑executable). It provides fast, deterministic installs with strict hashing and a lockfile, plus adapters that link packages into developer tools."
},
{
"id": "value_props",
"question": "List up to 7 headline value propositions (e.g., performance, safety, determinism, tool‑compatibility, offline). For each: **Name**: one sentence.",
"answer": "- **Fast**: CDN‑first tarballs, content‑addressable cache, and parallel downloads.\n- **Safe**: Non‑executable packages, strict SHA‑256, tar path‑traversal protections.\n- **Deterministic**: SAT‑based resolver with lockfile for reproducible installs.\n- **Tool‑agnostic**: Integrations via symlinks/settings for editors and agents.\n- **Offline‑first**: Cache and lockfile enable repeatable operations without network."
}
],
"notes": []
}

⸻

Practical tips
• Facts matter: The better your repo-facts, the richer the answers. Consider augmenting facts with:
• top‑level directory listing (1–2 levels),
• package.json scripts,
• presence of build.config.mjs, vitest.config.ts, .github/workflows/\*,
• a small excerpt of README (first 80–120 lines).
• Guardrails: In your prompt preamble, say: “Use only provided facts; if unknown, output N/A.”
• Length: Encourage concise bullets so your renderers don’t overflow sections.

If you want, I can also provide a drop‑in renderCodex() update that takes these 29 IDs and formats them exactly into the AGENTS.md structure you pasted.

Absolutely—here’s a **drop‑in `renderCodex()`** that formats your new 29‑question set into an **AGENTS.md** with the same structure and tone as your example. I’m also including a **small helper** and a **Vitest snapshot test** so devs can wire it up confidently.

---

## `src/utils/context-render.ts` (updated)

> Keep your existing `QA`/`QAResult` types. Replace your old `renderCodex` with this version. It maps each `id` → section(s), preserves any code fences in answers, and falls back to `N/A` if a field is missing.

```ts
export interface QA {
  id: string;
  question: string;
  answer: string;
}
export interface QAResult {
  answers: QA[];
  notes?: string[];
}

function get(data: QAResult, id: string): string {
  return (data.answers.find((a) => a.id === id)?.answer ?? 'N/A').trim();
}

/**
 * Renders a comprehensive AGENTS.md using the 29-question set
 * (see QUESTIONS in context-prompt).
 *
 * Sections mirror the example provided by the user.
 */
export function renderCodex(data: QAResult): string {
  const repo_purpose = get(data, 'repo_purpose');
  const value_props = get(data, 'value_props');

  const goals = get(data, 'goals');
  const non_goals = get(data, 'non_goals');
  const design_principles = get(data, 'design_principles');

  const repo_layout = get(data, 'repo_layout');

  const runtime_language = get(data, 'runtime_language');
  const core_deps = get(data, 'core_deps');
  const dev_deps = get(data, 'dev_deps');
  const lint_format = get(data, 'lint_format');

  const domain_breakdown = get(data, 'domain_breakdown');
  const command_catalog = get(data, 'command_catalog');
  const command_ac = get(data, 'command_acceptance_criteria');

  const build_distribution = get(data, 'build_distribution');

  const config_auth = get(data, 'config_auth');

  const package_format = get(data, 'package_format');
  const lockfile_format = get(data, 'lockfile_format');

  const storage_manager = get(data, 'storage_manager');
  const resolver_semver_sat = get(data, 'resolver_semver_sat');
  const registry_client_api = get(data, 'registry_client_api');

  const security_considerations = get(data, 'security_considerations');
  const testing_strategy = get(data, 'testing_strategy');

  const quickstart = get(data, 'quickstart');
  const ci_quality = get(data, 'ci_quality');

  const contrib_workflow = get(data, 'contrib_workflow');
  const conventional_commits = get(data, 'conventional_commits');

  const roadmap = get(data, 'roadmap');
  const error_taxonomy = get(data, 'error_taxonomy');

  const update_policy = get(data, 'update_policy');

  const lines: string[] = [];

  // Header + blurb
  lines.push(
    '# Terrazul CLI — `agents.md`',
    '',
    '> A living guide to the repo, its goals, architecture, libraries, testing strategy, and how to build and ship high‑quality code for the Terrazul CLI.',
    '',
    '---',
    '',
    '## 0) What is this repo?',
    '',
    repo_purpose,
    '',
    value_props,
    '',
    '---',
    '',
    '## 1) Goals & Non‑Goals',
    '',
    '### Goals (v0)',
    '',
    goals,
    '',
    '### Non‑Goals (v0)',
    '',
    non_goals,
    '',
    '---',
    '',
    '## 2) Design Principles',
    '',
    design_principles,
    '',
    '---',
    '',
    '## 3) Repository Layout',
    '',
    repo_layout,
    '',
    '---',
    '',
    '## 4) Technology Stack & Libraries',
    '',
    '### Runtime & Language',
    '',
    runtime_language,
    '',
    '### Core Dependencies',
    '',
    core_deps,
    '',
    '### Dev Dependencies',
    '',
    dev_deps,
    '',
    '### Linting & Formatting',
    '',
    lint_format,
    '',
    '---',
    '',
    '## 5) Core Domains',
    '',
    domain_breakdown,
    '',
    '---',
    '',
    '## 6) Build & Distribution',
    '',
    build_distribution,
    '',
    '---',
    '',
    '## 7) Configuration & Auth',
    '',
    config_auth,
    '',
    '---',
    '',
    '## 8) Package Format & Lockfile',
    '',
    '### `agents.toml` (manifest)',
    '',
    package_format,
    '',
    '### `agents-lock.toml`',
    '',
    lockfile_format,
    '',
    '---',
    '',
    '## 9) Storage Manager',
    '',
    storage_manager,
    '',
    '---',
    '',
    '## 10) Dependency Resolver (SAT + Semver)',
    '',
    resolver_semver_sat,
    '',
    '---',
    '',
    '## 11) Registry Client & API Conventions',
    '',
    registry_client_api,
    '',
    '---',
    '',
    '## 12) Commands',
    '',
    '### Catalog',
    '',
    command_catalog,
    '',
    '### Selected Commands — Purpose / Behavior / Acceptance Criteria',
    '',
    command_ac,
    '',
    '---',
    '',
    '## 13) Security Considerations',
    '',
    security_considerations,
    '',
    '---',
    '',
    '## 14) Testing Strategy',
    '',
    testing_strategy,
    '',
    '---',
    '',
    '## 15) Local Development Quickstart',
    '',
    quickstart,
    '',
    '---',
    '',
    '## 16) CI & Quality Gates',
    '',
    ci_quality,
    '',
    '---',
    '',
    '## 17) Contribution Workflow',
    '',
    contrib_workflow,
    '',
    '### Conventional Commits',
    '',
    conventional_commits,
    '',
    '---',
    '',
    '## 18) Roadmap (milestones)',
    '',
    roadmap,
    '',
    '---',
    '',
    '## 19) Error Taxonomy (selected)',
    '',
    error_taxonomy,
    '',
    '### Keep this file up to date',
    '',
    update_policy,
  );

  return lines.join('\n');
}

// (Optional) Keep Claude renderer as-is; shown here for completeness.
export function renderClaude(data: QAResult): string {
  const title = (id: string) =>
    ({
      repo_purpose: 'Purpose',
      value_props: 'Value Propositions',
      goals: 'Goals',
      non_goals: 'Non‑Goals',
      design_principles: 'Design Principles',
      repo_layout: 'Repository Layout',
      runtime_language: 'Runtime & Language',
      core_deps: 'Core Dependencies',
      dev_deps: 'Dev Dependencies',
      lint_format: 'Linting & Formatting',
      domain_breakdown: 'Core Domains',
      command_catalog: 'Command Catalog',
      command_acceptance_criteria: 'Command Acceptance Criteria',
      build_distribution: 'Build & Distribution',
      config_auth: 'Configuration & Auth',
      package_format: '`agents.toml`',
      lockfile_format: '`agents-lock.toml`',
      storage_manager: 'Storage Manager',
      resolver_semver_sat: 'Dependency Resolver',
      registry_client_api: 'Registry Client & API',
      security_considerations: 'Security Considerations',
      testing_strategy: 'Testing Strategy',
      quickstart: 'Local Development Quickstart',
      ci_quality: 'CI & Quality Gates',
      contrib_workflow: 'Contribution Workflow',
      conventional_commits: 'Conventional Commits',
      roadmap: 'Roadmap',
      error_taxonomy: 'Error Taxonomy',
      update_policy: 'Maintenance Policy',
    })[id] || id;

  const lines = ['# Project Context for Claude', '> Generated by `tz ctx gen`.'];
  for (const a of data.answers) {
    lines.push(`\n## ${title(a.id)}\n\n**Q:** ${a.question}\n\n**A:** ${a.answer.trim()}`);
  }
  if (data.notes?.length) {
    lines.push('\n---\n### Notes', ...data.notes.map((n) => `- ${n}`));
  }
  return lines.join('\n');
}
```

**Notes**

- This renderer **doesn’t re‑wrap** answers; if your tool returns code fences for `repo_layout`, `package_format`, etc., they’ll be preserved.
- If an answer is missing, the section shows `N/A`, making gaps obvious in review diffs.

---

## Vitest: snapshot test (quick confidence)

> Put this under `tests/unit/context-render.codex.spec.ts`. It uses a **minimal** set of answers and checks the outline + a few key inserts. Expand as you like.

````ts
import { describe, it, expect } from 'vitest';
import { renderCodex } from '../../src/utils/context-render';

function qa(id: string, answer: string, question = 'q') {
  return { id, question, answer };
}

describe('renderCodex', () => {
  it('renders the full AGENTS.md scaffold with inserted answers', () => {
    const data = {
      answers: [
        qa(
          'repo_purpose',
          '**Terrazul CLI (`tz`)** is a Node.js + TypeScript tool for AI agent config packages.',
        ),
        qa(
          'value_props',
          '- **Fast**: CDN cache\n- **Safe**: Non-executable\n- **Deterministic**: Lockfile',
        ),
        qa('goals', '- Clean architecture\n- Deterministic I/O'),
        qa('non_goals', '- Real registry'),
        qa('design_principles', '- Functional Core / Imperative Shell'),
        qa('repo_layout', '```text\ncli/\n  src/\n  tests/\n```'),
        qa(
          'runtime_language',
          '- Node 22.18+\n- TypeScript 5+ (strict)\n- TypeScript→ESM bundle bundle',
        ),
        qa('core_deps', '- commander\n- chalk'),
        qa('dev_deps', '- esbuild\n- vitest\n- tsx'),
        qa('lint_format', '- ESLint TS aware; Prettier; zero-warnings policy'),
        qa(
          'domain_breakdown',
          '- commands/: thin I/O shell\n- core/: business logic\n- utils/: pure helpers',
        ),
        qa('command_catalog', '- tz install\n- tz update'),
        qa(
          'command_acceptance_criteria',
          '#### tz uninstall\n**Purpose**: Remove package...\n\n**Behavior**: 1) ...\n\n**Acceptance Criteria**: - ...',
        ),
        qa('build_distribution', 'esbuild → dist/tz.mjs (ESM + shebang); SEA artifacts'),
        qa('config_auth', 'Config at ~/.terrazul/config.json with token fields...'),
        qa('package_format', '```toml\n[package]\nname="..."\n```'),
        qa('lockfile_format', '- integrity: sha256-<base64>'),
        qa('storage_manager', '- CAS layout; safe extraction; no symlinks'),
        qa('resolver_semver_sat', '- CNF encoding; AtMostOne; prefer latest; yanked rules'),
        qa('registry_client_api', '- GET /packages/v1/:name\n- Auth: Bearer'),
        qa('security_considerations', '- HTTPS only; strict hashing'),
        qa('testing_strategy', '- Unit, integration, E2E; dummy registry; perf sanity'),
        qa('quickstart', '```bash\npnpm ci\npnpm build\n```'),
        qa('ci_quality', '- Matrix: Linux/macOS/Windows; coverage gates'),
        qa('contrib_workflow', '- Small PRs; tests+docs; ADRs'),
        qa('conventional_commits', '- feat/fix/docs/test; Release Please'),
        qa('roadmap', '- M0..M5 milestones'),
        qa('error_taxonomy', '```ts\nenum ErrorCode { ... }\n```'),
        qa('update_policy', '- Keep AGENTS.md and tests updated'),
      ],
      notes: [],
    };

    const md = renderCodex(data);
    // Outline checks
    expect(md).toMatch(/# Terrazul CLI — `agents\.md`/);
    expect(md).toMatch(/## 0\) What is this repo\?/);
    expect(md).toMatch(/## 1\) Goals & Non‑Goals/);
    expect(md).toMatch(/## 18\) Roadmap \(milestones\)/);
    expect(md).toMatch(/## 19\) Error Taxonomy \(selected\)/);

    // Content spot checks
    expect(md).toMatch(/\*\*Terrazul CLI/);
    expect(md).toMatch(/- \*\*Fast\*\*: CDN cache/);
    expect(md).toMatch(/```text[\s\S]*cli\//);
    expect(md).toMatch(/esbuild → dist\/tz\.js/);
    expect(md).toMatch(/~\/\.terrazul\/config\.json/);
    expect(md).toMatch(/CAS layout/);
    expect(md).toMatch(/CNF encoding/);
    expect(md).toMatch(/GET \/packages\/v1\/:name/);
    expect(md).toMatch(/Conventional Commits/);
  });
});
````

---

## Where this plugs in

- Your **Q\&A builder** (`buildPrompt`) already references these IDs, so this renderer will drop in cleanly.
- Your CLI (`tz ctx gen …`) that targets **Codex** will now produce an **AGENTS.md** with the same sectioning and flow as your hand‑written example—populated directly from the structured JSON answers.

If you want, I can also supply a `renderClaude()` variant that condenses the same content into Q\&A‑style sections (the one above is already included and safe to use).
