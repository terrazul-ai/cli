import { promises as fs } from 'node:fs';
import path from 'node:path';

const BEGIN_MARKER = '<!-- terrazul:begin -->';
const END_MARKER = '<!-- terrazul:end -->';

export interface InjectOptions {
  /**
   * Dry run mode - don't write, just return what would be written
   */
  dryRun?: boolean;
}

/**
 * Inject @-mention of .terrazul/TZ.md into a context file (CLAUDE.md, AGENTS.md, etc.)
 * Uses marker comments to ensure idempotent injection.
 *
 * @param filePath - Absolute path to the context file
 * @param projectRoot - Absolute path to project root
 * @param options - Injection options
 * @returns true if file was modified, false if already had the reference
 */
export async function injectTZMdReference(
  filePath: string,
  projectRoot: string,
  options: InjectOptions = {},
): Promise<{ modified: boolean; content?: string }> {
  // Check if file exists
  let content = '';
  let fileExists = false;
  try {
    content = await fs.readFile(filePath, 'utf8');
    fileExists = true;
  } catch {
    // File doesn't exist, create with just the TZ.md reference
    content = '';
    fileExists = false;
  }

  // Check if markers already exist
  const hasBeginMarker = content.includes(BEGIN_MARKER);
  const hasEndMarker = content.includes(END_MARKER);

  // If both markers exist, the injection is already present
  if (hasBeginMarker && hasEndMarker) {
    // Verify the content between markers is correct
    const regex = new RegExp(`${escapeRegExp(BEGIN_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`);
    const expectedBlock = generateTZMdBlock();

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

  // Inject the TZ.md reference block
  const tzBlock = generateTZMdBlock();

  // New file or empty file - just add the block; otherwise append at the end with proper spacing
  const newContent =
    !fileExists || content.trim() === '' ? tzBlock : content.trimEnd() + '\n\n' + tzBlock;

  if (!options.dryRun) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, newContent, 'utf8');
  }

  return { modified: true, content: newContent };
}

/**
 * Remove TZ.md reference from a context file.
 *
 * @param filePath - Absolute path to the context file
 * @param options - Injection options
 * @returns true if file was modified, false if reference wasn't present
 */
export async function removeTZMdReference(
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
 * Check if a context file has the TZ.md reference injected.
 */
export async function hasTZMdReference(filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.includes(BEGIN_MARKER) && content.includes(END_MARKER);
  } catch {
    return false;
  }
}

/**
 * Generate the TZ.md reference block.
 */
function generateTZMdBlock(): string {
  return `${BEGIN_MARKER}
@.terrazul/TZ.md
${END_MARKER}`;
}

/**
 * Escape special regex characters.
 */
function escapeRegExp(str: string): string {
  return str.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}
