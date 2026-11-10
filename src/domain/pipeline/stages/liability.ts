/**
 * LiabilityStage - Phase 5 of the forecast pipeline.
 *
 * Handles liability interest and payment processing using double-entry
 * ledger entries.
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
import {
  emitAccountChange,
  DEFAULT_EQUITY_ACCOUNT_ID,
} from '../../../engine/ledger';
import { v4 as uuidv4 } from 'uuid';

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
        const fundingAccount = accounts.find((a) => a.id === payoffInfo.fundedByAccountId);
        if (fundingAccount) {
          emitAccountChange(
            payoffInfo.fundedByAccountId,
            payoffInfo.amount,
            'decrease',
            'internalTransfer',
            `Payoff: ${payoffInfo.liabilityName}`,
            payoffInfo.fundedByAccountId,
            payoffInfo.liabilityName,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
          emitAccountChange(
            account.id,
            payoffInfo.amount,
            'decrease',
            'internalTransfer',
            `Payoff: ${payoffInfo.liabilityName}`,
            account.id,
            payoffInfo.liabilityName,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
        }
        result.endValue = 0;
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
      const principalBalance = result.endValue; // balance BEFORE interest accrual

      if (interestAmount !== 0) {
        emitAccountChange(
          DEFAULT_EQUITY_ACCOUNT_ID,
          interestAmount,
          'decrease',
          'synthetic',
          `Interest: ${account.name}`,
          account.id,
          account.name,
          newLedgerEntries,
          accountResults,
          accountValues,
          onError
        );
        emitAccountChange(
          account.id,
          interestAmount,
          'increase',
          'synthetic',
          `Interest: ${account.name}`,
          account.id,
          account.name,
          newLedgerEntries,
          accountResults,
          accountValues,
          onError
        );
        result.growth += interestAmount;
      }

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
          const principalToPay = principalBalance;
          const principalPaymentPerYear = principalToPay / yearsRemaining;
          paymentAmount = principalPaymentPerYear + interestAmount;
        } else if (interestRate > 0) {
          paymentAmount = principalBalance / yearsRemaining;
        } else {
          paymentAmount = principalBalance / yearsRemaining;
        }
      }

      if (account.paymentType === 'interestOnly') {
        paymentAmount = interestAmount;
      }

      const maxPayment = result.endValue + interestAmount;
      paymentAmount = Math.min(paymentAmount, maxPayment);

      const principalReduction =
        account.paymentType === 'interestOnly' ? 0 : Math.max(0, paymentAmount - interestAmount);

      if (paymentAmount > 0) {
        const fundingAccount = accounts.find((a) => a.id === account.fundedByAccountId);
        if (fundingAccount) {
          emitAccountChange(
            account.id,
            paymentAmount,
            'decrease',
            'internalTransfer',
            `Liability payment: ${account.name}`,
            account.id,
            account.name,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
          emitAccountChange(
            account.fundedByAccountId,
            paymentAmount,
            'decrease',
            'internalTransfer',
            `Liability payment: ${account.name}`,
            account.id,
            account.name,
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
        }
      }

      // result.endValue has already been updated by emitLedgerEntry above
      // Track principal reduction as withdrawals (not total payment including interest)
      result.withdrawals = principalReduction;
      accountValues.set(account.id, result.endValue);
    }

    return {
      ...context,
      yearLedgerEntries: newLedgerEntries,
    };
  }
}
