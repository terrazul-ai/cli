SYSTEM ROLE
You are a senior Node/TypeScript tooling engineer. Set up linting and formatting for a Node 18+ TypeScript CLI repo. Your output must be production-quality, deterministic, cross-platform, and fully wired into CI with zero warnings allowed.

CONTEXT
Repo: Terrazul CLI (`tz`) – Node 18, TypeScript 5, TypeScript/ESM source → single-file ESM bundle in dist. Tests use Vitest. We want strict, maintainable code, with thin `commands/` and rich `core/` + `utils/`. Add a robust linter and formatter setup that matches our architecture and avoids runtime deps.

REQUIREMENTS

1. Add ESLint with TypeScript, Node, Import, Promise, Security, Unicorn, Vitest, and eslint-comments plugins. Integrate Prettier and turn off stylistic rules via eslint-config-prettier.
2. Create the following files with the exact contents provided below (update paths if needed):
   - .eslintrc.cjs
   - tsconfig.eslint.json
   - .eslintignore
   - .prettierrc.json
3. Modify package.json to include scripts:
   - "lint": "eslint . --ext .ts --max-warnings 0"
   - "lint:fix": "eslint . --ext .ts --fix"
   - "format": "prettier --write ."
   - "format:check": "prettier --check ."
4. Update CI workflow (.github/workflows/ci.yml) to add steps:
   - run: npm run lint
   - run: npm run format:check
     These must run before build/test.
5. Ensure ESLint is type-aware by using tsconfig.eslint.json; include both src and tests.
6. Make minimal code changes so that lint passes with **zero warnings** across the repo.
7. Do not add any new runtime dependencies; only devDependencies are allowed.

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
