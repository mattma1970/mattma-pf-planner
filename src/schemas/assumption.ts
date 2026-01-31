import { z } from 'zod';

export const AssumptionProfileSchema = z.object({
  baseValue: z.number(),
  formula: z.string().optional(),
  overrides: z.record(z.coerce.number(), z.number()).optional(),
});
export type AssumptionProfile = z.infer<typeof AssumptionProfileSchema>;

export const AssumptionsSchema = z.object({
  id: z.string().optional(),
  cpi: AssumptionProfileSchema,
  startYear: z.number().int().optional(),
  endYear: z.number().int().optional(),
});
export type Assumptions = z.infer<typeof AssumptionsSchema>;
