/**
 * GrowthStage - Phase 3 of the forecast pipeline.
 *
 * Applies growth profiles (fixed, CPI-linked, increasing, decreasing) to
 * account balances. Growth is emitted as synthetic ledger entries.
 *
 * GrowthStage does NOT handle transfers, contributions, or withdrawals -
 * those are handled by LifecycleTransferStage, UserTransferStage, and
 * DerivedFlowsStage respectively.
 */

import type {
  Account,
  Event,
  Person,
  Settings,
  Epoch,
  Assumptions,
  ForecastWarning,
} from '../../schemas';

import type { ForecastContext, IForecastStage } from './stages';
import type { Year, Money, AccountId, PersonId } from '../../types';
import {
  isAccountActive,
  calculateGrowthRate,
} from '../../../engine/accounts';
import {
  projectAccountValue,
  getAccountAssumptionForEpoch,
  calculateGrowthRate,
} from '../../../engine/accounts';
import { resolveAssumptions } from '../../../engine/assumptions';
import {
  emitTransaction,
  type DoubleEntryTransaction,
  DEFAULT_EQUITY_ACCOUNT_ID,
} from '../../../engine/ledger';
import { v4 as uuidv4 } from 'uuid';

export class GrowthStage implements IForecastStage {
  readonly id = 'growth';
  readonly order = 1;
  readonly enabled = true;

  execute(context: ForecastContext): ForecastContext {
    const {
      year,
      accounts,
      persons,
      settings,
      epochs,
      assumptions,
      accountValues,
      accountResults,
      accountStartYears,
      yearLedgerEntries,
    } = context;

    const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);

    const resolvedAssumptions = resolveAssumptions(assumptions, year, sortedEpochs);

    const yearWarnings: ForecastWarning[] = [];

    // Check for incomplete employer SG accounts (only in first year)
    if (year === context.startYear) {
      for (const account of accounts) {
        if (
          account.type === 'income' &&
          account.basedOnAccountId &&
          account.basedOnPercentage !== undefined &&
          !account.superContributionConfig
        ) {
          const sourceAccount = accounts.find((a) => a.id === account.basedOnAccountId);
          if (sourceAccount?.type === 'income' && sourceAccount?.incomeSubType === 'salary') {
            yearWarnings.push({
              type: 'incompleteEmployerSg',
              severity: 'warning',
              message: `Employer SG account needs configuration`,
              details: `Select a target super account for: ${account.name}`,
              accountId: account.id,
            });
          }
        }
      }
    }

    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isFirstActiveYear = accountStartYears.get(account.id) === year;

      if (isFirstActiveYear) {
        accountStartYears.set(account.id, year);
      }

      if (!isActive) {
        const openingValue = accountValues.get(account.id) ?? account.initialValue;

        if (account.endBehavior === 'hold') {
          accountResults.set(account.id, {
            accountId: account.id,
            accountType: account.type,
            year,
            startValue: openingValue,
            growth: 0,
            contributions: 0,
            withdrawals: 0,
            transfers: 0,
            endValue: openingValue,
          });
        } else if (
          account.endBehavior === 'transfer' ||
          account.endBehavior === 'sell'
        ) {
          accountResults.set(account.id, {
            accountId: account.id,
            accountType: account.type,
            year,
            startValue: openingValue,
            growth: 0,
            contributions: 0,
            withdrawals: 0,
            transfers: 0,
            endValue: accountValues.get(account.id) ?? 0,
          });
        } else {
          // 'zero' or default - emit double-entry to zero out
          if (openingValue !== 0) {
            emitTransaction(
              {
                id: uuidv4(),
                kind: 'synthetic',
                legs: [
                  {
                    accountId: DEFAULT_EQUITY_ACCOUNT_ID,
                    amount: openingValue,
                    delta: 'debit',
                    label: `Account ended: ${account.name}`,
                    sourceAccountId: account.id,
                    sourceAccountName: account.name,
                  },
                  {
                    accountId: account.id,
                    amount: openingValue,
                    delta: 'credit',
                    label: `Account ended: ${account.name}`,
                    sourceAccountId: account.id,
                    sourceAccountName: account.name,
                  },
                ],
              },
              yearLedgerEntries,
              accountResults,
              accountValues,
              (msg) => {
                context.yearWarnings.push({
                  type: 'ledgerError',
                  severity: 'error',
                  message: msg,
                });
              }
            );
          }
          accountResults.set(account.id, {
            accountId: account.id,
            accountType: account.type,
            year,
            startValue: openingValue,
            growth: 0,
            contributions: 0,
            withdrawals: 0,
            transfers: 0,
            endValue: 0,
          });
        }
        continue;
      }

