import { z } from 'zod';

/**
 * Zod schema for validating package names in @owner/package-name format.
 * Enforces lowercase alphanumeric characters, hyphens, and underscores only.
 */
export const PackageNameSchema = z
  .string()
  .regex(/^@[\d_a-z-]+\/[\d_a-z-]+$/, 'Package name must be in format @owner/package-name');

/**
 * Type representing a validated package name
 */
export type PackageName = z.infer<typeof PackageNameSchema>;
