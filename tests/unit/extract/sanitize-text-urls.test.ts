import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { sanitizeText } from '../../../src/core/extract/sanitize';

describe('sanitizeText (URL and path heuristics)', () => {
  const projectRoot = path.join(os.homedir(), 'projects', 'demo');

  it('does not replace protocol-relative (//) paths and masks absolute paths', () => {
    const raw = `link https://example.com/a/b and //cdn.example.com/x but path /var/tmp should be masked`;
    const out = sanitizeText(raw, projectRoot);
    expect(out).toContain('//cdn.example.com/x');
    expect(out).toContain('{{ replace_me }}');
  });

  it('masks UNC forward-slash form (//server/share)', () => {
    const raw = 'see //server/share/docs and https://example.com okay';
    const out = sanitizeText(raw, projectRoot);
    expect(out).toContain('{{ replace_me }}');
    expect(out).toContain('https://example.com');
  });

  it('does not alter placeholders already present', () => {
    const raw = 'See {{ PROJECT_ROOT }}/README and {{ HOME }}/dotfiles';
    const out = sanitizeText(raw, projectRoot);
    expect(out).toContain('{{ PROJECT_ROOT }}/README');
    expect(out).toContain('{{ HOME }}/dotfiles');
  });

  it('replaces Windows absolute paths with replace_me', () => {
    const raw = String.raw`cmd C:\Tools\bin\tool.exe run`;
    const out = sanitizeText(raw, projectRoot);
    expect(out).toContain('{{ replace_me }}');
  });

  it('leaves relative paths untouched', () => {
    const raw = 'relative ./foo/bar and nested docs/readme.md';
    const out = sanitizeText(raw, projectRoot);
    expect(out).toContain('./foo/bar');
    expect(out).toContain('docs/readme.md');
  });
});
