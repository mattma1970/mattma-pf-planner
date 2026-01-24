import { z } from 'zod';

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
});
export type Event = z.infer<typeof EventSchema>;
