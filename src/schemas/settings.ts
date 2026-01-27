import { z } from 'zod';
import { SuperContributionTypeSchema, SuperContributionSourceSchema } from './event';

export const GrowthCalculationMethodSchema = z.enum(['openingBalance', 'averageBalance']);
export type GrowthCalculationMethod = z.infer<typeof GrowthCalculationMethodSchema>;

// Configuration for each super contribution source
export const SuperContributionSourceConfigSchema = z.object({
  source: SuperContributionSourceSchema,
  label: z.string(),
  defaultContributionType: SuperContributionTypeSchema,
  defaultReducesAssessableIncome: z.boolean(),
});
export type SuperContributionSourceConfig = z.infer<typeof SuperContributionSourceConfigSchema>;

// Default configurations for each source
export const defaultSourceConfigs: SuperContributionSourceConfig[] = [
  { source: 'employerSG', label: 'Employer SG (mandatory)', defaultContributionType: 'concessional', defaultReducesAssessableIncome: false },
  { source: 'employerAdditional', label: 'Employer Additional', defaultContributionType: 'concessional', defaultReducesAssessableIncome: false },
  { source: 'salarySacrifice', label: 'Salary Sacrifice', defaultContributionType: 'concessional', defaultReducesAssessableIncome: true },
  { source: 'personalDeductible', label: 'Personal (tax deductible)', defaultContributionType: 'concessional', defaultReducesAssessableIncome: true },
  { source: 'personalAfterTax', label: 'Personal (after-tax)', defaultContributionType: 'nonConcessional', defaultReducesAssessableIncome: false },
  { source: 'spouseContribution', label: 'Spouse Contribution', defaultContributionType: 'nonConcessional', defaultReducesAssessableIncome: false },
  { source: 'governmentCoContribution', label: 'Government Co-contribution', defaultContributionType: 'capExempt', defaultReducesAssessableIncome: false },
  { source: 'downsizer', label: 'Downsizer Contribution', defaultContributionType: 'capExempt', defaultReducesAssessableIncome: false },
];

// Superannuation settings
export const SuperSettingsSchema = z.object({
  preservationAge: z.number().int().default(67),
  concessionalCap: z.number().default(30000),
  nonConcessionalCap: z.number().default(120000),
  carryForwardYears: z.number().int().default(5),
  contributionsTaxRate: z.number().default(0.15),
  div293Threshold: z.number().default(250000),
  div293Rate: z.number().default(0.15),
  sourceConfigs: z.array(SuperContributionSourceConfigSchema).optional(),
});
export type SuperSettings = z.infer<typeof SuperSettingsSchema>;

export const defaultSuperSettings: SuperSettings = {
  preservationAge: 67,
  concessionalCap: 30000,
  nonConcessionalCap: 120000,
  carryForwardYears: 5,
  contributionsTaxRate: 0.15,
  div293Threshold: 250000,
  div293Rate: 0.15,
};

export const SettingsSchema = z.object({
  eventHighlightColor: z.string().default('#bfdbfe'),
  defaultTaxFundingAccountId: z.string().uuid().optional(),
  defaultBankAccountId: z.string().uuid().optional(), // Default account for income deposits, expense funding, etc.
  growthCalculationMethod: GrowthCalculationMethodSchema.default('openingBalance'),
  super: SuperSettingsSchema.default(defaultSuperSettings),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings: Settings = {
  eventHighlightColor: '#bfdbfe',
  defaultTaxFundingAccountId: undefined,
  defaultBankAccountId: undefined,
  growthCalculationMethod: 'openingBalance',
  super: defaultSuperSettings,
};
