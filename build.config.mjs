#!/usr/bin/env node
// Build script for Terrazul CLI (tz)
// Produces a single-file ESM bundle with a shebang at dist/tz.mjs

import esbuild from 'esbuild';
import fs, { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');

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

async function bundleZodForSea() {
  let zodEntry;
  let zodPackagePath;
  try {
    const zodEntryResolved = await import.meta.resolve('zod', import.meta.url);
    const zodPackageResolved = await import.meta.resolve('zod/package.json', import.meta.url);
    zodEntry = zodEntryResolved.startsWith('file:')
      ? fileURLToPath(zodEntryResolved)
      : zodEntryResolved;
    zodPackagePath = zodPackageResolved.startsWith('file:')
      ? fileURLToPath(zodPackageResolved)
      : zodPackageResolved;
  } catch (error) {
    throw new Error(`Failed to resolve zod dependency: ${error?.message ?? error}`);
  }

  const vendorDir = path.join(__dirname, 'dist', 'vendor', 'zod');
  await fsPromises.mkdir(vendorDir, { recursive: true });

  await esbuild.build({
    entryPoints: [zodEntry],
    outfile: path.join(vendorDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    target: ['node18'],
    format: 'esm',
    logLevel: 'silent',
    sourcemap: false,
    legalComments: 'none',
  });

  const packageJson = JSON.parse(await fsPromises.readFile(zodPackagePath, 'utf8'));
  const vendorPackageJson = {
    name: 'zod',
    version: packageJson.version ?? '0.0.0',
    type: 'module',
    main: './index.mjs',
    module: './index.mjs',
    exports: {
      '.': './index.mjs',
      './package.json': './package.json',
    },
  };

  await fsPromises.writeFile(
    path.join(vendorDir, 'package.json'),
    `${JSON.stringify(vendorPackageJson, null, 2)}\n`,
    'utf8',
  );
}

async function writeSeaWrapper() {
  const seaWrapperCode = `#!/usr/bin/env node
// CJS wrapper that executes the bundled ESM entry via Module.runMain
(() => {
  try {
    const { getAsset } = require('node:sea');
    const { writeFileSync, mkdirSync } = require('node:fs');
    const { tmpdir, homedir } = require('node:os');
    const { join, delimiter } = require('node:path');
    const Module = require('node:module');

    // Create temp directory for extracted assets
    const tempDir = join(tmpdir(), 'tz-' + Date.now());
    mkdirSync(tempDir, { recursive: true });

    // Extract the ESM bundle from SEA assets
    const esmBundle = getAsset('tz.mjs', 'utf8');
    const entryFile = join(tempDir, 'tz.mjs');
    writeFileSync(entryFile, esmBundle);

    // Extract yoga.wasm from SEA assets
    const yogaWasm = getAsset('yoga.wasm');
    const yogaFile = join(tempDir, 'yoga.wasm');
    writeFileSync(yogaFile, Buffer.from(yogaWasm));

    // Expose zod to schema modules installed under ~/.terrazul/store
    try {
      const zodIndex = getAsset('vendor/zod/index.mjs', 'utf8');
      const zodPackage = getAsset('vendor/zod/package.json', 'utf8');
      const nodeModulesRoot = join(homedir(), '.terrazul', 'node_modules');
      const zodDir = join(nodeModulesRoot, 'zod');
      mkdirSync(zodDir, { recursive: true });
      writeFileSync(join(zodDir, 'index.mjs'), zodIndex);
      writeFileSync(join(zodDir, 'package.json'), zodPackage);

      // Ensure resolution includes ~/.terrazul/node_modules for ESM imports
      const existingNodePath = process.env.NODE_PATH;
      process.env.NODE_PATH = existingNodePath
        ? nodeModulesRoot + delimiter + existingNodePath
        : nodeModulesRoot;
      if (!Module.globalPaths.includes(nodeModulesRoot)) {
        Module.globalPaths.unshift(nodeModulesRoot);
      }
      if (typeof Module._initPaths === 'function') {
        Module._initPaths();
      }
    } catch (error) {
      console.warn(
        'Warning: Failed to prepare embedded zod dependency:',
        error?.message ?? error,
      );
    }

    // Ensure the extracted bundle is treated as the main module
    const argv = process.argv;
    if (argv.length > 1) {
      // Node SEA populates argv[1] with a duplicate of argv[0]; replace it with our entry file
      argv[1] = entryFile;
    } else {
      argv.push(entryFile);
    }

    Module.runMain(entryFile);
  } catch (error) {
    console.error('Failed to load Terrazul CLI:', error);
    process.exit(1);
  }
})();
`;

  await fsPromises.writeFile('dist/sea-entry.cjs', seaWrapperCode);
  await fsPromises.chmod('dist/sea-entry.cjs', 0o755);
}

async function buildSeaFetcherBundle() {
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
}

async function runPostBuildSteps() {
  await writeSeaWrapper();
  await buildSeaFetcherBundle();
  await bundleZodForSea();

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

let postBuildChain = Promise.resolve();
let buildCount = 0;

const postBuildPlugin = {
  name: 'terrazul-post-build-steps',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        console.error('❌ Build failed. Fix the errors above to continue.');
        return;
      }

      buildCount += 1;

      postBuildChain = postBuildChain
        .then(async () => {
          await runPostBuildSteps();
          const label = buildCount === 1 ? '✅ Built dist/tz.mjs' : '✅ Rebuilt dist/tz.mjs';
          console.log(label);
        })
        .catch((postError) => {
          console.error('❌ Post-build step failed:', postError);
        });

      return postBuildChain;
    });
  },
};

async function build() {
  const mainContext = await esbuild.context({
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
    plugins: [stripInkDevtoolsPlugin, postBuildPlugin],
  });

  try {
    await mainContext.rebuild();
  } catch (error) {
    await postBuildChain.catch(() => {});
    await mainContext.dispose();
    throw error;
  }

  if (isWatch) {
    await mainContext.watch();

    console.log('⚡ Watching for changes in src/... (press Ctrl+C to exit)');

    const shutdown = async () => {
      try {
        await postBuildChain.catch(() => {});
        await mainContext.dispose();
      } finally {
        process.exit(0);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  await postBuildChain.catch(() => {});
  await mainContext.dispose();
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
