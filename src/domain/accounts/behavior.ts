/**
 * Pluggable account behaviors.
 *
 * Account behavior is decoupled from account data via this interface.
 * New account types (e.g. Reverse Mortgage, Aged Care Bond, SMSF) can be
 * added by implementing IAccountBehavior and registering it in the
 * AccountBehaviorRegistry, without modifying the forecast engine.
 */

import type { Account, Person, ResolvedAssumptions } from '../../schemas';
import type { AccountEffect, AccountId, Money, PersonId, Year } from '../types';

// ============================================
// IAccountBehavior interface
// ============================================

export interface IAccountBehavior {
  /** The account type this behavior handles (matches Account.type) */
  readonly accountType: string;

  /**
   * Called at the start of each year for active accounts.
   * Returns any effects to apply (e.g. opening balance adjustments).
   */
  onYearStart(
    account: Account,
    ctx: YearContext
  ): AccountEffect[] | Promise<AccountEffect[]>;

  /**
   * Calculate growth for the account in the given year.
   */
  calculateGrowth(
    account: Account,
    ctx: YearContext
  ): GrowthResult | Promise<GrowthResult>;

  /**
   * Called at the end of each year for active accounts.
   * Returns any effects to apply (e.g. transfers, zeroing).
   */
  onYearEnd(
    account: Account,
    ctx: YearContext
  ): AccountEffect[] | Promise<AccountEffect[]>;

  /**
   * Validate the account configuration.
   */
  validate(account: Account): ValidationError[];
}

// ============================================
// YearContext - context passed to behaviors
// ============================================

export interface YearContext {
  year: Year;
  personId?: PersonId;
  personName?: string;
  assumptions: ResolvedAssumptions;
  accountValues: Map<AccountId, Money>;
  openingValues: Map<AccountId, Money>;
}

// ============================================
// GrowthResult
// ============================================

export interface GrowthResult {
  rate: number;
  appliedValue: Money;
  description: string;
}

// ============================================
// ValidationError
// ============================================

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

// ============================================
// AccountBehaviorRegistry
// ============================================

export class AccountBehaviorRegistry {
  private behaviors = new Map<string, IAccountBehavior>();

  register(behavior: IAccountBehavior): void {
    this.behaviors.set(behavior.accountType, behavior);
  }

  unregister(accountType: string): void {
    this.behaviors.delete(accountType);
  }

  get(accountType: string): IAccountBehavior | undefined {
    return this.behaviors.get(accountType);
  }

  has(accountType: string): boolean {
    return this.behaviors.has(accountType);
  }

  getAll(): IAccountBehavior[] {
    return [...this.behaviors.values()];
  }
}

export const defaultAccountBehaviorRegistry = new AccountBehaviorRegistry();
