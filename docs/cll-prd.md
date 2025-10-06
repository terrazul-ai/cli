Below is a pragmatic build plan that gets you from **zero → shipping** in small, verifiable steps. I keep it true to your spec, lean on the suggested libraries, and optimize for maintainability and “install anywhere.” I also include concrete TypeScript skeletons you can paste into your repo to jump‑start v0 with a **dummy registry API**.

---

## High‑level delivery plan

**Milestones**

1. **M0 – Project foundation**
2. **M1 – CLI skeleton & config/auth shell**
3. **M2 – Storage + lockfile + installers (end‑to‑end via dummy API)**
4. **M3 – SAT resolver + yanked handling + updates**
5. **M4 – Publish/yank/unyank (dummy server), Claude integration links**
6. **M5 – Hardening, tests, distribution (npm/global/brew/scoop)**

Each milestone has a DoD (Definition of Done) and a small set of tasks you can parallelize.

---

## Architecture choices (built for maintainability + easy install)

- **Layered, testable modules**: `commands/` (thin, I/O only) → `core/` (business logic) → `utils/` (pure helpers).
- **Dependency injection via a Context** (`createCLIContext()`): makes commands easily unit-testable and lets you swap implementations (e.g., dummy vs real registry client).
- **Strict typing & schemas**: `zod` for all external inputs (config files, API responses).
- **Deterministic I/O**: all FS/network calls centralized in `core`/`utils`—no side effects in commands.
- **Minimal runtime deps**: only libraries listed, plus a couple tiny, optional utilities (not required).
- **Cross‑platform symlinks**: prefer symlinks; on Windows, fall back to junctions or copies (user-configurable).
- **Binary-friendly build**: single bundled `dist/tz.mjs` with shebang (fast global install, no postinstall steps).
- **Offline-first**: content-addressable cache with SHA‑256, lockfile with integrity & URLs, retries/backoff.

> Output format: **ESM bundle** (single file with shebang + require shim) for modern Node; source remains TypeScript/ESM.

---

## Milestone details

### M0 – Project foundation

**DoD**

- TypeScript strict, ESM source → ESM bundle with shebang
- Vitest running with coverage
- Esbuild bundling single output with shebang
- Prettier/ESLint (optional) and basic GH Actions CI

**Tasks**

- Initialize repo + `package.json` (as per your spec)
- `tsconfig.json` with strict & Node 18 libs
- `build.config.mjs` (from your spec) + `pnpm run build`, `pnpm test`

---

### M1 – CLI skeleton & config/auth shell

**DoD**

- `tz --help` shows all commands (init/install/update/publish/auth/run/yank/unyank)
- `~/.terrazul/config.json` read/write via `zod`; file permissions enforced (0600)
- Auth command stubs store long-lived Personal Access Tokens (PATs); login opens browser (or prints manual flow)

**Tasks**

- Implement `src/index.ts` using `commander`
- `utils/logger.ts` with `chalk`, `--verbose` flag support
- `utils/config.ts` using `zod` and safe FS (`0600` on write)
- `utils/auth.ts` with login/logout stubs (browser open helper + manual paste)
- `types/config.ts`, `types/api.ts`, `types/package.ts`

**Skeletons**

```ts
// src/index.ts
import { Command } from 'commander';
import { version } from '../package.json';
import { createCLIContext } from './utils/context';
import installCmd from './commands/add';
import initCmd from './commands/init';
import updateCmd from './commands/update';
import publishCmd from './commands/publish';
import authCmd from './commands/auth';
import runCmd from './commands/run';
import yankCmd from './commands/yank';

const program = new Command();
program
  .name('tz')
  .description('Terrazul CLI — AI config package manager')
  .version(version)
  .option('--verbose', 'enable verbose logging', false);

program.addCommand(initCmd);
program.addCommand(installCmd);
program.addCommand(updateCmd);
program.addCommand(publishCmd);
program.addCommand(authCmd);
program.addCommand(runCmd);
program.addCommand(yankCmd);

async function main() {
  const ctx = await createCLIContext(program.opts());
  // stash ctx globally or inject into commands via closures
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
```

