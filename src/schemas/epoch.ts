import { z } from 'zod';

export const EpochConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('age'), personId: z.string(), age: z.number() }),
  z.object({ type: z.literal('year'), year: z.number() }),
  z.object({ type: z.literal('previousEpochEnd') }),
]);
export type EpochCondition = z.infer<typeof EpochConditionSchema>;

export const EpochSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  startCondition: EpochConditionSchema,
  endCondition: EpochConditionSchema,
  order: z.number().int(),
});
export type Epoch = z.infer<typeof EpochSchema>;
