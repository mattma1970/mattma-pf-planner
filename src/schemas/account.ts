import { z } from 'zod';
import { TaxClassificationSchema } from './tax';

export const AccountTypeSchema = z.enum(['income', 'expense', 'asset', 'liability']);
export type AccountType = z.infer<typeof AccountTypeSchema>;

// Account category - distinguishes standard financial accounts from tax/off-balance sheet trackers
export const AccountCategorySchema = z.enum([
  'standard',           // Normal financial accounts (bank, super, shares, etc.)
  'taxCap',             // Tax cap trackers (non-concessional cap, franking credits)
  'taxCarryForward',    // Carry-forward trackers (concessional carry-forward)
  'taxLoss',            // Income tax loss carry-forward (future)
  'capitalLoss',        // Capital loss carry-forward (future)
  'hecsDebt',           // HECS/HELP debt tracking (future)
  'cgtDiscountTracker', // CGT discount tracking (future)
]);
export type AccountCategory = z.infer<typeof AccountCategorySchema>;

// Special configuration for tax/off-balance sheet accounts
export const ConcessionalCarryForwardConfigSchema = z.object({
  kind: z.literal('concessionalCarryForward'),
  // Per-year buckets of unused cap (oldest first, for FIFO consumption)
  buckets: z.array(z.object({
    year: z.number().int(),
    amount: z.number(),
  })).default([]),
  // Override global carry-forward years if needed
  carryForwardYears: z.number().int().optional(),
});
export type ConcessionalCarryForwardConfig = z.infer<typeof ConcessionalCarryForwardConfigSchema>;

export const NonConcessionalCapConfigSchema = z.object({
  kind: z.literal('nonConcessionalCap'),
  // Prior year's closing balance (determines bring-forward availability)
  priorClosingBalance: z.number().default(0),
});
export type NonConcessionalCapConfig = z.infer<typeof NonConcessionalCapConfigSchema>;

export const FrankingCreditsConfigSchema = z.object({
  kind: z.literal('frankingCredits'),
  // No special config needed for now - just tracks accumulated franking credits
});
export type FrankingCreditsConfig = z.infer<typeof FrankingCreditsConfigSchema>;

// Discriminated union for category-specific configuration
export const SpecialConfigSchema = z.discriminatedUnion('kind', [
  ConcessionalCarryForwardConfigSchema,
  NonConcessionalCapConfigSchema,
  FrankingCreditsConfigSchema,
]);
export type SpecialConfig = z.infer<typeof SpecialConfigSchema>;

export const AssetSubTypeSchema = z.enum(['generic', 'superannuation', 'allocatedPension']);
export type AssetSubType = z.infer<typeof AssetSubTypeSchema>;

export const IncomeSubTypeSchema = z.enum(['salary', 'business', 'investment', 'other']);
export type IncomeSubType = z.infer<typeof IncomeSubTypeSchema>;

export const SuperPhaseSchema = z.enum(['accumulation', 'pension']);
export type SuperPhase = z.infer<typeof SuperPhaseSchema>;

export const SuperAccountConfigSchema = z.object({
  preservationYear: z.number().int().optional(), // Year when preservation age is reached
});
export type SuperAccountConfig = z.infer<typeof SuperAccountConfigSchema>;

// Super contribution configuration for income accounts that generate super contributions
// When an income account has this config, its calculated value flows to the target super account
export const IncomeAsSuperContributionConfigSchema = z.object({
  targetSuperAccountId: z.string().uuid(),
  contributionType: z.enum(['concessional', 'nonConcessional', 'capExempt']),
  source: z.enum(['employerSG', 'employerAdditional', 'salarySacrifice', 'personal', 'spouseContribution', 'governmentCoContribution', 'downsizer']),
  reducesAssessableIncome: z.boolean().default(false),
});
export type IncomeAsSuperContributionConfig = z.infer<typeof IncomeAsSuperContributionConfigSchema>;

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

export const EndBehaviorSchema = z.enum(['zero', 'transfer', 'hold', 'sell', 'sellNoCgt']);
export type EndBehavior = z.infer<typeof EndBehaviorSchema>;

export const IncomeTaxTreatmentSchema = z.enum(['taxable', 'taxFree']);
export type IncomeTaxTreatment = z.infer<typeof IncomeTaxTreatmentSchema>;

