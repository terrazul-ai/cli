import { describe, it, expect } from 'vitest';

import { ErrorCode } from '../../../src/core/errors';
import { splitPackageName, buildPackageApiPath } from '../../../src/utils/package';

describe('utils/package', () => {
  describe('splitPackageName', () => {
    it('splits valid scoped package names correctly', () => {
      const result1 = splitPackageName('@owner/package');
      expect(result1.owner).toBe('owner');
      expect(result1.name).toBe('package');
      expect(result1.fullName).toBe('@owner/package');

      const result2 = splitPackageName('@terrazul/starter');
      expect(result2.owner).toBe('terrazul');
      expect(result2.name).toBe('starter');
      expect(result2.fullName).toBe('@terrazul/starter');

      const result3 = splitPackageName('@alice/my-agents');
      expect(result3.owner).toBe('alice');
      expect(result3.name).toBe('my-agents');
      expect(result3.fullName).toBe('@alice/my-agents');
    });

    it('adds @ prefix if missing but format is otherwise valid', () => {
      const result = splitPackageName('owner/package');
      expect(result.owner).toBe('owner');
      expect(result.name).toBe('package');
      expect(result.fullName).toBe('@owner/package');
    });

    it('rejects unscoped package names', () => {
      expect(() => splitPackageName('package')).toThrow();
      expect(() => splitPackageName('my-package')).toThrow();

      try {
        splitPackageName('package');
      } catch (error) {
        if (error instanceof Error && 'code' in error) {
          expect(error.code).toBe(ErrorCode.INVALID_PACKAGE);
          expect(error.message).toContain('@owner/name');
        }
      }
    });

    it('rejects empty or invalid input', () => {
      expect(() => splitPackageName('')).toThrow();
      expect(() => splitPackageName('  ')).toThrow();
      expect(() => splitPackageName('@owner')).toThrow();
      expect(() => splitPackageName('@owner/')).toThrow();
      expect(() => splitPackageName('/@package')).toThrow();
    });

    it('rejects uppercase names', () => {
      expect(() => splitPackageName('@Owner/package')).toThrow();
      expect(() => splitPackageName('@owner/Package')).toThrow();
    });

    it('rejects names with spaces', () => {
      expect(() => splitPackageName('@owner/pack age')).toThrow();
      expect(() => splitPackageName('@own er/package')).toThrow();
    });
  });

  describe('buildPackageApiPath', () => {
    it('builds correct API paths from package names', () => {
      const path1 = buildPackageApiPath('@owner/package');
      expect(path1).toBe('/packages/v1/owner/package');

      const path2 = buildPackageApiPath('@terrazul/starter', 'versions');
      expect(path2).toBe('/packages/v1/terrazul/starter/versions');

      const path3 = buildPackageApiPath('@alice/my-agents', 'tarball', '1.0.0');
      expect(path3).toBe('/packages/v1/alice/my-agents/tarball/1.0.0');
    });

    it('URL encodes package name components', () => {
      const path = buildPackageApiPath('@my-org/my-pkg', 'some-segment');
      expect(path).toBe('/packages/v1/my-org/my-pkg/some-segment');
    });
  });
});
