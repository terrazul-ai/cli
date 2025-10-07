PRD #1 — tz extract

Goal: Turn an existing project’s AI context/config into a reusable package (assets‑only), with first‑class Claude Code support and zero secrets.

CLI

tz extract \
 --from <project-dir> \
 --out <package-dir> \
 --name @scope/name \
 --pkg-version 1.0.0 \
 [--force] \
 [--include-claude-local] \
 [--include-claude-user] \
 [--dry-run]

What we detect (inputs)

From --from:
• Codex: AGENTS.md, .codex/AGENTS.md
• Claude:
• CLAUDE.md or .claude/CLAUDE.md
• .claude/settings.json (project shared)
• .claude/settings.local.json (only if --include-claude-local)
• User settings (only if --include-claude-user):
• ~/.claude/settings.json
• ~/.claude.json (only the .projects["<abs project path>"] entry if present)
• .claude/mcp\*servers.json
• .claude/agents/\*\*/\_ (subagents)
• Cursor: .cursor/rules (file or dir → concatenate)
• Copilot: .github/copilot-instructions.md

What we output (package structure)

<out>/
├─ agents.toml
├─ README.md # optional banner (can be empty)
└─ templates/
├─ AGENTS.md.hbs # if AGENTS.md found
├─ CLAUDE.md.hbs # if CLAUDE.md found
├─ cursor.rules.hbs # if .cursor/rules found (concat if dir)
├─ copilot.md.hbs # if copilot file found
├─ codex/
│ └─ mcp_servers.toml.hbs # if Codex MCP servers detected
└─ claude/
├─ settings.json.hbs # from .claude/settings.json (sanitized)
├─ settings.local.json.hbs # only with --include-claude-local (sanitized)
├─ user.settings.json.hbs # only with --include-claude-user (sanitized & scoped)
├─ mcp_servers.json.hbs # from .claude/mcp_servers.json (sanitized)
└─ agents/
└─ \*.md.hbs # copied subagents (path placeholders if needed)

agents.toml produced (MVP)

[package]
name = "@scope/name"
version = "1.0.0"
description = "Extracted AI context package"
license = "MIT"

[exports]

# present only if file exists in templates/

codex.template = "templates/AGENTS.md.hbs"
codex.mcpServers = "templates/codex/mcp_servers.toml.hbs"
claude.template = "templates/CLAUDE.md.hbs"
claude.settings = "templates/claude/settings.json.hbs"
claude.subagentsDir = "templates/claude/agents"
claude.mcpServers = "templates/claude/mcp_servers.json.hbs"
cursor.template = "templates/cursor.rules.hbs"
copilot.template = "templates/copilot.md.hbs"

[metadata]
tz_spec_version = 1

Sanitization & safety (Claude‑aware)
• Never copy secrets:
• settings.env._ → "{{ env.KEY }}".
• Dangerous script fields (apiKeyHelper, awsAuthRefresh, awsCredentialExport) → "{{ replace_me }}".
• Path rewriting:
• Absolute paths inside project → {{ PROJECT_ROOT }}/rel/path.
• Absolute paths under home → {{ HOME }}/rel/path.
• Other absolute paths → "{{ replace_me }}".
• Applies to permissions.additionalDirectories, mcpServers._.args, and any string that looks path‑like (UNIX or C:\…).
• Include user/local only on opt‑in flags, and when user settings are JSON with "projects": { "<abs project>": { ... } }, extract only that project block.
• Determinism: Stable ordering; re-run produces identical content.
• Safety: By default, refuses to write when --out exists and is non‑empty. Use --force to overwrite. --dry-run prints plan.

See also: troubleshooting tips in ./troubleshooting.md

Implementation plan (files & functions)

New files

src/core/extract/
detect-claude.ts
detect-others.ts
sanitize-claude.ts
copy-plans.ts
build-manifest.ts
orchestrator.ts
write.ts
src/commands/extract.ts

Key code sketches

