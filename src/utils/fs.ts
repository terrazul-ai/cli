/**
 * File system utilities
 * Cross-platform helpers for common FS operations
 */

import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs';
import { platform } from 'node:os';
import path from 'node:path';

/**
 * Check if a file or directory exists
 */
export function exists(p: string): boolean {
  return existsSync(p);
}

/**
 * Check if path is a directory
 */
export function isDirectory(p: string): boolean {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if path is a file
 */
export function isFile(p: string): boolean {
  try {
    return lstatSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Check if path is a symlink
 */
export function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Create a symlink with fallback for Windows
 * On Windows, tries junction for directories, copies for files if symlink fails
 */
export async function createSymlink(target: string, linkPath: string): Promise<void> {
  // Ensure parent directory exists
  mkdirSync(path.dirname(linkPath), { recursive: true });

  // Remove existing symlink/file if present
  if (exists(linkPath)) {
    const { rmSync } = await import('node:fs');
    rmSync(linkPath, { recursive: true, force: true });
  }

  const isWin = platform() === 'win32';
  const targetIsDir = isDirectory(target);

  try {
    if (isWin && targetIsDir) {
      // Try junction on Windows for directories
      symlinkSync(target, linkPath, 'junction');
    } else {
      // Standard symlink
      symlinkSync(target, linkPath, targetIsDir ? 'dir' : 'file');
    }
  } catch (error) {
    // If symlink fails on Windows, fall back to copying. Symlinks can require
    // privileges or developer mode. Cover common error codes.
    const err = error as NodeJS.ErrnoException;
    const code = err?.code;
    if (
      isWin &&
      (code === 'EPERM' ||
        code === 'EACCES' ||
        code === 'EINVAL' ||
        code === 'ENOSYS' ||
        code === 'UNKNOWN')
    ) {
      console.warn(`Symlink failed, falling back to copy: ${linkPath}`);
      await copyRecursive(target, linkPath);
    } else {
      throw err ?? error;
    }
  }
}

/**
 * Copy files/directories recursively (fallback for Windows)
 */
export async function copyRecursive(source: string, dest: string): Promise<void> {
  const { cpSync } = await import('node:fs');

  cpSync(source, dest, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
  });
}

/**
 * Ensure a directory exists
 */
export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

/**
 * Remove a file or directory
 */
export async function remove(p: string): Promise<void> {
  if (!exists(p)) {
    return;
  }

  const { rmSync } = await import('node:fs');
  rmSync(p, { recursive: true, force: true });
}

/**
 * Get file size in bytes
 */
export function getFileSize(p: string): number {
  try {
    return lstatSync(p).size;
  } catch {
    return 0;
  }
}

/**
 * Get modification time
 */
export function getModTime(p: string): Date | null {
  try {
    return lstatSync(p).mtime;
  } catch {
    return null;
  }
}

/**
 * Normalize path separators for current platform
 */
export function normalizePath(p: string): string {
  const isWin = platform() === 'win32';
  return isWin ? p.split('/').join('\\') : p.split('\\').join('/');
}

/**
 * Join paths and normalize
 */
export function joinPath(...parts: string[]): string {
  return normalizePath(path.join(...parts));
}
