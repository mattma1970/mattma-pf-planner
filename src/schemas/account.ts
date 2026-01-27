import { z } from 'zod';
import { TaxClassificationSchema } from './tax';

export const AccountTypeSchema = z.enum(['income', 'expense', 'asset', 'liability']);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const AssetSubTypeSchema = z.enum(['generic', 'superannuation']);
export type AssetSubType = z.infer<typeof AssetSubTypeSchema>;

export const SuperPhaseSchema = z.enum(['accumulation', 'pension']);
export type SuperPhase = z.infer<typeof SuperPhaseSchema>;

export const SuperAccountConfigSchema = z.object({
  phase: SuperPhaseSchema,
  preservationYear: z.number().int().optional(), // Year when preservation age is reached
});
export type SuperAccountConfig = z.infer<typeof SuperAccountConfigSchema>;

export const GrowthOperationSchema = z.enum(['add', 'subtract', 'multiply']);
export type GrowthOperation = z.infer<typeof GrowthOperationSchema>;

export const GrowthProfileSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixed'), rate: z.number() }),
  z.object({ 
    type: z.literal('cpiLinked'), 
    operation: GrowthOperationSchema.default('add'),
    value: z.number().default(0),
  }),
  z.object({ type: z.literal('increasing'), rate: z.number(), changePerYear: z.number().default(0.005) }),
  z.object({ type: z.literal('decreasing'), rate: z.number(), changePerYear: z.number().default(0.005) }),
]);
export type GrowthProfile = z.infer<typeof GrowthProfileSchema>;

export const AccountConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('year'), year: z.number().int() }),
  z.object({ type: z.literal('age'), personId: z.string(), age: z.number().int() }),
]);
export type AccountCondition = z.infer<typeof AccountConditionSchema>;

export const EndBehaviorSchema = z.enum(['zero', 'transfer', 'hold', 'sell']);
export type EndBehavior = z.infer<typeof EndBehaviorSchema>;

export const IncomeTaxTreatmentSchema = z.enum(['taxable', 'taxFree']);
export type IncomeTaxTreatment = z.infer<typeof IncomeTaxTreatmentSchema>;

export const LiquidityTypeSchema = z.enum(['liquid', 'fixed']);
export type LiquidityType = z.infer<typeof LiquidityTypeSchema>;

export const AutoTopupSchema = z.object({
  enabled: z.boolean().default(false),
  threshold: z.number().default(0),
  fromAccountId: z.string().uuid(),
  targetBalance: z.number().optional(),
});
export type AutoTopup = z.infer<typeof AutoTopupSchema>;

export const LiabilityPaymentTypeSchema = z.enum(['principalAndInterest', 'interestOnly']);
export type LiabilityPaymentType = z.infer<typeof LiabilityPaymentTypeSchema>;

export const AccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: AccountTypeSchema,
  assetSubType: AssetSubTypeSchema.optional(),
  superConfig: SuperAccountConfigSchema.optional(),
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
  
  // Legacy tax treatment (deprecated - use taxClassification instead)
  incomeTaxTreatment: IncomeTaxTreatmentSchema.optional(),
  
  // New tax classification (discriminated union)
  taxClassification: TaxClassificationSchema.optional(),
  
  // CGT fields for assets with endBehavior: 'sell'
  costBase: z.number().optional(),
  acquisitionYear: z.number().int().optional(),
  eligibleForCgtDiscount: z.boolean().optional(),
  
  taxFundedFromAccountId: z.string().uuid().optional(),
  
  // Auto-topup: automatically transfer from another account when balance falls below threshold
  autoTopup: AutoTopupSchema.optional(),
  
  // Income-specific fields
  passThrough: z.boolean().optional(), // If true, balance doesn't carry forward (e.g., dividends)
  
  // Expense-specific fields
  basedOnAccountId: z.string().uuid().optional(), // Calculate expense as % of this account's balance
  basedOnPercentage: z.number().optional(), // Percentage of reference account (0.005 = 0.5%)
  occursEveryYears: z.number().int().positive().optional(), // Expense only incurs every X years
  
  // Liability-specific fields
  interestRate: z.number().optional(), // Annual interest rate as decimal (0.065 for 6.5%)
  paymentType: LiabilityPaymentTypeSchema.optional(),
  annualPayment: z.number().optional(), // Fixed annual payment amount
  calculatePayment: z.boolean().optional(), // Auto-calculate payment to pay off by end date
  offsetAccountId: z.string().uuid().optional(), // Asset account that offsets interest calculation
  payoffFromAccountId: z.string().uuid().optional(), // Pay off when this asset sells
});
export type Account = z.infer<typeof AccountSchema>;
