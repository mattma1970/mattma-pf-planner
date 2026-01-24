# Tax System Design

**Version:** 0.1 (Draft)  
**Last Updated:** 2026-01-25  
**Status:** Design

---

## Overview

This document describes the data structures and UX for handling Australian tax in the retirement planner. The design must be flexible enough to cover:

1. **Income tax** - marginal rates on regular income
2. **Capital gains tax (CGT)** - (sale price - cost base), 50% discount if held >12 months
3. **Tax-free income** - pension phase super returns
4. **Superannuation contributions** - concessional caps, carry-forward, excess contribution tax

---

## Core Principle: Two-Part Design

| Component | Scope | Purpose |
|-----------|-------|---------|
| `TaxClassification` | Per account/event | Describes *what type* of income/transaction this is |
| `TaxPolicy` | Global (assumptions) | Describes *how* each type is taxed |

This separates "what is this?" from "how do we tax it?" - allowing flexible rules without hardcoding.

---

## 1. Tax Classifications

Attached to accounts and events via a discriminated union:

### 1.1 Income Classifications

| Kind | Use Case | Properties |
|------|----------|------------|
| `none` | Internal transfers, no tax impact | — |
| `assessableIncome` | Salary, rental income, dividends | `assessableProportion` (0-1, for partially franked dividends) |
| `taxFreeIncome` | Pension phase returns | `reason: 'pension' | 'other'` |

### 1.2 Capital Gains Classifications

| Kind | Use Case | Properties |
|------|----------|------------|
| `capitalGainAsset` | Shares, investment property (on account) | `eligibleForDiscount`, `costBaseMode` |
| `capitalGainRealisation` | Specific sale event | `costBase`, `acquisitionYear`, `assetAccountId` |

### 1.3 Superannuation Classifications

| Kind | Use Case | Properties |
|------|----------|------------|
| `superContribution` | Contributions into super | `contributionType: 'concessional' | 'nonConcessional'`, `source: 'employer' | 'salarySacrifice' | 'personalDeductible' | 'personalNonDeductible'`, `countsTowardsConcessionalCap`, `deductibleAgainstIncome` |

---

## 2. Account End Behaviors

When an account ends (reaches its end year), the behavior determines both what happens to the value AND the tax implications:

| Behavior | Description | Tax Treatment |
|----------|-------------|---------------|
| `zero` | Value goes to zero (income stops, expense ends) | No tax event |
| `hold` | Value remains at final amount indefinitely | No tax event |
| `transfer` | Value moves to another account at cost base | No CGT (cost base carries over) |
| `sell` | Asset is sold, proceeds go to another account | **Triggers CGT event** |

### 2.1 Sell Behavior Details

When `endBehavior: 'sell'`:
- Engine calculates capital gain: `finalValue - costBase`
- Applies CGT discount if holding period ≥ 12 months
- Adds discounted gain to assessable income for that year
- Transfers net proceeds (after tax) to destination account

**Schema:**
```typescript
endBehavior: z.enum(['zero', 'hold', 'transfer', 'sell'])
transferTo: z.string().uuid().optional()  // destination account for transfer/sell
costBase: z.number().optional()            // for sell: original purchase price
acquisitionYear: z.number().optional()     // for sell: when asset was acquired
```

### 2.2 One-Time Sale Events

For mid-life sales (not end-of-account), use an Event with `taxClassification: 'capitalGainRealisation'`:

```typescript
{
  year: 2030,
  type: 'assetChange',
  amount: -50000,  // reducing asset value
  description: 'Partial share sale',
  taxClassification: {
    kind: 'capitalGainRealisation',
    costBase: 30000,
    acquisitionYear: 2025,
  }
}
```

---

## 3. Tax Policy (Global Rules)

Stored in assumptions, configurable by Configurator role:

### 3.1 Income Tax Brackets

```typescript
{
  id: 'au-individual-2024-25',
  label: 'Australian Individual 2024-25',
  fromYear: 2024,
  toYear: 2025,
  brackets: [
    { threshold: 0, rate: 0, baseTax: 0 },
    { threshold: 18201, rate: 0.19, baseTax: 0 },
    { threshold: 45001, rate: 0.325, baseTax: 5092 },
    { threshold: 120001, rate: 0.37, baseTax: 29467 },
    { threshold: 180001, rate: 0.45, baseTax: 51667 },
  ]
}
```

### 3.2 Capital Gains Policy

```typescript
{
  discountPercentage: 0.5,      // 50% discount for individuals
  minHoldingPeriodYears: 1,     // Must hold >12 months for discount
}
```

### 3.3 Superannuation Concessional Cap

```typescript
{
  baseCap: 30000,
  yearOverrides: { '2027': 32000 },  // Legislative changes
  allowCarryForward: true,
  maxCarryForwardYears: 5,
  excessContributionTaxRate: 0.15,  // 15% tax on excess
}
```

---

## 4. Tax Funding

**Critical:** Calculated tax must be paid from an actual account, not just reported.

### 4.1 Funding Model

Each taxable entity (person) must nominate a **default tax funding account** (typically a cash/bank account). Individual accounts or events can override this.

```typescript
// On Person schema
defaultTaxFundingAccountId: z.string().uuid()

// On Account/Event schema (optional override)
taxFundedFrom: z.string().uuid().optional()
```

### 4.2 Tax Payment Flow

1. Engine calculates total tax liability for person/year
2. Tax is deducted from the funding account in that year
3. If funding account has insufficient balance:
   - Option A: Allow negative balance (overdraft)
   - Option B: Flag as warning in UI
   - Option C: Auto-liquidate from nominated backup account

### 4.3 Super Tax (Inside Fund)

