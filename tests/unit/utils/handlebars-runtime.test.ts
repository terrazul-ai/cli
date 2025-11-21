import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { interpolate } from '../../../src/utils/handlebars-runtime';

describe('handlebars-runtime helpers', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hbs-test-'));
    await fs.mkdir(path.join(tmpDir, 'memories'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'test', 'utf8');
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('exists helper', () => {
    it('returns true for existing directory', () => {
      const template = "{{#if (exists 'memories/')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('found');
    });

    it('returns true for existing file', () => {
      const template = "{{#if (exists 'test.txt')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('found');
    });

    it('returns false for non-existing path', () => {
      const template = "{{#if (exists 'nonexistent/')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('not found');
    });

    it('returns false for invalid path types', () => {
      const template = '{{#if (exists invalidArg)}}found{{else}}not found{{/if}}';
      const result = interpolate(template, { project: { root: tmpDir }, invalidArg: 123 });
      expect(result).toBe('not found');
    });
  });

  describe('exists helper - security', () => {
    it('rejects absolute Unix paths', () => {
      const template = "{{#if (exists '/etc/passwd')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('not found');
    });

    it('rejects absolute Windows paths', () => {
      const template = String.raw`{{#if (exists 'C:\\Windows\\System32')}}found{{else}}not found{{/if}}`;
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('not found');
    });

    it('rejects parent directory traversal outside project root', () => {
      const template = "{{#if (exists '../../../etc/passwd')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('not found');
    });

    it('rejects path attempting to escape via multiple parent traversals', () => {
      const template =
        "{{#if (exists '../../../../../../../../etc/hosts')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('not found');
    });

    it('allows relative paths within project root', () => {
      const template = "{{#if (exists 'test.txt')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('found');
    });

    it('allows subdirectory paths within project root', () => {
      const template = "{{#if (exists 'memories/')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('found');
    });

    it('allows parent traversal within project root boundaries', async () => {
      // Create structure: tmpDir (project root)/sub1/sub2/
      const subDir = path.join(tmpDir, 'sub1', 'sub2');
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'sub1', 'sibling.txt'), 'test', 'utf8');

      // With project root = tmpDir, we can access sub1/sub2/../sibling.txt
      // This resolves to tmpDir/sub1/sibling.txt which is within tmpDir
      const template = "{{#if (exists 'sub1/sub2/../sibling.txt')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('found');
    });

    it('rejects parent traversal that would escape even from nested directory', async () => {
      // Create nested structure: tmpDir/sub1/sub2/
      const subDir = path.join(tmpDir, 'sub1', 'sub2');
      await fs.mkdir(subDir, { recursive: true });

      // From sub2, ../../../etc/passwd tries to escape tmpDir entirely
      const template = "{{#if (exists '../../../etc/passwd')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: subDir } });
      expect(result).toBe('not found');
    });

    it('rejects mixed absolute and relative path attempts', () => {
      const template = "{{#if (exists '/tmp/../etc/passwd')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('not found');
    });

    it('handles edge case of checking project root itself', () => {
      const template = "{{#if (exists '.')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('found');
    });

    it('handles edge case of checking parent of project root (should be rejected)', () => {
      const template = "{{#if (exists '..')}}found{{else}}not found{{/if}}";
      const result = interpolate(template, { project: { root: tmpDir } });
      expect(result).toBe('not found');
    });
  });

  describe('eq helper', () => {
    it('returns true for equal values', () => {
      const template = '{{#if (eq a b)}}equal{{else}}not equal{{/if}}';
      const result = interpolate(template, { a: 'test', b: 'test' });
      expect(result).toBe('equal');
    });

    it('returns false for different values', () => {
      const template = '{{#if (eq a b)}}equal{{else}}not equal{{/if}}';
      const result = interpolate(template, { a: 'test', b: 'other' });
      expect(result).toBe('not equal');
    });
  });

  describe('json helper', () => {
    it('serializes objects to JSON', () => {
      const template = '{{{json data}}}';
      const result = interpolate(template, { data: { foo: 'bar', baz: 123 } });
      expect(result).toBe('{\n  "foo": "bar",\n  "baz": 123\n}');
    });
  });

  describe('findById helper', () => {
    it('finds entry by id', () => {
      const template = '{{findById items "b" "name"}}';
      const result = interpolate(template, {
        items: [
          { id: 'a', name: 'Alice' },
          { id: 'b', name: 'Bob' },
        ],
      });
      expect(result).toBe('Bob');
    });

    it('returns empty string when entry not found', () => {
      const template = '{{findById items "c" "name"}}';
      const result = interpolate(template, {
        items: [
          { id: 'a', name: 'Alice' },
          { id: 'b', name: 'Bob' },
        ],
      });
      expect(result).toBe('');
    });
  });
});
