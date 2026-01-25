import { z } from 'zod';

export const TaxEventTypeSchema = z.enum([
  'incomeTax',
  'capitalGainsTax',
  'superContributionTax',
]);
export type TaxEventType = z.infer<typeof TaxEventTypeSchema>;

export const TaxEventSchema = z.object({
  id: z.string().uuid(),
  year: z.number().int(),
  type: TaxEventTypeSchema,
  description: z.string(),
  sourceAccountId: z.string().uuid().optional(),
  sourceAccountName: z.string().optional(),
  amount: z.number(),
  fundedFromAccountId: z.string().uuid(),
  fundedFromAccountName: z.string().optional(),
});
export type TaxEvent = z.infer<typeof TaxEventSchema>;

export const TaxEventsByYearSchema = z.record(z.string(), z.array(TaxEventSchema));
export type TaxEventsByYear = z.infer<typeof TaxEventsByYearSchema>;
