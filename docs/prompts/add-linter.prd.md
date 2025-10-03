Below is a turnkey proposal for **linting & formatting**—including the _why_, the exact **rules**, a **task** you can drop into your backlog, and a **copy‑paste prompt** to give your AI coding agent so it implements everything cleanly.

---

## Recommendation

**Linter:** ESLint (TypeScript‑aware)
**Formatter:** Prettier (kept separate; ESLint defers stylistic rules via `eslint-config-prettier`)

**Why this combo?**

- ESLint gives **semantic** and **type‑aware** checks for Node/TS (unsafe promise usage, missing types, import hygiene).
- Prettier handles formatting deterministically. We disable ESLint’s styling rules to avoid tool overlap (“one source of truth” for format).
- Plugins target our needs: **TypeScript**, **Node 18**, **import rules**, **promises**, **security**, **unicorn** (sane modern JS checks), and **Vitest**.

---

## Dev dependencies to add

> (Pinned majors only—your agent can resolve compatible minors)

- `eslint`
- `@typescript-eslint/parser`
- `@typescript-eslint/eslint-plugin`
- `eslint-plugin-import`
- `eslint-import-resolver-typescript`
- `eslint-plugin-promise`
- `eslint-plugin-unicorn`
- `eslint-plugin-n` (Node rules)
- `eslint-plugin-security`
- `eslint-plugin-vitest`
- `eslint-plugin-eslint-comments`
- `eslint-config-prettier`
- `prettier`

---

## Files to add/update

### 1) `.eslintrc.cjs`

```js
/* eslint-env node */
module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.eslint.json'],
    sourceType: 'module',
    ecmaVersion: 'latest',
  },
  plugins: [
    '@typescript-eslint',
    'import',
    'promise',
    'unicorn',
    'n',
    'security',
    'vitest',
    'eslint-comments',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:promise/recommended',
    'plugin:unicorn/recommended',
    'plugin:n/recommended',
    'plugin:security/recommended',
    'plugin:vitest/recommended',
    'plugin:eslint-comments/recommended',
    'prettier',
  ],
  settings: {
    'import/resolver': {
      // Let ESLint understand TS paths and .ts extensions
      typescript: true,
      node: true,
    },
  },
  rules: {
    /* ---------- TypeScript ---------- */
    '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    '@typescript-eslint/explicit-module-boundary-types': 'error',
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false, ignoreIIFE: false }],
    '@typescript-eslint/no-misused-promises': [
      'error',
      { checksVoidReturn: { arguments: false, attributes: false } },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-throw-literal': 'error',
    '@typescript-eslint/ban-ts-comment': ['warn', { 'ts-ignore': 'allow-with-description' }],

    // We rely heavily on zod-validation; keep the "no-unsafe-*" family relaxed for now.
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',

    /* ---------- Imports ---------- */
    'import/no-default-export': 'error',
    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: [
          '**/tests/**',
          '**/*.test.ts',
          'tools/**',
          'vitest.config.ts',
          'build.config.mjs',
        ],
      },
    ],
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],

    /* ---------- Node ---------- */
    'n/no-missing-import': 'off', // TS resolver handles this
    'n/no-unsupported-features/es-syntax': 'off',
    'n/no-unsupported-features/node-builtins': ['error', { version: '>=18.0.0' }],

    /* ---------- Promises ---------- */
    'promise/no-multiple-resolved': 'error',
    'promise/no-return-wrap': 'error',
    'promise/no-nesting': 'warn',

    /* ---------- Unicorn (selectively tuned) ---------- */
    'unicorn/prevent-abbreviations': 'off',
    'unicorn/no-null': 'off',
    'unicorn/no-process-exit': 'off', // CLI
    'unicorn/filename-case': ['warn', { case: 'kebabCase' }],
    'unicorn/no-array-reduce': 'off',

    /* ---------- Security ---------- */
    'security/detect-object-injection': 'off', // noisy; revisit if needed

    /* ---------- General ---------- */
    'eslint-comments/no-unused-disable': 'error',
    'no-console': 'off',
    'no-restricted-syntax': [
      'error',
      {
        selector: 'TSEnumDeclaration',
        message: 'Use union types or const objects instead of enums.',
      },
    ],
  },
  overrides: [
    {
      files: ['src/commands/**/*.ts'],
      rules: {
        '@typescript-eslint/explicit-module-boundary-types': 'off', // commands often export Commander instances
      },
    },
    {
      files: ['tests/**/*.ts'],
      env: { 'vitest/globals': true },
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        'import/no-default-export': 'off',
      },
    },
    {
      files: ['tools/**/*.ts', 'fixtures/**/*'],
      rules: {
        'import/no-extraneous-dependencies': 'off',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', 'fixtures/', '*.d.ts'],
};
```

### 2) `tsconfig.eslint.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": [
    "src/**/*.ts",
    "tests/**/*.ts",
    "tools/**/*.ts",
    "vitest.config.ts",
    "build.config.mjs"
  ]
}
```

### 3) `.eslintignore` (optional; ignore also defined in config)

```
dist
node_modules
fixtures
```

### 4) `.prettierrc.json`

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "arrowParens": "always"
}
```

### 5) `package.json` scripts (add)

```json
{
  "scripts": {
    "lint": "eslint . --ext .ts --max-warnings 0",
    "lint:fix": "eslint . --ext .ts --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

### 6) CI (add a lint step before build/test)

In `.github/workflows/ci.yml`, add:

```yaml
- name: Lint
  run: npm run lint

- name: Check formatting
  run: npm run format:check
