import type { SeaManifest } from '../types/sea-manifest';

export interface SeaTargetDefinition {
  platform: NodeJS.Platform;
  arch: string;
  target: keyof SeaManifest['targets'];
  binaryName: string;
}

export const SEA_TARGETS: SeaTargetDefinition[] = [
  { platform: 'darwin', arch: 'arm64', target: 'darwin-arm64', binaryName: 'tz-darwin-arm64' },
  { platform: 'darwin', arch: 'x64', target: 'darwin-x64', binaryName: 'tz-darwin-x64' },
  { platform: 'linux', arch: 'x64', target: 'linux-x64', binaryName: 'tz-linux-x64' },
  { platform: 'linux', arch: 'arm64', target: 'linux-arm64', binaryName: 'tz-linux-arm64' },
  { platform: 'win32', arch: 'x64', target: 'win32-x64', binaryName: 'tz-win32-x64.exe' },
  { platform: 'win32', arch: 'arm64', target: 'win32-arm64', binaryName: 'tz-win32-arm64.exe' },
];

export function resolveSeaTarget(platform: NodeJS.Platform, arch: string): SeaTargetDefinition {
  const match = SEA_TARGETS.find(
    (candidate) => candidate.platform === platform && candidate.arch === arch,
  );
  if (!match) {
    const supported = SEA_TARGETS.map((candidate) => `${candidate.platform}/${candidate.arch}`)
      .sort()
      .join(', ');
    throw new Error(
      `Unsupported platform/arch combination: ${platform}/${arch}. Supported combinations: ${supported}`,
    );
  }
  return match;
}

export function archiveNameForTarget(definition: SeaTargetDefinition): string {
  return `${definition.binaryName}.zst`;
}

export function binaryNameFromArchive(archiveName: string): string {
  return archiveName.toLowerCase().endsWith('.zst') ? archiveName.slice(0, -4) : archiveName;
}
