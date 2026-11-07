/**
 * Core domain value objects and types.
 * These are independent of the UI, persistence, and calculation layers.
 * All monetary values are in dollars (AUD).
 */

export type Money = number;
export type Year = number;
export type PersonId = string;
export type AccountId = string;
export type EventId = string;
export type RuleId = string;

/**
 * A money amount with a currency context (always AUD in this app).
 */
export interface MoneyValue {
  amount: Money;
  currency: 'AUD';
}

/**
 * A financial year range.
 */
export interface YearRange {
  start: Year;
  end: Year;
}

/**
 * Result of a tax rule calculation.
 */
export interface TaxRuleResult {
  taxPayable: Money;
  taxEvents: Array<{
    type: 'incomeTax' | 'capitalGainsTax' | 'superContributionTax' | 'division293Tax' | 'taxDeduction' | 'frankingCreditOffset';
    description: string;
    assessableAmount: Money;
    personId?: PersonId;
    fundedFromAccountId?: AccountId;
    fundedFromAccountName?: string;
    metadata?: Record<string, unknown>;
  }>;
}

/**
 * Context passed to tax rules during calculation.
 */
export interface TaxRuleContext {
  year: Year;
  personId: PersonId;
  personName?: string;
  assessableIncome: Money;
  concessionalContributions: Money;
  superBalance?: Money;
  familyIncome?: Money;
  fundingAccountId?: AccountId;
  fundingAccountName?: string;
}

/**
 * Superannuation contribution cap rule result.
 */
export interface SuperCapRuleResult {
  concessionalCap: Money;
  nonConcessionalCap: Money;
  carryForwardYears: number;
  contributionsTaxRate: Money;
  employerSgRate: Money;
  preservationAge: number;
  div293Threshold: Money;
  div293Rate: Money;
}

/**
 * Context for super cap rules.
 */
export interface SuperCapRuleContext {
  year: Year;
  personId: PersonId;
}

/**
 * Growth profile result.
 */
export interface GrowthResult {
  rate: number;
  appliedValue: Money;
  description: string;
}

/**
 * Account behavior effect - a change to apply to an account in a given year.
 */
export interface AccountEffect {
  accountId: AccountId;
  kind: 'credit' | 'debit' | 'transfer' | 'growth' | 'zero';
  amount: Money;
  label: string;
  sourceRuleId?: RuleId;
}

/**
 * Validation error for an account or event.
 */
export interface ValidationError {
  entityId: string;
  entityType: 'account' | 'event' | 'person' | 'epoch';
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Capability flag for gating UI and features.
 */
export interface FeatureCapability {
  id: string;
  enabled: boolean;
  dependsOn?: string[];
  description?: string;
}
