import { z } from 'zod';
import { TaxClassificationSchema, EventTaxTreatmentTypeSchema } from './tax';

export const EventTypeSchema = z.enum(['income', 'expense', 'assetChange', 'liabilityChange', 'transfer']);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventSchema = z.object({
  id: z.string().uuid(),
  year: z.number().int(),
  type: EventTypeSchema,
  description: z.string(),
  amount: z.number(),
  affectedAccountId: z.string().uuid().optional(),
  sourceAccountId: z.string().uuid().optional(),
  targetAccountId: z.string().uuid().optional(),
  transferAll: z.boolean().optional(),
  
  // Tax treatment for this event
  taxTreatmentType: EventTaxTreatmentTypeSchema.optional(),
  
  // Advanced tax classification (discriminated union, for future use)
  taxClassification: TaxClassificationSchema.optional(),
  
  // Which account pays any tax from this event
  taxFundedFromAccountId: z.string().uuid().optional(),
  
  // CGT fields for capital gain events
  costBase: z.number().optional(),
  acquisitionYear: z.number().int().optional(),
});
export type Event = z.infer<typeof EventSchema>;
