/**
 * GrowthStage - Phase 4 of the forecast pipeline.
 *
 * Apply growth to account balances based on settings.growthCalculationMethod.
 * Handles income, expense, asset, and liability account types differently.
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

import type {
  ForecastContext,
  IForecastStage,
  AccountYearResult,
} from './stages';
import type { Year, Money, AccountId } from '../../types';
import { isAccountActive } from '../../../engine/accounts';
import { projectAccountValue, getAccountAssumptionForEpoch } from '../../../engine/accounts';
import { resolveAssumptions } from '../../../engine/assumptions';

export class GrowthStage implements IForecastStage {
  readonly id = 'growth';
  readonly order = 3;
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
      priorYearInflows,
      accountStartYears,
      lifecycleTransfers,
      lifecycleFlows,
      userTransferFlows,
      superContributionFlows,
      accountResults,
    } = context;

    const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);

    const yearEvents = context.events.filter((e) => e.year === year);

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

    const yearStartPriorInflows = new Map(priorYearInflows);

    // Track per-account income for itemized tax events
    const incomeByAccount: Array<{
      accountId: AccountId;
      accountName: string;
      amount: Money;
      fundedFromAccountId?: AccountId;
      personId?: PersonId;
      personName?: string;
    }> = [];

    const incomeByPerson = new Map<string, Money>();
    const frankingCreditsByPerson = new Map<string, Money>();

    let totalIncome = 0;
    let totalExpenses = 0;

    // Track liability payoffs triggered by asset sales
    const liabilityPayoffs = context.liabilityPayoffs ?? new Map<AccountId, {
      amount: Money;
      fundedByAccountId: AccountId;
      triggeredByAssetId: AccountId;
      triggeredByAssetName: string;
      liabilityName: string;
    }>();

    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isFirstActiveYear = accountStartYears.get(account.id) === year;
      const isLifecycleEnding = lifecycleTransfers?.some(
        (t) => t.sourceId === account.id
      ) ?? false;

      const openingValue = isFirstActiveYear
        ? account.initialValue
        : account.type === 'income'
          ? 0
          : (accountValues.get(account.id) ?? account.initialValue);

      const lifecycleChange = lifecycleFlows?.get(account.id) ?? 0;
      const userTransferChange = userTransferFlows?.get(account.id) ?? 0;
      const superContributionChange = superContributionFlows?.get(account.id) ?? 0;

      let growth = 0;
      let projectedValue = openingValue;
      let contributions = 0;
      let withdrawals = 0;
      let transfers = 0;
      let endValue = openingValue;

      // Track lifecycle transfers: outflows as transfers, inflows as contributions
      const lifecycleContribution = Math.max(0, lifecycleChange);
      if (lifecycleChange < 0) {
        transfers = lifecycleChange;
      } else if (lifecycleChange > 0) {
        contributions = lifecycleChange;
      }

      transfers += userTransferChange;
      contributions += superContributionChange;

      if (isActive && !isLifecycleEnding) {
        const totalTransfers =
          lifecycleChange + userTransferChange + superContributionChange;
        let balanceForGrowth: Money;

        if (settings.growthCalculationMethod === 'averageBalance') {
          balanceForGrowth = openingValue + 0.5 * totalTransfers;
        } else {
          balanceForGrowth =
            openingValue + Math.min(0, lifecycleChange) + userTransferChange;
        }

        // Apply growth based on account type
        if (account.type === 'liability') {
          const payoffInfo = liabilityPayoffs.get(account.id);
          if (payoffInfo) {
            projectedValue = openingValue;
            endValue = openingValue;
            growth = 0;
          } else {
            projectedValue = openingValue + lifecycleChange - userTransferChange;
            growth = 0;
          }
        } else if (account.type === 'expense') {
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
            grownBaseValue =
              account.initialValue * Math.pow(1 + rate, yearsSinceStart - 1);
          } else if (balanceForGrowth > 0) {
            const epochGrowthOverride = getAccountAssumptionForEpoch(
              account,
              year,
              sortedEpochs,
              'growthRate'
            );
            grownBaseValue = projectAccountValue(
              account,
              year,
              balanceForGrowth,
              resolvedAssumptions,
              yearsSinceStart,
              epochGrowthOverride
            );
          } else {
            grownBaseValue = balanceForGrowth;
          }

          const expenseResult = this.calculateExpenseValue(
            account,
            year,
            grownBaseValue,
            context.openingValues ?? new Map(),
            accountStartYear,
            accounts,
            persons
          );

          projectedValue = expenseResult.value;
          growth = projectedValue - openingValue;
        } else if (account.type === 'income') {
          if (account.basedOnAccountId && account.basedOnPercentage !== undefined) {
            const refAccount = accounts.find(
              (a) => a.id === account.basedOnAccountId
            );
            if (refAccount) {
              const refAccountActive = isAccountActive(
                refAccount,
                year,
                persons
              );
              if (!refAccountActive) {
                projectedValue = 0;
                growth = 0;
              } else {
                let refValue = 0;
                if (refAccount.type === 'income') {
                  const refPriorInflows =
                    yearStartPriorInflows.get(refAccount.id) ??
                    refAccount.initialValue;
                  const refIsFirstActive =
                    accountStartYears.get(refAccount.id) === year;
                  if (refIsFirstActive) {
                    refValue = refAccount.initialValue;
                  } else if (refPriorInflows > 0) {
                    const refYearsSinceStart =
                      year - (accountStartYears.get(refAccount.id) ?? year) + 1;
                    const refEpochGrowthOverride =
                      getAccountAssumptionForEpoch(
                        refAccount,
                        year,
                        sortedEpochs,
                        'growthRate'
                      );
                    refValue = projectAccountValue(
                      refAccount,
                      year,
                      refPriorInflows,
                      resolvedAssumptions,
                      refYearsSinceStart,
                      refEpochGrowthOverride
                    );
                  }
                } else {
                  refValue =
                    context.openingValues?.get(account.basedOnAccountId) ??
                    refAccount.initialValue;
                }

                projectedValue = refValue * account.basedOnPercentage;
                growth = projectedValue;
              }
            } else {
              projectedValue = 0;
              growth = 0;
            }
          } else if (isFirstActiveYear) {
            projectedValue = account.initialValue;
            growth = 0;
          } else {
            const priorInflows =
              priorYearInflows.get(account.id) ?? account.initialValue;
            if (priorInflows > 0) {
              const yearsSinceStart =
                year - (accountStartYears.get(account.id) ?? year) + 1;
              const epochGrowthOverride = getAccountAssumptionForEpoch(
                account,
                year,
                sortedEpochs,
                'growthRate'
              );
              projectedValue = projectAccountValue(
                account,
                year,
                priorInflows,
                resolvedAssumptions,
                yearsSinceStart,
                epochGrowthOverride
              );
              growth = projectedValue - priorInflows;
            } else {
              projectedValue = 0;
              growth = 0;
            }
          }
        } else if (balanceForGrowth > 0) {
          const yearsSinceStart =
            year - (accountStartYears.get(account.id) ?? year) + 1;
          const epochGrowthOverride = getAccountAssumptionForEpoch(
            account,
            year,
            sortedEpochs,
            'growthRate'
          );
          projectedValue = projectAccountValue(
            account,
            year,
            balanceForGrowth,
            resolvedAssumptions,
            yearsSinceStart,
            epochGrowthOverride
          );
          growth = projectedValue - balanceForGrowth;
        } else {
          projectedValue = balanceForGrowth;
          growth = 0;
        }

        // Add remaining transfer amounts not included in growth base
        if (settings.growthCalculationMethod === 'averageBalance') {
          projectedValue += 0.5 * totalTransfers;
        } else {
          projectedValue += lifecycleContribution + superContributionChange;
        }

        // Process non-transfer events
        let eventContributions = 0;
        let eventWithdrawals = 0;
        for (const event of yearEvents) {
          if (event.affectedAccountId === account.id) {
            if (event.type === 'income' || event.type === 'assetChange') {
              eventContributions += event.amount;
            } else if (event.type === 'expense' || event.type === 'liabilityChange') {
              eventWithdrawals += event.amount;
            }
          }
        }
        contributions += eventContributions;
        withdrawals += eventWithdrawals;

        const wasLiabilityPaidOff =
          account.type === 'liability' && liabilityPayoffs.has(account.id);
        if (!wasLiabilityPaidOff) {
          endValue = projectedValue + eventContributions - eventWithdrawals;
        }

        // Store derived flows for the DerivedFlowsStage
        // We'll capture them in the context
      } else if (isLifecycleEnding) {
        endValue = contributions;
        projectedValue = contributions;
      } else if (!isActive) {
        if (account.endBehavior === 'hold') {
          endValue = openingValue;
          projectedValue = openingValue;
        } else if (
          account.endBehavior === 'transfer' ||
          account.endBehavior === 'sell'
        ) {
          endValue = openingValue + contributions;
          projectedValue = openingValue + contributions;
        } else {
          endValue = 0;
          projectedValue = 0;
        }

        if (
          account.type === 'income' &&
          account.depositsToAccountId &&
          account.endBehavior === 'hold'
        ) {
          // Deferred ledger entry will be handled in DerivedFlowsStage
        }
        if (
          account.type === 'expense' &&
          account.fundedByAccountId &&
          account.endBehavior === 'hold'
        ) {
          // Deferred ledger entry will be handled in DerivedFlowsStage
        }
      }

      accountValues.set(account.id, endValue);

      if (account.type === 'income') {
        const taxableIncome = projectedValue + contributions;
        totalIncome += taxableIncome;

        const isDerivedSuperIncome = !!account.superContributionConfig;
        if (
          taxableIncome > 0 &&
          account.incomeTaxTreatment !== 'taxFree' &&
          !isDerivedSuperIncome
        ) {
          const ownerPerson = account.owner
            ? persons.find((p) => p.id === account.owner)
            : undefined;
          incomeByAccount.push({
            accountId: account.id,
            accountName: account.name,
            amount: taxableIncome,
            fundedFromAccountId: account.taxFundedFromAccountId,
            personId: account.owner,
            personName: ownerPerson?.name,
          });
          if (account.owner) {
            incomeByPerson.set(
              account.owner,
              (incomeByPerson.get(account.owner) ?? 0) + taxableIncome
            );
          }
        }
        endValue = taxableIncome;
        priorYearInflows.set(account.id, taxableIncome);
      } else if (account.type === 'expense') {
        totalExpenses += projectedValue;
        priorYearInflows.set(account.id, projectedValue);
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

    // Handle events without affected accounts
    for (const event of yearEvents) {
      if (!event.affectedAccountId && !event.sourceAccountId) {
        if (event.type === 'income') {
          totalIncome += event.amount;
        } else if (event.type === 'expense') {
          totalExpenses += event.amount;
        }
      }
    }

    return {
      ...context,
      resolvedAssumptions,
      yearWarnings,
      incomeByAccount,
      incomeByPerson,
      frankingCreditsByPerson,
      totalIncome,
      totalExpenses,
      liabilityPayoffs,
    };
  }

  private calculateExpenseValue(
    account: Account,
    year: Year,
    baseValue: Money,
    openingValues: Map<AccountId, Money>,
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
        basedOnValue =
          openingValues.get(account.basedOnAccountId) ?? refAccount.initialValue;
        value = basedOnValue * account.basedOnPercentage;
      }
    }

    return { value, isPeriodicOffYear: false, basedOnValue };
  }
}