For excess contribution tax (15%), the tax is paid from **within the super account itself**, not the external funding account.

### 4.4 CGT on Asset Sale

When an asset is sold (`endBehavior: 'sell'`):
1. Calculate gross proceeds
2. Calculate CGT liability
3. Deduct CGT from proceeds before transferring to destination account

OR

1. Transfer full proceeds to destination account
2. Deduct CGT from the `taxFundedFrom` account

**Recommendation:** Option 2 is more realistic (ATO bills you later), but Option 1 is simpler for MVP.

---

## 5. Engine Computation Flow

### 5.1 Generate Taxable Flows

For each year, convert accounts and events into taxable flows:

```typescript
type TaxableFlow = {
  year: number
  personId: string
  source: { kind: 'account' | 'event', id: string }
  amount: number
  classification: TaxClassification
}
```

### 5.2 Aggregate by Person/Year

Group flows and compute:

1. **Assessable income** - sum of `assessableIncome` flows × proportion
2. **Capital gains** - from `capitalGainRealisation` flows, apply discount
3. **Super contributions** - track against caps
4. **Deductions** - deductible super contributions (up to cap)

### 5.3 Apply Tax Policy

```typescript
type YearlyTaxSummary = {
  year: number
  personId: string
  
  // Income components
  grossAssessableIncome: number
  capitalGains: number
  capitalGainsDiscount: number
  
  // Super contributions
  concessionalContributions: number
  concessionalCap: number
  carryForwardUsed: number
  carryForwardRemaining: number
  excessContributions: number
  
  // Deductions
  deductibleSuperUsed: number
  
  // Final tax
  taxableIncome: number
  incomeTax: number
  superTaxInsideFund: number  // 15% on excess
  totalTax: number
  fundedFromAccountId: string
}
```

### 5.4 Deduct Tax from Funding Account

After computing `YearlyTaxSummary`:

1. Look up `fundedFromAccountId` for the person
2. Reduce that account's balance by `totalTax` (excluding `superTaxInsideFund`)
3. For `superTaxInsideFund`, reduce the super account balance directly

This ensures the tax actually impacts the forecast, not just reported.

---

## 6. UX Design

### 6.1 Spreadsheet View (Simple)

Keep the main grid uncluttered with a single Tax row:

```
═ CALCULATED
  Total Income      150,000  154,500  159,135
  Total Expenses     65,000   66,950   68,959
  Tax                32,000   33,500   35,100  ← Click for details
  Net Worth         650,000  795,000  948,731
```

### 6.2 Tax Detail Panel

Click any Tax cell to open a side panel showing:

**Summary Section:**
- Gross assessable income
- Capital gains (gross → discounted)
- Deductible super contributions
- Final taxable income
- Income tax payable
- Super tax (inside fund)

**Breakdown by Source:**

| Source | Type | Amount | Tax Treatment |
|--------|------|--------|---------------|
| Salary | Income | $120,000 | Assessable income |
| Share sale | Capital gain | $50,000 | 50% CGT discount |
| Personal super | Contribution | $25,000 | Deductible (cap $30k) |

**Rule Snapshot:**
- Income tax brackets for that year
- Concessional cap and carry-forward status
- CGT discount applied

### 6.3 Account Configuration

Add "Tax treatment" section to account editor:

**For Income accounts:**
- Dropdown: "Taxable income" / "Tax-free (pension)" / "None"

**For Asset accounts:**
- Dropdown: "Capital gains asset" / "Non-CGT asset"
- If CGT: fields for cost base, acquisition year

**For Super accounts:**
- Mode: "Accumulation phase" / "Pension phase"
- If accumulation: contribution settings

### 6.4 End Behavior Configuration

When setting account end year, show:

```
End Year: 2035
End Behavior: [Dropdown]
  - Zero (stops)
  - Hold (keeps value)
  - Transfer (move to another account)
  - Sell (triggers CGT)

[If transfer or sell]
Transfer to: [Account dropdown]

[If sell]
Cost Base: $________
Acquisition Year: ____
```

### 6.5 Tax Funding Configuration

**Person settings:**
- Default tax funding account: [Account dropdown]

**Account/Event override (optional):**
- Pay tax from: [Account dropdown] (defaults to person's default)

---

## 7. Schema Changes Required

### 7.1 New File: `src/schemas/tax.ts`

- `TaxClassificationSchema` (discriminated union)
- `TaxBracketSchema`
- `IncomeTaxScheduleSchema`
- `CapitalGainsPolicySchema`
- `SuperConcessionalCapSchema`
- `TaxPolicySchema`

### 7.2 Update: `src/schemas/person.ts`

- Add `defaultTaxFundingAccountId: string` (required)

### 7.3 Update: `src/schemas/account.ts`

- Add `taxClassification?: TaxClassification`
- Add `endBehavior: 'zero' | 'hold' | 'transfer' | 'sell'`
- Add `transferTo?: string` (account ID)
- Add `costBase?: number`
- Add `acquisitionYear?: number`

### 7.4 Update: `src/schemas/event.ts`

- Add `taxClassification?: TaxClassification`
- Add `taxFundedFrom?: string` (account ID, optional override)

---

## 8. Implementation Phases

| Phase | Scope |
|-------|-------|
| Phase 1 (MVP) | Hardcoded income tax brackets, tax funded from default account |
| Phase 2 | Add `sell` end behavior with CGT calculation |
| Phase 4 | Full tax classification system, configurable rules, super contribution tracking |

---

## 9. Open Questions

- [ ] Should we track cost base per lot for shares (FIFO/LIFO)?
- [ ] How to handle principal residence CGT exemption?
- [ ] Medicare levy and surcharge - include in Phase 4?
- [ ] Franking credits on dividends - include?
