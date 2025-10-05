import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, runReject } from '../helpers/cli';
import { createTempProject } from '../helpers/project';

describe('tz extract requires authentication', () => {
  it('prompts users to login when no token is available', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    const outDir = path.join(proj.root, 'pkg');

    const { stderr, error } = await runReject(
      'node',
      [
        cli,
        'extract',
        '--from',
        proj.root,
        '--out',
        outDir,
        '--name',
        '@you/pkg',
        '--pkg-version',
        '1.0.0',
      ],
      { env: { TERRAZUL_TOKEN: '' } },
    );

    expect(stderr).toContain('Authentication required');
    expect(stderr).toContain('tz login');
    const exitCode = (error as NodeJS.ErrnoException).code;
    expect(exitCode).toBe(3);
  });
});
