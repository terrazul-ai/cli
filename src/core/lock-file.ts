/**
 * Lockfile management for deterministic installations
 * Uses TOML format with SHA-256 integrity hashes
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import * as TOML from '@iarna/toml';

import { getCliVersion } from '../utils/version.js';

export interface LockfilePackage {
  version: string;
  resolved: string;
  integrity: string; // sha256-<base64>
  dependencies?: Record<string, string>;
  yanked?: boolean;
  yankedReason?: string;
}

export interface LockfileData {
  version: number; // Lockfile format version
  packages: Record<string, LockfilePackage>;
  metadata: {
    generatedAt: string;
    cliVersion: string;
  };
}

export class LockfileManager {
  private static readonly LOCKFILE_VERSION = 1;
  private static readonly LOCKFILE_NAME = 'agents-lock.toml';

  /**
   * Read lockfile from disk
   */
  static read(projectDir: string = '.'): LockfileData | null {
    const lockfilePath = `${projectDir}/${this.LOCKFILE_NAME}`;

    if (!existsSync(lockfilePath)) {
      return null;
    }

    try {
      const content = readFileSync(lockfilePath, 'utf8');
      interface Parsed {
        version?: number;
        packages?: Record<string, LockfilePackage>;
        metadata?: {
          generatedAt?: string;
          generated_at?: string;
          cliVersion?: string;
          cli_version?: string;
        };
      }
      const parsed = TOML.parse(content) as Parsed;

      // Validate structure
      if (!parsed.version || !parsed.packages || !parsed.metadata) {
        console.warn('Invalid lockfile structure');
        return null;
      }

      const generatedAt = parsed.metadata.generatedAt ?? parsed.metadata.generated_at ?? '';
      const cliVersion = parsed.metadata.cliVersion ?? parsed.metadata.cli_version ?? '';

      return {
        version: parsed.version,
        packages: parsed.packages || {},
        metadata: {
          generatedAt,
          cliVersion,
        },
      };
    } catch (error) {
      console.error('Error parsing lockfile:', error);
      return null;
    }
  }

  /**
   * Write lockfile to disk with deterministic ordering
   */
  static write(data: LockfileData, projectDir: string = '.'): void {
    const lockfilePath = `${projectDir}/${this.LOCKFILE_NAME}`;

    // Sort packages alphabetically for determinism
    const sortedPackages: Record<string, LockfilePackage> = {};
    const packageNames = Object.keys(data.packages).sort();

    for (const name of packageNames) {
      const pkg = data.packages[name];

      // Sort dependencies if present
      if (pkg.dependencies) {
        const sortedDeps: Record<string, string> = {};
        const depNames = Object.keys(pkg.dependencies).sort();

        for (const depName of depNames) {
          sortedDeps[depName] = pkg.dependencies[depName];
        }

        sortedPackages[name] = {
          ...pkg,
          dependencies: sortedDeps,
        };
      } else {
        sortedPackages[name] = pkg;
      }
    }

    // Create TOML structure
    const tomlData = {
      version: this.LOCKFILE_VERSION,
      packages: sortedPackages,
      metadata: {
        generated_at: new Date().toISOString(),
        cli_version: getCliVersion(),
      },
    };

    // Convert to TOML string
    // Cast due to conservative typings in @iarna/toml
    const tomlString = TOML.stringify(tomlData as unknown as TOML.JsonMap);

    // Write to file
    writeFileSync(lockfilePath, tomlString, 'utf8');
  }

  /**
   * Merge new package data into existing lockfile
   */
  static merge(
    existing: LockfileData | null,
    updates: Record<string, LockfilePackage>,
  ): LockfileData {
    const base = existing || {
      version: this.LOCKFILE_VERSION,
      packages: {},
      metadata: {
        generatedAt: new Date().toISOString(),
        cliVersion: getCliVersion(),
      },
    };

    // Merge packages
    const merged: LockfileData = {
      ...base,
      packages: {
        ...base.packages,
        ...updates,
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        cliVersion: getCliVersion(),
      },
    };

    return merged;
  }

  /**
   * Remove packages from lockfile
   */
  static remove(existing: LockfileData, packageNames: string[]): LockfileData {
    const packages = { ...existing.packages };

    for (const name of packageNames) {
      delete packages[name];
    }

    return {
      ...existing,
      packages,
      metadata: {
        generatedAt: new Date().toISOString(),
        cliVersion: getCliVersion(),
      },
    };
  }

  /**
   * Create integrity hash from content
   * Format: sha256-<base64>
   */
  static createIntegrityHash(content: Buffer): string {
    const hash = createHash('sha256').update(content).digest('base64');
    return `sha256-${hash}`;
  }

  /**
   * Verify integrity hash
   */
  static verifyIntegrity(content: Buffer, integrity: string): boolean {
    if (!integrity.startsWith('sha256-')) {
      return false;
    }

    const expected = integrity.slice(7); // Remove 'sha256-' prefix
    const actual = createHash('sha256').update(content).digest('base64');

    return expected === actual;
  }

  /**
   * Convert hex hash to integrity format
   */
  static hexToIntegrity(hexHash: string): string {
    const buffer = Buffer.from(hexHash, 'hex');
    const base64 = buffer.toString('base64');
    return `sha256-${base64}`;
  }

  /**
   * Convert integrity format to hex hash
   */
  static integrityToHex(integrity: string): string | null {
    if (!integrity.startsWith('sha256-')) {
      return null;
    }

    const base64 = integrity.slice(7);
    const buffer = Buffer.from(base64, 'base64');
    return buffer.toString('hex');
  }

  /**
   * Check if a package is in the lockfile
   */
  static hasPackage(lockfile: LockfileData | null, packageName: string): boolean {
    if (!lockfile) {
      return false;
    }

    return packageName in lockfile.packages;
  }

  /**
   * Get package from lockfile
   */
  static getPackage(lockfile: LockfileData | null, packageName: string): LockfilePackage | null {
    if (!lockfile) {
      return null;
    }

    return lockfile.packages[packageName] || null;
  }

  /**
   * Check if lockfile needs updating
   * (different version or missing packages)
   */
  static needsUpdate(lockfile: LockfileData | null, requiredPackages: string[]): boolean {
    if (!lockfile) {
      return requiredPackages.length > 0;
    }

    // Check if all required packages are in lockfile
    for (const pkg of requiredPackages) {
      if (!this.hasPackage(lockfile, pkg)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get CLI version for metadata
   */
  // Note: CLI version is provided by utils/version to ensure consistency

  /**
   * Validate lockfile integrity
   */
  static validate(lockfile: LockfileData): string[] {
    const errors: string[] = [];

    // Check version
    if (lockfile.version !== this.LOCKFILE_VERSION) {
      errors.push(`Unsupported lockfile version: ${lockfile.version}`);
    }

    // Check packages
    for (const [name, pkg] of Object.entries(lockfile.packages)) {
      if (!pkg.version) {
        errors.push(`Package ${name} missing version`);
      }

      if (!pkg.resolved) {
        errors.push(`Package ${name} missing resolved URL`);
      }

      if (!pkg.integrity || !pkg.integrity.startsWith('sha256-')) {
        errors.push(`Package ${name} has invalid integrity hash`);
      }

      // Check dependency versions
      if (pkg.dependencies) {
        for (const [depName, depVersion] of Object.entries(pkg.dependencies)) {
          if (!depVersion) {
            errors.push(`Package ${name} has invalid dependency ${depName}`);
          }
        }
      }
    }

    // Check metadata
    if (!lockfile.metadata.generatedAt) {
      errors.push('Missing generatedAt metadata');
    }

    if (!lockfile.metadata.cliVersion) {
      errors.push('Missing cliVersion metadata');
    }

    return errors;
  }
}
