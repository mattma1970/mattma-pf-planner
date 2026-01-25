import { z } from 'zod';

export const SettingsSchema = z.object({
  eventHighlightColor: z.string().default('#bfdbfe'),
  defaultTaxFundingAccountId: z.string().uuid().optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings: Settings = {
  eventHighlightColor: '#bfdbfe',
  defaultTaxFundingAccountId: undefined,
};
