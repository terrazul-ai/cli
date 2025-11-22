/**
 * Utilities for setting up the runtime environment for schema modules
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ensures that a package directory has access to the zod runtime provider
 * by creating a node_modules/zod shim that re-exports from the CLI's bundled zod.
 *
 * This allows user-provided schema modules to `import { z } from 'zod'` successfully.
 *
 * @param packageDir - The package directory (e.g., ~/.terrazul/store/@user/pkg/1.0.0)
 */
export async function ensureZodRuntime(packageDir: string): Promise<void> {
  const nodeModulesDir = path.join(packageDir, 'node_modules');
  const zodDir = path.join(nodeModulesDir, 'zod');
  const zodIndexFile = path.join(zodDir, 'index.mjs');

  // Check if zod shim already exists
  try {
    await fs.access(zodIndexFile);
    return; // Already set up
  } catch {
    // Needs setup
  }

  // Create node_modules/zod directory
  await fs.mkdir(zodDir, { recursive: true });

  // Resolve the path to the CLI's runtime zod provider
  // import.meta.url points to the current module within the CLI bundle
  const cliLocation = fileURLToPath(import.meta.url);
  const cliDir = path.dirname(cliLocation);

  // The runtime provider should be at dist/runtime/zod-provider.mjs relative to the CLI
  // In development: src/utils/schema-runtime.ts -> ../../dist/runtime/zod-provider.mjs
  // In production: dist/tz.mjs -> ./runtime/zod-provider.mjs
  let zodProviderPath: string;

  // Try production path first (when running from bundled dist/tz.mjs)
  const prodPath = path.join(cliDir, 'runtime', 'zod-provider.mjs');
  try {
    await fs.access(prodPath);
    zodProviderPath = prodPath;
  } catch {
    // Try development path (when running from src/)
    const devPath = path.join(cliDir, '..', '..', 'dist', 'runtime', 'zod-provider.mjs');
    try {
      await fs.access(devPath);
      zodProviderPath = devPath;
    } catch {
      throw new Error(
        `Could not find zod-provider.mjs. Tried:\n- ${prodPath}\n- ${devPath}\nPlease run 'pnpm run build' first.`,
      );
    }
  }

  // Create package.json for the zod shim
  const packageJson = {
    name: 'zod',
    version: '3.23.8',
    type: 'module',
    main: './index.mjs',
    exports: {
      '.': './index.mjs',
      './package.json': './package.json',
    },
  };

  await fs.writeFile(path.join(zodDir, 'package.json'), JSON.stringify(packageJson, null, 2));

  // Create index.mjs that re-exports from the runtime provider
  const indexContent = `// Auto-generated shim for zod runtime
// This file re-exports zod from the Terrazul CLI's bundled runtime
export * from '${zodProviderPath}';
`;

  await fs.writeFile(zodIndexFile, indexContent);
}