```

---

## Rule rationale (highlights)

- **Type safety at boundaries**: `explicit-module-boundary-types`, `consistent-type-imports`, `no-floating-promises`, `no-misused-promises`.
- **Deterministic imports**: `import/order`, `no-default-export` (encourages named APIs across `core`/`utils`).
- **Node 18 correctness**: `plugin:n` ensures we don’t use unsupported builtins.
- **CLI realities**: allow `process.exit` and `console` usage.
- **Security posture**: baseline `plugin:security/recommended`; we disable the noisier `detect-object-injection` for now—can revisit when we have structured maps.
- **Test ergonomics**: relax “unsafe” rules in test files; unit tests often stub or cast.

---

## Backlog Task

**Task:** LIN‑001 – Add ESLint + Prettier with TypeScript, Node, Import, Promise, Security, Unicorn, and Vitest rules

**Owner:** Tooling
**Milestone:** M0/M1 (foundation)

**Why:** Enforce code quality and consistency; catch bugs early (promises/imports/types), keep codebase maintainable.

**Scope:**

1. Add dev dependencies listed above.
2. Create `.eslintrc.cjs`, `tsconfig.eslint.json`, `.eslintignore`, `.prettierrc.json`.
3. Add `lint`, `lint:fix`, `format`, `format:check` scripts.
4. Integrate lint & format checks into CI prior to build/test.
5. Make minimal code changes to satisfy `--max-warnings 0`.
6. Document in `agents.md` under “Tooling”.

**Acceptance Criteria:**

- `npm run lint` passes with **0 warnings**.
- `npm run format:check` passes.
- CI fails if lint or formatting fails.
- Lint rules apply type‑aware checks (ESLint uses `tsconfig.eslint.json`).
- Import hygiene enforced (`no-default-export`, `import/order`), promise misuse caught, Node 18 supported.
- Tests unaffected (vitest globals recognized; relaxed unsafe rules inside `tests/**`).
- Windows & macOS runners pass lint step.

**Out of scope:** Pre-commit hooks (husky/lint‑staged) – optional later.

---

## Copy‑paste Prompt for Your AI Coding Agent

```text
SYSTEM ROLE
You are a senior Node/TypeScript tooling engineer. Set up linting and formatting for a Node 18+ TypeScript CLI repo. Your output must be production-quality, deterministic, cross-platform, and fully wired into CI with zero warnings allowed.

CONTEXT
Repo: Terrazul CLI (`tz`) – Node 18, TypeScript 5, TypeScript/ESM source → single-file ESM bundle in dist. Tests use Vitest. We want strict, maintainable code, with thin `commands/` and rich `core/` + `utils/`. Add a robust linter and formatter setup that matches our architecture and avoids runtime deps.

REQUIREMENTS
1) Add ESLint with TypeScript, Node, Import, Promise, Security, Unicorn, Vitest, and eslint-comments plugins. Integrate Prettier and turn off stylistic rules via eslint-config-prettier.
2) Create the following files with the exact contents provided below (update paths if needed):
   - .eslintrc.cjs
   - tsconfig.eslint.json
   - .eslintignore
   - .prettierrc.json
3) Modify package.json to include scripts:
   - "lint": "eslint . --ext .ts --max-warnings 0"
   - "lint:fix": "eslint . --ext .ts --fix"
   - "format": "prettier --write ."
   - "format:check": "prettier --check ."
4) Update CI workflow (.github/workflows/ci.yml) to add steps:
   - run: npm run lint
   - run: npm run format:check
   These must run before build/test.
5) Ensure ESLint is type-aware by using tsconfig.eslint.json; include both src and tests.
6) Make minimal code changes so that lint passes with **zero warnings** across the repo.
7) Do not add any new runtime dependencies; only devDependencies are allowed.

FILES TO WRITE

=== .eslintrc.cjs ===
[PASTE THE .eslintrc.cjs CONTENT FROM THE SPEC ABOVE]

=== tsconfig.eslint.json ===
[PASTE THE tsconfig.eslint.json CONTENT FROM THE SPEC ABOVE]

=== .eslintignore ===
[PASTE THE .eslintignore CONTENT FROM THE SPEC ABOVE]

=== .prettierrc.json ===
[PASTE THE .prettierrc.json CONTENT FROM THE SPEC ABOVE]

PACKAGE.JSON UPDATES
- Add devDependencies for:
  eslint, @typescript-eslint/parser, @typescript-eslint/eslint-plugin,
  eslint-plugin-import, eslint-import-resolver-typescript,
  eslint-plugin-promise, eslint-plugin-unicorn, eslint-plugin-n,
  eslint-plugin-security, eslint-plugin-vitest, eslint-plugin-eslint-comments,
  eslint-config-prettier, prettier
- Add scripts exactly as specified.

CI UPDATES
- Insert the lint and format steps **before** build and test jobs.
- CI must fail on lint errors or formatting drift.

VALIDATION
- Run: npm ci && npm run lint && npm run format:check
- Ensure zero warnings.
- Confirm Vitest files are linted with vitest globals enabled.
- Confirm Node 18 rule set is active and import order enforced.

OUTPUT FORMAT
Provide a diff or full file contents for each changed/added file, and a short note describing any source code edits you made to satisfy the linter (e.g., adding explicit return types, fixing unused variables). Ensure your PR is small and self-contained.
```

---

If you want this integrated into your existing **milestones**, I’d put it at the tail end of **M0** (tooling) or early **M1** (foundation) so all subsequent PRs are lint‑clean from the start.
