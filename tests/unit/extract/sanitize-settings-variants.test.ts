import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { sanitizeSettingsJson } from '../../../src/core/extract/sanitize';

describe('sanitizeSettingsJson (variants)', () => {
  const projectRoot = path.join(os.homedir(), 'projects', 'demo');

  it('replaces additional risky helper fields', () => {
    const raw = {
      apiKeyHelper: 'scripts/key.js',
      awsAuthRefresh: 'scripts/aws-refresh.sh',
      awsCredentialExport: 'scripts/aws-export.sh',
    };
    const out = sanitizeSettingsJson(raw, projectRoot) as Record<string, unknown>;
    expect(out.apiKeyHelper as string).toBe('{{ replace_me }}');
    expect(out.awsAuthRefresh as string).toBe('{{ replace_me }}');
    expect(out.awsCredentialExport as string).toBe('{{ replace_me }}');
  });

  it('sanitizes env block templates', () => {
    const raw = { env: { A: 'a', B: 'b' } };
    const out = sanitizeSettingsJson(raw, projectRoot) as {
      env: Record<string, string>;
    };
    expect(out.env.A).toBe('{{ env.A }}');
    expect(out.env.B).toBe('{{ env.B }}');
  });

  it('sanitizes UNC and forward-slash Windows paths in additionalDirectories', () => {
    const raw = {
      permissions: {
        additionalDirectories: [
          String.raw`\\server\share\docs`,
          'C:/Temp',
          path.join(projectRoot, 'docs'),
        ],
      },
    };
    const out = sanitizeSettingsJson(raw, projectRoot) as {
      permissions: { additionalDirectories: string[] };
    };
    const dirs = out.permissions.additionalDirectories;
    expect(dirs[0]).toBe('{{ replace_me }}');
    expect(dirs[1]).toBe('{{ replace_me }}');
    expect(dirs[2]).toContain('{{ PROJECT_ROOT }}');
  });
});