```ts
// src/utils/context.ts
import { createLogger } from './logger';
import { readUserConfig, writeUserConfig } from './config';
import { RegistryClient } from '../core/registry-client';
import { StorageManagerFs } from '../core/storage';
import { DependencyResolver } from '../core/dependency-resolver';

export interface CLIContext {
  logger: ReturnType<typeof createLogger>;
  config: Awaited<ReturnType<typeof readUserConfig>>;
  saveConfig: typeof writeUserConfig;
  registry: RegistryClient;
  storage: StorageManagerFs;
  resolver: DependencyResolver;
}

export async function createCLIContext(opts: { verbose?: boolean }): Promise<CLIContext> {
  const logger = createLogger({ verbose: !!opts.verbose });
  const config = await readUserConfig();
  const storage = new StorageManagerFs();
  const registry = new RegistryClient({ logger, configProvider: () => config });
  const resolver = new DependencyResolver({ registry, logger });
  return { logger, config, saveConfig: writeUserConfig, registry, storage, resolver };
}
```

```ts
// src/utils/config.ts
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const UserConfigSchema = z.object({
  registry: z.string().default('https://api.terrazul.com'),
  token: z.string().optional(),
  tokenExpiry: z.number().optional(),
  username: z.string().optional(),
  cache: z
    .object({
      ttl: z.number().default(3600),
      maxSize: z.number().default(500),
    })
    .default({ ttl: 3600, maxSize: 500 }),
  telemetry: z.boolean().default(false),
});

export type UserConfig = z.infer<typeof UserConfigSchema>;

const CONFIG_DIR = join(homedir(), '.terrazul');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export async function readUserConfig(): Promise<UserConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    return UserConfigSchema.parse(JSON.parse(raw));
  } catch {
    // create defaults
    const defaults = UserConfigSchema.parse({});
    await writeUserConfig(defaults);
    return defaults;
  }
}

export async function writeUserConfig(cfg: UserConfig) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
```

```ts
// src/utils/logger.ts
import chalk from 'chalk';

export function createLogger({ verbose }: { verbose: boolean }) {
  return {
    info: (m: string) => console.log(chalk.blue('info'), m),
    warn: (m: string) => console.warn(chalk.yellow('warn'), m),
    error: (m: string) => console.error(chalk.red('error'), m),
    debug: (m: string) => {
      if (verbose) console.log(chalk.gray('debug'), m);
    },
  };
}
```

---

### M2 – Storage + lockfile + installers (end‑to‑end via dummy API)

**DoD**

- `tz init` writes `agents.toml`, detects Claude (.claude/) if present
- `tz add` installs either a named package or all from `agents.toml`
- Tarball download → SHA‑256 verify → extract to `agent_modules/*`
- `agents-lock.toml` written with versions, resolved CDN URLs, integrity
- TERRAZUL.md generated; Claude symlinks created where applicable
- All of the above work **against a dummy API**

**Tasks**

- `core/storage.ts`: CAS store + extract + symlink creation
- `core/lock-file.ts`: read/write `agents-lock.toml` (use `@iarna/toml`)
- `core/package-manager.ts`: orchestration of install/update
- `integrations/claude-code.ts`: symlink & MCP update
- `commands/init.ts`, `commands/add.ts`
- Dummy API server (Node http) + fixtures

**Skeletons**

```ts
// src/core/storage.ts
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import * as tar from 'tar';

const HOME = process.env.HOME || '';
const ROOT = join(HOME, '.terrazul');
const CACHE_DIR = join(ROOT, 'cache', 'sha256');
const STORE_DIR = join(ROOT, 'store');

export class StorageManagerFs {
  async store(content: Buffer): Promise<string> {
    const sha = createHash('sha256').update(content).digest('hex');
    const p = join(CACHE_DIR, sha.slice(0, 2), sha.slice(2));
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, content);
    return sha;
  }

  async retrieve(hash: string): Promise<Buffer> {
    const p = join(CACHE_DIR, hash.slice(0, 2), hash.slice(2));
    return fs.readFile(p);
  }

  verify(content: Buffer, expectedHash: string): boolean {
    const sha = createHash('sha256').update(content).digest('hex');
    return sha === expectedHash;
  }

  getPackagePath(name: string, version: string): string {
    // flatten scoped names @a/b -> _a_b for filesystem safety
    const safe = name.replace(/\//g, '_').replace(/^@/, '_');
    return join(STORE_DIR, safe, version);
  }

  async extractTarball(tgz: Buffer, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    // tar v7 supports extracting from buffer via file: '-' stream
    // Work-around: write to temp then extract
    const temp = dest + '.tgz';
    await fs.writeFile(temp, tgz);
    await tar.x({ file: temp, cwd: dest, strip: 1 });
    await fs.rm(temp);
  }
}
```

