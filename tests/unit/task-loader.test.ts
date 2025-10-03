import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ErrorCode, TerrazulError } from '../../src/core/errors';
import { loadTaskFile } from '../../src/utils/task-loader';

async function setup(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tz-task-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

describe('task-loader: loadTaskFile', () => {
  it('parses YAML task spec and validates shape', async () => {
    const root = await setup({
      'tasks/t.yaml': 'version: v1\npipeline: []\nresources: { a: "ok" }\n',
    });
    const spec = await loadTaskFile(root, 'tasks/t.yaml');
    expect(spec.version).toBe('v1');
    expect(Array.isArray(spec.pipeline)).toBe(true);
  });

  it('parses JSON task spec and validates shape', async () => {
    const root = await setup({ 'tasks/t.json': JSON.stringify({ version: 'v1', pipeline: [] }) });
    const spec = await loadTaskFile(root, 'tasks/t.json');
    expect(spec.version).toBe('v1');
    expect(Array.isArray(spec.pipeline)).toBe(true);
  });

  it('throws on missing file', async () => {
    const root = await setup({});
    await expect(loadTaskFile(root, 'tasks/missing.yaml')).rejects.toBeInstanceOf(TerrazulError);
  });

  it('throws CONFIG_INVALID on invalid spec', async () => {
    const root = await setup({ 'tasks/t.yaml': 'not: a: valid: pipeline\n' });
    try {
      await loadTaskFile(root, 'tasks/t.yaml');
      throw new Error('expected rejection');
    } catch (error) {
      const te = error as TerrazulError;
      expect(te.code).toBe(ErrorCode.CONFIG_INVALID);
    }
  });
});