src/core/extract/sanitize-claude.ts

import { homedir } from 'node:os';
import { isAbsolute, relative } from 'node:path';

const P = { HOME: '{{ HOME }}', PROJECT: '{{ PROJECT_ROOT }}', REPLACE: '{{ replace_me }}' };

export function sanitizeEnv(env?: Record<string,string>) {
if (!env) return undefined;
return Object.fromEntries(Object.keys(env).map(k => [k, `{{ env.${k} }}`]));
}

export function rewritePath(s: string, projectRoot: string): string {
const home = homedir().replace(/\\/g, '/');
const proj = projectRoot.replace(/\\/g, '/');
const str = s.replace(/\\/g, '/');
if (str.startsWith(proj + '/')) return str.replace(proj, P.PROJECT);
if (str.startsWith(home + '/')) return str.replace(home, P.HOME);
if (isAbsolute(s)) return P.REPLACE;
return s;
}

function deepVisitStrings(obj: any, fn: (s: string) => string) {
if (!obj || typeof obj !== 'object') return;
for (const k of Object.keys(obj)) {
const v = obj[k];
if (typeof v === 'string') obj[k] = fn(v);
else deepVisitStrings(v, fn);
}
}

export function sanitizeSettingsJson(raw: any, projectRoot: string) {
const c = structuredClone(raw ?? {});
if (c.env) c.env = sanitizeEnv(c.env);
for (const key of ['apiKeyHelper','awsAuthRefresh','awsCredentialExport']) {
if (c[key]) c[key] = P.REPLACE;
}
if (Array.isArray(c?.permissions?.additionalDirectories)) {
c.permissions.additionalDirectories = c.permissions.additionalDirectories.map((p: string) => rewritePath(p, projectRoot));
}
deepVisitStrings(c, (s) => /^(\/|[A-Za-z]:\\)/.test(s) ? rewritePath(s, projectRoot) : s);
return c;
}

export function sanitizeMcpServers(raw: any, projectRoot: string) {
const c = structuredClone(raw ?? {});
deepVisitStrings(c, (s) => /^(\/|[A-Za-z]:\\)/.test(s) ? rewritePath(s, projectRoot) : s);
return c;
}

src/core/extract/build-manifest.ts

import \* as TOML from '@iarna/toml';

export function buildAgentsToml(name: string, version: string, exportsMap: Record<string,string>) {
return TOML.stringify({
package: { name, version, description: 'Extracted AI context package', license: 'MIT' },
exports: exportsMap,
metadata: { tz_spec_version: 1 }
});
}

src/commands/extract.ts

import { Command } from 'commander';
import { performExtract } from '../core/extract/orchestrator';
import { createCLIContext } from '../utils/context';

export function registerExtractCommand(program: Command) {
program.command('extract')
.requiredOption('--from <dir>')
.requiredOption('--out <dir>')
.requiredOption('--name <name>')
.requiredOption('--version <semver>')
.option('--include-claude-local', false)
.option('--include-claude-user', false)
.option('--dry-run', false)
.action(async (opts) => {
const { logger } = createCLIContext();
try {
const res = await performExtract({
from: opts.from, out: opts.out, name: opts.name, version: opts.version,
includeClaudeLocal: !!opts.includeClaudeLocal, includeClaudeUser: !!opts.includeClaudeUser, dryRun: !!opts.dryRun
}, logger);
logger.info(opts.dryRun ? JSON.stringify(res.summary, null, 2) : `Extracted → ${opts.out}`);
} catch (e: any) {
logger.error(e.message || String(e)); process.exitCode = 1;
}
});
}

(Orchestrator & copy plan combine detectors/sanitizers and write files; see earlier sketches—same approach.)

Tests (Vitest)

Helpers

tests/helpers/run-tz.ts # spawn node dist/tz.mjs

// tests/helpers/run-tz.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export async function runTz(bin: string, args: string[], opts: any = {}) {
return run('node', [bin, ...args], opts);
}

