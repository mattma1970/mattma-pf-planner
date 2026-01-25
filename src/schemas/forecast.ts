import { z } from 'zod';
import { TaxEventSchema } from './tax';

export const ResolvedAssumptionsSchema = z.object({
  cpi: z.number(),
  investmentGrowth: z.number(),
  superGrowth: z.number(),
});
export type ResolvedAssumptions = z.infer<typeof ResolvedAssumptionsSchema>;

export const AccountYearResultSchema = z.object({
  accountId: z.string().uuid(),
  year: z.number().int(),
  startValue: z.number(),
  growth: z.number(),
  contributions: z.number(),
  withdrawals: z.number(),
  transfers: z.number(),
  endValue: z.number(),
});
export type AccountYearResult = z.infer<typeof AccountYearResultSchema>;

export const YearResultSchema = z.object({
  year: z.number().int(),
  accounts: z.array(AccountYearResultSchema),
  totalAssets: z.number(),
  totalLiquidAssets: z.number(),
  totalIncome: z.number(),
  totalExpenses: z.number(),
  taxPayable: z.number(),
  taxEvents: z.array(TaxEventSchema),
  netPosition: z.number(),
  resolvedAssumptions: ResolvedAssumptionsSchema,
});
export type YearResult = z.infer<typeof YearResultSchema>;

export const ForecastSummarySchema = z.object({
  startYear: z.number().int(),
  endYear: z.number().int(),
  peakAssets: z.number(),
  peakAssetsYear: z.number().int(),
  finalAssets: z.number(),
});
export type ForecastSummary = z.infer<typeof ForecastSummarySchema>;

export const ForecastResultSchema = z.object({
  years: z.array(YearResultSchema),
  summary: ForecastSummarySchema,
});
export type ForecastResult = z.infer<typeof ForecastResultSchema>;
