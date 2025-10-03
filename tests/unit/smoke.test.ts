/* eslint unicorn/prefer-module: off */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Resolve project root (cli/) from this test file
const root = path.dirname(path.dirname(__dirname));

describe('M0: build smoke', () => {
  it('build emits dist/tz.mjs with shebang', () => {
    execSync('node build.config.mjs', { cwd: root, stdio: 'inherit' });
    const out = path.join(root, 'dist', 'tz.mjs');
    expect(existsSync(out)).toBe(true);
    const content = readFileSync(out, 'utf8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });
});
