import os from 'node:os';
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
 * Enforces the same rules as PackageNameSchema: lowercase alphanumeric, hyphens, and underscores only.
 * Rejects dot segments, slashes, uppercase letters, whitespace, and other special characters.
 */
export function isSafePkgSegment(seg: string): boolean {
  if (!seg || seg === '.' || seg === '..') return false;
  if (seg.includes('/') || seg.includes('\\')) return false;

  // Enforce PackageNameSchema rules: only lowercase letters, digits, hyphens, and underscores
  // Regex: /^[\d_a-z-]+$/
  const validPattern = /^[\d_a-z-]+$/;
  return validPattern.test(seg);
}

/**
 * Parse and validate package name. Only scoped packages (@scope/name) are accepted.
 * Enforces the same strict rules as PackageNameSchema:
 * - Both scope and name must contain only lowercase letters, digits, hyphens, and underscores
 * - No uppercase letters, whitespace, or other special characters allowed
 * - Rejects path traversal attempts (., .., /, \)
 *
 * @param pkg - Package name to parse (must be in format @owner/package-name)
 * @returns Object with scope (including @) and name components
 * @throws Error if package name is invalid or unsafe
 */
export function parseSafePackageName(pkg: string): { scope: string; name: string } {
  if (!pkg.startsWith('@')) {
    throw new Error(`Package name "${pkg}" must be scoped in format @owner/package-name`);
  }

  const parts = pkg.split('/');
  if (parts.length !== 2) throw new Error(`Invalid scoped package: ${pkg}`);

  const [scope, name] = parts;
  if (!scope.startsWith('@')) throw new Error(`Invalid scope: ${scope}`);
  if (!isSafePkgSegment(scope.slice(1)) || !isSafePkgSegment(name)) {
    throw new Error(`Unsafe package name: ${pkg}`);
  }

  return { scope, name };
}

/**
 * Compute a safe path under projectDir/agent_modules for a package link.
 */
export function agentModulesPath(projectDir: string, pkgName: string): string {
  const base = path.join(projectDir, 'agent_modules');
  const parsed = parseSafePackageName(pkgName);
  return resolveWithin(base, parsed.scope, parsed.name);
}

/**
 * Check if a string looks like a filesystem path (not a package spec).
 * Returns true for:
 * - Absolute paths (/foo/bar, C:\foo\bar)
 * - Relative paths (./foo, ../bar)
 * - Tilde paths (~/foo)
 */
export function isFilesystemPath(spec: string): boolean {
  // Absolute paths
  if (path.isAbsolute(spec)) return true;

  // Relative paths starting with ./ or ../
  if (spec.startsWith('./') || spec.startsWith('../')) return true;

  // Tilde expansion (home directory)
  if (spec.startsWith('~/')) return true;

  // Windows paths (C:\, D:\, etc.)
  if (/^[A-Za-z]:[/\\]/.test(spec)) return true;

  return false;
}

/**
 * Resolve a path spec, handling tilde expansion.
 * For absolute and relative paths, resolves them normally.
 * For tilde paths, expands ~ to the home directory.
 */
export function resolvePathSpec(pathSpec: string): string {
  if (pathSpec.startsWith('~/')) {
    return path.join(os.homedir(), pathSpec.slice(2));
  }
  return path.resolve(pathSpec);
}
