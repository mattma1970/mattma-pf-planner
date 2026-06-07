import { z } from 'zod';
import { TaxEventSchema, TaxAggregationSchema, TaxByPersonSchema } from './tax';

export const ResolvedAssumptionsSchema = z.object({
  cpi: z.number(),
});
export type ResolvedAssumptions = z.infer<typeof ResolvedAssumptionsSchema>;

export const JournalEntrySchema = z.object({
  seq: z.number().int(),
  year: z.number().int(),
  userId: z.string(),
  timestamp: z.string(),
  debitAccountId: z.string(),
  debitAccountName: z.string(),
  creditAccountId: z.string(),
  creditAccountName: z.string(),
  amount: z.number(),
  label: z.string(),
  kind: z.enum(['externalIn', 'externalOut', 'synthetic', 'internalTransfer']).optional(),
  sourceAccountId: z.string().optional(),
  sourceAccountName: z.string().optional(),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export const ForecastWarningSchema = z.object({
  type: z.enum(['blockedContribution', 'capExceeded', 'negativeBalance', 'incompleteEmployerSg', 'unroutedIncome', 'ledgerError', 'conservationViolation', 'other']),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string(),
  details: z.string().optional(),
  personId: z.string().optional(),
  accountId: z.string().optional(),
  amount: z.number().optional(),
});
export type ForecastWarning = z.infer<typeof ForecastWarningSchema>;

export const OffBalanceSheetItemSchema = z.object({
  id: z.string(),
  type: z.enum([
    'carryForwardContribution',
    'frankingCredits',
    'concessionalCapAccount',
    'nonConcessionalCapAccount',
    'capitalLossCarryForward',
  ]),
  label: z.string(),
  personId: z.string().optional(),
  value: z.number().optional(),
  opening: z.number().optional(),
  movement: z.number().optional(),
  closing: z.number().optional(),
});
export type OffBalanceSheetItem = z.infer<typeof OffBalanceSheetItemSchema>;

export const CashflowItemSchema = z.object({
  description: z.string(),
  amount: z.number(),
  type: z.enum(['contribution', 'withdrawal']),
  kind: z.enum(['externalIn', 'externalOut', 'synthetic', 'internalTransfer']).optional(),
  sourceAccountId: z.string().optional(),
  sourceAccountName: z.string().optional(),
});
export type CashflowItem = z.infer<typeof CashflowItemSchema>;

export const AccountYearResultSchema = z.object({
  accountId: z.string().uuid(),
  year: z.number().int(),
  startValue: z.number(),
  growth: z.number(),
  contributions: z.number(),
  withdrawals: z.number(),
  transfers: z.number(),
  endValue: z.number(),
  autoTopupApplied: z.boolean().optional(),
  cashflowDetails: z.array(CashflowItemSchema).optional(),
});
export type AccountYearResult = z.infer<typeof AccountYearResultSchema>;

export const YearResultSchema = z.object({
  year: z.number().int(),
  accounts: z.array(AccountYearResultSchema),
  totalAssets: z.number(),
  totalLiabilities: z.number(),
  totalLiquidAssets: z.number(),
  totalIncome: z.number(),
  totalExpenses: z.number(),
  taxPayable: z.number(),
  taxEvents: z.array(TaxEventSchema),
  taxAggregations: z.array(TaxAggregationSchema),
  taxByPerson: z.array(TaxByPersonSchema).optional(),
  netPosition: z.number(),
  resolvedAssumptions: ResolvedAssumptionsSchema,
  offBalanceSheet: z.array(OffBalanceSheetItemSchema).optional(),
  warnings: z.array(ForecastWarningSchema).optional(),
  journal: z.array(JournalEntrySchema).optional(),
  conservationLog: z.string().optional(),
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