```ts
// src/core/lock-file.ts
import { promises as fs } from 'node:fs';
import { parse, stringify } from '@iarna/toml';

export interface LockFile {
  version: number;
  packages: Record<
    string,
    {
      version: string;
      resolved: string;
      integrity: string; // "sha256-<base64>"
      dependencies: Record<string, string>;
      yanked?: boolean;
      yanked_reason?: string;
    }
  >;
  metadata?: { generated_at: string; cli_version: string };
}

export async function readLockFile(path = 'agents-lock.toml'): Promise<LockFile | null> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    return parse(raw) as LockFile;
  } catch {
    return null;
  }
}

export async function writeLockFile(lock: LockFile, path = 'agents-lock.toml') {
  await fs.writeFile(path, stringify(lock));
}
```

```ts
// src/core/registry-client.ts
import type { UserConfig } from '../utils/config';

export class RegistryClient {
  constructor(
    private deps: {
      logger: { debug: (m: string) => void };
      configProvider: () => UserConfig;
    },
  ) {}

  private base() {
    return this.deps.configProvider().registry;
  }
  private token() {
    return this.deps.configProvider().token;
  }

  private async fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
    const url = new URL(path, this.base()).toString();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.token()) headers['authorization'] = `Bearer ${this.token()}`;
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });

    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success === false) {
      const message = body?.error?.message || `HTTP ${res.status}`;
      throw new Error(message);
    }
    return (body.data ?? body) as T;
  }

  getPackageInfo(name: string) {
    return this.fetchJSON(`/packages/v1/${encodeURIComponent(name)}`);
  }
  listVersions(name: string) {
    return this.fetchJSON(`/packages/v1/${encodeURIComponent(name)}/versions`);
  }
  downloadTarball(name: string, version: string): Promise<ArrayBuffer> {
    return this.fetchJSON(
      `/packages/v1/${encodeURIComponent(name)}/tarball/${encodeURIComponent(version)}`,
      {
        // server can respond with redirect; follow is default
      },
    ).then(async (data: any) => {
      // If API returns a URL, fetch binary
      if (typeof data?.url === 'string') {
        const res = await fetch(data.url);
        if (!res.ok) throw new Error(`tarball download failed: ${res.status}`);
        return res.arrayBuffer();
      }
      // Or if API directly returned bytes (dummy mode)
      return data as ArrayBuffer;
    });
  }
}
```

```ts
// src/commands/init.ts
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { parse, stringify } from '@iarna/toml';
import inquirer from 'inquirer';

const cmd = new Command('init')
  .description('Initialize a new Terrazul project')
  .action(async () => {
    const exists = await fs
      .stat('agents.toml')
      .then(() => true)
      .catch(() => false);
    if (exists) {
      console.log('agents.toml already exists');
      return;
    }
    const answers = await inquirer.prompt([
      {
        name: 'name',
        message: 'Package name (@username/pkg):',
        validate: (s) => !!s || 'required',
      },
      { name: 'description', message: 'Description:' },
    ]);

    const toml = stringify({
      package: {
        name: answers.name,
        version: '0.1.0',
        description: answers.description,
        license: 'MIT',
        keywords: ['claude-code'],
      },
      dependencies: {},
      compatibility: { 'claude-code': '>=0.2.0' },
      scripts: { postinstall: "echo 'Package installed'" },
    } as any);

    await fs.writeFile('agents.toml', toml);
    // Add .gitignore entry
    const gi = await fs.readFile('.gitignore', 'utf8').catch(() => '');
    if (!gi.includes('agent_modules/')) {
      await fs.writeFile('.gitignore', gi + (gi.endsWith('\n') ? '' : '\n') + 'agent_modules/\n');
    }
    console.log('Initialized agents.toml');
  });

export default cmd;
```

