/**
 * AutoTopupStage - Phase 8 of the forecast pipeline.
 *
 * Runs AFTER liability payments and tax so balance reflects all withdrawals.
 * Automatically transfers from another account when balance falls below threshold.
 */

import type {
  Account,
  Settings,
} from '../../schemas';

import type { ForecastContext, IForecastStage } from './stages';
import type { Money, AccountId } from '../../types';
import {
  emitTransaction,
  type DoubleEntryTransaction,
} from '../../../engine/ledger';
import { v4 as uuidv4 } from 'uuid';

export class AutoTopupStage implements IForecastStage {
  readonly id = 'auto-topup';
  readonly order = 7;
  readonly enabled = true;

  execute(context: ForecastContext): ForecastContext {
    const {
      accounts,
      accountResults,
      accountValues,
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
      if (account.type !== 'asset' || !account.autoTopup?.enabled) continue;

      const result = accountResults.get(account.id);
      if (!result) continue;

      const threshold = account.autoTopup.threshold ?? 0;

      if (result.endValue < threshold) {
        const sourceAccount = accounts.find((a) => a.id === account.autoTopup!.fromAccountId);
        if (!sourceAccount) continue;

        const targetBalance = account.autoTopup.targetBalance ?? threshold;
        const topupAmount = targetBalance - result.endValue;

        if (topupAmount > 0) {
          // Double-entry: debit source (decrease), credit target (increase)
          const sourceDelta = deltaForAccount(sourceAccount, 'decrease');
          const targetDelta = deltaForAccount(account, 'increase');

          emitTransaction(
            {
              id: uuidv4(),
              kind: 'internalTransfer',
              legs: [
                {
                  accountId: account.autoTopup!.fromAccountId,
                  amount: topupAmount,
                  delta: sourceDelta,
                  label: `Auto top-up to: ${account.name}`,
                  sourceAccountId: account.id,
                  sourceAccountName: account.name,
                },
                {
                  accountId: account.id,
                  amount: topupAmount,
                  delta: targetDelta,
                  label: `Auto top-up from: ${sourceAccount.name ?? 'Unknown'}`,
                  sourceAccountId: account.autoTopup!.fromAccountId,
                  sourceAccountName: sourceAccount.name,
                },
              ],
            },
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
          result.autoTopupApplied = true;
        }
      }
    }

    return {
      ...context,
      yearLedgerEntries: newLedgerEntries,
    };
  }
}

/**
 * Returns the correct delta direction for changing an account balance.
 * - To INCREASE an asset: debit; to DECREASE an asset: credit
 * - To INCREASE a liability: credit; to DECREASE a liability: debit
 */
function deltaForAccount(account: Account, direction: 'increase' | 'decrease'): 'debit' | 'credit' {
  if (direction === 'increase') {
    return account.type === 'asset' ? 'debit' : 'credit';
  } else {
    return account.type === 'asset' ? 'credit' : 'debit';
  }
}
