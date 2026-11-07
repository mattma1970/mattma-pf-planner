/**
 * DerivedFlowsStage - Phase 5 of the forecast pipeline.
 *
 * Handles derived flows: income deposits, expense funding, asset returns,
 * pension drawdowns, asset funding. These are emitted as deferred ledger
 * entries and applied after all accounts are processed.
 */

import type {
  Account,
  Event,
  Person,
  Settings,
  Epoch,
  Assumptions,
} from '../../schemas';

import type {
  ForecastContext,
  IForecastStage,
  AccountYearResult,
} from './stages';
import type { Year, Money, AccountId, PersonId } from '../../types';
import { isAccountActive } from '../../../engine/accounts';
import { getAccountAssumptionForEpoch } from '../../../engine/accounts';
import {
  emitLedgerEntry,
  applyDeferredLedger,
} from '../../../engine/ledger';

export class DerivedFlowsStage implements IForecastStage {
  readonly id = 'derived-flows';
  readonly order = 4;
  readonly enabled = true;

  execute(context: ForecastContext): ForecastContext {
    const {
      year,
      accounts,
      persons,
      settings,
      epochs,
      accountResults,
      accountValues,
      superContributionsByAccount,
      incomeByAccount,
      frankingCreditsByPerson,
      yearLedgerEntries,
      deferredLedgerEntries,
      ledgerError,
    } = context;

    const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);
    const yearEvents = context.events.filter((e) => e.year === year);

    const newDeferredEntries = [...(deferredLedgerEntries ?? [])];
    const newLedgerEntries = [...(yearLedgerEntries ?? [])];

    const onError = (msg: string) => {
      context.yearWarnings.push({
        type: 'ledgerError',
        severity: 'error',
        message: msg,
      });
    };

    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isFirstActiveYear =
        context.accountStartYears.get(account.id) === year;
      const isLifecycleEnding = context.lifecycleTransfers?.some(
        (t) => t.sourceId === account.id
      ) ?? false;

      const openingValue = isFirstActiveYear
        ? account.initialValue
        : account.type === 'income' || account.type === 'expense'
          ? 0
          : (context.accountValues.get(account.id) ?? account.initialValue);

      const result = accountResults.get(account.id);
      if (!result) continue;

