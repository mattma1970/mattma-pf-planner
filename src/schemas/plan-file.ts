import { z } from 'zod';
import { AccountSchema } from './account';
import { PersonSchema } from './person';
import { EventSchema } from './event';
import { EpochSchema } from './epoch';
import { AssumptionsSchema } from './assumption';
import { SettingsSchema } from './settings';

// Current schema version - increment when making breaking changes
export const CURRENT_PLAN_VERSION = 1;

// Plan file metadata
export const PlanFileMetadataSchema = z.object({
  version: z.number().int().positive(),
  exportedAt: z.string().datetime(),
  appVersion: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
});
export type PlanFileMetadata = z.infer<typeof PlanFileMetadataSchema>;

// Complete plan data (version 1)
export const PlanDataV1Schema = z.object({
  persons: z.array(PersonSchema),
  accounts: z.array(AccountSchema),
  events: z.array(EventSchema),
  epochs: z.array(EpochSchema),
  assumptions: AssumptionsSchema,
  settings: SettingsSchema,
});
export type PlanDataV1 = z.infer<typeof PlanDataV1Schema>;

// Current plan data type (alias to latest version)
export type PlanData = PlanDataV1;
export const PlanDataSchema = PlanDataV1Schema;

// Complete plan file (metadata + data)
export const PlanFileSchema = z.object({
  metadata: PlanFileMetadataSchema,
  data: PlanDataSchema,
});
export type PlanFile = z.infer<typeof PlanFileSchema>;

// For parsing files with unknown versions (before migration)
export const PlanFileLooseSchema = z.object({
  metadata: z.object({
    version: z.number().int().positive(),
  }).passthrough(),
  data: z.record(z.string(), z.unknown()),
});
export type PlanFileLoose = z.infer<typeof PlanFileLooseSchema>;
