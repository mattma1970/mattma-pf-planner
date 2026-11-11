/**
 * DerivedFlowsStage - Phase 4 of the forecast pipeline.
 *
 * Handles derived flows: income deposits, expense funding, asset returns,
 * pension drawdowns, asset funding. Each flow is emitted as a pair of
 * emitAccountChange calls (one per leg) to maintain double-entry integrity.
 * Deferred double-entry transactions are applied after all accounts are
 * processed.
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
  applyDeferredTransactions,
  emitAccountChange,
  type DoubleEntryTransaction,
  DEFAULT_EQUITY_ACCOUNT_ID,
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
      totalExpenses,
      totalIncome,
    } = context;

    const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);
    const yearEvents = context.events.filter((e) => e.year === year);

    const newDeferredEntries: DoubleEntryTransaction[] = [...(deferredLedgerEntries ?? [])];
    const newLedgerEntries = [...(yearLedgerEntries ?? [])];

    const onError = (msg: string) => {
      context.yearWarnings.push({
        type: 'ledgerError',
        severity: 'error',
        message: msg,
      });
    };

    // Build incomeByAccount for tax processing
    const newIncomeByAccount: Array<{
      accountId: AccountId;
      accountName: string;
      amount: Money;
      fundedFromAccountId?: AccountId;
      personId?: PersonId;
      personName?: string;
    }> = [];

    const newIncomeByPerson = new Map<PersonId, Money>();

    let newTotalExpenses = totalExpenses;
    let newTotalIncome = totalIncome;

    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isFirstActiveYear = context.accountStartYears.get(account.id) === year;
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

      // Phase 4: Derived flows
      if (account.type === 'income') {
        const totalIncomeValue = result.startValue + result.growth;
        const projectedValue = result.endValue - result.contributions;

        newTotalIncome += totalIncomeValue;

        // Track income for tax processing
        if (totalIncomeValue > 0) {
          const person = account.owner ? persons.find((p) => p.id === account.owner) : undefined;
          newIncomeByAccount.push({
            accountId: account.id,
            accountName: account.name,
            amount: totalIncomeValue,
            fundedFromAccountId: account.fundedFromAccountId,
            personId: account.owner,
            personName: person?.name,
          });

          // Track income by person for Division 293 calculation
          // Exclude super contribution accounts - those are super contributions,
          // not personal income
          if (account.owner && !account.superContributionConfig) {
            const currentPersonIncome = newIncomeByPerson.get(account.owner) ?? 0;
            newIncomeByPerson.set(account.owner, currentPersonIncome + totalIncomeValue);
          }
        }

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

          // Double-entry: credit target super account, debit Retained Earnings
          // Missing target super account will be reported by emitLedgerEntry via onError.
          emitAccountChange(
            config.targetSuperAccountId,
            totalIncomeValue,
            'increase',
            'externalIn',
            `${config.source === 'employerSG' ? 'Employer SG' : config.source}: ${account.name}`,
            account.id,
            account.name,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
          emitAccountChange(
            DEFAULT_EQUITY_ACCOUNT_ID,
            totalIncomeValue,
            'decrease',
            'externalIn',
            `${config.source === 'employerSG' ? 'Employer SG' : config.source}: ${account.name}`,
            account.id,
            account.name,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
        } else if (totalIncomeValue > 0) {
          if (account.drawnFromAccountId && account.depositsToAccountId) {
            // Double-entry: debit drawnFrom, credit depositsTo
            // Missing accounts will be reported by emitLedgerEntry via onError.
            emitAccountChange(
              account.drawnFromAccountId,
              totalIncomeValue,
              'decrease',
              'internalTransfer',
              `Drawdown source: ${account.name}`,
              account.id,
              account.name,
              newLedgerEntries,
              accountResults,
              accountValues,
              onError
            );
            emitAccountChange(
              account.depositsToAccountId,
              totalIncomeValue,
              'increase',
              'internalTransfer',
              `Drawdown: ${account.name}`,
              account.id,
              account.name,
              newLedgerEntries,
              accountResults,
              accountValues,
              onError
            );
          } else if (account.depositsToAccountId) {
            // Double-entry: credit depositsTo, debit Retained Earnings
            // If depositsToAccountId references a non-existent account,
            // emitLedgerEntry will report the error via onError.
            emitAccountChange(
              account.depositsToAccountId,
              totalIncomeValue,
              'increase',
              'externalIn',
              `Income: ${account.name}`,
              account.id,
              account.name,
              newLedgerEntries,
              accountResults,
              accountValues,
              onError
            );
            emitAccountChange(
              DEFAULT_EQUITY_ACCOUNT_ID,
              totalIncomeValue,
              'decrease',
              'externalIn',
              `Income: ${account.name}`,
              account.id,
              account.name,
              newLedgerEntries,
              accountResults,
              accountValues,
              onError
            );
          }
        }
      }

      // Track expense total for all expense accounts
      if (account.type === 'expense') {
        newTotalExpenses += result.endValue;
      }

      if (account.type === 'expense' && account.fundedByAccountId) {
        // Double-entry: debit fundedBy (decrease asset), debit Retained Earnings (decrease equity)
        // Missing fundedBy account will be reported by emitLedgerEntry via onError.
        emitAccountChange(
          account.fundedByAccountId,
          result.endValue,
          'decrease',
          'externalOut',
          `Expense: ${account.name}`,
          account.id,
          account.name,
          newLedgerEntries,
          accountResults,
          accountValues,
          onError
        );
        emitAccountChange(
          DEFAULT_EQUITY_ACCOUNT_ID,
          result.endValue,
          'decrease',
          'externalOut',
          `Expense: ${account.name}`,
          account.id,
          account.name,
          newLedgerEntries,
          accountResults,
          accountValues,
          onError
        );
      }

      if (account.type === 'asset' && account.incomeTargetAccountId) {
        const balanceForGrowth = result.startValue;
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

          // Double-entry: credit income target, credit Retained Earnings
          // Missing incomeTarget will be reported by emitLedgerEntry via onError.
          emitAccountChange(
            account.incomeTargetAccountId,
            grossedUpReturn,
            'increase',
            'synthetic',
            `Return: ${account.name}`,
            account.id,
            account.name,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
          emitAccountChange(
            DEFAULT_EQUITY_ACCOUNT_ID,
            grossedUpReturn,
            'increase',
            'synthetic',
            `Return: ${account.name}`,
            account.id,
            account.name,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
        }
      }

      if (account.type === 'asset' && account.fundedByAccountId) {
        // userTransferFlows: contributions already applied directly by user
        // assetChange events in UserTransferStage — must not be re-funded here.
        const userContributions =
          result.contributions -
          Math.max(0, context.lifecycleFlows?.get(account.id) ?? 0) -
          (context.superContributionFlows?.get(account.id) ?? 0) -
          (context.userTransferFlows?.get(account.id) ?? 0);
        let fundingAmount = userContributions - result.withdrawals;
        if (isFirstActiveYear) {
          fundingAmount += account.initialValue;
        }
        if (fundingAmount > 0) {
          // Double-entry: debit fundedBy (decrease), credit asset (increase)
          // Missing fundedBy account will be reported by emitLedgerEntry via onError.
          emitAccountChange(
            account.fundedByAccountId,
            fundingAmount,
            'decrease',
            'internalTransfer',
            `Fund asset: ${account.name}`,
            account.id,
            account.name,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
          emitAccountChange(
            account.id,
            fundingAmount,
            'increase',
            'internalTransfer',
            `Fund asset: ${account.name}`,
            account.fundedByAccountId,
            account.name,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
        }
      }

      if (isLifecycleEnding) {
        // Handle hold behavior for ended accounts
        if (
          account.type === 'income' &&
          account.depositsToAccountId &&
          account.endBehavior === 'hold'
        ) {
          // Missing depositsTo account will be reported by emitLedgerEntry via onError.
          emitAccountChange(
            account.depositsToAccountId,
            result.endValue,
            'increase',
            'externalIn',
            `Income (held): ${account.name}`,
            account.id,
            account.name,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
          emitAccountChange(
            DEFAULT_EQUITY_ACCOUNT_ID,
            result.endValue,
            'decrease',
            'externalIn',
            `Income (held): ${account.name}`,
            account.id,
            account.name,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
        }
        if (
          account.type === 'expense' &&
          account.fundedByAccountId &&
          account.endBehavior === 'hold'
        ) {
          // Missing fundedBy account will be reported by emitLedgerEntry via onError.
          emitAccountChange(
            account.fundedByAccountId,
            result.endValue,
            'decrease',
            'externalOut',
            `Expense (held): ${account.name}`,
            account.id,
            account.name,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
          emitAccountChange(
            DEFAULT_EQUITY_ACCOUNT_ID,
            result.endValue,
            'decrease',
            'externalOut',
            `Expense (held): ${account.name}`,
            account.id,
            account.name,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
        }
      }
    }

    // Apply deferred ledger entries
    applyDeferredTransactions(
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
      incomeByAccount: newIncomeByAccount,
      incomeByPerson: newIncomeByPerson,
      totalExpenses: newTotalExpenses,
      totalIncome: newTotalIncome,
    };
  }
}
