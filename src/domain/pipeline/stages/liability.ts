/**
 * LiabilityStage - Phase 6 of the forecast pipeline.
 *
 * Handles liability interest and payment processing.
 */

import type {
  Account,
  Person,
  Settings,
} from '../../schemas';

import type {
  ForecastContext,
  IForecastStage,
  AccountYearResult,
} from './stages';
import type { Year, Money, AccountId } from '../../types';
import { emitLedgerEntry } from '../../../engine/ledger';

export class LiabilityStage implements IForecastStage {
  readonly id = 'liability';
  readonly order = 5;
  readonly enabled = true;

  execute(context: ForecastContext): ForecastContext {
    const {
      year,
      accounts,
      persons,
      settings,
      accountResults,
      accountValues,
      liabilityPayoffs,
      yearLedgerEntries,
    } = context;

    const newLedgerEntries = [...(yearLedgerEntries ?? [])];
    const onError = (msg: string) => {
      context.yearWarnings.push({
        type: 'ledgerError',
        severity: 'error',
        message: msg,
      });
    };

    for (const account of accounts) {
      if (account.type !== 'liability') continue;

      const result = accountResults.get(account.id);
      if (!result) continue;

      const payoffInfo = liabilityPayoffs?.get(account.id);
      if (payoffInfo) {
        emitLedgerEntry(
          {
            accountId: payoffInfo.fundedByAccountId,
            amount: payoffInfo.amount,
            delta: 'debit',
            kind: 'internalTransfer',
            label: `Payoff: ${payoffInfo.liabilityName}`,
            sourceAccountId: account.id,
            sourceAccountName: payoffInfo.liabilityName,
          },
          newLedgerEntries,
          accountResults,
          accountValues,
          onError
        );
        result.withdrawals = payoffInfo.amount;
        result.endValue = 0;
        accountValues.set(account.id, 0);
        continue;
      }

      if (result.endValue <= 0) continue;

      const interestRate = account.interestRate ?? 0;

      let effectiveBalance = result.endValue;
      if (account.offsetAccountId) {
        const offsetResult = accountResults.get(account.offsetAccountId);
        if (offsetResult) {
          const offsetBalance = Math.max(0, offsetResult.endValue);
          effectiveBalance = Math.max(0, result.endValue - offsetBalance);
        }
      }

      const interestAmount = effectiveBalance * interestRate;

      let paymentAmount = account.annualPayment ?? 0;

      if (account.calculatePayment && account.endCondition) {
        const owner = persons.find((p) => p.id === account.owner);
        let endYear: Year;
        if (account.endCondition.type === 'year') {
          endYear = account.endCondition.year;
        } else if (account.endCondition.type === 'age' && owner) {
          endYear = owner.birthYear + account.endCondition.age;
        } else {
          endYear = year + 30;
        }

        const yearsRemaining = Math.max(1, endYear - year + 1);

        if (interestRate > 0 && effectiveBalance > 0) {
          const principalToPay = result.endValue;
          const principalPaymentPerYear = principalToPay / yearsRemaining;
          paymentAmount = principalPaymentPerYear + interestAmount;
        } else if (interestRate > 0) {
          paymentAmount = result.endValue / yearsRemaining;
        } else {
          paymentAmount = result.endValue / yearsRemaining;
        }
      }

      if (account.paymentType === 'interestOnly') {
        paymentAmount = interestAmount;
      }

      const maxPayment = result.endValue + interestAmount;
      paymentAmount = Math.min(paymentAmount, maxPayment);

      const principalReduction =
        account.paymentType === 'interestOnly' ? 0 : Math.max(0, paymentAmount - interestAmount);

      result.growth = interestAmount;
      result.withdrawals = principalReduction;

      if (account.paymentType === 'interestOnly') {
        result.endValue = result.endValue;
      } else {
        result.endValue = Math.max(0, result.endValue + interestAmount - paymentAmount);
      }
      accountValues.set(account.id, result.endValue);

      if (account.fundedByAccountId && paymentAmount > 0) {
        emitLedgerEntry(
          {
            accountId: account.fundedByAccountId,
            amount: paymentAmount,
            delta: 'debit',
            kind: 'externalOut',
            label: `Liability payment: ${account.name}`,
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          },
          newLedgerEntries,
          accountResults,
          accountValues,
          onError
        );
      }
    }

    return {
      ...context,
      yearLedgerEntries: newLedgerEntries,
    };
  }
}