Spec files

tests/integration/extract.claude.settings.spec.ts
tests/integration/extract.claude.mcp.spec.ts
tests/integration/extract.claude.subagents.spec.ts
tests/integration/extract.exports.mapping.spec.ts

Sample: extract.claude.settings.spec.ts

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTz } from '../helpers/run-tz';

describe('tz extract (claude settings)', () => {
it('sanitizes env and rewrites paths', async () => {
const proj = await mkdtemp(join(tmpdir(),'proj-'));
await mkdir(join(proj,'.claude'),{recursive:true});
await writeFile(join(proj,'.claude/settings.json'), JSON.stringify({
env: { ANTHROPIC_API_KEY:'sk-xxx', OTEL_METRICS_EXPORTER:'otlp' },
permissions: { additionalDirectories: [join(proj,'docs'), '/opt/shared'] }
}, null, 2));
const out = await mkdtemp(join(tmpdir(),'pkg-'));
const bin = join(process.cwd(), 'dist', 'tz.js');
await runTz(bin, ['extract','--from',proj,'--out',out,'--name','@me/ctx','--version','1.0.0']);
const tpl = await readFile(join(out,'templates/claude/settings.json.hbs'),'utf8');
expect(tpl).toMatch(/"ANTHROPIC_API_KEY":\s\*"\{\{ env.ANTHROPIC_API_KEY \}\}"/);
expect(tpl).toMatch(/\{\{ PROJECT_ROOT \}\}\/docs/);
expect(tpl).toMatch(/\{\{ replace_me \}\}/); // /opt/shared
});
});

Also add
• extract.claude.mcp.spec.ts (rewrites args paths)
• extract.claude.subagents.spec.ts (copies subagents as .hbs)
• extract.exports.mapping.spec.ts (agents.toml has correct [exports])

⸻

PRD #2 — tz add

Goal: Install a package into a project from the dummy registry: resolve version, download tarball, verify integrity, CAS cache, safe extract to store, link into agent_modules/, write lockfile, refresh TERRAZUL.md.

CLI

# install one spec

tz add @scope/name@^1.0.0

# or with no args: read agents.toml [dependencies] (MVP: optional)

tz add

Behavior 1. Ensure project agents.toml exists (create minimal if missing when installing explicit spec). 2. Resolve version (simple semver) using GET /packages/v1/:name (skip yanked). 3. Get tarball URL: GET /packages/v1/:name/tarball/:version → { url }. 4. Download tarball buffer. 5. Compute SHA‑256 and base64; verify against registry’s metadata if provided (MVP: accept tarball as source of truth; still record integrity). 6. Write to CAS: ~/.terrazul/cache/sha256/ab/cdef.../blob.tgz. 7. Safe extract to store: ~/.terrazul/store/\_scope_pkg/<version>/:
• Reject absolute paths, .., symlinks/devices, clear exec bits. 8. Link store path into ./agent_modules/@scope/name (symlink; junction or copy fallback on Windows). 9. Update agents-lock.toml deterministically with { version, resolved, integrity }. 10. Generate/refresh a simple TERRAZUL.md listing installed packages and their template paths.

Lockfile shape

version = 1

[packages."@scope/name"]
version = "1.0.0"
resolved = "http://localhost:8787/cdn/@scope/name/1.0.0.tgz"
integrity = "sha256-<base64>"
dependencies = {}

Safety
• Tar safety: reject traversal/symlinks/devices.
• Integrity: compute and store sha256-<base64>.
• Network: allow http://localhost:\* (tests), else HTTPS.
• Idempotent: re-running with same version should be a no‑op.

Implementation plan (files & functions)

New / shared files

src/utils/hash.ts # sha256Hex, sha256Base64
src/utils/fs.ts # exists, symlinkOrJunctionOrCopy
src/core/storage.ts # writeToCAS, safeExtractCASToStore
src/core/lock-file.ts # readLock, writeLock, mergeLock
src/core/registry-client.ts # getPackageInfo, getTarballURL, download
src/core/package-manager.ts # installOne(...)
src/commands/add.ts # thin CLI
tests/setup/server.ts # dummy registry server

