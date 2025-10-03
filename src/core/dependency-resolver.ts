import { rcompare, compare, satisfies } from 'semver';

import type { LockfileData } from './lock-file';
import type { PackageVersions } from './registry-client';

export interface ResolverOptions {
  skipYanked?: boolean;
  allowYankedFromLock?: boolean;
  preferLatest?: boolean;
  lockfile?: LockfileData | null;
  logger?: { warn(msg: string): void };
}

export interface RegistryLike {
  getPackageVersions(name: string): Promise<PackageVersions>;
}

export interface ResolvedPackage {
  version: string;
  dependencies: Record<string, string>;
}

export type ResolvedDependencies = Map<string, ResolvedPackage>;

export class DependencyResolver {
  constructor(
    private registry: RegistryLike,
    private options: ResolverOptions = {},
  ) {}

  async resolve(rootDeps: Record<string, string>): Promise<{
    resolved: ResolvedDependencies;
    warnings: string[];
  }> {
    const resolved: ResolvedDependencies = new Map();
    const warnings: string[] = [];

    const resolveList = async (deps: [string, string][], index = 0): Promise<void> => {
      if (index >= deps.length) return;
      const [name, range] = deps[index];

      if (resolved.has(name)) {
        const chosen = resolved.get(name)!;
        if (!satisfies(chosen.version, range)) {
          throw new Error(`Version conflict for ${name}`);
        }
        await resolveList(deps, index + 1);
        return;
      }

      const versions = await this.registry.getPackageVersions(name);
      let candidates = Object.values(versions.versions)
        .map((v) => ({
          version: v.version,
          deps: v.dependencies || {},
          yanked: v.yanked,
        }))
        .filter((v) => satisfies(v.version, range));

      const skipYanked = this.options.skipYanked !== false;
      if (skipYanked) {
        candidates = candidates.filter((v) => !v.yanked);
      }

      const lockedPkg = this.options.lockfile?.packages[name];
      if (
        this.options.allowYankedFromLock !== false &&
        lockedPkg?.yanked &&
        satisfies(lockedPkg.version, range) &&
        !candidates.some((c) => c.version === lockedPkg.version)
      ) {
        const lockV = versions.versions[lockedPkg.version];
        if (lockV) {
          candidates.push({
            version: lockedPkg.version,
            deps: lockV.dependencies || {},
            yanked: true,
          });
          warnings.push(`${name}@${lockedPkg.version} is yanked but pinned in lockfile`);
        }
      }

      if (candidates.length === 0) {
        throw new Error(`No versions available for ${name} satisfying ${range}`);
      }

      if (this.options.preferLatest === false) {
        candidates.sort((a, b) => Number(compare(a.version, b.version)));
      } else {
        candidates.sort((a, b) => Number(rcompare(a.version, b.version)));
      }

      if (lockedPkg && satisfies(lockedPkg.version, range)) {
        const idx = candidates.findIndex((c) => c.version === lockedPkg.version);
        if (idx > 0) {
          const [locked] = candidates.splice(idx, 1);
          candidates.unshift(locked);
        }
      }

      for (const cand of candidates) {
        const snapshot = new Set(resolved.keys());
        resolved.set(name, { version: cand.version, dependencies: cand.deps });
        try {
          await resolveList(Object.entries(cand.deps), 0);
          await resolveList(deps, index + 1);
          return;
        } catch {
          for (const key of resolved.keys()) {
            if (!snapshot.has(key)) resolved.delete(key);
          }
        }
      }

      throw new Error(`Could not resolve dependencies for ${name}`);
    };

    await resolveList(Object.entries(rootDeps));

    return { resolved, warnings };
  }
}
