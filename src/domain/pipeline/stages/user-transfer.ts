/**
 * UserTransferStage - Phase 3 of the forecast pipeline.
 *
 * Applies user transfer events and super contribution events.
 * These happen AFTER lifecycle transfers, so proceeds are available.
 */

import type {
  Account,
  Event,
  Person,
  Settings,
  ForecastWarning,
} from '../../schemas';

import type {
  ForecastContext,
  IForecastStage,
  SuperContributionAccountResult,
  ContributionCapResultByPerson,
} from './stages';
import type { Year, Money, AccountId, PersonId } from '../../types';
import { isAccountActive } from '../../../engine/accounts';
import {
  aggregateContributionsByPerson,
  getContributionTaxCategory,
  isCapExempt,
  processPersonContributions,
  type ContributionProcessingResult,
} from '../../../engine/superContributions';

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
      lifecycleFlows,
      lifecycleTransfers,
      accountValues,
    } = context;

    const yearEvents = events.filter((e) => e.year === year);

    const userTransferFlows = new Map<AccountId, Money>();
    const superContributionFlows = new Map<AccountId, Money>();
    const superContributionsByAccount = new Map<
      AccountId,
      SuperContributionAccountResult
    >();

    // Pre-calculate blocked/excess contributions per person
    const contributionCapResultsByPerson = new Map<
      PersonId,
      ContributionCapResultByPerson
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

      // We need carry-forward and non-concessional states from context
      const carryForwardStates = context.carryForwardStates;
      const nonConcessionalCapStates = context.nonConcessionalCapStates;

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

        // Update non-concessional cap state for next year
        newNonConcessionalCapStates.set(person.id, result.newNonConcessionalCapState);
        // Update carry-forward state for next year
        newCarryForwardStates.set(person.id, result.newCarryForwardState);

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
            const lifecycleChange = lifecycleFlows?.get(event.sourceAccountId) ?? 0;
            transferAmount = openingValue + lifecycleChange;
          }
        }

        userTransferFlows.set(
          event.sourceAccountId,
          (userTransferFlows.get(event.sourceAccountId) ?? 0) - transferAmount
        );
        userTransferFlows.set(
          event.targetAccountId,
          (userTransferFlows.get(event.targetAccountId) ?? 0) + transferAmount
        );
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

        superContributionFlows.set(
          event.targetAccountId,
          (superContributionFlows.get(event.targetAccountId) ?? 0) + effectiveAmount
        );

        if (event.sourceAccountId) {
          userTransferFlows.set(
            event.sourceAccountId,
            (userTransferFlows.get(event.sourceAccountId) ?? 0) - effectiveAmount
          );
        }

        const existing =
          superContributionsByAccount.get(event.targetAccountId) ?? {
            concessional: 0,
            nonConcessional: 0,
            preTaxReduction: 0,
            postTaxDeduction: 0,
            personId: personId ?? 'unassigned',
          };
        if (taxCategory === 'concessional') {
          existing.concessional += event.amount;
          if (reducesAssessableIncome) {
            if (source === 'salarySacrifice') {
              existing.preTaxReduction += event.amount;
            } else {
              existing.postTaxDeduction += event.amount;
            }
          }
        } else {
          existing.nonConcessional += effectiveAmount;
        }
        superContributionsByAccount.set(event.targetAccountId, existing);
      }
    }

    return {
      ...context,
      userTransferFlows,
      superContributionFlows,
      superContributionsByAccount,
      contributionCapResultsByPerson,
      contributionProcessingResults,
      nonConcessionalCapStates: newNonConcessionalCapStates,
      carryForwardStates: newCarryForwardStates,
    };
  }
}
