import { v4 as uuidv4 } from 'uuid';
import type {
  Account,
  Assumptions,
  Event,
  Person,
  ResolvedAssumptions,
  ForecastResult,
  YearResult,
  AccountYearResult,
  Settings,
  TaxEvent,
  TaxAggregation,
  TaxSchedule,
} from '../schemas';
import { calculateIncomeTax } from './tax';
import { resolveAssumptionForYear } from './assumptions';
import { isAccountActive, projectAccountValue, handleAccountTransfer } from './accounts';

export interface ForecastInput {
  accounts: Account[];
  assumptions: Assumptions;
  events: Event[];
  persons: Person[];
  settings: Settings;
  startYear: number;
  endYear: number;
}

export function calculateForecast(input: ForecastInput): ForecastResult {
  const { accounts, assumptions, events, persons, settings, startYear, endYear } = input;

  const years: YearResult[] = [];
  const accountValues: Map<string, number> = new Map();
  const accountStartYears: Map<string, number> = new Map();

  accounts.forEach((account) => {
    accountValues.set(account.id, account.initialValue);
  });

  let peakAssets = 0;
  let peakAssetsYear = startYear;

  for (let year = startYear; year <= endYear; year++) {
    const resolvedAssumptions = resolveAssumptions(assumptions, year);
    const yearAccounts: AccountYearResult[] = [];
    let totalIncome = 0;
    let totalExpenses = 0;

    const yearEvents = events.filter((e) => e.year === year);

    const pendingFlows: { accountId: string; amount: number; type: 'contribution' | 'withdrawal' }[] = [];
    const accountResults = new Map<string, AccountYearResult>();

    const getAccountOpeningValue = (accountId: string): number => {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) return 0;
      const isFirstActive = !accountStartYears.has(accountId) && isAccountActive(account, year, persons);
      if (isFirstActive) {
        return account.initialValue;
      }
      return accountValues.get(accountId) ?? account.initialValue;
    };

    const startOfYearTransfers = new Map<string, number>();
    for (const event of yearEvents) {
      if (event.type === 'transfer' && event.sourceAccountId && event.targetAccountId) {
        const transferAmount = event.transferAll
          ? getAccountOpeningValue(event.sourceAccountId)
          : event.amount;
        
        startOfYearTransfers.set(
          event.sourceAccountId,
          (startOfYearTransfers.get(event.sourceAccountId) ?? 0) - transferAmount
        );
        startOfYearTransfers.set(
          event.targetAccountId,
          (startOfYearTransfers.get(event.targetAccountId) ?? 0) + transferAmount
        );
      }
    }

    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isFirstActiveYear = !accountStartYears.has(account.id) && isActive;
      if (isFirstActiveYear) {
        accountStartYears.set(account.id, year);
      }

      const openingValue = isFirstActiveYear
        ? account.initialValue
        : (accountValues.get(account.id) ?? account.initialValue);

      const transferAmount = startOfYearTransfers.get(account.id) ?? 0;
      const transferredAllOut = transferAmount < 0 && openingValue + transferAmount <= 0;
      const startValue = transferredAllOut ? 0 : openingValue + transferAmount;

      let growth = 0;
      let projectedValue = startValue;
      let contributions = 0;
      let withdrawals = 0;
      let transfers = transferAmount;
      let endValue = startValue;

      if (isActive && !transferredAllOut) {
        const yearsSinceStart = year - (accountStartYears.get(account.id) ?? year) + 1;
        projectedValue = projectAccountValue(account, year, startValue, resolvedAssumptions, yearsSinceStart);
        growth = projectedValue - startValue;

        for (const event of yearEvents) {
          if (event.affectedAccountId === account.id) {
            if (event.type === 'income' || event.type === 'assetChange') {
              contributions += event.amount;
            } else if (event.type === 'expense' || event.type === 'liabilityChange') {
              withdrawals += event.amount;
            }
          }
        }

        const transfer = handleAccountTransfer(account, year, persons, projectedValue + contributions - withdrawals);
        if (transfer.isTransferYear && transfer.destinationId) {
          transfers += -transfer.amount;
          endValue = 0;
          pendingFlows.push({ accountId: transfer.destinationId, amount: transfer.amount, type: 'contribution' });
        } else {
          endValue = projectedValue + contributions - withdrawals;
        }

        if (account.type === 'income' && account.depositsToAccountId) {
          pendingFlows.push({ accountId: account.depositsToAccountId, amount: projectedValue, type: 'contribution' });
        }
        if (account.type === 'expense' && account.fundedByAccountId) {
          pendingFlows.push({ accountId: account.fundedByAccountId, amount: projectedValue, type: 'withdrawal' });
        }
        if (account.type === 'asset' && account.returnRate && account.incomeTargetAccountId && startValue > 0) {
          const incomeGenerated = startValue * (account.returnRate / 100);
          pendingFlows.push({ accountId: account.incomeTargetAccountId, amount: incomeGenerated, type: 'contribution' });
        }
        if (account.type === 'asset' && account.fundedByAccountId) {
          let fundingAmount = contributions - withdrawals + growth;
          if (isFirstActiveYear) {
            fundingAmount += account.initialValue;
          }
          if (fundingAmount > 0) {
            pendingFlows.push({ accountId: account.fundedByAccountId, amount: fundingAmount, type: 'withdrawal' });
          }
        }
      } else if (!isActive) {
        if (account.endBehavior === 'hold') {
          endValue = startValue;
          projectedValue = startValue;
        } else {
          endValue = 0;
          projectedValue = 0;
        }

        if (account.type === 'income' && account.depositsToAccountId && account.endBehavior === 'hold') {
          pendingFlows.push({ accountId: account.depositsToAccountId, amount: projectedValue, type: 'contribution' });
        }
        if (account.type === 'expense' && account.fundedByAccountId && account.endBehavior === 'hold') {
          pendingFlows.push({ accountId: account.fundedByAccountId, amount: projectedValue, type: 'withdrawal' });
        }
      }

      accountValues.set(account.id, endValue);

      if (account.type === 'income') {
        totalIncome += projectedValue;
      } else if (account.type === 'expense') {
        totalExpenses += projectedValue;
      }

      accountResults.set(account.id, {
        accountId: account.id,
        year,
        startValue: openingValue,
        growth,
        contributions,
        withdrawals,
        transfers,
        endValue,
      });
    }

    for (const event of yearEvents) {
      if (!event.affectedAccountId && !event.sourceAccountId) {
        if (event.type === 'income') {
          totalIncome += event.amount;
        } else if (event.type === 'expense') {
          totalExpenses += event.amount;
        }
      }
    }

    for (const flow of pendingFlows) {
      const result = accountResults.get(flow.accountId);
      if (result) {
        if (flow.type === 'contribution') {
          result.contributions += flow.amount;
          result.endValue += flow.amount;
        } else {
          result.withdrawals += flow.amount;
          result.endValue -= flow.amount;
        }
        accountValues.set(flow.accountId, result.endValue);
      }
    }

    const taxEvents: TaxEvent[] = [];
    
    const defaultFundingAccountId = settings.defaultTaxFundingAccountId ?? 'unassigned';
    const defaultFundingAccount = settings.defaultTaxFundingAccountId 
      ? accounts.find(a => a.id === settings.defaultTaxFundingAccountId) 
      : undefined;

    if (totalIncome > 0) {
      taxEvents.push({
        id: uuidv4(),
        year,
        type: 'incomeTax',
        description: 'Income Tax',
        assessableAmount: totalIncome,
        fundedFromAccountId: defaultFundingAccountId,
        fundedFromAccountName: defaultFundingAccount?.name ?? 'Not configured',
      });
    }

    const aggregationMap = new Map<string, { 
      fundedFromAccountName: string;
      taxSchedule: TaxSchedule;
      totalAssessable: number;
      events: TaxEvent[];
    }>();

    for (const taxEvent of taxEvents) {
      const existing = aggregationMap.get(taxEvent.fundedFromAccountId);
      if (existing) {
        existing.totalAssessable += taxEvent.assessableAmount;
        existing.events.push(taxEvent);
      } else {
        const fundingAccount = accounts.find(a => a.id === taxEvent.fundedFromAccountId);
        const isSuperAccount = fundingAccount?.type === 'asset' && 
          fundingAccount.name?.toLowerCase().includes('super');
        
        aggregationMap.set(taxEvent.fundedFromAccountId, {
          fundedFromAccountName: taxEvent.fundedFromAccountName ?? 'Unknown',
          taxSchedule: isSuperAccount ? 'flatRate15' : 'marginalRates',
          totalAssessable: taxEvent.assessableAmount,
          events: [taxEvent],
        });
      }
    }

    const taxAggregations: TaxAggregation[] = [];
    let taxPayable = 0;

    for (const [fundedFromAccountId, agg] of aggregationMap) {
      let calculatedTax: number;
      if (agg.taxSchedule === 'marginalRates') {
        calculatedTax = calculateIncomeTax(agg.totalAssessable, year);
      } else {
        calculatedTax = agg.totalAssessable * 0.15;
      }

      taxAggregations.push({
        fundedFromAccountId,
        fundedFromAccountName: agg.fundedFromAccountName,
        taxSchedule: agg.taxSchedule,
        totalAssessable: agg.totalAssessable,
        calculatedTax,
      });

      taxPayable += calculatedTax;

      if (fundedFromAccountId !== 'unassigned') {
        const fundingResult = accountResults.get(fundedFromAccountId);
        if (fundingResult) {
          fundingResult.withdrawals += calculatedTax;
          fundingResult.endValue -= calculatedTax;
          accountValues.set(fundedFromAccountId, fundingResult.endValue);
        }
      }
    }

    const netPosition = totalIncome - totalExpenses - taxPayable;

    for (const account of accounts) {
      const result = accountResults.get(account.id);
      if (result) {
        yearAccounts.push(result);
      }
    }

    let totalAssets = 0;
    let totalLiquidAssets = 0;
    let totalLiabilities = 0;
    for (const account of accounts) {
      const value = accountValues.get(account.id) ?? 0;
      if (account.type === 'asset') {
        totalAssets += value;
        if (account.liquidityType === 'liquid') {
          totalLiquidAssets += value;
        }
      } else if (account.type === 'liability') {
        totalLiabilities += value;
      }
    }

    if (totalAssets > peakAssets) {
      peakAssets = totalAssets;
      peakAssetsYear = year;
    }

    years.push({
      year,
      accounts: yearAccounts,
      totalAssets,
      totalLiquidAssets,
      totalIncome,
      totalExpenses,
      taxPayable,
      taxEvents,
      taxAggregations,
      netPosition,
      resolvedAssumptions,
    });
  }

  const finalAssets = years.length > 0 ? years[years.length - 1].totalAssets : 0;

  return {
    years,
    summary: {
      startYear,
      endYear,
      peakAssets,
      peakAssetsYear,
      finalAssets,
    },
  };
}

function resolveAssumptions(assumptions: Assumptions, year: number): ResolvedAssumptions {
  const cpi = resolveAssumptionForYear(assumptions.cpi, year);

  return {
    cpi,
    investmentGrowth: resolveAssumptionForYear(assumptions.investmentGrowth, year, cpi),
    superGrowth: resolveAssumptionForYear(assumptions.superGrowth, year, cpi),
  };
}
