import { describe, it, expect } from 'vitest';

import { PackageNameSchema } from '../../../src/types/package';

describe('types/package', () => {
  describe('PackageNameSchema', () => {
    it('accepts valid scoped package names', () => {
      const valid = [
        '@owner/package',
        '@user/my-package',
        '@org/pkg_name',
        '@scope/name-123',
        '@a/b',
        '@terrazul/starter',
        '@alice/my-agents',
      ];

      for (const name of valid) {
        const result = PackageNameSchema.safeParse(name);
        expect(result.success, `Expected ${name} to be valid`).toBe(true);
      }
    });

    it('rejects unscoped package names', () => {
      const invalid = ['package', 'my-package', 'pkg_name', 'name-123'];

      for (const name of invalid) {
        const result = PackageNameSchema.safeParse(name);
        expect(result.success, `Expected ${name} to be rejected`).toBe(false);
        if (!result.success) {
          expect(result.error.errors[0].message).toContain('@owner/package-name');
        }
      }
    });

    it('rejects invalid formats', () => {
      const invalid = [
        '',
        '@',
        '@owner',
        '@owner/',
        '/@package',
        'owner/package', // missing @
        '@/package', // empty owner
        '@owner/package/extra', // too many parts
        '@owner-', // missing package
        '@OWNER/package', // uppercase not allowed
        '@owner/PACKAGE', // uppercase not allowed
        '@owner/pack age', // spaces not allowed
        '@owner /package', // spaces not allowed
      ];

      for (const name of invalid) {
        const result = PackageNameSchema.safeParse(name);
        expect(result.success, `Expected "${name}" to be rejected`).toBe(false);
      }
    });

    it('provides clear error message', () => {
      const result = PackageNameSchema.safeParse('package');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe(
          'Package name must be in format @owner/package-name',
        );
      }
    });
  });
});
