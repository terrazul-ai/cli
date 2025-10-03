#!/usr/bin/env node
/**
 * Generate test fixture tarballs from source directories
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as tar from 'tar';

const FIXTURES_DIR = join(__dirname, '../fixtures');
const WORK_DIR = join(FIXTURES_DIR, 'work');
const PACKAGES_DIR = join(FIXTURES_DIR, 'packages');

interface PackageFixture {
  name: string;
  version: string;
  content: {
    'agents.toml': string;
    'README.md'?: string;
    'agents/'?: Record<string, string>;
    'commands/'?: Record<string, string>;
    'configurations/'?: Record<string, string>;
  };
}

const fixtures: PackageFixture[] = [
  {
    name: '@terrazul/starter',
    version: '1.0.0',
    content: {
      'agents.toml': `[package]
name = "@terrazul/starter"
version = "1.0.0"
description = "A starter package for Terrazul agents"
license = "MIT"
authors = ["Terrazul Team"]
homepage = "https://terrazul.com"

[dependencies]

[compatibility]
claude-code = ">=0.2.0"
`,
      'README.md': `# Terrazul Starter Package

A minimal starter package for testing the Terrazul CLI.

## Features
- Basic agent configuration
- Sample commands
- Claude Code compatibility

## Installation

\`\`\`bash
tz install @terrazul/starter
\`\`\`
`,
      'agents/': {
        'hello.md': `# Hello Agent

A simple agent that says hello.

## Usage

Ask me to greet someone!
`,
        'assistant.md': `# Assistant Agent

I can help you with various tasks.

## Capabilities
- Answer questions
- Provide code examples
- Help with debugging
`,
      },
      'commands/': {
        'greet.json': JSON.stringify(
          {
            name: 'greet',
            description: 'Greet someone',
            parameters: {
              name: {
                type: 'string',
                description: 'Name to greet',
              },
            },
          },
          null,
          2,
        ),
      },
      'configurations/': {
        'default.json': JSON.stringify(
          {
            theme: 'light',
            language: 'en',
            features: {
              autoComplete: true,
              syntaxHighlighting: true,
            },
          },
          null,
          2,
        ),
      },
    },
  },
  {
    name: '@terrazul/base',
    version: '2.0.0',
    content: {
      'agents.toml': `[package]
name = "@terrazul/base"
version = "2.0.0"
description = "Base utilities for Terrazul agents"
license = "MIT"
authors = ["Terrazul Team"]

[dependencies]

[compatibility]
`,
      'README.md': `# Terrazul Base

Core utilities and shared configurations for Terrazul agents.
`,
      'configurations/': {
        'base.json': JSON.stringify(
          {
            core: {
              version: '2.0.0',
              strict: true,
            },
          },
          null,
          2,
        ),
      },
    },
  },
];

/**
 * Create directory structure and files for a package
 */
function createPackageFiles(fixture: PackageFixture, workPath: string) {
  // Create work directory for this package
  mkdirSync(workPath, { recursive: true });

  // Write agents.toml
  writeFileSync(join(workPath, 'agents.toml'), fixture.content['agents.toml']);

  // Write README if present
  if (fixture.content['README.md']) {
    writeFileSync(join(workPath, 'README.md'), fixture.content['README.md']);
  }

  // Create subdirectories and files
  const dirs: (keyof typeof fixture.content)[] = ['agents/', 'commands/', 'configurations/'];

  for (const dir of dirs) {
    const files = fixture.content[dir];
    if (files) {
      const dirPath = join(workPath, dir.replace('/', ''));
      mkdirSync(dirPath, { recursive: true });

      for (const [filename, content] of Object.entries(files)) {
        writeFileSync(join(dirPath, filename), content);
      }
    }
  }
}

/**
 * Create a tarball from a directory
 */
async function createTarball(sourceDir: string, outputPath: string) {
  mkdirSync(join(outputPath, '..'), { recursive: true });

  await tar.create(
    {
      gzip: true,
      file: outputPath,
      cwd: sourceDir,
      portable: true,
      // Don't follow symlinks, preserve permissions
      follow: false,
      preservePaths: false,
    },
    ['.'],
  );
}

/**
 * Main function
 */
async function main() {
  console.log('🔧 Creating test fixtures...\n');

  // Clean and recreate directories
  if (existsSync(WORK_DIR)) {
    const { rmSync } = await import('fs');
    rmSync(WORK_DIR, { recursive: true, force: true });
  }
  if (existsSync(PACKAGES_DIR)) {
    const { rmSync } = await import('fs');
    rmSync(PACKAGES_DIR, { recursive: true, force: true });
  }

  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(PACKAGES_DIR, { recursive: true });

  // Process each fixture
  for (const fixture of fixtures) {
    console.log(`📦 Creating ${fixture.name}@${fixture.version}...`);

    // Create package directory structure
    const packageWorkDir = join(WORK_DIR, fixture.name.replace('/', '_'), fixture.version);
    createPackageFiles(fixture, packageWorkDir);

    // Create tarball
    const tarballDir = join(PACKAGES_DIR, fixture.name.replace('/', '_'));
    const tarballPath = join(tarballDir, `${fixture.version}.tgz`);

    await createTarball(packageWorkDir, tarballPath);

    console.log(`   ✅ Created tarball at: ${tarballPath}`);

    // List contents for verification
    const files = await tar.list({
      file: tarballPath,
      onentry: () => {},
    });
    console.log(`   📋 Contents: ${files.length} entries\n`);
  }

  console.log('✨ All fixtures created successfully!\n');
  console.log('📍 Work directories: fixtures/work/');
  console.log('📦 Tarballs: fixtures/packages/');
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Error creating fixtures:', error);
    process.exit(1);
  });
}

export { createPackageFiles, createTarball, fixtures };
