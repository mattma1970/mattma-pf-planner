/**
 * ConservationCheckStage - Final stage of the forecast pipeline.
 *
 * Runs the conservation/integrity check after all stages have been applied.
 * Verifies transfer balance and wealth drift for the year.
 */

import type {
  Account,
  Settings,
} from '../../schemas';

import type {
  ForecastContext,
  IForecastStage,
  AccountYearResult,
} from './stages';
import type { Year, Money, AccountId } from '../../types';
import { checkConservation } from '../../../engine/ledger';

export class ConservationCheckStage implements IForecastStage {
  readonly id = 'conservation-check';
  readonly order = 8;
  readonly enabled = true;

  execute(context: ForecastContext): ForecastContext {
    const {
      year,
      accounts,
      accountResults,
      yearLedgerEntries,
      warnings,
    } = context;

    const onError = (msg: string) => {
      warnings.push({
        type: 'ledgerError',
        severity: 'error',
        message: msg,
      });
    };

    // Apply any remaining deferred entries first
    // (deferred entries are applied in DerivedFlowsStage via applyDeferredLedger)

    const conservation = checkConservation(
      yearLedgerEntries ?? [],
      accountResults,
      accounts,
      year
    );

    if (!conservation.passed) {
      warnings.push({
        type: 'conservationViolation',
        severity: 'error',
        message: `Transaction integrity check failed for ${year}`,
        details: `Transfer imbalance: $${conservation.transferImbalance.toFixed(0)}. Wealth drift: $${conservation.wealthDrift.toFixed(0)}.`,
      });
    }

    return {
      ...context,
      warnings,
    };
  }
}