Key code sketches

src/core/storage.ts (safe extract)

import \* as tar from 'tar';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, normalize, sep } from 'node:path';

function unsafe(p: string) {
const n = normalize(p).replace(/^(\.\/)+/, '');
return isAbsolute(n) || n.split(sep).includes('..');
}

export async function safeExtractCASToStore(casFile: string, outDir: string) {
await mkdir(outDir, { recursive: true });
await tar.x({
file: casFile, cwd: outDir, strict: true,
filter: (p, stat) => {
if (unsafe(p)) throw new Error('TAR_UNSAFE: path traversal');
if (stat.isSymbolicLink()) throw new Error('TAR_UNSAFE: symlink entry');
return true;
},
onentry: (e) => { e.mode = (e.mode ?? 0) & ~0o111; }, // strip exec bits
});
return outDir;
}

src/core/package-manager.ts (install)

import semver from 'semver';
import { resolve, join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { sha256Base64, sha256Hex } from '../utils/hash';
import { writeToCAS, safeExtractCASToStore } from './storage';
import { symlinkOrJunctionOrCopy } from '../utils/fs';
import { readLock, writeLock, mergeLock } from './lock-file';
import { getPackageInfo, getTarballURL, download } from './registry-client';

export async function installOne(cwd: string, name: string, range: string, registry: string, logger: any) {
const info = await getPackageInfo(registry, name);
const version = semver.maxSatisfying(info.versions, range) || null;
if (!version) throw new Error(`VERSION_CONFLICT: ${name}@${range}`);

const { url } = await getTarballURL(registry, name, version);
const buf = await download(url);
const hex = sha256Hex(buf), b64 = sha256Base64(buf);

const { cachePath } = await writeToCAS(buf, hex);
const storePath = resolve(process.env.HOME || '', '.terrazul', 'store', name.replace('/','\_'), version);
await safeExtractCASToStore(cachePath, storePath);

const dest = resolve(cwd, 'agent_modules', name);
await mkdir(resolve(cwd, 'agent_modules'), { recursive: true });
await symlinkOrJunctionOrCopy(storePath, dest);

const lock = (await readLock(cwd)) ?? { version: 1, packages: {} };
const next = mergeLock(lock, { [name]: { version, resolved: url, integrity: `sha256-${b64}`, dependencies: {} } });
await writeLock(cwd, next);

await writeFile(resolve(cwd, 'TERRAZUL.md'), renderTzMd(next), 'utf8');

logger.info(`Installed ${name}@${version}`);
return { name, version, url, integrity: `sha256-${b64}` };
}

function renderTzMd(lock: any) {
const lines = ['# Terrazul Managed Configurations', '', '## Installed Packages', ''];
for (const [k, v] of Object.entries<any>(lock.packages ?? {})) {
lines.push(`- ${k} (${v.version})`);
}
return lines.join('\n') + '\n';
}

Tests (Vitest)

Dummy registry server

tests/setup/server.ts # in-process server, random port; stores published tarballs in memory and serves them under /cdn

Spec files

tests/unit/hash.spec.ts
tests/unit/storage.safe-extract.spec.ts
tests/unit/lockfile.spec.ts
tests/integration/registry.client.spec.ts
tests/integration/install.single.spec.ts
tests/integration/install.security.spec.ts
tests/integration/install.idempotent.spec.ts

Sample: install.single.spec.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startDummyRegistry } from '../setup/server';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process'; import { promisify } from 'node:util';
const run = promisify(execFile);

let srv:any;
beforeAll(async()=> srv = await startDummyRegistry());
afterAll(async()=> await srv.close());

