import path from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_PACKAGE_VERSION,
  buildInteractiveBaseOptions,
} from '../../../src/commands/extract';

describe('buildInteractiveBaseOptions', () => {
  it('uses 0.0.0 as the default package version', () => {
    const options = buildInteractiveBaseOptions({ from: '/tmp/project' });

    expect(options.version).toBe(DEFAULT_PACKAGE_VERSION);
  });

  it('preserves an explicit pkgVersion argument', () => {
    const options = buildInteractiveBaseOptions({
      from: '/tmp/project',
      pkgVersion: '3.2.1',
    });

    expect(options.version).toBe('3.2.1');
  });

  it('derives defaults relative to the provided project root', () => {
    const options = buildInteractiveBaseOptions({ from: '/tmp/project' });

    expect(options.from).toBe(path.resolve('/tmp/project'));
    expect(options.out).toBe(path.join(path.resolve('/tmp/project'), 'extracted-package'));
  });
});
