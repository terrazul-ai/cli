import { z } from 'zod';

export const seaManifestTargetSchema = z.object({
  url: z.string().url(),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[\dA-Fa-f]{64}$/),
});

export const seaManifestSchema = z.object({
  schemaVersion: z.literal(1),
  cliVersion: z.string().min(1),
  cdn: z.object({
    baseUrl: z.string().url(),
  }),
  targets: z.record(seaManifestTargetSchema),
  signatures: z
    .array(
      z.object({
        type: z.string().min(1),
        value: z.string().min(1),
      }),
    )
    .optional(),
});

export type SeaManifest = z.infer<typeof seaManifestSchema>;
export type SeaManifestTarget = z.infer<typeof seaManifestTargetSchema>;