it('installs a package from dummy registry', async () => {
// seed server with starter@1.0.0 (fixture or build-on-the-fly)
await srv.seedPackage('@terrazul/starter','1.0.0', Buffer.from('...tgz...'));

const cwd = await mkdtemp(join(tmpdir(),'proj-'));
await writeFile(join(cwd, 'agents.toml'), `[package]\nname="proj"\nversion="0.0.0"`, 'utf8');

const bin = join(process.cwd(), 'dist', 'tz.js');
const env = { ...process.env, TZ_REGISTRY: srv.url };
await run('node', [bin, 'install', '@terrazul/starter@^1.0.0'], { cwd, env });

const lock = await readFile(join(cwd,'agents-lock.toml'),'utf8');
expect(lock).toMatch(/@terrazul\/starter/);
});

Security: install.security.spec.ts
Seed a tarball with ../evil entry; expect error /TAR_UNSAFE/.

⸻

PRD #3 — tz publish

Goal: Validate a local package, build a tarball (assets‑only; strip exec bits), compute integrity, and publish to the dummy registry. Confirm returned CDN tarball URL.

CLI

tz publish [--dry-run]

Behavior 1. Validate package root (current directory):
• Required: agents.toml with [package] name and version.
• Allowed content dirs: templates/, tasks/, prompts/, configurations/, agents/, mcp/, README.md.
• No executables (clear exec bits in tar creation anyway). 2. Build deterministic tarball:
• tar.create({ gzip:true, portable:true, noMtime:true }) on allowed entries only. 3. Compute sha256Hex and sha256Base64. 4. POST /packages/v1/:name/publish?version=...&sha256=... with binary body. 5. Server stores and returns { url } to /cdn/.... 6. If --dry-run, skip POST and just print plan (files → tar entries, size, sha).

Safety
• Validation rejects missing/invalid agents.toml, disallowed files, or oversized packages (optional size cap, e.g. <1MB).
• Exec bits cleared while tarring.
• Network: allow http://localhost:\* (tests), else HTTPS.

Implementation plan (files & functions)

Files

src/core/validate/package.ts # validate structure
src/core/publish.ts # buildTarball, computeIntegrity, publish()
src/commands/publish.ts # thin CLI
src/core/registry-client.ts # publishTarball(...)

Key code sketches

src/core/validate/package.ts

import { stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

export async function validatePackageRoot(dir: string) {
// must have agents.toml
await access(join(dir, 'agents.toml'), constants.R_OK);
// allowed dirs/files: presence is optional
return true;
}

src/core/publish.ts

import tar from 'tar';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from '../utils/hash';
import { publishTarball } from './registry-client';

export async function buildTarball(pkgDir: string): Promise<Buffer> {
const entries = ['agents.toml','README.md','templates','tasks','prompts','configurations','agents','mcp'];
const bufs: Buffer[] = [];
await tar.create({ gzip:true, cwd: pkgDir, portable:true, noMtime:true }, entries)
.on('data', (c: Buffer) => bufs.push(c));
return Buffer.concat(bufs);
}

export async function doPublish(pkgDir: string, registry: string) {
const mf = await readFile(join(pkgDir,'agents.toml'),'utf8');
const name = /name\s*=\s*"([^"]+)"/.exec(mf)?.[1];
const version = /version\s*=\s*"([^"]+)"/.exec(mf)?.[1];
if (!name || !version) throw new Error('INVALID_PACKAGE: missing name/version');

const tgz = await buildTarball(pkgDir);
const sha = sha256Hex(tgz);
const { url } = await publishTarball(registry, name, version, sha, tgz);
return { name, version, url, sha };
}

src/commands/publish.ts

import { Command } from 'commander';
import { validatePackageRoot } from '../core/validate/package';
import { doPublish, buildTarball } from '../core/publish';
import { createCLIContext } from '../utils/context';
import { sha256Hex } from '../utils/hash';