```ts
// src/commands/add.ts
import { Command } from 'commander';
import ora from 'ora';
import { promises as fs } from 'node:fs';
import { parse } from '@iarna/toml';
import { createCLIContext } from '../utils/context';
import { writeLockFile, readLockFile } from '../core/lock-file';

const cmd = new Command('install')
  .argument('[packageSpec]', 'e.g., @user/pkg@^1.0.0')
  .description('Install packages with dependency resolution')
  .action(async (packageSpec?: string) => {
    const ctx = await createCLIContext({}); // simple for now
    const spinner = ora('Resolving dependencies').start();

    let deps: Record<string, string> = {};
    if (packageSpec) {
      // parse name@range
      const [name, range = 'latest'] = packageSpec.split('@').filter(Boolean);
      deps[name.startsWith('@') ? name : `@${name}`] = range;
    } else {
      const toml = parse(await fs.readFile('agents.toml', 'utf8')) as any;
      deps = toml?.dependencies || {};
    }

    // Resolve (placeholder: defer to resolver for real SAT)
    const solution = await ctx.resolver.resolve(deps, await readLockFile());
    spinner.text = 'Downloading packages';

    for (const [name, pkg] of solution.packages) {
      const arr = await ctx.registry.downloadTarball(name, pkg.version);
      const buf = Buffer.from(arr);
      // integrity
      const shaHex = await (await import('node:crypto'))
        .createHash('sha256')
        .update(buf)
        .digest('hex');
      await ctx.storage.store(buf);
      const dest = ctx.storage.getPackagePath(name, pkg.version);
      await ctx.storage.extractTarball(buf, dest);
      ctx.logger.info(`installed ${name}@${pkg.version} → ${dest}`);
    }

    // Lockfile
    const lock = {
      version: 1,
      packages: Object.fromEntries(
        [...solution.packages.entries()].map(([name, p]) => [
          name,
          {
            version: p.version,
            resolved: p.resolvedUrl,
            integrity: p.integrity, // "sha256-..." from registry or computed
            dependencies: p.dependencies || {},
            yanked: p.yanked || false,
            yanked_reason: p.yanked_reason || undefined,
          },
        ]),
      ),
      metadata: { generated_at: new Date().toISOString(), cli_version: '0.1.0' },
    };
    await writeLockFile(lock);
    spinner.succeed('Install complete');
  });

export default cmd;
```

---

### M3 – SAT resolver + yanked handling + updates

**DoD**

- `DependencyResolver` uses `minisat` to pick versions satisfying semver ranges + deps
- Skips yanked versions unless present in lock file and allowed by flags
- `tz update` computes new highest compatible versions and updates atomically
- `--dry-run` shows plan

**Tasks**

- Wire `/packages/v1/{name}/versions` into resolver
- Build SAT variables: one var per (package, version)
  - **AtMostOne** per package
  - For each selected version, add clauses for its dependencies (range→ variables)
  - Exclude yanked (unless `allowYankedFromLock`)

- Prefer-latest heuristic: sort assumption order by semver-desc when invoking minisat
- Implement `commands/update.ts`

**Resolver skeleton (outline)**

