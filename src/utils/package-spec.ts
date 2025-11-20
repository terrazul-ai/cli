export interface ParsedPackageSpec {
  name: string;
  range: string;
}

/**
 * Parse a package specification string into name and version range.
 * Supports both scoped (@scope/name@version) and unscoped (name@version) formats.
 *
 * @param spec - Package spec like @scope/name@1.0.0 or name@^1.0.0
 * @returns Parsed name and range, or null if invalid format
 *
 * @example
 * parsePackageSpec('@terrazul/starter@^1.0.0')
 * // Returns: { name: '@terrazul/starter', range: '^1.0.0' }
 */
export function parsePackageSpec(spec?: string): ParsedPackageSpec | null {
  if (!spec) return null;

  const scopedMatch = spec.match(/^(@[^@]+?)@([^@]+)$/);
  const unscopedMatch = spec.match(/^([^@]+)@([^@]+)$/);
  const match = scopedMatch || unscopedMatch;

  if (!match) return null;

  return { name: match[1], range: match[2] };
}
