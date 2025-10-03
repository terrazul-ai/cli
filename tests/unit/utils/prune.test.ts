import { describe, expect, it } from 'vitest';

import { computeRemovalSet, listDependents } from '../../../src/utils/prune';

const makePkg = (deps: Record<string, string> = {}) => ({
  version: '1.0.0',
  resolved: 'http://example.com/pkg.tgz',
  integrity: 'sha256-abc',
  dependencies: deps,
});

describe('listDependents', () => {
  it('lists direct dependents for a package', () => {
    const pkgs = {
      '@scope/root': makePkg({ '@scope/leaf': '^1.0.0', '@scope/branch': '^1.0.0' }),
      '@scope/leaf': makePkg(),
      '@scope/branch': makePkg({ '@scope/shared': '^1.0.0' }),
      '@scope/shared': makePkg(),
      '@scope/external': makePkg({ '@scope/shared': '^1.0.0' }),
    };

    const dependents = listDependents(pkgs, '@scope/shared');
    expect(new Set(dependents)).toEqual(new Set(['@scope/branch', '@scope/external']));
  });
});

describe('computeRemovalSet', () => {
  it('removes target and exclusive transitive dependencies', () => {
    const pkgs = {
      '@scope/root': makePkg({ '@scope/leaf': '^1.0.0', '@scope/branch': '^1.0.0' }),
      '@scope/leaf': makePkg(),
      '@scope/branch': makePkg({ '@scope/shared': '^1.0.0' }),
      '@scope/shared': makePkg(),
      '@scope/external': makePkg({ '@scope/shared': '^1.0.0' }),
    };

    const protect = new Set(['@scope/external']);
    const removal = computeRemovalSet(pkgs, new Set(['@scope/root']), protect);

    expect(new Set(removal)).toEqual(new Set(['@scope/root', '@scope/leaf', '@scope/branch']));
    expect(removal.has('@scope/shared')).toBe(false);
  });

  it('keeps protected dependencies even if only used by removed packages', () => {
    const pkgs = {
      '@scope/root': makePkg({ '@scope/leaf': '^1.0.0' }),
      '@scope/leaf': makePkg(),
    };
    const protect = new Set(['@scope/leaf']);
    const removal = computeRemovalSet(pkgs, new Set(['@scope/root']), protect);

    expect(new Set(removal)).toEqual(new Set(['@scope/root']));
  });
});