```ts
// src/core/dependency-resolver.ts
import semver from 'semver';
import minisat from 'minisat';

interface ResolveOptions {
  skipYanked?: boolean; // default true
  allowYankedFromLock?: boolean; // default true
  preferLatest?: boolean; // default true
}

export class DependencyResolver {
  constructor(private deps: { registry: any; logger: any }) {}

  async resolve(
    dependencies: Record<string, string>,
    lockFile?: any,
    options: ResolveOptions = {},
  ) {
    const opts = { skipYanked: true, allowYankedFromLock: true, preferLatest: true, ...options };

    // 1) Gather candidate versions per package from registry (and lockfile if pinned)
    const universe = new Map<
      string,
      { version: string; yanked: boolean; deps: Record<string, string> }[]
    >();

    for (const [name, range] of Object.entries(dependencies)) {
      const versions = await this.deps.registry.listVersions(name); // [{version, yanked, dependencies: {...}}]
      const candidates = versions
        .filter((v: any) => semver.satisfies(v.version, range))
        .filter((v: any) => (opts.skipYanked ? !v.yanked : true));
      universe.set(name, candidates);
    }

    // 2) Build SAT CNF
    //    - var id map: `${name}@${ver}` -> integer
    //    - AtMostOne per package
    //    - For each candidate, add dependency implications
    const varId = new Map<string, number>();
    let id = 1;
    for (const [name, list] of universe) {
      for (const v of list) varId.set(`${name}@${v.version}`, id++);
    }

    const solver = new minisat.Solver();
    const getLit = (k: string) => varId.get(k)!;

    // AtMostOne per package: for all pairs (a,b): (!a or !b)
    for (const [name, list] of universe) {
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          solver.addClause([
            -getLit(`${name}@${list[i].version}`),
            -getLit(`${name}@${list[j].version}`),
          ]);
        }
    }

    // Dependency implications: selecting X implies selecting some Y that satisfies range
    for (const [name, list] of universe) {
      for (const v of list) {
        const key = `${name}@${v.version}`;
        for (const [depName, depRange] of Object.entries(v.deps || {})) {
          const depList = (universe.get(depName) || []).filter((d) =>
            semver.satisfies(d.version, depRange),
          );
          // X -> (Y1 or Y2 or ...)
          const clause = [-getLit(key), ...depList.map((d) => getLit(`${depName}@${d.version}`))];
          if (clause.length === 1) {
            throw new Error(`Unsatisfiable: ${key} requires ${depName}@${depRange}`);
          }
          solver.addClause(clause);
        }
      }
    }

    // 3) Add at-least-one for each root dependency
    for (const [name, list] of universe) {
      if (list.length === 0) throw new Error(`No candidates for ${name}`);
      solver.addClause(list.map((v) => getLit(`${name}@${v.version}`)));
    }

    // 4) Prefer-latest: branch order (latest first)
    const order = [...varId.entries()]
      .sort((a, b) => {
        const [na, va] = a[0].split('@');
        const [nb, vb] = b[0].split('@');
        if (na !== nb) return na.localeCompare(nb);
        return semver.rcompare(va, vb);
      })
      .map(([, n]) => n);

    const sat = solver.solve(order);
    if (!sat) throw new Error('Version conflict');

    // Build result set
    const packages = new Map<
      string,
      {
        version: string;
        resolvedUrl: string;
        integrity: string;
        dependencies: Record<string, string>;
        yanked?: boolean;
        yanked_reason?: string;
      }
    >();
    for (const [k, n] of varId) {
      if (solver.modelValue(n)) {
        const [pname, v] = k.split('@');
        // You’ll fill details from versions list (resolvedUrl/integrity can come from registry on demand)
        packages.set(pname, { version: v, resolvedUrl: '', integrity: '', dependencies: {} });
      }
    }

    return { packages, conflicts: [], warnings: [] };
  }
}
```

> This is intentionally simplified—the shape matches your interface and is enough to power the MVP and grow later (yanked reasoning, lockfile pinning, etc.).

---

### M4 – Publish/yank/unyank (dummy server), Claude integration links

**DoD**

- `tz publish` validates structure, builds tarball, calculates SHA‑256, POSTs to dummy API
- Dummy API writes tarball to a local folder and returns `success: true` with metadata
- `tz yank` / `tz unyank` toggle a flag in dummy API storage
- `tz run` aggregates MCP servers under `.claude/` via symlinks and launches Claude with flags

**Tasks**

- Implement validators using `zod` + presence checks for directories
- Tar creation via `tar.c()`
- Claude integration: copy/symlink agents/commands; patch `settings.local.json` (as in your spec)
- Add `commands/publish.ts`, `commands/yank.ts`, `commands/run.ts`

---

