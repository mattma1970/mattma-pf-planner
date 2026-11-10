/**
 * UserTransferStage - Phase 2 of the forecast pipeline.
 *
 * Applies user transfer events and super contribution events as double-entry
 * ledger entries. These happen AFTER lifecycle transfers, so proceeds are
 * available for user transfers.
 */

import type {
  Account,
  Event,
  Person,
  Settings,
  ForecastWarning,
} from '../../schemas';

import type { ForecastContext, IForecastStage } from './stages';
import type { Year, Money, AccountId, PersonId } from '../../types';
import { isAccountActive } from '../../../engine/accounts';
import {
  aggregateContributionsByPerson,
  getContributionTaxCategory,
  isCapExempt,
  processPersonContributions,
  type ContributionProcessingResult,
} from '../../../engine/superContributions';
import {
  emitTransaction,
  type DoubleEntryTransaction,
  DEFAULT_EQUITY_ACCOUNT_ID,
} from '../../../engine/ledger';
import { v4 as uuidv4 } from 'uuid';

export class UserTransferStage implements IForecastStage {
  readonly id = 'user-transfer';
  readonly order = 2;
  readonly enabled = true;

  execute(context: ForecastContext): ForecastContext {
    const {
      year,
      accounts,
      events,
      persons,
      settings,
      accountStartYears,
      accountValues,
      accountResults,
      yearLedgerEntries,
      carryForwardStates,
      nonConcessionalCapStates,
      superContributionsByAccount,
    } = context;

    const yearEvents = events.filter((e) => e.year === year);

    const newLedgerEntries = [...(yearLedgerEntries ?? [])];
    const onError = (msg: string) => {
      context.yearWarnings.push({
        type: 'ledgerError',
        severity: 'error',
        message: msg,
      });
    };

    // Pre-calculate blocked/excess contributions per person
    const contributionCapResultsByPerson = new Map<
      PersonId,
      {
        unallowedNonConcessional: Money;
        totalRequestedNonConcessional: Money;
        excessConcessional: Money;
        blockedExcessConcessional: Money;
        totalRequestedConcessional: Money;
      }
    >();
    const contributionProcessingResults: ContributionProcessingResult[] = [];

    // Carry forward non-concessional cap state
    const newNonConcessionalCapStates = new Map(context.nonConcessionalCapStates);
    const newCarryForwardStates = new Map(context.carryForwardStates);

    if (persons.length > 0 && settings.super) {
      const contributionsByPerson = aggregateContributionsByPerson(
        events,
        year,
        persons,
        accounts
      );

      for (const person of persons) {
        const personContribs = contributionsByPerson.get(person.id);
        const currentCarryForwardState =
          carryForwardStates.get(person.id) ?? {
            personId: person.id,
            unusedCaps: [],
          };
        const currentNonConcCapState =
          nonConcessionalCapStates.get(person.id) ?? {
            personId: person.id,
            closingBalance: 0,
          };

        const result = processPersonContributions(
          person.id,
          year,
          personContribs?.concessional ?? 0,
          personContribs?.nonConcessional ?? 0,
          currentCarryForwardState,
          currentNonConcCapState,
          settings.super
        );

        contributionProcessingResults.push(result);

        // Update carry-forward state for next year
        newCarryForwardStates.set(person.id, result.newCarryForwardState);
        newNonConcessionalCapStates.set(person.id, result.newNonConcessionalCapState);

        const totalUnallowed =
          result.blockedNonConcessional + result.excessNonConcessional;

        const totalForNonConcCap =
          (personContribs?.nonConcessional ?? 0) + result.excessConcessional;

        let unallowedNonConcessional = 0;
        let blockedExcessConcessional = 0;

        if (totalUnallowed > 0 && totalForNonConcCap > 0) {
          const nonConcRatio =
            (personContribs?.nonConcessional ?? 0) / totalForNonConcCap;
          const excessConcRatio = result.excessConcessional / totalForNonConcCap;

          unallowedNonConcessional = totalUnallowed * nonConcRatio;
          blockedExcessConcessional = totalUnallowed * excessConcRatio;
        }

        contributionCapResultsByPerson.set(person.id, {
          unallowedNonConcessional,
          totalRequestedNonConcessional: personContribs?.nonConcessional ?? 0,
          excessConcessional: result.excessConcessional,
          blockedExcessConcessional,
          totalRequestedConcessional: personContribs?.concessional ?? 0,
        });

        // Generate consolidated warnings for blocked contributions (per person)
        const totalBlocked = unallowedNonConcessional + blockedExcessConcessional;
        if (totalBlocked > 0) {
          const parts: string[] = [];
          if (unallowedNonConcessional > 0) {
            parts.push(
              `$${Math.round(unallowedNonConcessional).toLocaleString()} non-concessional`
            );
          }
          if (blockedExcessConcessional > 0) {
            parts.push(
              `$${Math.round(blockedExcessConcessional).toLocaleString()} excess concessional`
            );
          }

          context.yearWarnings.push({
            type: 'blockedContribution',
            severity: 'warning',
            message: `Super contribution blocked for ${person.name}`,
            details: `${parts.join(' and ')} blocked - non-concessional cap exhausted`,
            personId: person.id,
            amount: totalBlocked,
          });
        }
      }
    }

    for (const event of yearEvents) {
      if (event.type === 'transfer' && event.sourceAccountId && event.targetAccountId) {
        let transferAmount = event.amount;
        if (event.transferAll) {
          const sourceAccount = accounts.find((a) => a.id === event.sourceAccountId);
          if (sourceAccount) {
            const isFirstActive =
              !accountStartYears.has(event.sourceAccountId) &&
              isAccountActive(sourceAccount, year, persons);
            const openingValue = isFirstActive
              ? sourceAccount.initialValue
              : (accountValues.get(event.sourceAccountId) ?? sourceAccount.initialValue);
            transferAmount = openingValue;
          }
        }

        if (transferAmount > 0) {
          const sourceAccount = accounts.find((a) => a.id === event.sourceAccountId);
          const targetAccount = accounts.find((a) => a.id === event.targetAccountId);

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
                  accountId: event.sourceAccountId,
                  amount: transferAmount,
                  delta: sourceDelta,
                  label: `Transfer: ${event.description}`,
                  sourceAccountId: event.sourceAccountId,
                  sourceAccountName: sourceAccount?.name,
                },
                {
                  accountId: event.targetAccountId,
                  amount: transferAmount,
                  delta: destDelta,
                  label: `Transfer: ${event.description}`,
                  sourceAccountId: event.sourceAccountId,
                  sourceAccountName: sourceAccount?.name,
                },
              ],
            },
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );
        }
      }

      // Handle super contribution events
      if (event.type === 'superContribution' && event.superContribution && event.targetAccountId) {
        const { contributionType, memberPersonId, reducesAssessableIncome, source } = event.superContribution;
        const exemptFromCap = event.superContribution.exemptFromCap ?? isCapExempt(contributionType);

        const targetAccount = accounts.find((a) => a.id === event.targetAccountId);
        const personId = targetAccount?.owner || memberPersonId;

        const taxCategory = getContributionTaxCategory(contributionType);

        let effectiveAmount = event.amount;

        if (!exemptFromCap && personId) {
          const capResult = contributionCapResultsByPerson.get(personId);

          if (capResult) {
            if (taxCategory === 'nonConcessional') {
              if (capResult.unallowedNonConcessional > 0 && capResult.totalRequestedNonConcessional > 0) {
                const unallowedRatio = capResult.unallowedNonConcessional / capResult.totalRequestedNonConcessional;
                const unallowedForThisEvent = event.amount * unallowedRatio;
                effectiveAmount = event.amount - unallowedForThisEvent;
              }
            } else if (taxCategory === 'concessional') {
              if (capResult.blockedExcessConcessional > 0 && capResult.totalRequestedConcessional > 0) {
                const blockedRatio = capResult.blockedExcessConcessional / capResult.totalRequestedConcessional;
                const blockedForThisEvent = event.amount * blockedRatio;
                effectiveAmount = event.amount - blockedForThisEvent;
              }
            }
          }
        }

        if (effectiveAmount > 0) {
          // Track contributions by super account for tax processing
          const existingSuper =
            superContributionsByAccount.get(event.targetAccountId) ?? {
              concessional: 0,
              nonConcessional: 0,
              preTaxReduction: 0,
              postTaxDeduction: 0,
              personId: personId ?? 'unassigned',
            };
          if (taxCategory === 'concessional') {
            existingSuper.concessional += effectiveAmount;
          } else {
            existingSuper.nonConcessional += effectiveAmount;
          }
          // Track pre/post-tax reduction for assessable income calculation
          if (event.superContribution?.reducesAssessableIncome) {
            if (event.superContribution.source === 'salarySacrifice') {
              existingSuper.preTaxReduction += effectiveAmount;
            } else {
              existingSuper.postTaxDeduction += effectiveAmount;
            }
          }
          superContributionsByAccount.set(event.targetAccountId, existingSuper);
          if (exemptFromCap) {
            // Cap-exempt: externalIn credit to super account, debit Retained Earnings
            const sourceAccount = accounts.find((a) => a.id === event.sourceAccountId);
            emitTransaction(
              {
                id: uuidv4(),
                kind: 'externalIn',
                legs: [
                  {
                    accountId: event.targetAccountId,
                    amount: effectiveAmount,
                    delta: 'debit',
                    label: `Super contribution: ${event.description}`,
                    sourceAccountId: event.sourceAccountId,
                    sourceAccountName: sourceAccount?.name,
                  },
                  {
                    accountId: DEFAULT_EQUITY_ACCOUNT_ID,
                    amount: effectiveAmount,
                    delta: 'credit',
                    label: `Super contribution: ${event.description}`,
                    sourceAccountId: event.sourceAccountId,
                    sourceAccountName: sourceAccount?.name,
                  },
                ],
              },
              newLedgerEntries,
              accountResults,
              accountValues,
              onError
            );
            } else if (event.sourceAccountId) {
              // Internal transfer from source to super account
              // Credit source (decrease asset), debit super (increase asset)
              const sourceAccount = accounts.find((a) => a.id === event.sourceAccountId);
              emitTransaction(
                {
                  id: uuidv4(),
                  kind: 'internalTransfer',
                  legs: [
                    {
                      accountId: event.sourceAccountId,
                      amount: effectiveAmount,
                      delta: 'credit',
                      label: `Super contribution: ${event.description}`,
                      sourceAccountId: event.sourceAccountId,
                      sourceAccountName: sourceAccount?.name,
                    },
                    {
                      accountId: event.targetAccountId,
                      amount: effectiveAmount,
                      delta: 'debit',
                      label: `Super contribution: ${event.description}`,
                      sourceAccountId: event.sourceAccountId,
                      sourceAccountName: sourceAccount?.name,
                    },
                  ],
                },
                newLedgerEntries,
                accountResults,
                accountValues,
                onError
              );
            } else {
              // Non-exempt contribution without source: externalIn offset by Retained Earnings
              emitTransaction(
                {
                  id: uuidv4(),
                  kind: 'externalIn',
                  legs: [
                    {
                      accountId: event.targetAccountId,
                      amount: effectiveAmount,
                      delta: 'debit',
                      label: `Super contribution: ${event.description}`,
                      sourceAccountId: undefined,
                      sourceAccountName: undefined,
                    },
                    {
                      accountId: DEFAULT_EQUITY_ACCOUNT_ID,
                      amount: effectiveAmount,
                      delta: 'credit',
                      label: `Super contribution: ${event.description}`,
                      sourceAccountId: undefined,
                      sourceAccountName: undefined,
                    },
                  ],
                },
                newLedgerEntries,
                accountResults,
                accountValues,
                onError
              );
            }
          // If no source account and not exempt, contribution is blocked
        }
      }
    }

    return {
      ...context,
      contributionCapResultsByPerson,
      contributionProcessingResults,
      nonConcessionalCapStates: newNonConcessionalCapStates,
      carryForwardStates: newCarryForwardStates,
      yearLedgerEntries: newLedgerEntries,
      superContributionsByAccount,
    };
  }
}
