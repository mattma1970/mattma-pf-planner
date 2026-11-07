/**
 * LifecycleTransferStage - Phases 1 & 2 of the forecast pipeline.
 *
 * Phase 1: Calculate opening balances and identify lifecycle transfers
 * Phase 2: Apply lifecycle transfers (sell/transfer from endBehavior)
 *
 * These happen FIRST so proceeds from ending accounts are available
 * for user transfers in the next stage.
 */

import type {
  Account,
  Event,
  Person,
  Settings,
  ForecastWarning,
} from '../../schemas';

import type { ForecastContext, IForecastStage, LifecycleTransfer, PendingCgtEvent } from './stages';
import type { Year, Money, AccountId, PersonId } from '../../types';
import {
  isAccountActive,
  handleAccountTransfer,
  getAccountAcquisitionYear,
} from '../../../engine/accounts';
import { calculateCapitalGain } from '../../../engine/tax';

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
    } = context;

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
    const lifecycleTransfers: LifecycleTransfer[] = [];

    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isFirstActiveYear =
        !accountStartYears.has(account.id) && isActive;

      if (isFirstActiveYear) {
        accountStartYears.set(account.id, year);
      }

      const openingValue = isFirstActiveYear
        ? account.initialValue
        : account.type === 'income' || account.type === 'expense'
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

    // Apply lifecycle transfers
    const lifecycleFlows = new Map<AccountId, Money>();
    const pendingCgtEvents: PendingCgtEvent[] = [];

    for (const transfer of lifecycleTransfers) {
      lifecycleFlows.set(
        transfer.sourceId,
        (lifecycleFlows.get(transfer.sourceId) ?? 0) - transfer.amount
      );
      lifecycleFlows.set(
        transfer.destinationId,
        (lifecycleFlows.get(transfer.destinationId) ?? 0) + transfer.amount
      );

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
      lifecycleFlows,
      pendingCgtEvents,
      liabilityPayoffs,
    };
  }
}
