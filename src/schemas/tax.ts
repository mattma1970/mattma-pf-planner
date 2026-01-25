import { z } from 'zod';

export const TaxEventTypeSchema = z.enum([
  'incomeTax',
  'capitalGainsTax',
  'superContributionTax',
]);
export type TaxEventType = z.infer<typeof TaxEventTypeSchema>;

export const TaxScheduleSchema = z.enum(['marginalRates', 'flatRate15']);
export type TaxSchedule = z.infer<typeof TaxScheduleSchema>;

export const TaxEventSchema = z.object({
  id: z.string().uuid(),
  year: z.number().int(),
  type: TaxEventTypeSchema,
  description: z.string(),
  sourceAccountId: z.string().uuid().optional(),
  sourceAccountName: z.string().optional(),
  assessableAmount: z.number(),
  fundedFromAccountId: z.string(),
  fundedFromAccountName: z.string().optional(),
});
export type TaxEvent = z.infer<typeof TaxEventSchema>;

export const TaxAggregationSchema = z.object({
  fundedFromAccountId: z.string(),
  fundedFromAccountName: z.string(),
  taxSchedule: TaxScheduleSchema,
  totalAssessable: z.number(),
  calculatedTax: z.number(),
});
export type TaxAggregation = z.infer<typeof TaxAggregationSchema>;

export const TaxEventsByYearSchema = z.record(z.string(), z.array(TaxEventSchema));
export type TaxEventsByYear = z.infer<typeof TaxEventsByYearSchema>;
