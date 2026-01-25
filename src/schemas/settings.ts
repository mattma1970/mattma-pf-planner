import { z } from 'zod';

export const GrowthCalculationMethodSchema = z.enum(['openingBalance', 'averageBalance']);
export type GrowthCalculationMethod = z.infer<typeof GrowthCalculationMethodSchema>;

export const SettingsSchema = z.object({
  eventHighlightColor: z.string().default('#bfdbfe'),
  defaultTaxFundingAccountId: z.string().uuid().optional(),
  growthCalculationMethod: GrowthCalculationMethodSchema.default('openingBalance'),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings: Settings = {
  eventHighlightColor: '#bfdbfe',
  defaultTaxFundingAccountId: undefined,
  growthCalculationMethod: 'openingBalance',
};
