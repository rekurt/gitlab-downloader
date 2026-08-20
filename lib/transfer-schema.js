import { z } from 'zod';

const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', {
    message: 'GitLab platform transfer requires HTTPS',
  })
  .refine((value) => {
    const parsed = new URL(value);
    return !parsed.username && !parsed.password;
  }, {
    message: 'GitLab URLs must not contain embedded credentials',
  })
  .refine((value) => {
    const parsed = new URL(value);
    return !parsed.search && !parsed.hash;
  }, {
    message: 'GitLab URLs must not contain a query or fragment',
  })
  .transform((value) => value.replace(/\/+$/, ''));

export const TransferConnectionSchema = z
  .object({
    url: HttpsUrlSchema,
    token: z.string().min(1),
  })
  .strict();

export const TransferEntityModeSchema = z.enum([
  'direct_transfer',
  'git_sync',
  'git_only_fallback',
  'blocked',
]);

export const TransferEventSchema = z
  .object({
    runId: z.string().min(1),
    entityId: z.string().min(1).nullable(),
    phase: z.enum([
      'preflight',
      'planning',
      'direct_transfer',
      'fallback',
      'git_sync',
      'history_rewrite',
      'complete',
    ]),
    status: z.enum([
      'started',
      'running',
      'finished',
      'partial',
      'failed',
      'canceled',
      'blocked',
    ]),
    progress: z.number().min(0).max(1),
    message: z.string(),
  })
  .strict();

export const TransferEntityPlanSchema = z
  .object({
    id: z.string().min(1),
    sourceType: z.enum(['group', 'project']),
    sourceFullPath: z.string().min(1),
    destinationFullPath: z.string().min(1),
    destinationNamespace: z.string(),
    destinationSlug: z.string().min(1),
    mode: TransferEntityModeSchema,
    reason: z.string().min(1),
  })
  .strict();

export const TransferPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    createdAt: z.string().datetime(),
    source: z
      .object({
        url: HttpsUrlSchema,
        version: z.string().min(1),
        fullPath: z.string().min(1),
        type: z.enum(['group', 'project']),
      })
      .strict(),
    destination: z
      .object({
        url: HttpsUrlSchema,
        version: z.string().min(1),
        namespace: z.string(),
      })
      .strict(),
    entities: z.array(TransferEntityPlanSchema),
    warnings: z.array(z.string()),
  })
  .strict();

function versionOrdinal(version) {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?(?:[-+].*)?$/.exec(String(version));
  if (!match) return null;
  return Number(match[1]) * 12 + Number(match[2]);
}

export function isDirectTransferCompatible(sourceVersion, destinationVersion) {
  const source = versionOrdinal(sourceVersion);
  const destination = versionOrdinal(destinationVersion);
  const minimum = versionOrdinal('16.8');
  if (source === null || destination === null) return false;
  if (source < minimum || destination < minimum) return false;
  return source <= destination && destination - source <= 2;
}
