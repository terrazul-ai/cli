import { TerrazulError, ErrorCode } from '../core/errors.js';

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
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new TerrazulError(
      ErrorCode.INVALID_PACKAGE,
      `Package name "${trimmed}" must include an owner segment like @owner/name`,
    );
  }
  const ownerSegment = trimmed.slice(0, slash);
  const packageSegment = trimmed.slice(slash + 1);
  const owner = ownerSegment.startsWith('@') ? ownerSegment.slice(1) : ownerSegment;
  if (!owner || !packageSegment) {
    throw new TerrazulError(
      ErrorCode.INVALID_PACKAGE,
      `Package name "${trimmed}" must include an owner segment like @owner/name`,
    );
  }
  return {
    owner,
    name: packageSegment,
    fullName: trimmed.startsWith('@') ? trimmed : `@${owner}/${packageSegment}`,
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
