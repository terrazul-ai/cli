import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  sanitizeSettingsJson,
  sanitizeMcpServers,
  sanitizeText,
  rewritePath,
} from '../../../src/core/extract/sanitize';

describe('sanitize utilities', () => {
  const projectRoot = path.join(os.homedir(), 'projects', 'demo');

  it('sanitizes env and risky fields in settings.json', () => {
    const settings = {
      env: { ANTHROPIC_API_KEY: 'secret', FOO: 'bar' },
      apiKeyHelper: 'node helpers/key.js',
      permissions: { additionalDirectories: [path.join(projectRoot, 'docs'), '/var/tmp'] },
    };
    const out = sanitizeSettingsJson(settings, projectRoot) as {
      env: Record<string, string>;
      apiKeyHelper?: string;
      permissions: { additionalDirectories: string[] };
    };
    expect(out.env['ANTHROPIC_API_KEY']).toBe('{{ env.ANTHROPIC_API_KEY }}');
    expect(out.env['FOO']).toBe('{{ env.FOO }}');
    expect(out.apiKeyHelper).toBe('{{ replace_me }}');
    expect(out.permissions.additionalDirectories[0]).toContain('{{ PROJECT_ROOT }}');
    expect(out.permissions.additionalDirectories[1]).toBe('{{ replace_me }}');
  });

  it('rewrites absolute paths in mcp servers', () => {
    const servers = {
      foo: { command: '/usr/bin/foo', args: ['--data', path.join(projectRoot, 'data')] },
    };
    const out = sanitizeMcpServers(servers, projectRoot) as {
      foo: { command: string; args: string[] };
    };
    expect(out.foo.command).toBe('{{ replace_me }}');
    expect(out.foo.args[1]).toContain('{{ PROJECT_ROOT }}');
  });

  it('sanitizes text by replacing project and home paths', () => {
    const raw = `See ${projectRoot}/README.md and ${os.homedir()}/.config`; //
    const out = sanitizeText(raw, projectRoot);
    expect(out).toContain('{{ PROJECT_ROOT }}/README.md');
    expect(out).toContain('{{ HOME }}/.config');
  });

  it('rewrites generic absolute paths to replace_me', () => {
    const raw = 'Path: /var/lib/something';
    const out = sanitizeText(raw, projectRoot);
    expect(out).toContain('{{ replace_me }}');
  });

  it('rewritePath handles windows and posix styles', () => {
    const p = rewritePath(String.raw`C:\\tmp\\foo`, projectRoot);
    expect(p).toBe('{{ replace_me }}');
  });

  it('sanitizes Windows forward-slash paths (C:/...) in text', () => {
    const raw = 'Binary at C:/Program Files/tool.exe';
    const out = sanitizeText(raw, projectRoot);
    expect(out).toContain('{{ replace_me }}');
  });
});
