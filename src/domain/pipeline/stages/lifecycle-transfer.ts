/**
 * LifecycleTransferStage - Phase 1 of the forecast pipeline.
 *
 * Detects accounts ending this year (endBehavior: transfer/sell/sellNoCgt)
 * and emits double-entry ledger transfers. Proceeds are available for
 * user transfers in the next stage.
 */

import type {
  Account,
  Event,
  Person,
  Settings,
  ForecastWarning,
} from '../../schemas';

import type { ForecastContext, IForecastStage, PendingCgtEvent } from './stages';
import type { Year, Money, AccountId, PersonId } from '../../types';
import {
  isAccountActive,
  handleAccountTransfer,
  getAccountAcquisitionYear,
} from '../../../engine/accounts';
import { calculateCapitalGain } from '../../../engine/tax';
import {
  emitTransaction,
  type DoubleEntryTransaction,
  DEFAULT_EQUITY_ACCOUNT_ID,
} from '../../../engine/ledger';
import { v4 as uuidv4 } from 'uuid';

export class LifecycleTransferStage implements IForecastStage {
  readonly id = 'lifecycle-transfer';
  readonly order = 1;
  readonly enabled = true;

  execute(context: ForecastContext): ForecastContext {
    const {
      year,
      accounts,
      persons,
      settings,
      accountValues,
      accountStartYears,
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

    // Capture opening values for all accounts at the start of the year
    const openingValues = new Map<AccountId, Money>();
    for (const account of accounts) {
      const isFirstActiveYear =
        !accountStartYears.has(account.id) &&
        isAccountActive(account, year, persons);
      const opening = isFirstActiveYear
        ? account.initialValue
        : account.type === 'income'
          ? 0
          : (accountValues.get(account.id) ?? account.initialValue);
      openingValues.set(account.id, opening);
    }

    // First pass: determine which accounts are ending and their transfer amounts
    const lifecycleTransfers: Array<{
      sourceId: AccountId;
      destinationId: AccountId;
      amount: Money;
      endBehavior: 'transfer' | 'sell' | 'sellNoCgt';
      account: Account;
    }> = [];

    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isFirstActiveYear =
        !accountStartYears.has(account.id) && isActive;

      if (isFirstActiveYear) {
        accountStartYears.set(account.id, year);
      }

      const openingValue = isFirstActiveYear
        ? account.initialValue
        : account.type === 'income'
          ? 0
          : (accountValues.get(account.id) ?? account.initialValue);

      if (isActive) {
        const transfer = handleAccountTransfer(
          account,
          year,
          persons,
          openingValue
        );
        if (
          transfer.isTransferYear &&
          transfer.destinationId &&
          transfer.endBehavior
        ) {
          lifecycleTransfers.push({
            sourceId: account.id,
            destinationId: transfer.destinationId,
            amount: transfer.amount,
            endBehavior: transfer.endBehavior,
            account,
          });
        }
      }
    }

    // Emit double-entry transfers
    const pendingCgtEvents: PendingCgtEvent[] = [];

    for (const transfer of lifecycleTransfers) {
      const sourceAccount = transfer.account;
      const destAccount = accounts.find((a) => a.id === transfer.destinationId);
      const amount = transfer.amount;

      if (!destAccount) continue;

      // Source account balance decreases
      // Destination account balance increases (asset) or decreases (liability paid off)
      const sourceDelta = sourceAccount.type === 'asset' ? 'credit' : 'debit';
      // Destination: debit increases an asset, debit decreases a liability (paid off)
      const destDelta = 'debit';
      emitTransaction(
        {
          id: uuidv4(),
          kind: 'internalTransfer',
          legs: [
            {
              accountId: transfer.sourceId,
              amount,
              delta: sourceDelta,
              label: `Lifecycle transfer: ${transfer.account.name}`,
              sourceAccountId: transfer.sourceId,
              sourceAccountName: transfer.account.name,
            },
            {
              accountId: transfer.destinationId,
              amount,
              delta: destDelta,
              label: `Lifecycle transfer: ${transfer.account.name}`,
              sourceAccountId: transfer.sourceId,
              sourceAccountName: transfer.account.name,
            },
          ],
        },
        newLedgerEntries,
        context.accountResults,
        accountValues,
        onError
      );

      // Handle CGT for sell behavior
      if (transfer.endBehavior === 'sell') {
        const account = transfer.account;
        const costBase = account.costBase ?? account.initialValue;
        const acquisitionYear = getAccountAcquisitionYear(account, persons);
        const eligibleForDiscount = account.eligibleForCgtDiscount ?? true;

        const cgtResult = calculateCapitalGain(
          transfer.amount,
          costBase,
          acquisitionYear,
          year,
          eligibleForDiscount
        );

        const fundingAccountId =
          account.taxFundedFromAccountId ??
          settings.defaultTaxFundingAccountId ??
          'unassigned';
        const fundingAccount = accounts.find((a) => a.id === fundingAccountId);
        const ownerPerson = account.owner
          ? persons.find((p) => p.id === account.owner)
          : undefined;

        pendingCgtEvents.push({
          accountId: account.id,
          accountName: account.name,
          cgtResult,
          fundedFromAccountId: fundingAccountId,
          fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
          personId: account.owner,
          personName: ownerPerson?.name,
        });
      }
    }

    // Identify liabilities to pay off when their linked asset sells
    const liabilityPayoffs = new Map<AccountId, {
      amount: Money;
      fundedByAccountId: AccountId;
      triggeredByAssetId: AccountId;
      triggeredByAssetName: string;
      liabilityName: string;
    }>();

    for (const transfer of lifecycleTransfers) {
      if (
        transfer.endBehavior === 'sell' ||
        transfer.endBehavior === 'sellNoCgt'
      ) {
        const account = transfer.account;
        for (const liability of accounts) {
          if (
            liability.type === 'liability' &&
            liability.payoffFromAccountId === account.id
          ) {
            const liabilityBalance =
              accountValues.get(liability.id) ?? liability.initialValue;
            if (liabilityBalance > 0 && liability.fundedByAccountId) {
              liabilityPayoffs.set(liability.id, {
                amount: liabilityBalance,
                fundedByAccountId: liability.fundedByAccountId,
                triggeredByAssetId: account.id,
                triggeredByAssetName: account.name,
                liabilityName: liability.name,
              });
            }
          }
        }
      }
    }

    return {
      ...context,
      openingValues,
      lifecycleTransfers,
      pendingCgtEvents,
      liabilityPayoffs,
      yearLedgerEntries: newLedgerEntries,
    };
  }
}
