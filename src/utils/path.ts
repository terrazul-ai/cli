import path from 'node:path';

/**
 * Cross-platform safe path helpers. Keep pure and side-effect free.
 * These functions never touch the filesystem; callers may wrap thrown Errors
 * into domain-specific errors (e.g., TerrazulError) near user surfaces.
 */

/**
 * Resolve a path within a base directory, rejecting traversal outside of base.
 */
export function resolveWithin(baseDir: string, ...parts: string[]): string {
  const out = path.resolve(baseDir, ...parts);
  const isWin = process.platform === 'win32';
  const norm = (p: string) => (isWin ? p.toLowerCase() : p);
  const base = norm(path.resolve(baseDir));
  const outNorm = norm(out);
  const withSep = (p: string) => (p.endsWith(path.sep) ? p : p + path.sep);
  const baseWith = withSep(base);
  const outWith = withSep(outNorm);
  if (outWith === baseWith) return out; // allow equal
  if (!outWith.startsWith(baseWith)) {
    throw new Error(`Path escapes base: ${out}`);
  }
  return out;
}

/**
 * Validate a package name segment (scope or name) for use as a path segment.
 */
export function isSafePkgSegment(seg: string): boolean {
  if (!seg || seg === '.' || seg === '..') return false;
  if (seg.includes('/') || seg.includes('\\')) return false;
  return true;
}

/**
 * Parse and validate package name. Supports '@scope/name' or 'name'.
 */
export function parseSafePackageName(pkg: string): { scope?: string; name: string } {
  if (pkg.startsWith('@')) {
    const parts = pkg.split('/');
    if (parts.length !== 2) throw new Error(`Invalid scoped package: ${pkg}`);
    const [scope, name] = parts;
    if (!scope.startsWith('@')) throw new Error(`Invalid scope: ${scope}`);
    if (!isSafePkgSegment(scope.slice(1)) || !isSafePkgSegment(name)) {
      throw new Error(`Unsafe package name: ${pkg}`);
    }
    return { scope, name };
  }
  if (!isSafePkgSegment(pkg)) throw new Error(`Unsafe package name: ${pkg}`);
  return { name: pkg };
}

/**
 * Compute a safe path under projectDir/agent_modules for a package link.
 */
export function agentModulesPath(projectDir: string, pkgName: string): string {
  const base = path.join(projectDir, 'agent_modules');
  const parsed = parseSafePackageName(pkgName);
  return parsed.scope
    ? resolveWithin(base, parsed.scope, parsed.name)
    : resolveWithin(base, parsed.name);
}
