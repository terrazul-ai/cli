import { describe, it, expect } from 'vitest';

import { parseSpec } from '../../../src/commands/add.js';

describe('commands/add - parseSpec', () => {
  describe('explicit version', () => {
    it('parses scoped package with explicit version', () => {
      const result = parseSpec('@owner/pkg@1.0.0');
      expect(result).toEqual({
        name: '@owner/pkg',
        range: '1.0.0',
      });
    });

    it('parses scoped package with semver range', () => {
      const result = parseSpec('@owner/pkg@^1.2.3');
      expect(result).toEqual({
        name: '@owner/pkg',
        range: '^1.2.3',
      });
    });

    it('parses unscoped package with explicit version', () => {
      const result = parseSpec('package@2.0.0');
      expect(result).toEqual({
        name: 'package',
        range: '2.0.0',
      });
    });

    it('parses scoped package with prerelease version', () => {
      const result = parseSpec('@owner/pkg@1.0.0-beta.1');
      expect(result).toEqual({
        name: '@owner/pkg',
        range: '1.0.0-beta.1',
      });
    });
  });

  describe('latest tag', () => {
    it('parses scoped package with @latest', () => {
      const result = parseSpec('@owner/pkg@latest');
      expect(result).toEqual({
        name: '@owner/pkg',
        range: 'latest',
      });
    });

    it('parses unscoped package with @latest', () => {
      const result = parseSpec('package@latest');
      expect(result).toEqual({
        name: 'package',
        range: 'latest',
      });
    });
  });

  describe('no version specified', () => {
    it('parses scoped package without version', () => {
      const result = parseSpec('@owner/pkg');
      expect(result).toEqual({
        name: '@owner/pkg',
        range: null,
      });
    });

    it('parses unscoped package without version', () => {
      const result = parseSpec('package');
      expect(result).toEqual({
        name: 'package',
        range: null,
      });
    });

    it('parses deeply scoped package without version', () => {
      const result = parseSpec('@org/sub-package');
      expect(result).toEqual({
        name: '@org/sub-package',
        range: null,
      });
    });
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      const result = parseSpec('');
      expect(result).toBeNull();
    });

    it('returns null for undefined', () => {
      const result = parseSpec();
      expect(result).toBeNull();
    });

    it('handles package names with hyphens', () => {
      const result = parseSpec('@owner/my-package@1.0.0');
      expect(result).toEqual({
        name: '@owner/my-package',
        range: '1.0.0',
      });
    });

    it('handles package names with underscores', () => {
      const result = parseSpec('@owner/my_package');
      expect(result).toEqual({
        name: '@owner/my_package',
        range: null,
      });
    });

    it('handles wildcard version', () => {
      const result = parseSpec('@owner/pkg@*');
      expect(result).toEqual({
        name: '@owner/pkg',
        range: '*',
      });
    });
  });
});
