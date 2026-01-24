import { z } from 'zod';

export const AccountTypeSchema = z.enum(['income', 'expense', 'asset', 'liability']);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const GrowthProfileSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixed'), rate: z.number() }),
  z.object({ type: z.literal('cpiLinked'), offset: z.number().default(0) }),
  z.object({ type: z.literal('increasing'), rate: z.number(), changePerYear: z.number().default(0.005) }),
  z.object({ type: z.literal('decreasing'), rate: z.number(), changePerYear: z.number().default(0.005) }),
]);
export type GrowthProfile = z.infer<typeof GrowthProfileSchema>;

export const AccountConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('year'), year: z.number().int() }),
  z.object({ type: z.literal('age'), personId: z.string(), age: z.number().int() }),
]);
export type AccountCondition = z.infer<typeof AccountConditionSchema>;

export const EndBehaviorSchema = z.enum(['zero', 'transfer', 'hold']);
export type EndBehavior = z.infer<typeof EndBehaviorSchema>;

export const LiquidityTypeSchema = z.enum(['liquid', 'fixed']);
export type LiquidityType = z.infer<typeof LiquidityTypeSchema>;

export const AccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: AccountTypeSchema,
  owner: z.string().optional(),
  initialValue: z.number(),
  growthProfile: GrowthProfileSchema,
  returnRate: z.number().optional(),
  incomeTargetAccountId: z.string().uuid().optional(),
  startCondition: AccountConditionSchema.optional(),
  endCondition: AccountConditionSchema.optional(),
  endBehavior: EndBehaviorSchema.optional(),
  transferToAccountId: z.string().uuid().optional(),
  depositsToAccountId: z.string().uuid().optional(),
  fundedByAccountId: z.string().uuid().optional(),
  order: z.number().int().optional(),
  liquidityType: LiquidityTypeSchema.optional(),
});
export type Account = z.infer<typeof AccountSchema>;
