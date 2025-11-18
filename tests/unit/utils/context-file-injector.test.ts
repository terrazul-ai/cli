import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  injectTZMdReference,
  removeTZMdReference,
  hasTZMdReference,
} from '../../../src/utils/context-file-injector';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function write(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, 'utf8');
}

describe('utils/context-file-injector', () => {
  let projectRoot = '';

  beforeEach(async () => {
    projectRoot = await mkdtemp('tz-injector');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true }).catch(() => {});
  });

  describe('injectTZMdReference', () => {
    it('injects TZ.md reference into new file', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');

      const result = await injectTZMdReference(filePath, projectRoot);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('<!-- terrazul:begin -->');
      expect(content).toContain('@.terrazul/TZ.md');
      expect(content).toContain('<!-- terrazul:end -->');
    });

    it('injects TZ.md reference into existing file with content', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(filePath, '# Existing Content\n\nSome text here.');

      const result = await injectTZMdReference(filePath, projectRoot);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('# Existing Content');
      expect(content).toContain('Some text here.');
      expect(content).toContain('<!-- terrazul:begin -->');
      expect(content).toContain('@.terrazul/TZ.md');
      expect(content).toContain('<!-- terrazul:end -->');

      // Should be at the end
      const lines = content.split('\n');
      const lastNonEmpty = lines.findLast((l) => l.trim());
      expect(lastNonEmpty).toBe('<!-- terrazul:end -->');
    });

    it('is idempotent - does not modify if already injected', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');

      // First injection
      const result1 = await injectTZMdReference(filePath, projectRoot);
      expect(result1.modified).toBe(true);
      const content1 = await fs.readFile(filePath, 'utf8');

      // Second injection
      const result2 = await injectTZMdReference(filePath, projectRoot);
      expect(result2.modified).toBe(false);
      const content2 = await fs.readFile(filePath, 'utf8');

      expect(content1).toBe(content2);
    });

    it('updates block if markers exist but content is wrong', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(
        filePath,
        '# Content\n\n<!-- terrazul:begin -->\nOld content\n<!-- terrazul:end -->',
      );

      const result = await injectTZMdReference(filePath, projectRoot);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('<!-- terrazul:begin -->');
      expect(content).toContain('@.terrazul/TZ.md');
      expect(content).toContain('<!-- terrazul:end -->');
      expect(content).not.toContain('Old content');
    });

    it('handles partial markers by removing them and re-injecting', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(filePath, '# Content\n\n<!-- terrazul:begin -->\nIncomplete');

      const result = await injectTZMdReference(filePath, projectRoot);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('<!-- terrazul:begin -->');
      expect(content).toContain('@.terrazul/TZ.md');
      expect(content).toContain('<!-- terrazul:end -->');

      // Should have both markers now
      const beginCount = (content.match(/<!-- terrazul:begin -->/g) || []).length;
      const endCount = (content.match(/<!-- terrazul:end -->/g) || []).length;
      expect(beginCount).toBe(1);
      expect(endCount).toBe(1);
    });

    it('supports dry run mode', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');

      const result = await injectTZMdReference(filePath, projectRoot, { dryRun: true });

      expect(result.modified).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content).toContain('@.terrazul/TZ.md');

      // File should not exist
      const exists = await fs.stat(filePath).catch(() => null);
      expect(exists).toBeNull();
    });

    it('creates parent directories if they do not exist', async () => {
      const filePath = path.join(projectRoot, 'nested', 'dir', 'CLAUDE.md');

      await injectTZMdReference(filePath, projectRoot);

      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('@.terrazul/TZ.md');
    });
  });

  describe('removeTZMdReference', () => {
    it('removes TZ.md reference from file', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await injectTZMdReference(filePath, projectRoot);

      const result = await removeTZMdReference(filePath);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).not.toContain('<!-- terrazul:begin -->');
      expect(content).not.toContain('@.terrazul/TZ.md');
      expect(content).not.toContain('<!-- terrazul:end -->');
    });

    it('preserves existing content when removing reference', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(filePath, '# Existing Content\n\nSome text here.');
      await injectTZMdReference(filePath, projectRoot);

      await removeTZMdReference(filePath);

      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('# Existing Content');
      expect(content).toContain('Some text here.');
      expect(content).not.toContain('<!-- terrazul:begin -->');
      expect(content).not.toContain('@.terrazul/TZ.md');
    });

    it('returns false if file does not exist', async () => {
      const filePath = path.join(projectRoot, 'nonexistent.md');

      const result = await removeTZMdReference(filePath);

      expect(result.modified).toBe(false);
    });

    it('returns false if reference is not present', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(filePath, '# Content without reference');

      const result = await removeTZMdReference(filePath);

      expect(result.modified).toBe(false);
    });

    it('supports dry run mode', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await injectTZMdReference(filePath, projectRoot);

      const result = await removeTZMdReference(filePath, { dryRun: true });

      expect(result.modified).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content).not.toContain('@.terrazul/TZ.md');

      // File should still have the reference
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('@.terrazul/TZ.md');
    });
  });

  describe('hasTZMdReference', () => {
    it('returns true if reference is present', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await injectTZMdReference(filePath, projectRoot);

      const result = await hasTZMdReference(filePath);

      expect(result).toBe(true);
    });

    it('returns false if reference is not present', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(filePath, '# Content without reference');

      const result = await hasTZMdReference(filePath);

      expect(result).toBe(false);
    });

    it('returns false if file does not exist', async () => {
      const filePath = path.join(projectRoot, 'nonexistent.md');

      const result = await hasTZMdReference(filePath);

      expect(result).toBe(false);
    });

    it('returns false if only partial markers exist', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(filePath, '# Content\n\n<!-- terrazul:begin -->\nIncomplete');

      const result = await hasTZMdReference(filePath);

      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty file correctly', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(filePath, '');

      const result = await injectTZMdReference(filePath, projectRoot);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toContain('@.terrazul/TZ.md');
    });

    it('handles file with only whitespace', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');
      await write(filePath, '   \n\n   \n');

      const result = await injectTZMdReference(filePath, projectRoot);

      expect(result.modified).toBe(true);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content.trim()).toContain('@.terrazul/TZ.md');
    });

    it('handles multiple injections and removals', async () => {
      const filePath = path.join(projectRoot, 'CLAUDE.md');

      // Inject
      await injectTZMdReference(filePath, projectRoot);
      let hasRef = await hasTZMdReference(filePath);
      expect(hasRef).toBe(true);

      // Remove
      await removeTZMdReference(filePath);
      hasRef = await hasTZMdReference(filePath);
      expect(hasRef).toBe(false);

      // Inject again
      await injectTZMdReference(filePath, projectRoot);
      hasRef = await hasTZMdReference(filePath);
      expect(hasRef).toBe(true);

      // Should still be idempotent
      const result = await injectTZMdReference(filePath, projectRoot);
      expect(result.modified).toBe(false);
    });
  });
});
