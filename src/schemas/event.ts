import { z } from 'zod';
import { TaxClassificationSchema, EventTaxTreatmentTypeSchema } from './tax';

export const EventTypeSchema = z.enum(['income', 'expense', 'assetChange', 'liabilityChange', 'transfer', 'superContribution']);
export type EventType = z.infer<typeof EventTypeSchema>;

// Super contribution types
export const SuperContributionTypeSchema = z.enum([
  'concessional',
  'nonConcessional',
  'capExempt',
]);
export type SuperContributionType = z.infer<typeof SuperContributionTypeSchema>;

// Super contribution source (for tracking and tax purposes)
export const SuperContributionSourceSchema = z.enum([
  'employerSG',           // Employer Super Guarantee (mandatory)
  'employerAdditional',   // Employer contributions above SG
  'salarySacrifice',      // Pre-tax salary sacrifice
  'personalDeductible',   // Personal contributions claiming tax deduction
  'personalAfterTax',     // Personal after-tax contributions (non-concessional)
  'spouseContribution',   // Contributions from spouse
  'governmentCoContribution', // Government co-contribution
  'downsizer',            // Downsizer contribution (from home sale, cap-exempt)
]);
export type SuperContributionSource = z.infer<typeof SuperContributionSourceSchema>;

// Super contribution configuration for events
export const SuperContributionConfigSchema = z.object({
  contributionType: SuperContributionTypeSchema,
  source: SuperContributionSourceSchema,
  memberPersonId: z.string(), // Person receiving the contribution
  reducesAssessableIncome: z.boolean().default(false), // For salary sacrifice / personal deductible
  exemptFromCap: z.boolean().optional(), // Legacy field - now derived from contributionType === 'capExempt'
});
export type SuperContributionConfig = z.infer<typeof SuperContributionConfigSchema>;

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
  
  // Person this event applies to (for tax attribution)
  personId: z.string().uuid().optional(),
  
  // Tax treatment for this event
  taxTreatmentType: EventTaxTreatmentTypeSchema.optional(),
  
  // Advanced tax classification (discriminated union, for future use)
  taxClassification: TaxClassificationSchema.optional(),
  
  // Which account pays any tax from this event
  taxFundedFromAccountId: z.string().uuid().optional(),
  
  // CGT fields for capital gain events
  costBase: z.number().optional(),
  acquisitionYear: z.number().int().optional(),
  
  // Super contribution fields (for type: 'superContribution')
  superContribution: SuperContributionConfigSchema.optional(),
});
export type Event = z.infer<typeof EventSchema>;
