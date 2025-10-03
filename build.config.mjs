#!/usr/bin/env node
// Build script for Terrazul CLI (tz)
// Produces a single-file ESM bundle with a shebang at dist/tz.mjs

import esbuild from 'esbuild';
import { promises as fsPromises } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stripInkDevtoolsPlugin = {
  name: 'strip-ink-devtools',
  setup(build) {
    build.onLoad({ filter: /ink[\\/]build[\\/].*\.js$/ }, async (args) => {
      let source = await fsPromises.readFile(args.path, 'utf8');
      if (args.path.endsWith('reconciler.js')) {
        source = source.replace(/await import\(['"]\.\/devtools\.js['"]\);?/g, '');
      }
      return { contents: source, loader: 'js' };
    });
  },
};

async function ensureYogaAsset() {
  try {
    const yogaUrl = await import.meta.resolve('yoga-wasm-web/dist/yoga.wasm', import.meta.url);
    const yogaSource = fileURLToPath(yogaUrl);
    const yogaDest = path.join(__dirname, 'dist', 'yoga.wasm');
    await fsPromises.mkdir(path.dirname(yogaDest), { recursive: true });
    await fsPromises.copyFile(yogaSource, yogaDest);
  } catch (error) {
    console.warn('⚠️  Failed to copy yoga.wasm dependency:', error?.message ?? error);
  }
}

async function build() {
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    outfile: 'dist/tz.mjs',
    bundle: true,
    platform: 'node',
    target: ['node22'],
    format: 'esm',
    logLevel: 'info',
    sourcemap: false,
    legalComments: 'none',
    banner: {
      js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "module";\nconst require = __createRequire(import.meta.url);',
    },
    loader: {
      '.ts': 'ts',
      '.tsx': 'tsx',
    },
    jsx: 'automatic',
    jsxImportSource: 'react',
    external: ['react-devtools-core'],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    plugins: [stripInkDevtoolsPlugin],
  });

  await esbuild.build({
    entryPoints: ['src/runtime/sea-fetcher.ts'],
    outfile: 'dist/runtime/sea-fetcher.mjs',
    bundle: true,
    platform: 'node',
    target: ['node22'],
    format: 'esm',
    logLevel: 'info',
    sourcemap: false,
    legalComments: 'none',
    banner: {
      js: 'import { fileURLToPath as __fileURLToPath } from "url";\nimport { dirname as __pathDirname } from "path";\nconst __filename = __fileURLToPath(import.meta.url);\nconst __dirname = __pathDirname(__filename);',
    },
  });

  try {
    fs.chmodSync('dist/tz.mjs', 0o755);
  } catch {
    // ignore on platforms that don't support chmod
  }

  try {
    await fsPromises.rm('dist/tz.js', { force: true });
  } catch {
    // ignore if previous CJS bundle never existed
  }

  await ensureYogaAsset();
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
