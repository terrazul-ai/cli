import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { SnippetCacheManager } from '../../../src/core/snippet-cache';

import type { CachedSnippet } from '../../../src/types/snippet';

describe('core/snippet-cache', () => {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-cache-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('creates empty cache when file does not exist', async () => {
    const cacheFile = path.join(tmpDir, 'agents-cache.toml');
    const manager = new SnippetCacheManager(cacheFile);

    const cache = await manager.read();
    expect(cache.version).toBe(1);
    expect(cache.packages).toEqual({});
    expect(cache.metadata).toBeDefined();
  });

  it('writes and reads cache with deterministic ordering', async () => {
    const cacheFile = path.join(tmpDir, 'agents-cache.toml');
    const manager = new SnippetCacheManager(cacheFile);

    const snippetA: CachedSnippet = {
      id: 'snippet_a1b2c3d4',
      type: 'askUser',
      promptExcerpt: 'What is your name?',
      value: 'John Doe',
      timestamp: '2025-01-15T12:00:00.000Z',
    };

    const snippetZ: CachedSnippet = {
      id: 'snippet_z9y8x7w6',
      type: 'askAgent',
      promptExcerpt: 'Generate README',
      value: '{"title":"My Project"}',
      timestamp: '2025-01-15T12:00:10.000Z',
      tool: 'claude',
    };

    // Set snippets for two packages
    await manager.setSnippet('@z/package', '2.0.0', snippetZ);
    await manager.setSnippet('@a/package', '1.0.0', snippetA);

    // Read cache and verify ordering
    const cache = await manager.read();
    expect(cache.version).toBe(1);
    expect(cache.packages['@a/package']).toBeDefined();
    expect(cache.packages['@z/package']).toBeDefined();
    expect(cache.packages['@a/package'].version).toBe('1.0.0');
    expect(cache.packages['@z/package'].version).toBe('2.0.0');

    // Read file and check alphabetical ordering
    const content = await fs.readFile(cacheFile, 'utf8');
    const indexA = content.indexOf('"@a/package"');
    const indexZ = content.indexOf('"@z/package"');
    expect(indexA).toBeGreaterThanOrEqual(0);
    expect(indexZ).toBeGreaterThanOrEqual(0);
    expect(indexA).toBeLessThan(indexZ);
  });

  it('retrieves snippet from cache', async () => {
    const cacheFile = path.join(tmpDir, 'agents-cache.toml');
    const manager = new SnippetCacheManager(cacheFile);

    const snippet: CachedSnippet = {
      id: 'snippet_abc123',
      type: 'askUser',
      promptExcerpt: 'What is your name?',
      value: 'Jane Smith',
      timestamp: '2025-01-15T12:00:00.000Z',
    };

    await manager.setSnippet('@test/pkg', '1.0.0', snippet);

    const retrieved = manager.getSnippet('@test/pkg', '1.0.0', 'snippet_abc123');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.value).toBe('Jane Smith');
  });

  it('returns null for non-existent snippet', () => {
    const cacheFile = path.join(tmpDir, 'agents-cache.toml');
    const manager = new SnippetCacheManager(cacheFile);

    const retrieved = manager.getSnippet('@test/pkg', '1.0.0', 'nonexistent');
    expect(retrieved).toBeNull();
  });

  it('returns null when package version does not match', async () => {
    const cacheFile = path.join(tmpDir, 'agents-cache.toml');
    const manager = new SnippetCacheManager(cacheFile);

    const snippet: CachedSnippet = {
      id: 'snippet_abc123',
      type: 'askUser',
      promptExcerpt: 'What is your name?',
      value: 'Jane Smith',
      timestamp: '2025-01-15T12:00:00.000Z',
    };

    await manager.setSnippet('@test/pkg', '1.0.0', snippet);

    // Try to get with different version
    const retrieved = manager.getSnippet('@test/pkg', '2.0.0', 'snippet_abc123');
    expect(retrieved).toBeNull();
  });

  it('updates existing snippet when setting with same id', async () => {
    const cacheFile = path.join(tmpDir, 'agents-cache.toml');
    const manager = new SnippetCacheManager(cacheFile);

    const snippet1: CachedSnippet = {
      id: 'snippet_abc123',
      type: 'askUser',
      promptExcerpt: 'What is your name?',
      value: 'Old Value',
      timestamp: '2025-01-15T12:00:00.000Z',
    };

    const snippet2: CachedSnippet = {
      id: 'snippet_abc123',
      type: 'askUser',
      promptExcerpt: 'What is your name?',
      value: 'New Value',
      timestamp: '2025-01-15T12:00:10.000Z',
    };

    await manager.setSnippet('@test/pkg', '1.0.0', snippet1);
    await manager.setSnippet('@test/pkg', '1.0.0', snippet2);

    const cache = await manager.read();
    const snippets = cache.packages['@test/pkg'].snippets;
    expect(snippets).toHaveLength(1);
    expect(snippets[0].value).toBe('New Value');
  });

  it('clears cache for specific package', async () => {
    const cacheFile = path.join(tmpDir, 'agents-cache.toml');
    const manager = new SnippetCacheManager(cacheFile);

    const snippet1: CachedSnippet = {
      id: 'snippet_1',
      type: 'askUser',
      promptExcerpt: 'Question 1',
      value: 'Answer 1',
      timestamp: '2025-01-15T12:00:00.000Z',
    };

    const snippet2: CachedSnippet = {
      id: 'snippet_2',
      type: 'askUser',
      promptExcerpt: 'Question 2',
      value: 'Answer 2',
      timestamp: '2025-01-15T12:00:00.000Z',
    };

    await manager.setSnippet('@pkg1/test', '1.0.0', snippet1);
    await manager.setSnippet('@pkg2/test', '1.0.0', snippet2);

    await manager.clearPackage('@pkg1/test');

    const cache = await manager.read();
    expect(cache.packages['@pkg1/test']).toBeUndefined();
    expect(cache.packages['@pkg2/test']).toBeDefined();
  });

  it('clears all cache', async () => {
    const cacheFile = path.join(tmpDir, 'agents-cache.toml');
    const manager = new SnippetCacheManager(cacheFile);

    const snippet: CachedSnippet = {
      id: 'snippet_1',
      type: 'askUser',
      promptExcerpt: 'Question',
      value: 'Answer',
      timestamp: '2025-01-15T12:00:00.000Z',
    };

    await manager.setSnippet('@pkg1/test', '1.0.0', snippet);
    await manager.setSnippet('@pkg2/test', '1.0.0', snippet);

    await manager.clearAll();

    const cache = await manager.read();
    expect(cache.packages).toEqual({});
  });

  it('prunes stale package entries', async () => {
    const cacheFile = path.join(tmpDir, 'agents-cache.toml');
    const manager = new SnippetCacheManager(cacheFile);

    const snippet: CachedSnippet = {
      id: 'snippet_1',
      type: 'askUser',
      promptExcerpt: 'Question',
      value: 'Answer',
      timestamp: '2025-01-15T12:00:00.000Z',
    };

    await manager.setSnippet('@pkg1/test', '1.0.0', snippet);
    await manager.setSnippet('@pkg2/test', '1.0.0', snippet);
    await manager.setSnippet('@pkg3/test', '1.0.0', snippet);

    // Prune keeping only pkg1 and pkg3
    await manager.prune(['@pkg1/test', '@pkg3/test']);

    const cache = await manager.read();
    expect(cache.packages['@pkg1/test']).toBeDefined();
    expect(cache.packages['@pkg2/test']).toBeUndefined();
    expect(cache.packages['@pkg3/test']).toBeDefined();
  });

  it('handles atomic writes correctly', async () => {
    const cacheFile = path.join(tmpDir, 'agents-cache.toml');
    const manager = new SnippetCacheManager(cacheFile);

    const snippet: CachedSnippet = {
      id: 'snippet_1',
      type: 'askUser',
      promptExcerpt: 'Question',
      value: 'Answer',
      timestamp: '2025-01-15T12:00:00.000Z',
    };

    await manager.setSnippet('@test/pkg', '1.0.0', snippet);

    // Verify file exists and can be read
    const exists = await fs
      .access(cacheFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    const cache = await manager.read();
    expect(cache.packages['@test/pkg']).toBeDefined();
  });
});
