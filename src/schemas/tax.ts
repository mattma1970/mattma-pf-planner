import { z } from 'zod';

// ============================================
// Tax Classifications (per account/event)
// ============================================

// Income classifications
export const AssessableIncomeClassificationSchema = z.object({
  kind: z.literal('assessableIncome'),
  assessableProportion: z.number().min(0).max(1).default(1),
});

export const TaxFreeIncomeClassificationSchema = z.object({
  kind: z.literal('taxFreeIncome'),
  reason: z.enum(['pension', 'other']),
});

export const NoTaxClassificationSchema = z.object({
  kind: z.literal('none'),
});

// Capital gains classifications
export const CapitalGainAssetClassificationSchema = z.object({
  kind: z.literal('capitalGainAsset'),
  eligibleForDiscount: z.boolean().default(true),
});

export const CapitalGainRealisationClassificationSchema = z.object({
  kind: z.literal('capitalGainRealisation'),
  costBase: z.number(),
  acquisitionYear: z.number().int(),
  assetAccountId: z.string().uuid().optional(),
});

// Superannuation classifications
export const SuperContributionClassificationSchema = z.object({
  kind: z.literal('superContribution'),
  contributionType: z.enum(['concessional', 'nonConcessional']),
  source: z.enum(['employer', 'salarySacrifice', 'personalDeductible', 'personalNonDeductible']),
  countsTowardsConcessionalCap: z.boolean().default(true),
  deductibleAgainstIncome: z.boolean().default(false),
});

export const SuperAccumulationEarningsClassificationSchema = z.object({
  kind: z.literal('superAccumulationEarnings'),
  earningsTaxRate: z.number().default(0.15),
  capitalGainsEffectiveRate: z.number().default(0.10),
});
export type SuperAccumulationEarningsClassification = z.infer<typeof SuperAccumulationEarningsClassificationSchema>;

export const SuperPensionEarningsClassificationSchema = z.object({
  kind: z.literal('superPensionEarnings'),
  earningsTaxRate: z.number().default(0),
  capitalGainsEffectiveRate: z.number().default(0),
});
export type SuperPensionEarningsClassification = z.infer<typeof SuperPensionEarningsClassificationSchema>;

// Union of all tax classifications
export const TaxClassificationSchema = z.discriminatedUnion('kind', [
  NoTaxClassificationSchema,
  AssessableIncomeClassificationSchema,
  TaxFreeIncomeClassificationSchema,
  CapitalGainAssetClassificationSchema,
  CapitalGainRealisationClassificationSchema,
  SuperContributionClassificationSchema,
  SuperAccumulationEarningsClassificationSchema,
  SuperPensionEarningsClassificationSchema,
]);
export type TaxClassification = z.infer<typeof TaxClassificationSchema>;

// ============================================
// Tax Event Types
// ============================================

export const TaxEventTypeSchema = z.enum([
  'incomeTax',
  'capitalGainsTax',
  'superContributionTax',
  'taxDeduction',
  'division293Tax',
  'frankingCreditOffset',
]);
export type TaxEventType = z.infer<typeof TaxEventTypeSchema>;

// Event-specific tax treatments
// Note: superContribution events have their own event type with built-in tax handling
// Note: CGT is handled via account endBehavior: 'sell', not via events
export const EventTaxTreatmentTypeSchema = z.enum([
  'none',
  'taxable',
  'taxDeduction',
]);
export type EventTaxTreatmentType = z.infer<typeof EventTaxTreatmentTypeSchema>;

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
  personId: z.string().optional(),
  personName: z.string().optional(),
  
  // CGT-specific fields
  grossCapitalGain: z.number().optional(),
  discountApplied: z.boolean().optional(),
  costBase: z.number().optional(),
  saleProceeds: z.number().optional(),
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

export const TaxByPersonSchema = z.object({
  personId: z.string(),
  personName: z.string(),
  totalAssessable: z.number(),
  calculatedTax: z.number(),
});
export type TaxByPerson = z.infer<typeof TaxByPersonSchema>;

export const TaxEventsByYearSchema = z.record(z.string(), z.array(TaxEventSchema));
export type TaxEventsByYear = z.infer<typeof TaxEventsByYearSchema>;
