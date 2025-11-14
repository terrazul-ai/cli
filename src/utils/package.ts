import { TerrazulError, ErrorCode } from '../core/errors.js';
import { PackageNameSchema } from '../types/package.js';

export interface PackagePath {
  owner: string;
  name: string;
  fullName: string;
}

export function splitPackageName(fullName: string): PackagePath {
  if (!fullName || typeof fullName !== 'string') {
    throw new TerrazulError(ErrorCode.INVALID_PACKAGE, 'Package name is required');
  }

  const trimmed = fullName.trim();

  // Normalize: add @ prefix if missing but otherwise looks like owner/name
  const normalized = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;

  // Validate using centralized schema
  const result = PackageNameSchema.safeParse(normalized);
  if (!result.success) {
    throw new TerrazulError(
      ErrorCode.INVALID_PACKAGE,
      `Package name "${trimmed}" must include an owner segment like @owner/name`,
    );
  }

  // Parse the validated name
  const slashIndex = normalized.indexOf('/');
  const owner = normalized.slice(1, slashIndex); // Remove @ and get owner
  const name = normalized.slice(slashIndex + 1);

  return {
    owner,
    name,
    fullName: normalized,
  };
}

export function buildPackageApiPath(fullName: string, ...segments: string[]): string {
  const { owner, name } = splitPackageName(fullName);
  const parts = [`/packages/v1/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`];
  if (segments.length > 0) {
    parts.push(segments.map((seg) => `/${encodeURIComponent(seg)}`).join(''));
  }
  return parts.join('');
}
