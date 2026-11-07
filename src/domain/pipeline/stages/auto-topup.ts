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
import { emitLedgerEntry } from '../../../engine/ledger';

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
        const sourceResult = accountResults.get(account.autoTopup.fromAccountId);
        if (!sourceResult) continue;

        const targetBalance = account.autoTopup.targetBalance ?? threshold;
        const topupAmount = targetBalance - result.endValue;

        if (topupAmount > 0) {
          const sourceAccount = accounts.find(
            (a) => a.id === account.autoTopup!.fromAccountId
          );

          emitLedgerEntry(
            {
              accountId: account.autoTopup!.fromAccountId,
              amount: topupAmount,
              delta: 'debit',
              kind: 'internalTransfer',
              label: `Auto top-up to: ${account.name}`,
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            },
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
          emitLedgerEntry(
            {
              accountId: account.id,
              amount: topupAmount,
              delta: 'credit',
              kind: 'internalTransfer',
              label: `Auto top-up from: ${sourceAccount?.name ?? 'Unknown'}`,
              sourceAccountId: account.autoTopup!.fromAccountId,
              sourceAccountName: sourceAccount?.name,
            },
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
          result.autoTopupApplied = true;
          sourceResult.autoTopupApplied = true;
        }
      }
    }

    return {
      ...context,
      yearLedgerEntries: newLedgerEntries,
    };
  }
}
