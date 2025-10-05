// Centralized CLI version accessor, sourced from package.json at build time.
// Using esbuild bundling, the JSON import is inlined into the single-file output.

// @ts-ignore - resolveJsonModule allows this import and esbuild will inline it
import pkg from '../../package.json' with { type: 'json' };

export function getCliVersion(): string {
  // Fallback defensively in case of unexpected shapes
  const v = (pkg as unknown as { version?: string }).version;
  return typeof v === 'string' && v.length > 0 ? v : '0.0.0';
}
