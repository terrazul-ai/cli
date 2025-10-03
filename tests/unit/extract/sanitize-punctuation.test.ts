import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { sanitizeText } from '../../../src/core/extract/sanitize';

describe('sanitizeText punctuation edges', () => {
  const projectRoot = path.join(os.homedir(), 'projects', 'demo');

  it('does not mask POSIX path when followed by punctuation (current heuristic)', () => {
    const raw = 'see (/var/tmp).';
    const out = sanitizeText(raw, projectRoot);
    // Heuristic requires whitespace/EOL; with ")"+"." punctuation it remains unchanged
    expect(out).toContain('(/var/tmp).');
  });

  it('masks POSIX paths at word boundary and with trailing comma', () => {
    const raw = 'first /var/tmp, then /var/tmp';
    const out = sanitizeText(raw, projectRoot);
    // Both occurrences are masked by the heuristic
    const maskedCount = (out.match(/{{ replace_me }}/g) || []).length;
    expect(maskedCount).toBeGreaterThanOrEqual(2);
  });

  it('keeps quoted POSIX path as-is; masks quoted Windows absolute path', () => {
    const raw = String.raw`posix "/var/tmp" and windows "C:\Tools\bin\tool.exe"`;
    const out = sanitizeText(raw, projectRoot);
    expect(out).toContain('"/var/tmp"');
    expect(out).toContain('"{{ replace_me }}"');
  });

  it('preserves protocol-relative URL with trailing punctuation', () => {
    const raw = 'see //cdn.example.com/x.';
    const out = sanitizeText(raw, projectRoot);
    expect(out).toContain('//cdn.example.com/x.');
  });
});