export const LiquidityTypeSchema = z.enum(['liquid', 'fixed']);
export type LiquidityType = z.infer<typeof LiquidityTypeSchema>;

export const AutoTopupSchema = z.object({
  enabled: z.boolean().default(false),
  threshold: z.number().default(0),
  // Multiple source accounts - drawn from in order until exhausted, then moves to next
  fromAccountIds: z.array(z.string().uuid()).min(1),
  targetBalance: z.number().optional(),
});
export type AutoTopup = z.infer<typeof AutoTopupSchema>;

export const LiabilityPaymentTypeSchema = z.enum(['principalAndInterest', 'interestOnly']);
export type LiabilityPaymentType = z.infer<typeof LiabilityPaymentTypeSchema>;

export const AccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: AccountTypeSchema,
  
  // Category for distinguishing standard accounts from tax/off-balance sheet trackers
  category: AccountCategorySchema.optional().default('standard'),
  
  // Whether this account's balance contributes to net worth calculations
  // Set to false for tax cap/carry-forward accounts
  includeInNetWorth: z.boolean().optional().default(true),
  
  // Category-specific configuration (for tax/off-balance sheet accounts)
  specialConfig: SpecialConfigSchema.optional(),
  
  assetSubType: AssetSubTypeSchema.optional(),
  superConfig: SuperAccountConfigSchema.optional(),
  owner: z.string().optional(),
  initialValue: z.number(),
  growthProfile: GrowthProfileSchema,
  returnRate: z.number().optional(),
  frankingPercentage: z.number().optional(), // Percentage of return that is franked (0-1, e.g., 1.0 = fully franked)
  returnBalanceMethod: z.enum(['opening', 'closing', 'average']).optional(), // Balance method for return calculation
  returnTaxTreatment: z.enum(['asIncome', 'taxFree']).optional(), // Tax treatment for returns (for pension accounts)
  incomeTargetAccountId: z.string().uuid().optional(),
  // For allocated pensions: separate target for mandatory drawdowns (falls back to incomeTargetAccountId)
  drawdownTargetAccountId: z.string().uuid().optional(),
  // Scale factor applied to the minimum drawdown rate (1.0 = minimum required, 1.5 = 150% of minimum, etc.)
  drawdownScale: z.number().min(0).optional(),
  startCondition: AccountConditionSchema.optional(),
  endCondition: AccountConditionSchema.optional(),
  endBehavior: EndBehaviorSchema.optional(),
  transferToAccountId: z.string().uuid().optional(),
  depositsToAccountId: z.string().uuid().optional(),
  drawnFromAccountId: z.string().uuid().optional(), // For pension/drawdown income accounts: debits this asset when income is drawn
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
  // Note: All income/expense accounts are implicitly "pass-through" - opening balance is always 0
  // Growth is calculated based on prior year's inflows, not carried-forward balance
  incomeSubType: IncomeSubTypeSchema.optional(), // Type of income (salary, business, investment, other)
  
  // Derived account fields (for both income and expense accounts)
  // When set, this account's value is calculated as a percentage of the reference account
  basedOnAccountId: z.string().uuid().optional(), // Calculate value as % of this account's inflows/balance
  basedOnPercentage: z.number().optional(), // Percentage of reference account (0.115 = 11.5%)
  
  // Super contribution config for derived income accounts (e.g., employer SG)
  // When set, this income account's calculated value flows to the target super account as a contribution
  superContributionConfig: IncomeAsSuperContributionConfigSchema.optional(),
  
  // Expense-specific fields
  occursEveryYears: z.number().int().positive().optional(), // Expense only incurs every X years
  
  // Liability-specific fields
  interestRate: z.number().optional(), // Annual interest rate as decimal (0.065 for 6.5%)
  interestBalanceMethod: z.enum(['opening', 'closing', 'average']).optional(), // Balance method for interest calculation
  paymentType: LiabilityPaymentTypeSchema.optional(),
  annualPayment: z.number().optional(), // Fixed annual payment amount
  calculatePayment: z.boolean().optional(), // Auto-calculate payment to pay off by end date
  offsetAccountId: z.string().uuid().optional(), // Asset account that offsets interest calculation
  payoffFromAccountId: z.string().uuid().optional(), // Pay off when this asset sells
});
export type Account = z.infer<typeof AccountSchema>;

// Input type for creating/updating accounts - allows optional fields that have defaults
export type AccountInput = z.input<typeof AccountSchema>;
