import { promises as fs } from 'node:fs';
import path from 'node:path';

import { type PackageInfo } from './context-file-injector.js';
import { readManifest } from './manifest.js';

/**
 * Recursively collect all files from a directory
 * @param dir - Directory to scan
 * @returns Array of absolute file paths
 */
export async function collectFilesRecursively(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively collect files from subdirectories
        const subFiles = await collectFilesRecursively(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files;
}

/**
 * Collect all package files and metadata from agent_modules directory
 * @param projectRoot - Project root directory containing agent_modules
 * @returns Map of package names to file lists, and array of package metadata
 */
export async function collectPackageFilesFromAgentModules(projectRoot: string): Promise<{
  packageFiles: Map<string, string[]>;
  packageInfos: PackageInfo[];
}> {
  const agentModules = path.join(projectRoot, 'agent_modules');
  const packageFiles = new Map<string, string[]>();
  const packageInfos: PackageInfo[] = [];

  try {
    const entries = await fs.readdir(agentModules, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Handle scoped packages (e.g., @scope/)
      if (entry.name.startsWith('@')) {
        const scopeDir = path.join(agentModules, entry.name);
        const pkgs = await fs.readdir(scopeDir, { withFileTypes: true });

        for (const pkg of pkgs) {
          if (!pkg.isDirectory()) continue;

          const pkgName = `${entry.name}/${pkg.name}`;
          const pkgRoot = path.join(scopeDir, pkg.name);

          // Collect rendered files recursively
          const files = await collectFilesRecursively(pkgRoot);
          if (files.length > 0) {
            packageFiles.set(pkgName, files);

            // Read manifest for version info
            const manifest = await readManifest(pkgRoot);
            packageInfos.push({
              name: pkgName,
              version: manifest?.package?.version,
              root: pkgRoot,
            });
          }
        }
      } else {
        // Unscoped package
        const pkgName = entry.name;
        const pkgRoot = path.join(agentModules, pkgName);

        // Collect rendered files recursively
        const files = await collectFilesRecursively(pkgRoot);
        if (files.length > 0) {
          packageFiles.set(pkgName, files);

          // Read manifest for version info
          const manifest = await readManifest(pkgRoot);
          packageInfos.push({
            name: pkgName,
            version: manifest?.package?.version,
            root: pkgRoot,
          });
        }
      }
    }
  } catch {
    // agent_modules doesn't exist or can't be read
  }

  return { packageFiles, packageInfos };
}
