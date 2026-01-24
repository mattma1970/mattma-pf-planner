import { z } from 'zod';

export const PersonSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  birthYear: z.number().int(),
  retirementYear: z.number().int().optional(),
  preservationAge: z.number().int().optional(),
});
export type Person = z.infer<typeof PersonSchema>;
