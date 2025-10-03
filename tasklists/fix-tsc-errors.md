# Fix TypeScript Errors (2025-09-17)

- [x] Capture current TypeScript errors via `pnpm typecheck`
- [x] Resolve type issues in `src/core/registry-client.ts`
- [x] Resolve type issues in `src/utils/context.ts`
- [x] Re-run `pnpm typecheck`
- [x] Run `pnpm tsc`
- [x] Run `pnpm test` _(fails: sandbox cannot open listening sockets)_

## Object.hasOwn compatibility (2025-09-17)

- [x] Identify failing usage of `Object.hasOwn` in uninstall command
- [x] Replace `Object.hasOwn` with a compatibility-safe helper
- [x] Run `pnpm typecheck`
- [x] Run `pnpm test`
