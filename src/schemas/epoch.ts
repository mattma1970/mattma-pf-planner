import { z } from 'zod';

export const EpochGlobalAssumptionsSchema = z.object({
  cpi: z.number().optional(),
});
export type EpochGlobalAssumptions = z.infer<typeof EpochGlobalAssumptionsSchema>;

export const EpochAccountAssumptionSchema = z.object({
  growthRate: z.number().optional(),
  returnRate: z.number().optional(),
});
export type EpochAccountAssumption = z.infer<typeof EpochAccountAssumptionSchema>;

export const EpochSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  startYear: z.number().int(),
  endYear: z.number().int(),
  order: z.number().int(),
  color: z.string().optional(),
  globalAssumptions: EpochGlobalAssumptionsSchema.optional(),
  accountAssumptions: z.record(z.string(), EpochAccountAssumptionSchema).optional(),
});
export type Epoch = z.infer<typeof EpochSchema>;

export const DEFAULT_EPOCH_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
];
