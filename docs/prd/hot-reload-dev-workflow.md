# PRD: Hot Reload Developer Workflow

## Overview

Enable fast, zero-friction iteration during CLI development by providing hot reload workflows that eliminate build steps and manual restarts. Contributors should be able to modify TypeScript source and immediately test changes without context switching to rebuild/restart.

**Problem**: Current workflow requires `pnpm run build` after every change, adding ~2-5 seconds of latency and breaking flow state. For test-driven development cycles, this compounds to minutes of wasted time per feature.

**Solution**: Leverage `tsx` (already in dev deps) to run TypeScript source directly, paired with optional watch modes for different development scenarios.

---

## Goals

- **Zero-latency iteration**: Change TypeScript → test command in <500ms
- **Familiar ergonomics**: `pnpm run dev -- <command>` mirrors production `tz <command>`
- **Environment parity**: Easy toggle between source (dev) and bundle (pre-release validation)
- **Shell convenience**: Global alias for instant invocation from any directory
- **Minimal tooling**: Reuse existing dependencies; avoid additional watch daemons

## Non-Goals (v1)

- HMR for long-running processes (registry server keeps separate manual restart workflow)
- Automatic test re-runs on file change (developers control test execution)
- Integration with editor/IDE watchers (orthogonal; works alongside existing setups)
- Windows-specific optimizations (cross-platform by default via Node, but not tuning perf)

---

## Developer Workflows

### Workflow 1: Quick Iteration (Primary)

**Use case**: Tight TDD loop; testing small changes to core logic or commands.

```bash
# Terminal 1: Run CLI directly from source
pnpm run dev -- init
pnpm run dev -- add @terrazul/starter

# Or with shell alias (recommended)
tzdev init
tzdev add @terrazul/starter --verbose
```

**How it works**:

- `tsx` compiles TypeScript in-memory and executes immediately
- No disk writes, no build artifacts
- ~200-400ms overhead for cold start, ~50-100ms for warm restarts
- Changes to any `src/**` file are picked up on next invocation

**When to use**: 90% of development time; anytime you're actively coding a feature.

---

### Workflow 2: Watch Mode (Exploratory)

**Use case**: Rapid experimentation; repeatedly running same command with different args/state.

```bash
# Terminal 1: Watch source files
pnpm run dev:watch

# Changes auto-restart the CLI
# Useful for testing init/install flows in scratch directories
```

**How it works**:

- `tsx watch src/index.ts` monitors `src/**` and restarts on changes
- Automatically re-executes last command
- Best paired with a persistent test directory where you want to see live updates

**When to use**: 5% of time; when refactoring shared utilities or testing integrations that need repeated runs.

---

### Workflow 3: Bundle Validation (Pre-Ship)

**Use case**: Final check that bundled ESM behaves identically to source before opening PR.

```bash
# Terminal 1: Watch and rebuild bundle
pnpm run build:watch

# Terminal 2: Test bundled output in scratch project
cd /tmp/tz-test-project
node ~/Projects/cli/dist/tz.mjs init
node ~/Projects/cli/dist/tz.mjs add @pkg
```

**How it works**:

- `esbuild` watch mode rebuilds `dist/tz.mjs` on source changes
- Manual invocation of bundle ensures you're testing production-like artifact
- Catches edge cases with ESM bundling, shebang, or require shims

**When to use**: 5% of time; right before pushing commits or when debugging bundle-specific issues.

---

## Implementation

### 1. Package Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "dev:watch": "tsx watch src/index.ts",
    "build:watch": "node build.config.mjs --watch"
  }
}
```

**Key details**:

- `dev` automatically forwards args via `--`: `pnpm run dev -- add @pkg` → `tsx src/index.ts add @pkg`
- `dev:watch` uses `tsx`'s built-in watcher (no need for `nodemon`)
- `build:watch` requires updating `build.config.mjs` (see below)

---

### 2. Build Config Update

Modify `build.config.mjs` to support watch mode with clean shutdown:

```js
const isWatch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  // ... existing config (entryPoints, bundle, platform, format, etc.)
});

if (isWatch) {
  await ctx.watch();
  console.log('⚡ Watching for changes to src/...');

  // Clean shutdown on Ctrl+C
  process.on('SIGINT', async () => {
    await ctx.dispose();
    process.exit(0);
  });
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

**Why this matters**:

- `ctx.dispose()` releases file handles and watchers
- Without it, `Ctrl+C` during watch leaves zombie processes
- Signal handling ensures clean exits during interactive development

---

### 3. Shell Alias (Recommended)

Add to `~/.zshrc` or `~/.bashrc`:

```bash
export NODE_ENV=development
alias tzdev='NODE_ENV=development tsx ~/Projects/cli/src/index.ts'
```

**Benefits**:

- Invoke CLI from anywhere: `tzdev --help`, `tzdev init`, etc.
- `NODE_ENV=development` enables any dev-specific logging/behavior
- Differentiate dev runs from integration tests (which set `NODE_ENV=test`)
- Faster than `pnpm run dev --` (no npm overhead, ~30-50ms saved per invocation)

**Alternative** (if you don't want global pollution):

```bash
# Project-local alias (requires being in repo root)
alias tzdev='NODE_ENV=development tsx src/index.ts'
```

---

## Success Criteria

### Performance

- [ ] Cold start (first `pnpm run dev --` invocation): <500ms
- [ ] Warm restart (subsequent runs): <100ms
- [ ] Build watch rebuild: <2s for full bundle

### Developer Experience

- [ ] Contributors can edit→test in single terminal without manual builds
- [ ] Watch mode successfully restarts on source changes within 200ms
- [ ] Bundle validation workflow catches ESM/shebang issues before CI

### Documentation

- [ ] `CLAUDE.md` section updated with recommended workflow (link to this PRD)
- [ ] `README.md` "Contributing" section mentions `pnpm run dev`
- [ ] Onboarding doc includes shell alias setup instructions

---

## Rollout Plan

1. **PR 1: Scripts + Build Config**
   - Add `dev`, `dev:watch`, `build:watch` to `package.json`
   - Update `build.config.mjs` with signal handling
   - Test all three workflows locally (macOS/Linux)

2. **PR 2: Documentation**
   - Add "Hot Reload Workflow" section to `CLAUDE.md` (link to this PRD)
   - Update `README.md` contributing guide
   - Optional: Add `docs/DEVELOPING.md` with shell alias examples

3. **Announce**
   - Slack/Discord message with GIF showing edit→test flow
   - Encourage team to set up alias and share feedback

---

## Open Questions

- **Cross-platform alias syntax**: Should we provide both Bash and PowerShell examples for Windows contributors? _(Answer: Yes, add PowerShell example to docs)_
- **Watch mode restart behavior**: Should `tsx watch` exit on error or keep running? _(Current: keeps running; aligns with fail-fast TDD)_
- **CI integration**: Should CI run `pnpm run dev -- --version` as smoke test? _(Answer: No, CI already tests bundle via `node dist/tz.mjs`)_

---

## References

- `tsx` docs: https://github.com/privatenumber/tsx
- `esbuild` watch API: https://esbuild.github.io/api/#watch
- Related: `CLAUDE.md` Section 15 (Local Development Quickstart)