      // Phase 5: Derived flows
      if (account.type === 'income') {
        const totalIncomeValue = result.startValue + result.growth; // projectedValue + contributions already in endValue
        // Use projectedValue from result - we stored it as startValue + growth
        // Actually endValue for income = taxableIncome = projectedValue + contributions
        const projectedValue = result.endValue - result.contributions;

        if (account.superContributionConfig && totalIncomeValue > 0) {
          const config = account.superContributionConfig;
          const targetSuperAccount = accounts.find(
            (a) => a.id === config.targetSuperAccountId
          );
          const personId = account.owner ?? targetSuperAccount?.owner;

          const taxCategory = config.contributionType === 'concessional'
            ? 'concessional'
            : 'nonConcessional';

          const existing =
            superContributionsByAccount.get(config.targetSuperAccountId) ?? {
              concessional: 0,
              nonConcessional: 0,
              preTaxReduction: 0,
              postTaxDeduction: 0,
              personId: personId ?? 'unassigned',
            };

          if (taxCategory === 'concessional') {
            existing.concessional += totalIncomeValue;
            if (config.reducesAssessableIncome) {
              if (config.source === 'salarySacrifice') {
                existing.preTaxReduction += totalIncomeValue;
              } else {
                existing.postTaxDeduction += totalIncomeValue;
              }
            }
          } else {
            existing.nonConcessional += totalIncomeValue;
          }
          superContributionsByAccount.set(config.targetSuperAccountId, existing);

          newDeferredEntries.push({
            accountId: config.targetSuperAccountId,
            amount: totalIncomeValue,
            delta: 'credit',
            kind: 'externalIn',
            label: `${config.source === 'employerSG' ? 'Employer SG' : config.source}: ${account.name}`,
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        } else if (totalIncomeValue > 0) {
          if (account.drawnFromAccountId && account.depositsToAccountId) {
            newDeferredEntries.push({
              accountId: account.drawnFromAccountId,
              amount: totalIncomeValue,
              delta: 'debit',
              kind: 'internalTransfer',
              label: `Drawdown source: ${account.name}`,
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
            newDeferredEntries.push({
              accountId: account.depositsToAccountId,
              amount: totalIncomeValue,
              delta: 'credit',
              kind: 'internalTransfer',
              label: `Drawdown: ${account.name}`,
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
          } else if (account.depositsToAccountId) {
            newDeferredEntries.push({
              accountId: account.depositsToAccountId,
              amount: totalIncomeValue,
              delta: 'credit',
              kind: 'externalIn',
              label: `Income: ${account.name}`,
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
          }
        }
      }

      if (account.type === 'expense' && account.fundedByAccountId) {
        newDeferredEntries.push({
          accountId: account.fundedByAccountId,
          amount: result.endValue, // projectedValue for expense
          delta: 'debit',
          kind: 'externalOut',
          label: `Expense: ${account.name}`,
          sourceAccountId: account.id,
          sourceAccountName: account.name,
        });
      }

      if (account.type === 'asset' && account.incomeTargetAccountId) {
        const balanceForGrowth = result.startValue; // Approximation
        const epochReturnOverride = getAccountAssumptionForEpoch(
          account,
          year,
          sortedEpochs,
          'returnRate'
        );
        const effectiveReturnRate = epochReturnOverride ?? account.returnRate;
        if (effectiveReturnRate) {
          const cashReturn = balanceForGrowth * effectiveReturnRate;

          const frankingPercentage = account.frankingPercentage ?? 0;
          const companyTaxRate = settings.companyTaxRate ?? 0.30;

          let grossedUpReturn = cashReturn;
          let frankingCredits = 0;

          if (frankingPercentage > 0 && companyTaxRate > 0) {
            const frankedPortion = cashReturn * frankingPercentage;
            const unfrankedPortion = cashReturn - frankedPortion;
            const grossedUpFrankedPortion = frankedPortion / (1 - companyTaxRate);
            frankingCredits = grossedUpFrankedPortion - frankedPortion;
            grossedUpReturn = grossedUpFrankedPortion + unfrankedPortion;

            const ownerId = account.owner ?? 'unassigned';
            // frankingCreditsByPerson is updated in context
          }

          newDeferredEntries.push({
            accountId: account.incomeTargetAccountId,
            amount: grossedUpReturn,
            delta: 'credit',
            kind: 'synthetic',
            label: `Return: ${account.name}`,
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
      }

      if (account.type === 'asset' && account.fundedByAccountId) {
        const userContributions =
          result.contributions -
          Math.max(0, context.lifecycleFlows?.get(account.id) ?? 0) -
          (context.superContributionFlows?.get(account.id) ?? 0);
        let fundingAmount = userContributions - result.withdrawals;
        if (isFirstActiveYear) {
          fundingAmount += account.initialValue;
        }
        if (fundingAmount > 0) {
          newDeferredEntries.push({
            accountId: account.fundedByAccountId,
            amount: fundingAmount,
            delta: 'debit',
            kind: 'internalTransfer',
            label: `Fund asset: ${account.name}`,
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
      }

      if (isLifecycleEnding) {
        // Handle hold behavior for ended accounts
        if (
          account.type === 'income' &&
          account.depositsToAccountId &&
          account.endBehavior === 'hold'
        ) {
          newDeferredEntries.push({
            accountId: account.depositsToAccountId,
            amount: result.endValue,
            delta: 'credit',
            kind: 'externalIn',
            label: `Income (held): ${account.name}`,
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
        if (
          account.type === 'expense' &&
          account.fundedByAccountId &&
          account.endBehavior === 'hold'
        ) {
          newDeferredEntries.push({
            accountId: account.fundedByAccountId,
            amount: result.endValue,
            delta: 'debit',
            kind: 'externalOut',
            label: `Expense (held): ${account.name}`,
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
      }
    }

    // Apply deferred ledger entries
    applyDeferredLedger(
      newDeferredEntries,
      newLedgerEntries,
      accountResults,
      accountValues,
      onError
    );

    return {
      ...context,
      deferredLedgerEntries: newDeferredEntries,
      yearLedgerEntries: newLedgerEntries,
      superContributionsByAccount,
    };
  }
}
