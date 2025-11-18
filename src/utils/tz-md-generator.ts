import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readManifest } from './manifest.js';
import { ErrorCode, TerrazulError } from '../core/errors.js';

export interface PackageInfo {
  name: string;
  version?: string;
  root: string;
}

export interface GenerateTZMdOptions {
  /**
   * Output path for TZ.md. Default: .terrazul/TZ.md
   */
  outputPath?: string;
  /**
   * Dry run mode - don't write, just return content
   */
  dryRun?: boolean;
}

/**
 * Generate TZ.md file that aggregates context from all rendered packages.
 * Uses @-mention syntax to reference package-specific files.
 *
 * @param projectRoot - Absolute path to project root
 * @param packageFiles - Map of package name to array of rendered file paths
 * @param packages - Array of package info (name, version, root)
 * @param options - Generation options
 * @returns The generated TZ.md content
 */
export async function generateTZMd(
  projectRoot: string,
  packageFiles: Map<string, string[]>,
  packages: PackageInfo[],
  options: GenerateTZMdOptions = {},
): Promise<string> {
  const outputPath = options.outputPath ?? path.join(projectRoot, '.terrazul', 'TZ.md');

  // Validate that all referenced files exist
  for (const [pkgName, files] of packageFiles) {
    for (const file of files) {
      try {
        await fs.stat(file);
      } catch {
        throw new TerrazulError(
          ErrorCode.FILE_NOT_FOUND,
          `TZ.md generation failed: missing file ${file} from package ${pkgName}`,
        );
      }
    }
  }

  // Build markdown content
  const lines: string[] = [];
  lines.push(
    '# Terrazul Package Context',
    '',
    'This file aggregates context from installed Terrazul packages. Each @-mention references a rendered package file.',
    '',
  );

  if (packageFiles.size === 0) {
    lines.push('No packages have been rendered yet.');
  } else {
    lines.push('## Active Packages', '');

    // Sort packages alphabetically
    const sortedPackages = [...packages].sort((a, b) => a.name.localeCompare(b.name));

    for (const pkg of sortedPackages) {
      const files = packageFiles.get(pkg.name);
      if (!files || files.length === 0) continue;

      // Read package manifest for description
      const manifest = await readManifest(pkg.root);
      const description = manifest?.package?.description;

      lines.push(`### ${pkg.name}${pkg.version ? ` (v${pkg.version})` : ''}`);
      if (description) {
        lines.push(description);
      }
      lines.push('');

      // Add @-mentions for each rendered file
      for (const file of files) {
        const relPath = path.relative(projectRoot, file);
        lines.push(`@${relPath}`);
      }
      lines.push('');
    }
  }

  const content = lines.join('\n');

  // Write to file unless dry run
  if (!options.dryRun) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, content, 'utf8');
  }

  return content;
}

/**
 * Check if TZ.md exists at the default or specified location.
 */
export async function tzMdExists(projectRoot: string, customPath?: string): Promise<boolean> {
  const tzMdPath = customPath ?? path.join(projectRoot, '.terrazul', 'TZ.md');
  try {
    await fs.stat(tzMdPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove TZ.md if it exists.
 */
export async function removeTZMd(projectRoot: string, customPath?: string): Promise<void> {
  const tzMdPath = customPath ?? path.join(projectRoot, '.terrazul', 'TZ.md');
  try {
    await fs.unlink(tzMdPath);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Regenerate TZ.md from the current state of agent_modules.
 * Scans agent_modules for packages and their rendered directories,
 * then generates TZ.md with @-mentions.
 */
export async function regenerateTZMdFromAgentModules(
  projectRoot: string,
  options: GenerateTZMdOptions = {},
): Promise<void> {
  const agentModulesRoot = path.join(projectRoot, 'agent_modules');

  // Discover installed packages
  const packages: PackageInfo[] = [];
  const packageFiles = new Map<string, string[]>();

  try {
    const level1 = await fs.readdir(agentModulesRoot);

    for (const d1 of level1) {
      const abs = path.join(agentModulesRoot, d1);
      const st = await fs.stat(abs).catch(() => null);
      if (!st || !st.isDirectory()) continue;

      if (d1.startsWith('@')) {
        // Scoped package
        const nested = await fs.readdir(abs).catch(() => [] as string[]);
        for (const d2 of nested) {
          const abs2 = path.join(abs, d2);
          const st2 = await fs.stat(abs2).catch(() => null);
          if (!st2 || !st2.isDirectory()) continue;

          const pkgName = `${d1}/${d2}`;
          const renderedDir = path.join(abs2, 'rendered');

          // Check if rendered directory exists
          const renderedStat = await fs.stat(renderedDir).catch(() => null);
          if (renderedStat && renderedStat.isDirectory()) {
            // Collect all files in rendered directory
            const files = await collectFilesRecursively(renderedDir);
            if (files.length > 0) {
              packageFiles.set(pkgName, files);

              // Read manifest for package info
              const manifest = await readManifest(abs2);
              packages.push({
                name: pkgName,
                version: manifest?.package?.version,
                root: abs2,
              });
            }
          }
        }
      } else {
        // Unscoped package
        const pkgName = d1;
        const renderedDir = path.join(abs, 'rendered');

        // Check if rendered directory exists
        const renderedStat = await fs.stat(renderedDir).catch(() => null);
        if (renderedStat && renderedStat.isDirectory()) {
          // Collect all files in rendered directory
          const files = await collectFilesRecursively(renderedDir);
          if (files.length > 0) {
            packageFiles.set(pkgName, files);

            // Read manifest for package info
            const manifest = await readManifest(abs);
            packages.push({
              name: pkgName,
              version: manifest?.package?.version,
              root: abs,
            });
          }
        }
      }
    }
  } catch {
    // If agent_modules doesn't exist, just create empty TZ.md
    packageFiles.clear();
    packages.length = 0;
  }

  // Generate TZ.md
  await generateTZMd(projectRoot, packageFiles, packages, options);
}

/**
 * Recursively collect all files in a directory.
 */
async function collectFilesRecursively(dir: string): Promise<string[]> {
  const files: string[] = [];
  const stack: string[] = [dir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}