      const openingValue = accountValues.get(account.id) ?? account.initialValue;

      // Liabilities: no growth in this stage (handled in LiabilityStage)
      if (account.type === 'liability') {
        accountResults.set(account.id, {
          accountId: account.id,
          accountType: account.type,
          year,
          startValue: openingValue,
          growth: 0,
          contributions: 0,
          withdrawals: 0,
          transfers: 0,
          endValue: openingValue,
        });
        continue;
      }

      // Income accounts: pass-through, growth based on prior year inflows
      if (account.type === 'income') {
        let projectedValue = openingValue;
        let growth = 0;

        if (account.basedOnAccountId && account.basedOnPercentage !== undefined) {
          // Derived income (e.g., employer SG from salary)
          const refAccount = accounts.find((a) => a.id === account.basedOnAccountId);
          if (refAccount && isAccountActive(refAccount, year, persons)) {
            let refValue = 0;
            if (refAccount.type === 'income') {
              refValue = refAccount.initialValue;
            } else {
              refValue = accountValues.get(refAccount.id) ?? refAccount.initialValue;
            }
            projectedValue = refValue * account.basedOnPercentage;
            growth = projectedValue;
          } else {
            projectedValue = 0;
            growth = 0;
          }
        }

        if (growth !== 0) {
          emitSyntheticGrowth(
            account,
            growth,
            year,
            yearLedgerEntries,
            accountResults,
            accountValues,
            (msg) => {
              context.yearWarnings.push({
                type: 'ledgerError',
                severity: 'error',
                message: msg,
              });
            }
          );
        }

        accountResults.set(account.id, {
          accountId: account.id,
          accountType: account.type,
          year,
          startValue: openingValue,
          growth,
          contributions: 0,
          withdrawals: 0,
          transfers: 0,
          endValue: projectedValue,
        });
        continue;
      }

      // Expense accounts
      if (account.type === 'expense') {
        const accountStartYear = accountStartYears.get(account.id) ?? year;
        const yearsSinceStart = year - accountStartYear + 1;

        let grownBaseValue: Money;
        if (account.occursEveryYears) {
          const epochGrowthOverride = getAccountAssumptionForEpoch(
            account,
            year,
            sortedEpochs,
            'growthRate'
          );
          grownBaseValue = projectAccountValue(
            account,
            year,
            account.initialValue,
            resolvedAssumptions,
            yearsSinceStart,
            epochGrowthOverride
          );
          const rate =
            account.growthProfile.type === 'fixed'
              ? epochGrowthOverride ?? account.growthProfile.rate
              : account.growthProfile.type === 'cpiLinked'
                ? (epochGrowthOverride ?? account.growthProfile.value ?? 0) +
                  resolvedAssumptions.cpi
                : 0;
          grownBaseValue = account.initialValue * Math.pow(1 + rate, yearsSinceStart - 1);
        } else {
          const epochGrowthOverride = getAccountAssumptionForEpoch(
            account,
            year,
            sortedEpochs,
            'growthRate'
          );
          const rate = calculateGrowthRate(
            account.growthProfile,
            resolvedAssumptions,
            yearsSinceStart,
            epochGrowthOverride
          );
          grownBaseValue = openingValue * (1 + rate);
        }

        const expenseResult = calculateExpenseValue(
          account,
          year,
          grownBaseValue,
          accountValues,
          accountStartYear,
          accounts,
          persons
        );

        const expenseValue = expenseResult.value;
        const expenseGrowth = expenseValue - openingValue;

        if (expenseGrowth !== 0) {
          emitSyntheticGrowth(
            account,
            expenseGrowth,
            year,
            yearLedgerEntries,
            accountResults,
            accountValues,
            (msg) => {
              context.yearWarnings.push({
                type: 'ledgerError',
                severity: 'error',
                message: msg,
              });
            }
          );
        }

        accountResults.set(account.id, {
          accountId: account.id,
          accountType: account.type,
          year,
          startValue: openingValue,
          growth: expenseGrowth,
          contributions: 0,
          withdrawals: 0,
          transfers: 0,
          endValue: expenseValue,
        });
        continue;
      }

