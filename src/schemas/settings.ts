import { z } from 'zod';

export const GrowthCalculationMethodSchema = z.enum(['openingBalance', 'averageBalance']);
export type GrowthCalculationMethod = z.infer<typeof GrowthCalculationMethodSchema>;

// Superannuation settings
export const SuperSettingsSchema = z.object({
  preservationAge: z.number().int().default(67),
  concessionalCap: z.number().default(30000),
  nonConcessionalCap: z.number().default(120000),
  carryForwardYears: z.number().int().default(5),
  contributionsTaxRate: z.number().default(0.15),
  div293Threshold: z.number().default(250000),
  div293Rate: z.number().default(0.15),
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
  growthCalculationMethod: GrowthCalculationMethodSchema.default('openingBalance'),
  super: SuperSettingsSchema.default(defaultSuperSettings),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings: Settings = {
  eventHighlightColor: '#bfdbfe',
  defaultTaxFundingAccountId: undefined,
  growthCalculationMethod: 'openingBalance',
  super: defaultSuperSettings,
};
