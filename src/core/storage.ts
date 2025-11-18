/**
 * Content-addressable storage manager for packages
 * Handles caching, verification, and safe extraction
 */

import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import * as tar from 'tar';

import type { Stats } from 'node:fs';

export interface StorageOptions {
  cacheDir?: string;
  storeDir?: string;
}

export class StorageManager {
  private cacheDir: string;
  private storeDir: string;

  constructor(options: StorageOptions = {}) {
    const terrazulDir = path.join(homedir(), '.terrazul');
    this.cacheDir = options.cacheDir || path.join(terrazulDir, 'cache');
    this.storeDir = options.storeDir || path.join(terrazulDir, 'store');

    // Ensure directories exist
    mkdirSync(this.cacheDir, { recursive: true });
    mkdirSync(this.storeDir, { recursive: true });
  }

  /**
   * Store content in cache by SHA-256 hash
   * @returns The SHA-256 hash of the content
   */
  store(content: Buffer | string): string {
    const buffer = typeof content === 'string' ? Buffer.from(content) : content;
    const hash = this.computeHash(buffer);
    const cachePath = this.getCachePath(hash);

    // Skip if already cached
    if (existsSync(cachePath)) {
      return hash;
    }

    // Write to temp file first, then atomic rename
    const tempPath = `${cachePath}.tmp`;
    mkdirSync(path.join(cachePath, '..'), { recursive: true });
    writeFileSync(tempPath, buffer);
    renameSync(tempPath, cachePath);

    return hash;
  }

  /**
   * Retrieve content from cache by hash
   */
  retrieve(hash: string): Buffer | null {
    const cachePath = this.getCachePath(hash);

    if (!existsSync(cachePath)) {
      return null;
    }

    return readFileSync(cachePath);
  }

  /**
   * Verify that cached content matches its hash
   */
  verify(hash: string): boolean {
    const content = this.retrieve(hash);
    if (!content) {
      return false;
    }

    const computedHash = this.computeHash(content);
    return computedHash === hash;
  }

  /**
   * Get the extraction path for a package
   */
  getPackagePath(name: string, version: string): string {
    // Keep scoped package structure: @scope/package/version
    return path.join(this.storeDir, name, version);
  }

  /**
   * Extract a tarball to the store with security checks
   */
  async extractTarball(tarballPath: string, packageName: string, version: string): Promise<void> {
    const extractPath = this.getPackagePath(packageName, version);

    // Clean existing directory if present
    if (existsSync(extractPath)) {
      rmSync(extractPath, { recursive: true, force: true });
    }

    mkdirSync(extractPath, { recursive: true });

    // Security filter for tar entries
    const filter = (p: string, entry: tar.ReadEntry | Stats): boolean => {
      // tar passes ReadEntry during extraction; guard for Stats signatures
      if (!('type' in entry)) {
        return true;
      }
      // Normalize the path for the current platform. We only allow
      // simple relative paths and explicitly block any parent traversal.
      const normalizedPath = path.normalize(p);

      // Reject absolute paths
      if (normalizedPath.startsWith('/') || normalizedPath.startsWith('\\')) {
        console.warn(`Security: Rejecting absolute path in tarball: ${p}`);
        return false;
      }

      // Reject paths with parent directory traversal. Checking segments avoids
      // false positives for filenames that happen to contain "..".
      const hasParentTraversal = normalizedPath.split(path.sep).includes('..');
      if (hasParentTraversal) {
        console.warn(`Security: Rejecting path with parent traversal: ${p}`);
        return false;
      }

      // Reject symlinks (for security in v0)
      if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
        console.warn(`Security: Rejecting symlink in tarball: ${p}`);
        return false;
      }

      // Reject device files, FIFOs, etc.
      const allowedTypes = new Set(['File', 'Directory', '0', '5']); // '0' = File, '5' = Directory in tar
      const entryType = String(entry.type);
      if (!allowedTypes.has(entryType)) {
        console.warn(`Security: Rejecting special file type ${entryType}: ${p}`);
        return false;
      }

      // Ensure the path stays within the extraction directory
      const fullPath = path.resolve(extractPath, normalizedPath);
      const relPath = path.relative(extractPath, fullPath);
      if (
        relPath.startsWith('..') ||
        (relPath === '' && path.resolve(fullPath) !== path.resolve(extractPath))
      ) {
        console.warn(`Security: Path escapes extraction directory: ${p}`);
        return false;
      }

      return true;
    };

    // Extract with security filters
    await tar.extract({
      file: tarballPath,
      cwd: extractPath,
      filter,
      // Don't preserve uid/gid (security)
      preserveOwner: false,
      // Strip leading directory components if any
      strip: 0,
      // Ensure we handle errors properly
      onwarn: (message: string, data: unknown) => {
        console.warn(`Tar warning: ${message}`, data);
      },
    });

    // Remove execute permissions from all extracted files (security policy)
    // Windows has no executable bit semantics; skip to avoid noisy warnings.
    if (process.platform !== 'win32') {
      await this.stripExecutePermissions(extractPath);
    }
  }

  /**
   * Stream a file from storage
   */
  createReadStreamFromHash(hash: string): NodeJS.ReadableStream | null {
    const cachePath = this.getCachePath(hash);

    if (!existsSync(cachePath)) {
      return null;
    }

    return createReadStream(cachePath);
  }

  /**
   * Store a stream to cache
   */
  async storeStream(stream: NodeJS.ReadableStream): Promise<string> {
    // Create hash stream
    const hash = createHash('sha256');
    const chunks: Buffer[] = [];

    // Process stream with normalization to Buffer
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buf);
      chunks.push(buf);
    }

    const finalHash = hash.digest('hex');
    const buffer = Buffer.concat(chunks);

    // Store in cache
    this.store(buffer);

    return finalHash;
  }

  /**
   * Compute SHA-256 hash of content
   */
  private computeHash(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get cache path for a hash
   */
  private getCachePath(hash: string): string {
    // Use first 2 chars as prefix for directory sharding
    const prefix = hash.slice(0, 2);
    const rest = hash.slice(2);
    return path.join(this.cacheDir, 'sha256', prefix, rest);
  }

  /**
   * Strip execute permissions from files (security)
   */
  private async stripExecutePermissions(dir: string): Promise<void> {
    const { readdir, stat, chmod } = await import('node:fs/promises');

    const processDirectory = async (currentDir: string): Promise<void> => {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await processDirectory(fullPath);
        } else if (entry.isFile()) {
          try {
            const stats = await stat(fullPath);
            // Remove execute bits (keep read/write)
            const newMode = stats.mode & 0o666; // rw-rw-rw-
            await chmod(fullPath, newMode);
          } catch (error_) {
            // Be conservative about warnings here; chmod can be a no-op or restricted
            // on certain filesystems. We skip noisy logs outside of Unix-like systems.
            if (process.platform !== 'win32') {
              console.warn(`Could not change permissions for ${fullPath}:`, error_);
            }
          }
        }
      }
    };

    await processDirectory(dir);
  }

  /**
   * Clean up old cache entries (future enhancement)
   */
  cleanCache(): void {
    // no-op in v0
  }
}
