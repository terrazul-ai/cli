import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ErrorCode } from '../../src/core/errors';
import { loadTaskFile } from '../../src/utils/task-loader';

async function setupRoot(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), 'tz-task-sec-'));
}

describe('task-loader security', () => {
  it('rejects absolute task paths', async () => {
    const root = await setupRoot();
    const abs = path.resolve('/', 'etc', 'hosts'); // may or may not exist; rejection happens before read
    await expect(loadTaskFile(root, abs)).rejects.toMatchObject({
      code: ErrorCode.SECURITY_VIOLATION,
    });
  });

  it('rejects task paths that escape the package root via ..', async () => {
    const root = await setupRoot();
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'tz-outside-'));
    const outsideFile = path.join(outsideDir, 'task.yaml');
    await mkdir(path.dirname(outsideFile), { recursive: true });
    await writeFile(outsideFile, 'pipeline: []\n', 'utf8');
    const relEscape = path.relative(root, outsideFile); // likely starts with ../
    await expect(loadTaskFile(root, relEscape)).rejects.toMatchObject({
      code: ErrorCode.SECURITY_VIOLATION,
    });
  });

  it('rejects symlinked task files resolving outside the package root', async () => {
    const root = await setupRoot();
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'tz-outside-'));
    const outsideFile = path.join(outsideDir, 'task.yaml');
    await writeFile(outsideFile, 'pipeline: []\n', 'utf8');
    const linkRel = 'tasks/link.yaml';
    const linkAbs = path.join(root, linkRel);
    await mkdir(path.dirname(linkAbs), { recursive: true });
    try {
      await symlink(outsideFile, linkAbs, 'file');
    } catch (error) {
      const msg = String((error as { message?: string } | undefined)?.message || error);
      if (/(eperm|einval|operation not permitted|a required privilege is not held)/i.test(msg)) {
        return; // cannot create symlink here; skip
      }
      throw error;
    }
    await expect(loadTaskFile(root, linkRel)).rejects.toMatchObject({
      code: ErrorCode.SECURITY_VIOLATION,
    });
  });
});
