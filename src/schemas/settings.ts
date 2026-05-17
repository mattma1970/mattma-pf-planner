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
  { source: 'personal', label: 'Personal', defaultContributionType: 'concessional', defaultReducesAssessableIncome: true },
  { source: 'spouseContribution', label: 'Spouse Contribution', defaultContributionType: 'nonConcessional', defaultReducesAssessableIncome: false },
  { source: 'governmentCoContribution', label: 'Government Co-contribution', defaultContributionType: 'capExempt', defaultReducesAssessableIncome: false },
  { source: 'downsizer', label: 'Downsizer Contribution', defaultContributionType: 'capExempt', defaultReducesAssessableIncome: false },
];

// Minimum drawdown rates for allocated pensions (percentage by age)
export const MinimumDrawdownRatesSchema = z.object({
  under65: z.number().default(0.04),
  '65-74': z.number().default(0.05),
  '75-79': z.number().default(0.06),
  '80-84': z.number().default(0.07),
  '85-89': z.number().default(0.09),
  '90-94': z.number().default(0.11),
  '95plus': z.number().default(0.14),
});
export type MinimumDrawdownRates = z.infer<typeof MinimumDrawdownRatesSchema>;

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
  // Employer Super Guarantee rate (as decimal, e.g., 0.115 for 11.5%)
  employerSgRate: z.number().default(0.115),
  // Whether to auto-create employer SG accounts for new salary income
  autoCreateEmployerSg: z.boolean().default(true),
  // Minimum drawdown rates for allocated pensions
  minimumDrawdownRates: MinimumDrawdownRatesSchema.default({
    under65: 0.04,
    '65-74': 0.05,
    '75-79': 0.06,
    '80-84': 0.07,
    '85-89': 0.09,
    '90-94': 0.11,
    '95plus': 0.14,
  }),
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
  employerSgRate: 0.115,
  autoCreateEmployerSg: true,
  minimumDrawdownRates: {
    under65: 0.04,
    '65-74': 0.05,
    '75-79': 0.06,
    '80-84': 0.07,
    '85-89': 0.09,
    '90-94': 0.11,
    '95plus': 0.14,
  },
};

export const SettingsSchema = z.object({
  eventHighlightColor: z.string().default('#bfdbfe'),
  sectionHeaderColor: z.string().default('#53a6b2'),
  defaultTaxFundingAccountId: z.string().uuid().optional(),
  defaultBankAccountId: z.string().uuid().optional(), // Default account for income deposits, expense funding, etc.
  growthCalculationMethod: GrowthCalculationMethodSchema.default('averageBalance'),
  super: SuperSettingsSchema.default(defaultSuperSettings),
  companyTaxRate: z.number().default(0.30), // Australian company tax rate for franking credits (30%)
});
export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings: Settings = {
  eventHighlightColor: '#bfdbfe',
  sectionHeaderColor: '#53a6b2',
  defaultTaxFundingAccountId: undefined,
  defaultBankAccountId: undefined,
  growthCalculationMethod: 'averageBalance',
  super: defaultSuperSettings,
  companyTaxRate: 0.30,
};
