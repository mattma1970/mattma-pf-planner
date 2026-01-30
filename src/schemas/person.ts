import { z } from 'zod';

export const PersonColorSchema = z.enum([
  'indigo',
  'blue',
  'emerald',
  'amber',
  'rose',
  'purple',
  'cyan',
  'orange',
]);
export type PersonColor = z.infer<typeof PersonColorSchema>;

export const PersonSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  birthYear: z.number().int(),
  retirementYear: z.number().int().optional(),
  preservationAge: z.number().int().optional(),
  color: PersonColorSchema.optional(),
});
export type Person = z.infer<typeof PersonSchema>;
