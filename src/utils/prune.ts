import type { LockfilePackage } from '../core/lock-file';

function buildDependentsMap(packages: Record<string, LockfilePackage>): Map<string, Set<string>> {
  const dependents = new Map<string, Set<string>>();
  for (const [pkg, info] of Object.entries(packages)) {
    const deps = Object.keys(info.dependencies ?? {});
    for (const dep of deps) {
      const set = dependents.get(dep);
      if (set) {
        set.add(pkg);
      } else {
        dependents.set(dep, new Set([pkg]));
      }
    }
  }
  return dependents;
}

export function listDependents(
  packages: Record<string, LockfilePackage>,
  target: string,
): string[] {
  const dependents = buildDependentsMap(packages).get(target);
  if (!dependents) return [];
  return [...dependents].sort((a, b) => a.localeCompare(b));
}

/**
 * Determine the set of packages that should be removed from the lockfile when
 * uninstalling one or more root packages. Any dependency that is only required
 * by packages slated for removal (and not explicitly protected) will be
 * recursively added to the removal set.
 */
export function computeRemovalSet(
  packages: Record<string, LockfilePackage>,
  roots: Set<string>,
  protectedPackages: Set<string>,
): Set<string> {
  const toRemove = new Set<string>();
  const queue: string[] = [];

  for (const root of roots) {
    if (!toRemove.has(root)) {
      toRemove.add(root);
      queue.push(root);
    }
  }

  const dependents = buildDependentsMap(packages);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const info = packages[current];
    if (!info) continue;

    const deps = Object.keys(info.dependencies ?? {});
    for (const dep of deps) {
      const depDependents = dependents.get(dep);
      if (depDependents) depDependents.delete(current);

      if (protectedPackages.has(dep) || toRemove.has(dep)) {
        continue;
      }

      const stillNeeded = depDependents
        ? [...depDependents].some((pkg) => !toRemove.has(pkg))
        : false;

      if (!stillNeeded) {
        toRemove.add(dep);
        queue.push(dep);
      }
    }
  }

  return toRemove;
}
