import { describe, it, expect } from 'vitest';

import { DependencyResolver } from '../../../src/core/dependency-resolver';

import type { LockfileData } from '../../../src/core/lock-file';
import type { PackageVersions } from '../../../src/core/registry-client';

class MockRegistry {
  constructor(private data: Record<string, PackageVersions>) {}
  getPackageVersions(name: string): Promise<PackageVersions> {
    const pkg = this.data[name];
    if (!pkg) return Promise.reject(new Error(`unknown package ${name}`));
    return Promise.resolve(pkg);
  }
}

describe('dependency resolver', () => {
  it('resolves basic dependencies and skips yanked versions', async () => {
    const registryData: Record<string, PackageVersions> = {
      pkgA: {
        name: 'pkgA',
        owner: 'pkgA-owner',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: { pkgB: '^1.0.0' },
            yanked: false,
            publishedAt: '',
          },
          '1.1.0': {
            version: '1.1.0',
            dependencies: { pkgB: '^1.0.0' },
            yanked: false,
            publishedAt: '',
          },
        },
      },
      pkgB: {
        name: 'pkgB',
        owner: 'pkgB-owner',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: {},
            yanked: false,
            publishedAt: '',
          },
          '1.1.0': {
            version: '1.1.0',
            dependencies: {},
            yanked: true,
            publishedAt: '',
          },
        },
      },
    };
    const resolver = new DependencyResolver(new MockRegistry(registryData));
    const { resolved } = await resolver.resolve({ pkgA: '^1.0.0' });
    expect(resolved.get('pkgA')?.version).toBe('1.1.0');
    expect(resolved.get('pkgB')?.version).toBe('1.0.0');
  });

  it('throws when no candidates', async () => {
    const registryData: Record<string, PackageVersions> = {
      pkgA: { name: 'pkgA', owner: 'pkgA-owner', versions: {} },
    };
    const resolver = new DependencyResolver(new MockRegistry(registryData));
    await expect(resolver.resolve({ pkgA: '^1.0.0' })).rejects.toThrow();
  });

  it('prefers lockfile version when range satisfied', async () => {
    const registryData: Record<string, PackageVersions> = {
      pkgA: {
        name: 'pkgA',
        owner: 'pkgA-owner',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: { pkgB: '^1.0.0' },
            yanked: false,
            publishedAt: '',
          },
          '1.1.0': {
            version: '1.1.0',
            dependencies: { pkgB: '^1.0.0' },
            yanked: false,
            publishedAt: '',
          },
        },
      },
      pkgB: {
        name: 'pkgB',
        owner: 'pkgB-owner',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: {},
            yanked: false,
            publishedAt: '',
          },
          '1.1.0': {
            version: '1.1.0',
            dependencies: {},
            yanked: false,
            publishedAt: '',
          },
        },
      },
    };

    const lockfile: LockfileData = {
      version: 1,
      packages: {
        pkgA: {
          version: '1.0.0',
          resolved: '',
          integrity: '',
          dependencies: { pkgB: '^1.0.0' },
        },
        pkgB: {
          version: '1.0.0',
          resolved: '',
          integrity: '',
          dependencies: {},
        },
      },
      metadata: { generatedAt: '', cliVersion: '' },
    };

    const resolver = new DependencyResolver(new MockRegistry(registryData), {
      lockfile,
    });
    const { resolved } = await resolver.resolve({ pkgA: '^1.0.0' });
    expect(resolved.get('pkgA')?.version).toBe('1.0.0');
    expect(resolved.get('pkgB')?.version).toBe('1.0.0');
  });

  it('backtracks to earlier packages when conflicts arise', async () => {
    const registryData: Record<string, PackageVersions> = {
      auth: {
        name: 'auth',
        owner: 'auth-owner',
        versions: {
          '1.1.0': {
            version: '1.1.0',
            dependencies: { tslib: '^2.0.0' },
            yanked: false,
            publishedAt: '',
          },
          '1.0.0': {
            version: '1.0.0',
            dependencies: { tslib: '^1.0.0' },
            yanked: false,
            publishedAt: '',
          },
        },
      },
      ui: {
        name: 'ui',
        owner: 'ui-owner',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: { tslib: '^1.0.0' },
            yanked: false,
            publishedAt: '',
          },
        },
      },
      tslib: {
        name: 'tslib',
        owner: 'tslib-owner',
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dependencies: {},
            yanked: false,
            publishedAt: '',
          },
          '2.0.0': {
            version: '2.0.0',
            dependencies: {},
            yanked: false,
            publishedAt: '',
          },
        },
      },
    };
    const resolver = new DependencyResolver(new MockRegistry(registryData));
    const { resolved } = await resolver.resolve({ auth: '^1.0.0', ui: '^1.0.0' });
    expect(resolved.get('auth')?.version).toBe('1.0.0');
    expect(resolved.get('tslib')?.version).toBe('1.0.0');
  });
});