### M5 – Hardening, tests, distribution

**DoD**

- Unit tests (resolver, registry client, lockfile)
- Integration tests (install/update with dummy API)
- E2E tests (init → install → update)
- GitHub Actions CI for build + test on Node 18/20
- Publish to npm; provide Homebrew/Scoop manifests later

**Tasks**

- Use Vitest and a `tmp` dir utility
- Optionally MSW or nock for http mocking (or just run the dummy API in test)
- Release scripts (`prepublishOnly` already in your spec)
- Add `npx tz@latest` smoke test to CI

---

## Dummy API server (for v0)

Keep it simple: a single Node script serving JSON + tarballs from a `fixtures/` folder. It implements your response envelope and a minimal set of endpoints.

```
tools/
└── dummy-registry.ts
fixtures/
  packages/
    @terrazul/starter/1.0.0.tgz
  meta.json
```

```ts
// tools/dummy-registry.ts
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

const PORT = 8787;
const ROOT = join(process.cwd(), 'fixtures');

const meta = {
  '@terrazul/starter': {
    description: 'Starter package',
    versions: [
      {
        version: '1.0.0',
        published_at: new Date().toISOString(),
        sha256: '', // filled dynamically
        downloads: 0,
        dependencies: {},
        compatibility: { 'claude-code': '>=0.2.0' },
        yanked: false,
      },
    ],
  },
};

function respondJSON(res: http.ServerResponse, data: any) {
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      success: true,
      data,
      meta: { timestamp: new Date().toISOString(), request_id: 'req_dummy' },
    }),
  );
}

async function sha256File(p: string) {
  const buf = await readFile(p);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (url.pathname.startsWith('/packages/v1/')) {
    const parts = url.pathname.replace('/packages/v1/', '').split('/');
    const name = decodeURIComponent(parts[0]);
    const op = parts[1];

    if (op === 'versions') {
      const info = meta[name];
      if (!info) return respondJSON(res, []);
      return respondJSON(res, info.versions);
    }

    if (op === 'tarball') {
      const version = decodeURIComponent(parts[2] || '');
      const file = join(ROOT, 'packages', name, `${version}.tgz`);
      const hash = await sha256File(file).catch(() => null);
      if (!hash) {
        res.statusCode = 404;
        return res.end();
      }
      // Respond with a CDN-like redirect target (here just a local URL)
      return respondJSON(res, {
        url: `http://localhost:${PORT}/cdn/${encodeURIComponent(name)}/${version}.tgz`,
      });
    }

    // package info
    if (parts.length === 1) {
      const info = meta[name];
      return respondJSON(res, info || {});
    }
  }

  if (url.pathname.startsWith('/cdn/')) {
    const [, , name, fname] = url.pathname.split('/');
    const n = decodeURIComponent(name);
    const file = join(ROOT, 'packages', n, fname);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/gzip');
    return createReadStream(file).pipe(res);
  }

  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`Dummy registry running http://localhost:${PORT}`);
});
```

> Point your CLI at this server by setting `registry = "http://localhost:8787"` in `~/.terrazul/config.json`.

**Creating a fixture tarball**

Put a tiny package under `fixtures/work/@terrazul/starter/` (with `agents/`, `configurations/main.md`, etc.) then:

```ts
// tools/make-fixtures.ts
import tar from 'tar';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = join(process.cwd(), 'fixtures', 'work', '@terrazul', 'starter');
const out = join(process.cwd(), 'fixtures', 'packages', '@terrazul/starter');
await mkdir(out, { recursive: true });
await mkdir(join(base, 'configurations'), { recursive: true });
await mkdir(join(base, 'agents'), { recursive: true });
await writeFile(join(base, 'configurations', 'main.md'), '# Hello from Terrazul');
await writeFile(join(base, 'agents', 'test-writer.yaml'), 'name: test-writer');