export function registerPublishCommand(program: Command) {
program.command('publish')
.option('--dry-run', false)
.action(async (opts) => {
const { logger, config } = createCLIContext();
try {
await validatePackageRoot(process.cwd());
const registry = (await config.load()).registry;

        if (opts.dryRun) {
          const tgz = await buildTarball(process.cwd());
          logger.info(JSON.stringify({ size: tgz.length, sha256: sha256Hex(tgz) }, null, 2));
          return;
        }
        const res = await doPublish(process.cwd(), registry);
        logger.info(`Published ${res.name}@${res.version}\nTarball: ${res.url}`);
      } catch (e: any) {
        logger.error(e.message || String(e)); process.exitCode = 1;
      }
    });

}

Tests (Vitest)

Spec files

tests/integration/publish.validate.spec.ts
tests/integration/publish.install.roundtrip.spec.ts

Sample: publish.install.roundtrip.spec.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startDummyRegistry } from '../setup/server';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process'; import { promisify } from 'node:util';
const run = promisify(execFile);

let srv:any;
beforeAll(async()=> srv = await startDummyRegistry());
afterAll(async()=> await srv.close());

it('publishes then installs the package', async () => {
// Make a tiny package
const pkg = await mkdtemp(join(tmpdir(),'pkg-'));
await mkdir(join(pkg,'templates'),{recursive:true});
await writeFile(join(pkg,'templates','AGENTS.md.hbs'),'# Hi','utf8');
await writeFile(join(pkg,'agents.toml'), `[package]\nname="@u/p"\nversion="1.0.0"\n\n[exports]\ncodex.template="templates/AGENTS.md.hbs"\n`, 'utf8');

const bin = join(process.cwd(),'dist','tz.js');
const env = { ...process.env, TZ_REGISTRY: srv.url };
await run('node', [bin, 'publish'], { cwd: pkg, env });

const proj = await mkdtemp(join(tmpdir(),'proj-'));
await writeFile(join(proj,'agents.toml'),'[package]\nname="proj"\nversion="0.0.0"','utf8');
await run('node', [bin, 'install', '@u/p@1.0.0'], { cwd: proj, env });

const lock = await (await import('node:fs/promises')).readFile(join(proj,'agents-lock.toml'),'utf8');
expect(lock).toMatch(/@u\/p/);
});

⸻

Shared test utilities & fixtures

Dummy registry (required by install/publish tests)

tests/setup/server.ts

    •	Implements:
    •	seedPackage(name, version, buffer) helper for install tests (optional if publish test seeds).
    •	GET /packages/v1/:name → versions list.
    •	GET /packages/v1/:name/tarball/:version → { url }.
    •	POST /packages/v1/:name/publish?version&sha256 → stores buffer, returns { url }.
    •	GET /cdn/... → serves stored tar.

Helpers

tests/helpers/run-tz.ts # provided above

Fixtures (optional; can generate on-the-fly)

fixtures/packages/@terrazul/starter/1.0.0.tgz # small, safe tarball
fixtures/packages/malicious/traversal.tgz # contains ../evil (for TAR_UNSAFE)

⸻

Acceptance Criteria Recap

Extract
• Produces package folder with sanitized templates and correct [exports].
• No secrets; env values templated; absolute paths rewritten.
• Dry-run prints plan; non‑empty --out is not overwritten.

Install
• Resolves version, downloads tarball, verifies integrity string, safe extracts to store.
• Links into agent_modules/; writes deterministic agents-lock.toml.
• Rejects unsafe tarballs; idempotent.

Publish
• Validates structure; builds deterministic tarball (exec bits cleared).
• Computes SHA‑256; POSTs to dummy registry; prints returned CDN URL.
• Roundtrip (publish → install) works in tests.

⸻

Suggested PR sequencing 1. Publish support code (registry server + client + hashing + validator + publish tests). 2. Install (storage + safe extract + lockfile + install tests). 3. Extract (detect/sanitize/copy + exports + extract tests).

This order lets you seed the dummy registry via publish and then prove install with that exact tarball. Finally, extract produces real‑world packages for publish/install roundtrips.
