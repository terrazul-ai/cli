import { describe, it, expect, vi, afterEach } from 'vitest';

import { TerrazulError } from '../../../src/core/errors';
import { RegistryClient } from '../../../src/core/registry-client';

describe('core/registry-client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('allows http loopback hosts', () => {
    expect(() => new RegistryClient({ registryUrl: 'http://127.0.0.1:8787' })).not.toThrow();
    expect(() => new RegistryClient({ registryUrl: 'http://[::1]:8787' })).not.toThrow();
  });

  it('rejects http non-loopback hosts', () => {
    expect(() => new RegistryClient({ registryUrl: 'http://example.com' })).toThrow(TerrazulError);
  });

  it('handles non-JSON error responses gracefully', async () => {
    const client = new RegistryClient({ registryUrl: 'https://registry.example' });
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
        }),
      ),
    );
    await expect(client.getPackageInfo('@acme/pkg')).rejects.toMatchObject({
      message: expect.stringMatching('500'),
    });
  });

  it('normalizes numeric published_at seconds to ISO strings', async () => {
    const client = new RegistryClient({ registryUrl: 'https://registry.example' });
    const publishedSeconds = 1_701_470_400; // 2023-12-01T00:00:00Z
    const expectedIso = new Date(publishedSeconds * 1000).toISOString();

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              name: '@acme/pkg',
              versions: {
                '1.0.0': {
                  version: '1.0.0',
                  dependencies: {},
                  compatibility: {},
                  published_at: publishedSeconds,
                  yanked: false,
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        ),
      ),
    );

    const versions = await client.getPackageVersions('@acme/pkg');
    expect(versions.versions['1.0.0'].publishedAt).toBe(expectedIso);
  });
});