await tar.c({ gzip: true, cwd: base, file: join(out, '1.0.0.tgz') }, ['.']);
console.log('Fixture ready');
```

---

## Command behaviors & edge cases (quick checklists)

**tz init**

- Detect `.claude/` and set `[compatibility]` accordingly
- Add `agent_modules/` to `.gitignore`
- ✅ DoD: valid `agents.toml` + console hint for starter packages

**tz add \[package]**

- Read `agents.toml` or parse `@scope/name@range`
- Resolve deps (SAT in M3), skip yanked unless allowed by lock
- Download with redirects; verify SHA‑256; extract; link Claude assets
- Write/merge `agents-lock.toml` and `TERRAZUL.md`
- Warn if installing a yanked version (allowed only from lock)
- ✅ DoD: installed, lockfile updated, Claude links made

**tz update \[package]**

- Compare lockfile vs available versions; compute plan
- `--dry-run` shows changes
- Update atomically and regenerate lockfile + TERRAZUL.md
- ✅ DoD: no yanked updates; respects semver / constraints

**tz publish**

- Validate manifest + structure (`zod` + presence checks)
- Build tarball for distribution
- POST to registry; show resulting version
- ✅ DoD: appears in `search`/`versions` of dummy API

**tz yank / tz unyank**

- POST to registry endpoints; local warning on install/update
- ✅ DoD: versions disappear from new resolutions but remain installable from existing locks

**tz run**

- Aggregate `agent_modules/*/mcp/` into `.claude/settings.local.json`
- Launch Claude Code (`child_process.spawn`), pass `--mcp-config`
- ✅ DoD: Claude sees MCP servers

---

## Performance considerations (as you scale)

- **Concurrent downloads** (cap 5): simple queue using `Promise.allSettled` or a tiny `p-limit` (optional dep)
- **Cache TTL** in config (default 3600s) to avoid re-fetching versions too often
- **Hash once**: compute SHA‑256 during download stream (pipe to hasher and buffer)
- **Small packages**: keep your tarball creation strict and ignore dev files via `.tzignore` (future)

---

## Security notes

- **No executable code**: enforce in publish validation (ban `*.js`/`*.sh` unless they’re under `commands/` and explicitly non-executable, or enforce non-exec bit on extract).
- **0600 config**: warn if file mode is too open (on Unix).
- **HTTPS only** in real mode; allow `http://localhost` for dummy testing.
- **Proxy support**: honor `HTTPS_PROXY/HTTP_PROXY/NO_PROXY` (can be added to fetch init agent).

---

## Testing strategy recap

- **Unit**: resolver clauses (happy/sad paths), lockfile read/write, storage hashing
- **Integration**: `install` against dummy API (fixture packages)
- **E2E**: `init → install → update` in a temp dir
- **Auth**: mock token store; login writes tokens and respects 0600

---

## Distribution & “install everywhere”

- **Primary**: `pnpm install -g terrazul` or `npx terrazul@latest`
- **Secondary** (later):
  - **Homebrew**: formula pointing to npm tarball or GitHub release
  - **Scoop**: JSON manifest in your bucket
  - **AUR**: `terrazul-bin` packaging `dist/tz.mjs`

- **No native deps** → works on Linux/macOS/Windows without build tools

---

## What to build first (practical path this week)

1. M0/M1: scaffold repo; wire `tz init`, config, logger, auth stubs.
2. M2: storage manager + lockfile; **install end‑to‑end against dummy API** (one package).
3. M3: add SAT resolver and yanked handling; enable `update`.
4. M4: publish/yank flows (dummy server), Claude link creation.
5. M5: tests, polish messages, release `0.1.0`.

---

### Small niceties that pay off

- A single **`context`** object passed to each command (easy mocking).
- A consistent **spinner wrapper** that captures logs under `--verbose`.
- **Error taxonomy** exactly as in your `TerrazulError` (map API codes to messages).
- A short **“support bundle”** command (later) that collects logs/config (no secrets) for debugging.

---

If you want, I can turn these skeletons into a ready-to-run repo layout (with the scripts under `tools/` and a first `fixtures` package) so you can run:

```bash
# Terminal
node tools/dummy-registry.ts &
pnpm run build
# configure registry to http://localhost:8787 in ~/.terrazul/config.json
tz init
tz add @terrazul/starter@^1.0.0
```

…and see the full path from resolve → download → extract → lockfile on day one.
