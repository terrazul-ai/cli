import { describe, expect, it } from 'vitest';

import { runCommand } from '../../src/utils/proc';

// Ensure runCommand surfaces spawn errors instead of crashing
describe('proc', () => {
  it('rejects when command is missing', async () => {
    await expect(runCommand('__definitely_not_a_real_cmd__')).rejects.toBeDefined();
  });

  it('merges env with process.env (keeps PATH)', async () => {
    const script = [
      'const hasPath = Object.keys(process.env).some(k => k.toLowerCase() === "path");',
      'console.log(hasPath ? "HAS_PATH" : "NO_PATH");',
      'console.log(process.env.FOO ?? "NO_FOO")',
    ].join('\n');

    const res = await runCommand(process.execPath, ['-e', script], {
      env: { FOO: 'bar' },
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('HAS_PATH');
    expect(res.stdout).toContain('bar');
  });
});
