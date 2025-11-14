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
      expect(isSafePkgSegment('a-b_c1')).toBe(true);
      expect(isSafePkgSegment('.')).toBe(false);
      expect(isSafePkgSegment('..')).toBe(false);
      expect(isSafePkgSegment('a/b')).toBe(false);
      expect(isSafePkgSegment(String.raw`a\b`)).toBe(false);
      expect(isSafePkgSegment('a-b_c.1')).toBe(false); // dots are not allowed per PackageNameSchema
    });

    it('rejects uppercase letters to align with PackageNameSchema', () => {
      expect(isSafePkgSegment('Owner')).toBe(false);
      expect(isSafePkgSegment('Package')).toBe(false);
      expect(isSafePkgSegment('myPackage')).toBe(false);
      expect(isSafePkgSegment('ABC')).toBe(false);
    });

    it('rejects whitespace characters', () => {
      expect(isSafePkgSegment('my package')).toBe(false);
      expect(isSafePkgSegment('my\tpackage')).toBe(false);
      expect(isSafePkgSegment('my\npackage')).toBe(false);
      expect(isSafePkgSegment(' package')).toBe(false);
      expect(isSafePkgSegment('package ')).toBe(false);
    });

    it('rejects special characters not allowed by PackageNameSchema', () => {
      expect(isSafePkgSegment('pack@ge')).toBe(false);
      expect(isSafePkgSegment('pack.age')).toBe(false);
      expect(isSafePkgSegment('pack!age')).toBe(false);
      expect(isSafePkgSegment('pack$age')).toBe(false);
    });

    it('accepts only lowercase alphanumeric plus hyphens and underscores', () => {
      expect(isSafePkgSegment('package')).toBe(true);
      expect(isSafePkgSegment('my-package')).toBe(true);
      expect(isSafePkgSegment('my_package')).toBe(true);
      expect(isSafePkgSegment('package123')).toBe(true);
      expect(isSafePkgSegment('123package')).toBe(true);
      expect(isSafePkgSegment('p-a_c-k_a-g-e-1-2-3')).toBe(true);
    });
  });

  describe('parseSafePackageName', () => {
    it('parses scoped package names only', () => {
      const a = parseSafePackageName('@scope/name');
      expect(a.scope).toBe('@scope');
      expect(a.name).toBe('name');

      const b = parseSafePackageName('@owner/package');
      expect(b.scope).toBe('@owner');
      expect(b.name).toBe('package');
    });

    it('rejects unscoped package names', () => {
      expect(() => parseSafePackageName('pkg')).toThrow('must be scoped');
      expect(() => parseSafePackageName('package-name')).toThrow('must be scoped');
    });

    it('rejects invalid or unsafe names', () => {
      expect(() => parseSafePackageName('@scope/')).toThrow();
      expect(() => parseSafePackageName('bad/name/extra')).toThrow();
      expect(() => parseSafePackageName('../escape')).toThrow();
      expect(() => parseSafePackageName(String.raw`bad\name`)).toThrow();
    });

    it('rejects uppercase letters in scope', () => {
      expect(() => parseSafePackageName('@Owner/package')).toThrow('Unsafe package name');
      expect(() => parseSafePackageName('@OWNER/package')).toThrow('Unsafe package name');
      expect(() => parseSafePackageName('@myOwner/package')).toThrow('Unsafe package name');
    });

    it('rejects uppercase letters in package name', () => {
      expect(() => parseSafePackageName('@owner/Package')).toThrow('Unsafe package name');
      expect(() => parseSafePackageName('@owner/PACKAGE')).toThrow('Unsafe package name');
      expect(() => parseSafePackageName('@owner/myPackage')).toThrow('Unsafe package name');
    });

    it('rejects whitespace in scope', () => {
      expect(() => parseSafePackageName('@my owner/package')).toThrow('Unsafe package name');
      expect(() => parseSafePackageName('@my\towner/package')).toThrow('Unsafe package name');
      expect(() => parseSafePackageName('@ owner/package')).toThrow('Unsafe package name');
    });

    it('rejects whitespace in package name', () => {
      expect(() => parseSafePackageName('@owner/my package')).toThrow('Unsafe package name');
      expect(() => parseSafePackageName('@owner/my\tpackage')).toThrow('Unsafe package name');
      expect(() => parseSafePackageName('@owner/package ')).toThrow('Unsafe package name');
    });

    it('rejects special characters not allowed by PackageNameSchema', () => {
      expect(() => parseSafePackageName('@owner/pack@ge')).toThrow('Unsafe package name');
      expect(() => parseSafePackageName('@owner/pack.age')).toThrow('Unsafe package name');
      expect(() => parseSafePackageName('@own.er/package')).toThrow('Unsafe package name');
      expect(() => parseSafePackageName('@own@er/package')).toThrow('Unsafe package name');
    });
  });

  describe('agentModulesPath', () => {
    it('computes safe link paths inside agent_modules for scoped packages', () => {
      const proj = path.join(os.tmpdir(), 'tz-proj-x');
      const p1 = agentModulesPath(proj, '@owner/alpha');
      expect(p1).toBe(path.resolve(path.join(proj, 'agent_modules', '@owner', 'alpha')));
      const p2 = agentModulesPath(proj, '@s/alpha');
      expect(p2).toBe(path.resolve(path.join(proj, 'agent_modules', '@s', 'alpha')));
    });

    it('rejects unscoped package names', () => {
      const proj = path.join(os.tmpdir(), 'tz-proj-unscoped');
      expect(() => agentModulesPath(proj, 'alpha')).toThrow('must be scoped');
    });

    it('rejects names that would escape', () => {
      const proj = path.join(os.tmpdir(), 'tz-proj-y');
      expect(() => agentModulesPath(proj, '..')).toThrow();
      expect(() => agentModulesPath(proj, '@s/..')).toThrow();
    });
  });
});
