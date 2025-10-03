import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  resolveWithin,
  isSafePkgSegment,
  parseSafePackageName,
  agentModulesPath,
} from '../../../src/utils/path';

describe('utils/path', () => {
  describe('resolveWithin', () => {
    it('keeps paths confined under base', () => {
      const base = path.join(os.tmpdir(), 'tz-base-a');
      const p = resolveWithin(base, 'sub', 'dir', '..', 'file.txt');
      expect(p.startsWith(path.resolve(base))).toBe(true);
      expect(p.endsWith(path.join('sub', 'file.txt'))).toBe(true);
    });

    it('rejects traversal outside base', () => {
      const base = path.join(os.tmpdir(), 'tz-base-b');
      expect(() => resolveWithin(base, '..', '..', 'etc', 'passwd')).toThrow();
    });
  });

  describe('isSafePkgSegment', () => {
    it('accepts typical safe names and rejects dot segments and slashes', () => {
      expect(isSafePkgSegment('abc')).toBe(true);
      expect(isSafePkgSegment('a-b_c.1')).toBe(true);
      expect(isSafePkgSegment('.')).toBe(false);
      expect(isSafePkgSegment('..')).toBe(false);
      expect(isSafePkgSegment('a/b')).toBe(false);
      expect(isSafePkgSegment(String.raw`a\b`)).toBe(false);
    });
  });

  describe('parseSafePackageName', () => {
    it('parses unscoped and scoped package names', () => {
      const a = parseSafePackageName('pkg');
      expect(a.scope).toBeUndefined();
      expect(a.name).toBe('pkg');

      const b = parseSafePackageName('@scope/name');
      expect(b.scope).toBe('@scope');
      expect(b.name).toBe('name');
    });

    it('rejects invalid or unsafe names', () => {
      expect(() => parseSafePackageName('@scope/')).toThrow();
      expect(() => parseSafePackageName('bad/name/extra')).toThrow();
      expect(() => parseSafePackageName('../escape')).toThrow();
      expect(() => parseSafePackageName(String.raw`bad\name`)).toThrow();
    });
  });

  describe('agentModulesPath', () => {
    it('computes safe link paths inside agent_modules for scoped and unscoped', () => {
      const proj = path.join(os.tmpdir(), 'tz-proj-x');
      const p1 = agentModulesPath(proj, 'alpha');
      expect(p1).toBe(path.resolve(path.join(proj, 'agent_modules', 'alpha')));
      const p2 = agentModulesPath(proj, '@s/alpha');
      expect(p2).toBe(path.resolve(path.join(proj, 'agent_modules', '@s', 'alpha')));
    });

    it('rejects names that would escape', () => {
      const proj = path.join(os.tmpdir(), 'tz-proj-y');
      expect(() => agentModulesPath(proj, '..')).toThrow();
      expect(() => agentModulesPath(proj, '@s/..')).toThrow();
    });
  });
});
