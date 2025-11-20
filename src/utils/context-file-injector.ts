import { promises as fs } from 'node:fs';
import path from 'node:path';

const BEGIN_MARKER = '<!-- terrazul:begin -->';
const END_MARKER = '<!-- terrazul:end -->';

export interface PackageInfo {
  name: string;
  version?: string;
  root: string;
}

export interface InjectOptions {
  /**
   * Dry run mode - don't write, just return what would be written
   */
  dryRun?: boolean;
}

/**
 * Inject direct @-mentions of package context files (CLAUDE.md, AGENTS.md) into a context file.
 * Filters out non-context files (MCP configs, agents/, commands/, etc.)
 * Uses marker comments to ensure idempotent injection.
 *
 * @param filePath - Absolute path to the context file to inject into
 * @param projectRoot - Absolute path to project root
 * @param packageFiles - Map of package name to array of rendered file paths
 * @param packages - Array of package info (name, version, root)
 * @param options - Injection options
 * @returns Object indicating if file was modified and the new content
 */
export async function injectPackageContext(
  filePath: string,
  projectRoot: string,
  packageFiles: Map<string, string[]>,
  packages: PackageInfo[],
  options: InjectOptions = {},
): Promise<{ modified: boolean; content?: string }> {
  // Check if file exists
  let content = '';
  let fileExists = false;
  try {
    content = await fs.readFile(filePath, 'utf8');
    fileExists = true;
  } catch {
    // File doesn't exist, create with just the package context
    content = '';
    fileExists = false;
  }

  // Check if markers already exist
  const hasBeginMarker = content.includes(BEGIN_MARKER);
  const hasEndMarker = content.includes(END_MARKER);

  // Generate the new context block
  const expectedBlock = generateContextBlock(projectRoot, packageFiles, packages);

  // If both markers exist, the injection is already present
  if (hasBeginMarker && hasEndMarker) {
    // Verify the content between markers is correct
    const regex = new RegExp(`${escapeRegExp(BEGIN_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`);

    if (content.includes(expectedBlock)) {
      // Already injected and correct, no changes needed
      return { modified: false };
    }

    // Markers exist but content is wrong, replace the block
    const newContent = content.replace(regex, expectedBlock);

    if (!options.dryRun) {
      await fs.writeFile(filePath, newContent, 'utf8');
    }

    return { modified: true, content: newContent };
  }

  // If only one marker exists, remove it and re-inject cleanly
  if (hasBeginMarker || hasEndMarker) {
    content = content.replaceAll(new RegExp(escapeRegExp(BEGIN_MARKER), 'g'), '');
    content = content.replaceAll(new RegExp(escapeRegExp(END_MARKER), 'g'), '');
  }

  // Inject the package context block
  const contextBlock = expectedBlock;

  // New file or empty file - just add the block; otherwise append at the end with proper spacing
  const newContent =
    !fileExists || content.trim() === '' ? contextBlock : content.trimEnd() + '\n\n' + contextBlock;

  if (!options.dryRun) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, newContent, 'utf8');
  }

  return { modified: true, content: newContent };
}

/**
 * Remove package context block from a context file.
 *
 * @param filePath - Absolute path to the context file
 * @param options - Injection options
 * @returns Object indicating if file was modified and the new content
 */
export async function removePackageContext(
  filePath: string,
  options: InjectOptions = {},
): Promise<{ modified: boolean; content?: string }> {
  let content = '';
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    // File doesn't exist, nothing to remove
    return { modified: false };
  }

  // Check if markers exist
  const hasMarkers = content.includes(BEGIN_MARKER) && content.includes(END_MARKER);

  if (!hasMarkers) {
    return { modified: false };
  }

  // Remove the entire block including markers
  const regex = new RegExp(
    `\\n*${escapeRegExp(BEGIN_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}\\n*`,
    'g',
  );
  const newContent = content.replace(regex, '').trimEnd() + '\n';

  if (!options.dryRun) {
    await fs.writeFile(filePath, newContent, 'utf8');
  }

  return { modified: true, content: newContent };
}

/**
 * Check if a context file has the package context block injected.
 */
export async function hasPackageContext(filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.includes(BEGIN_MARKER) && content.includes(END_MARKER);
  } catch {
    return false;
  }
}

/**
 * Legacy function for backward compatibility.
 * @deprecated Use removePackageContext instead.
 */
export const removeTZMdReference = removePackageContext;

/**
 * Legacy function for backward compatibility.
 * @deprecated Use hasPackageContext instead.
 */
export const hasTZMdReference = hasPackageContext;

/**
 * Generate the package context block with direct @-mentions.
 * Filters to only include CLAUDE.md and AGENTS.md files (context files).
 * Excludes MCP configs, agents/, commands/, hooks/, skills/ files.
 */
function generateContextBlock(
  projectRoot: string,
  packageFiles: Map<string, string[]>,
  packages: PackageInfo[],
): string {
  const lines = [BEGIN_MARKER, '<!-- Terrazul package context - auto-managed, do not edit -->'];

  // Sort packages alphabetically by name
  const sortedPackages = [...packages].sort((a, b) => a.name.localeCompare(b.name));

  for (const pkg of sortedPackages) {
    const files = packageFiles.get(pkg.name);
    if (!files || files.length === 0) continue;

    // Filter to only include context files (CLAUDE.md, AGENTS.md)
    // Exclude MCP configs, agents/, commands/, hooks/, skills/ directories
    const contextFiles = files.filter((file) => {
      const basename = path.basename(file);

      // Only include CLAUDE.md and AGENTS.md
      if (basename === 'CLAUDE.md' || basename === 'AGENTS.md') {
        return true;
      }

      return false;
    });

    // Add @-mentions for each context file
    for (const file of contextFiles) {
      const relPath = path.relative(projectRoot, file);
      lines.push(`@${relPath}`);
    }
  }

  lines.push(END_MARKER);
  return lines.join('\n');
}

/**
 * Escape special regex characters.
 */
function escapeRegExp(str: string): string {
  return str.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}