      // Asset accounts: apply growth
      if (account.type === 'asset') {
        const epochGrowthOverride = getAccountAssumptionForEpoch(
          account,
          year,
          sortedEpochs,
          'growthRate'
        );
        const rate = calculateGrowthRate(
          account.growthProfile,
          resolvedAssumptions,
          1,
          epochGrowthOverride
        );
        const growthAmount = openingValue * rate;

        if (growthAmount !== 0) {
          emitSyntheticGrowth(
            account,
            growthAmount,
            year,
            yearLedgerEntries,
            accountResults,
            accountValues,
            (msg) => {
              context.yearWarnings.push({
                type: 'ledgerError',
                severity: 'error',
                message: msg,
              });
            }
          );
        }

        accountResults.set(account.id, {
          accountId: account.id,
          accountType: account.type,
          year,
          startValue: openingValue,
          growth: growthAmount,
          contributions: 0,
          withdrawals: 0,
          transfers: 0,
          endValue: openingValue + growthAmount,
        });
      }
    }

    // Sync accountValues from accountResults so subsequent years use the
    // correct opening values even for accounts without ledger entries.
    for (const account of accounts) {
      const result = accountResults.get(account.id);
      if (result) {
        accountValues.set(account.id, result.endValue);
      }
    }

    return {
      ...context,
      resolvedAssumptions,
      yearWarnings,
    };
  }
}

function calculateExpenseValue(
  account: Account,
  year: Year,
  baseValue: Money,
  accountValues: Map<AccountId, Money>,
  accountStartYear: Year,
  accounts: Account[],
  persons: Person[]
): { value: Money; isPeriodicOffYear: boolean; basedOnValue?: Money } {
  if (account.occursEveryYears) {
    const yearsSinceStart = year - accountStartYear;
    if (yearsSinceStart < 0 || yearsSinceStart % account.occursEveryYears !== 0) {
      return { value: 0, isPeriodicOffYear: true };
    }
  }

  let value = baseValue;
  let basedOnValue: Money | undefined;

  if (account.basedOnAccountId && account.basedOnPercentage !== undefined) {
    const refAccount = accounts.find((a) => a.id === account.basedOnAccountId);
    if (refAccount) {
      const refAccountActive = isAccountActive(refAccount, year, persons);
      if (!refAccountActive) {
        return { value: 0, isPeriodicOffYear: false, basedOnValue: 0 };
      }
      basedOnValue = accountValues.get(account.basedOnAccountId) ?? refAccount.initialValue;
      value = basedOnValue * account.basedOnPercentage;
    }
  }

  return { value, isPeriodicOffYear: false, basedOnValue };
}

function emitSyntheticGrowth(
  account: Account,
  amount: number,
  year: Year,
  yearLedgerEntries: Array<{
    accountId: string;
    amount: number;
    delta: 'credit' | 'debit';
    kind: 'externalIn' | 'externalOut' | 'synthetic' | 'internalTransfer';
    label: string;
    sourceAccountId?: string;
    sourceAccountName?: string;
  }>,
  accountResults: Map<string, {
    accountId: string;
    accountType: string;
    endValue: number;
    startValue: number;
    growth: number;
    contributions: number;
    withdrawals: number;
    transfers: number;
    cashflowDetails?: Array<{
      description: string;
      amount: number;
      type: string;
      sourceAccountId?: string;
      sourceAccountName?: string;
    }>;
  }>,
  accountValues: Map<string, number>,
  onError?: (msg: string) => void,
): void {
  if (amount === 0) return;

  const absAmount = Math.abs(amount);
  const isIncrease = amount > 0;

  // Synthetic growth increases the account balance and offsets against
  // Retained Earnings. For assets: debit increases, credit decreases.
  // For non-assets: credit increases, debit decreases.
  const accountDelta = account.type === 'asset'
    ? (isIncrease ? 'debit' : 'credit')
    : (isIncrease ? 'credit' : 'debit');
  const equityDelta = account.type === 'asset'
    ? (isIncrease ? 'credit' : 'debit')
    : (isIncrease ? 'debit' : 'credit');

  emitTransaction(
    {
      id: uuidv4(),
      kind: 'synthetic',
      legs: [
        {
          accountId: account.id,
          amount: absAmount,
          delta: accountDelta,
          label: `Growth: ${account.name}`,
          sourceAccountId: account.id,
          sourceAccountName: account.name,
        },
        {
          accountId: DEFAULT_EQUITY_ACCOUNT_ID,
          amount: absAmount,
          delta: equityDelta,
          label: `Growth: ${account.name}`,
          sourceAccountId: account.id,
          sourceAccountName: account.name,
        },
      ],
    },
    yearLedgerEntries,
    accountResults,
    accountValues,
    onError
  );
}
