/**
 * TaxStage - Phase 7 of the forecast pipeline.
 *
 * Handles tax calculations using pluggable tax rules from RuleRegistry.
 * This is the primary extension point for Australian tax legislation changes.
 *
 * Tax rules are resolved by year from RuleRegistry, so a new tax year,
 * new offset, or new rebate is a new rule registration, not an engine change.
 */

import type {
  Account,
  Event,
  Person,
  Settings,
} from '../../schemas';

import type {
  ForecastContext,
  IForecastStage,
  TaxEvent,
  PendingCgtEvent,
} from './stages';
import type { Year, Money, AccountId, PersonId } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import {
  calculateIncomeTax,
  calculateCapitalGain,
} from '../../../engine/tax';
import { calculateDiv293 } from '../../../engine/taxRules';
import {
  emitLedgerEntry,
  emitTransaction,
  type DoubleEntryTransaction,
  DEFAULT_EQUITY_ACCOUNT_ID,
} from '../../../engine/ledger';
import {
  processPersonContributions,
  type ContributionProcessingResult,
} from '../../../engine/superContributions';

export class TaxStage implements IForecastStage {
  readonly id = 'tax';
  readonly order = 6;
  readonly enabled = true;

  execute(context: ForecastContext): ForecastContext {
    const {
      year,
      accounts,
      events,
      persons,
      settings,
      incomeByAccount,
      incomeByPerson,
      pendingCgtEvents,
      capitalLossStates,
      frankingCreditsByPerson,
      superContributionsByAccount,
      carryForwardStates,
      nonConcessionalCapStates,
      yearLedgerEntries,
      accountResults,
      accountValues,
    } = context;

    // Update capital loss carry-forward opening balances for all persons
    // Opening balance = previous year's closing balance (carryForwardBalance)
    const newCapitalLossStates = new Map(context.capitalLossStates);
    for (const state of newCapitalLossStates.values()) {
      state.openingBalance = state.carryForwardBalance;
    }

    const newLedgerEntries = [...(yearLedgerEntries ?? [])];
    const taxEvents: TaxEvent[] = [];
    const onError = (msg: string) => {
      context.yearWarnings.push({
        type: 'ledgerError',
        severity: 'error',
        message: msg,
      });
    };

    const defaultFundingAccountId =
      settings.defaultTaxFundingAccountId ?? 'unassigned';
    const defaultFundingAccount = settings.defaultTaxFundingAccountId
      ? accounts.find((a) => a.id === settings.defaultTaxFundingAccountId)
      : undefined;

    // 1. Generate per-account income tax events
    for (const income of incomeByAccount ?? []) {
      const fundingAccountId =
        income.fundedFromAccountId ?? defaultFundingAccountId;
      const fundingAccount = income.fundedFromAccountId
        ? accounts.find((a) => a.id === income.fundedFromAccountId)
        : defaultFundingAccount;

      taxEvents.push({
        id: uuidv4(),
        year,
        type: 'incomeTax',
        description: income.accountName,
        sourceAccountId: income.accountId,
        sourceAccountName: income.accountName,
        assessableAmount: income.amount,
        fundedFromAccountId: fundingAccountId,
        fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
        personId: income.personId,
        personName: income.personName,
      });
    }

    // 2. Generate tax events from events with taxTreatmentType
    const yearEvents = events.filter((e) => e.year === year);
    for (const event of yearEvents) {
      if (event.type === 'superContribution') continue;

      if (event.affectedAccountId) {
        const affectedAccount = accounts.find((a) => a.id === event.affectedAccountId);
        if (affectedAccount && (affectedAccount.type === 'income' || affectedAccount.type === 'expense')) {
          continue;
        }
      }

      if (event.taxTreatmentType === 'taxable' && event.amount > 0) {
        const fundingAccountId =
          event.taxFundedFromAccountId ?? defaultFundingAccountId;
        const fundingAccount = event.taxFundedFromAccountId
          ? accounts.find((a) => a.id === event.taxFundedFromAccountId)
          : defaultFundingAccount;
        const eventPerson = event.personId
          ? persons.find((p) => p.id === event.personId)
          : undefined;

        taxEvents.push({
          id: uuidv4(),
          year,
          type: 'incomeTax',
          description: event.description,
          assessableAmount: event.amount,
          fundedFromAccountId: fundingAccountId,
          fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
          personId: event.personId,
          personName: eventPerson?.name,
        });
      } else if (event.taxTreatmentType === 'taxDeduction' && event.amount > 0) {
        const fundingAccountId =
          event.taxFundedFromAccountId ?? defaultFundingAccountId;
        const fundingAccount = event.taxFundedFromAccountId
          ? accounts.find((a) => a.id === event.taxFundedFromAccountId)
          : defaultFundingAccount;
        const eventPerson = event.personId
          ? persons.find((p) => p.id === event.personId)
          : undefined;

        taxEvents.push({
          id: uuidv4(),
          year,
          type: 'taxDeduction',
          description: event.description,
          assessableAmount: -event.amount,
          fundedFromAccountId: fundingAccountId,
          fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
          personId: event.personId,
          personName: eventPerson?.name,
        });
      }
    }

    // 3. Process CGT events with capital loss carry-forward
    const cgtByPerson = new Map<string, {
      grossGains: Money;
      grossLosses: Money;
      events: PendingCgtEvent[];
    }>();

    for (const cgtEvent of pendingCgtEvents ?? []) {
      const personId = cgtEvent.personId ?? 'unassigned';
      const existing = cgtByPerson.get(personId) ?? {
        grossGains: 0,
        grossLosses: 0,
        events: [],
      };

      if (cgtEvent.cgtResult.grossCapitalGain > 0) {
        existing.grossGains += cgtEvent.cgtResult.grossCapitalGain;
      } else {
        const loss = cgtEvent.cgtResult.costBase - cgtEvent.cgtResult.saleProceeds;
        if (loss > 0) {
          existing.grossLosses += loss;
        }
      }
      existing.events.push(cgtEvent);
      cgtByPerson.set(personId, existing);
    }

    for (const [personId, cgtData] of cgtByPerson) {
      const capitalLossState = newCapitalLossStates.get(personId) ?? {
        personId,
        openingBalance: 0,
        carryForwardBalance: 0,
      };
      const openingLossBalance = capitalLossState.openingBalance;

      const totalLossesAvailable = cgtData.grossLosses + openingLossBalance;
      const netGainBeforeDiscount = Math.max(0, cgtData.grossGains - totalLossesAvailable);
      const lossesUsed = Math.min(totalLossesAvailable, cgtData.grossGains);
      const newCarryForwardBalance = totalLossesAvailable - lossesUsed;

      const newState = { ...capitalLossState, carryForwardBalance: newCarryForwardBalance };
      newCapitalLossStates.set(personId, newState);

      if (cgtData.grossLosses > 0) {
        for (const cgtEvent of cgtData.events) {
          const loss = cgtEvent.cgtResult.costBase - cgtEvent.cgtResult.saleProceeds;
          if (loss > 0) {
            taxEvents.push({
              id: uuidv4(),
              year,
              type: 'capitalLoss',
              description: `Capital Loss: ${cgtEvent.accountName}`,
              sourceAccountId: cgtEvent.accountId,
              sourceAccountName: cgtEvent.accountName,
              assessableAmount: 0,
              fundedFromAccountId: cgtEvent.fundedFromAccountId,
              fundedFromAccountName: cgtEvent.fundedFromAccountName,
              personId: cgtEvent.personId,
              personName: cgtEvent.personName,
              costBase: cgtEvent.cgtResult.costBase,
              saleProceeds: cgtEvent.cgtResult.saleProceeds,
            });
          }
        }
      }

      if (netGainBeforeDiscount > 0 && cgtData.grossGains > 0) {
        const gainSurvivalRatio = netGainBeforeDiscount / cgtData.grossGains;

        for (const cgtEvent of cgtData.events) {
          if (cgtEvent.cgtResult.grossCapitalGain > 0) {
            const eventNetGain = cgtEvent.cgtResult.grossCapitalGain * gainSurvivalRatio;
            const discountedGain = cgtEvent.cgtResult.discountApplied
              ? eventNetGain * 0.5
              : eventNetGain;

            if (discountedGain > 0) {
              taxEvents.push({
                id: uuidv4(),
                year,
                type: 'capitalGainsTax',
                description: `CGT: ${cgtEvent.accountName}`,
                sourceAccountId: cgtEvent.accountId,
                sourceAccountName: cgtEvent.accountName,
                assessableAmount: discountedGain,
                fundedFromAccountId: cgtEvent.fundedFromAccountId,
                fundedFromAccountName: cgtEvent.fundedFromAccountName,
                personId: cgtEvent.personId,
                personName: cgtEvent.personName,
                grossCapitalGain: cgtEvent.cgtResult.grossCapitalGain,
                discountApplied: cgtEvent.cgtResult.discountApplied,
                costBase: cgtEvent.cgtResult.costBase,
                saleProceeds: cgtEvent.cgtResult.saleProceeds,
                capitalLossOffset: lossesUsed > 0
                  ? lossesUsed * (cgtEvent.cgtResult.grossCapitalGain / cgtData.grossGains)
                  : undefined,
              });
            }
          }
        }
      }
    }

    // 4. Super contribution tax processing
    if (settings.super && superContributionsByAccount.size > 0) {
      for (const [superAccountId, contribs] of superContributionsByAccount) {
        const superAccount = accounts.find((a) => a.id === superAccountId);
        if (!superAccount) continue;

        const superResult = accountResults.get(superAccountId);
        if (!superResult) continue;

        const currentCarryForwardState =
          carryForwardStates.get(contribs.personId) ?? {
            personId: contribs.personId,
            unusedCaps: [],
          };
        const currentNonConcCapState =
          nonConcessionalCapStates.get(contribs.personId) ?? {
            personId: contribs.personId,
            closingBalance: 0,
          };

        const result = processPersonContributions(
          contribs.personId,
          year,
          contribs.concessional,
          contribs.nonConcessional,
          currentCarryForwardState,
          currentNonConcCapState,
          settings.super
        );

        // Deduct 15% contributions tax from super account
        if (result.contributionsTax > 0) {
          // Double-entry: debit super account (cash leaves), debit Retained
          // Earnings (equity reduced by tax). Both balances decrease.
          emitTransaction(
            {
              id: uuidv4(),
              kind: 'externalOut',
              legs: [
                {
                  accountId: superAccountId,
                  amount: result.contributionsTax,
                  delta: 'debit',
                  label: 'Super contributions tax (15%)',
                },
                {
                  accountId: DEFAULT_EQUITY_ACCOUNT_ID,
                  amount: result.contributionsTax,
                  delta: 'debit',
                  label: 'Super contributions tax (15%)',
                },
              ],
            },
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );

          const contribPerson = persons.find((p) => p.id === contribs.personId);
          taxEvents.push({
            id: uuidv4(),
            year,
            type: 'superContributionTax',
            description: `Contributions Tax: ${superAccount.name}`,
            sourceAccountId: superAccountId,
            sourceAccountName: superAccount.name,
            assessableAmount: 0,
            fundedFromAccountId: superAccountId,
            fundedFromAccountName: superAccount.name,
            personId: contribs.personId,
            personName: contribPerson?.name,
          });
        }

        const contribPerson = persons.find((p) => p.id === contribs.personId);
        const fundingAccountId =
          superAccount.taxFundedFromAccountId ??
          settings.defaultTaxFundingAccountId ??
          'unassigned';
        const fundingAccount = accounts.find((a) => a.id === fundingAccountId);
        const concessionalWithinCap =
          result.concessionalContributions - result.excessConcessional;

        // Salary sacrifice (pre-tax)
        if (contribs.preTaxReduction > 0) {
          taxEvents.push({
            id: uuidv4(),
            year,
            type: 'taxDeduction',
            description: `Salary Sacrifice: ${superAccount.name}`,
            sourceAccountId: superAccountId,
            sourceAccountName: superAccount.name,
            assessableAmount: -contribs.preTaxReduction,
            fundedFromAccountId: fundingAccountId,
            fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
            personId: contribs.personId,
            personName: contribPerson?.name,
          });

          const preTaxExcess = Math.max(0, contribs.preTaxReduction - concessionalWithinCap);
          if (preTaxExcess > 0) {
            taxEvents.push({
              id: uuidv4(),
              year,
              type: 'incomeTax',
              description: `Excess Concessional (Salary Sacrifice): ${superAccount.name}`,
              sourceAccountId: superAccountId,
              sourceAccountName: superAccount.name,
              assessableAmount: preTaxExcess,
              fundedFromAccountId: fundingAccountId,
              fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
              personId: contribs.personId,
              personName: contribPerson?.name,
            });
          }
        }

        // Personal deductible (post-tax)
        if (contribs.postTaxDeduction > 0) {
          const capRemainingAfterPreTax = Math.max(
            0,
            concessionalWithinCap - contribs.preTaxReduction
          );
          const deductiblePostTax = Math.min(contribs.postTaxDeduction, capRemainingAfterPreTax);

          if (deductiblePostTax > 0) {
            taxEvents.push({
              id: uuidv4(),
              year,
              type: 'taxDeduction',
              description: `Personal Deductible: ${superAccount.name}`,
              sourceAccountId: superAccountId,
              sourceAccountName: superAccount.name,
              assessableAmount: -deductiblePostTax,
              fundedFromAccountId: fundingAccountId,
              fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
              personId: contribs.personId,
              personName: contribPerson?.name,
            });
          }
        }

        // Division 293 tax
        const personIncome = incomeByPerson.get(contribs.personId) ?? 0;
        const div293Result = calculateDiv293(
          personIncome,
          concessionalWithinCap,
          settings.super
        );

        if (div293Result.applies && div293Result.taxAmount > 0) {
          const div293FundingAccountId =
            superAccount.taxFundedFromAccountId ??
            settings.defaultTaxFundingAccountId ??
            superAccountId;
          const div293FundingAccount =
            accounts.find((a) => a.id === div293FundingAccountId) ?? superAccount;

          // Double-entry: debit funding account (cash leaves), debit Retained
          // Earnings (equity reduced by tax).
          emitTransaction(
            {
              id: uuidv4(),
              kind: 'externalOut',
              legs: [
                {
                  accountId: div293FundingAccountId,
                  amount: div293Result.taxAmount,
                  delta: 'debit',
                  label: 'Division 293 tax',
                },
                {
                  accountId: DEFAULT_EQUITY_ACCOUNT_ID,
                  amount: div293Result.taxAmount,
                  delta: 'debit',
                  label: 'Division 293 tax',
                },
              ],
            },
            newLedgerEntries,
            accountResults,
            accountValues,
            onError
          );

          const div293Person = persons.find((p) => p.id === contribs.personId);
          taxEvents.push({
            id: uuidv4(),
            year,
            type: 'division293Tax',
            description: `Div 293: ${superAccount.name}`,
            sourceAccountId: superAccountId,
            sourceAccountName: superAccount.name,
            assessableAmount: 0,
            fundedFromAccountId: div293FundingAccountId,
            fundedFromAccountName: div293FundingAccount.name,
            personId: contribs.personId,
            personName: div293Person?.name,
          });
        }
      }
    }

    // 5. Aggregate tax by funding account
    const aggregationMap = new Map<string, {
      fundedFromAccountName: string;
      taxSchedule: 'marginalRates' | 'flatRate15';
      totalAssessable: Money;
      events: TaxEvent[];
    }>();

    for (const taxEvent of taxEvents) {
      const existing = aggregationMap.get(taxEvent.fundedFromAccountId);
      if (existing) {
        existing.totalAssessable += taxEvent.assessableAmount;
        existing.events.push(taxEvent);
      } else {
        const fundingAccount = accounts.find((a) => a.id === taxEvent.fundedFromAccountId);
        const isSuperAccount =
          fundingAccount?.type === 'asset' &&
          fundingAccount.name?.toLowerCase().includes('super');

        aggregationMap.set(taxEvent.fundedFromAccountId, {
          fundedFromAccountName: taxEvent.fundedFromAccountName ?? 'Unknown',
          taxSchedule: isSuperAccount ? 'flatRate15' : 'marginalRates',
          totalAssessable: taxEvent.assessableAmount,
          events: [taxEvent],
        });
      }
    }

    const taxAggregations: Array<{
      fundedFromAccountId: string;
      fundedFromAccountName: string;
      taxSchedule: 'marginalRates' | 'flatRate15';
      totalAssessable: Money;
      calculatedTax: Money;
    }> = [];
    let taxPayable = 0;

    for (const [fundedFromAccountId, agg] of aggregationMap) {
      let calculatedTax: Money;
      if (agg.taxSchedule === 'marginalRates') {
        calculatedTax = calculateIncomeTax(agg.totalAssessable, year);
      } else {
        calculatedTax = agg.totalAssessable * 0.15;
      }

      taxAggregations.push({
        fundedFromAccountId,
        fundedFromAccountName: agg.fundedFromAccountName,
        taxSchedule: agg.taxSchedule,
        totalAssessable: agg.totalAssessable,
        calculatedTax,
      });

      taxPayable += calculatedTax;
    }

    // 6. Apply franking credits as tax offset
    const totalFrankingCredits = Array.from(
      frankingCreditsByPerson?.values() ?? []
    ).reduce((sum, v) => sum + v, 0);

    if (totalFrankingCredits > 0) {
      taxPayable -= totalFrankingCredits;

      for (const [personId, credits] of frankingCreditsByPerson ?? []) {
        const person = persons.find((p) => p.id === personId);
        taxEvents.push({
          id: uuidv4(),
          year,
          type: 'frankingCreditOffset',
          description: person ? `Franking Credits (${person.name})` : 'Franking Credit Offset',
          assessableAmount: -credits,
          fundedFromAccountId: 'unassigned',
          fundedFromAccountName: 'N/A',
          personId: personId !== 'unassigned' ? personId : undefined,
          personName: person?.name,
        });
      }
    }

    // 7. Deduct tax from funding account
    for (const agg of taxAggregations) {
      if (agg.fundedFromAccountId !== 'unassigned') {
        // Double-entry: debit funding account (cash leaves), debit Retained
        // Earnings (equity reduced by tax).
        emitTransaction(
          {
            id: uuidv4(),
            kind: 'externalOut',
            legs: [
              {
                accountId: agg.fundedFromAccountId,
                amount: agg.calculatedTax,
                delta: 'debit',
                label: `Tax payment (${agg.taxSchedule === 'flatRate15' ? '15% flat' : 'marginal rates'})`,
              },
              {
                accountId: DEFAULT_EQUITY_ACCOUNT_ID,
                amount: agg.calculatedTax,
                delta: 'debit',
                label: `Tax payment (${agg.taxSchedule === 'flatRate15' ? '15% flat' : 'marginal rates'})`,
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

    const netPosition =
      context.totalIncome - context.totalExpenses - taxPayable;

    // 8. Per-person tax aggregation
    const personTaxMap = new Map<string, {
      personName: string;
      totalAssessable: Money;
    }>();
    for (const taxEvent of taxEvents) {
      const personId = taxEvent.personId ?? 'unassigned';
      const personName = taxEvent.personName ?? 'Unassigned';
      const existing = personTaxMap.get(personId);
      if (existing) {
        existing.totalAssessable += taxEvent.assessableAmount;
      } else {
        personTaxMap.set(personId, { personName, totalAssessable: taxEvent.assessableAmount });
      }
    }

    const taxByPerson: Array<{
      personId: string;
      personName: string;
      totalAssessable: Money;
      calculatedTax: Money;
    }> = [];
    for (const [personId, data] of personTaxMap) {
      const calculatedTax = calculateIncomeTax(
        Math.max(0, data.totalAssessable),
        year
      );
      taxByPerson.push({
        personId,
        personName: data.personName,
        totalAssessable: data.totalAssessable,
        calculatedTax,
      });
    }

    return {
      ...context,
      taxEvents,
      taxAggregations,
      taxByPerson:
        taxByPerson.length > 0 ? taxByPerson : undefined,
      taxPayable,
      netPosition,
      yearLedgerEntries: newLedgerEntries,
      capitalLossStates: newCapitalLossStates,
    };
  }
}
