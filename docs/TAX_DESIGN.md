# Tax System Design

**Version:** 0.2  
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

## Core Principles

### Two-Part Design

| Component | Scope | Purpose |
|-----------|-------|---------|
| `TaxClassification` | Per account/event | Describes *what type* of income/transaction this is |
| `TaxPolicy` | Global (assumptions) | Describes *how* each type is taxed |

This separates "what is this?" from "how do we tax it?" - allowing flexible rules without hardcoding.

### Aggregate Then Calculate

**Critical:** Tax is calculated on **aggregated** values, not individual events.

Multiple sources contribute to a person's tax liability:
- Regular income (salary, rental, dividends)
- Capital gains (added to assessable income after discount)
- Super contribution deductions (reduce taxable income)

The tax calculation flow is:

1. **Generate Tax Events** - Each taxable source creates a tax event row for transparency
2. **Group by Funding Account** - Aggregate all tax events by their `fundedFromAccountId`
3. **Apply Tax Schedule** - Use the appropriate tax schedule for each group:
   - Personal accounts (bank): Marginal income tax rates
   - Super accounts: Flat 15% contribution tax
4. **Deduct from Funding Account** - Each funding account is reduced by its calculated tax

This ensures:
- Super contribution deductions reduce the income tax base correctly
- CGT is added to income and taxed at marginal rates
- Super excess contribution tax is paid from within the super fund

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

## 4. Tax Funding & Aggregation

**Critical:** Calculated tax must be paid from an actual account, not just reported.

### 4.1 Funding Model

Each taxable entity (person) must nominate a **default tax funding account** (typically a cash/bank account). Individual accounts or events can override this.

```typescript
// In Settings
defaultTaxFundingAccountId: z.string().uuid()

// On Account/Event schema (optional override)
taxFundedFrom: z.string().uuid().optional()
```

### 4.2 Aggregation by Funding Account

Tax events are aggregated by their `fundedFromAccountId` before calculation:

| Funding Account Type | Tax Events Included | Tax Schedule |
|---------------------|---------------------|--------------|
| Personal (bank/cash) | Income tax + CGT | Marginal income tax rates |
| Super account | Excess contribution tax | Flat 15% |

**Example:**
```
Year 2025:
  Tax Events:
    - Income Tax (Salary): $100,000 assessable → funded by Bank
    - CGT (Share sale): $20,000 discounted gain → funded by Bank
    - Super Excess Tax: $5,000 excess contribution → funded by Super

  Aggregation:
    Bank Account Group:
      - Assessable: $100,000 + $20,000 = $120,000
      - Tax (marginal rates): $29,467 + ($120,000 - $120,000) × 0.37 = $29,467
    
    Super Account Group:
      - Excess: $5,000
      - Tax (15% flat): $750
```

### 4.3 Tax Payment Flow

1. Generate tax events from accounts and events (for reporting)
2. Group tax events by `fundedFromAccountId`
3. For each funding account group:
   - Calculate total assessable amount
   - Apply appropriate tax schedule
   - Deduct calculated tax from the funding account
4. If funding account has insufficient balance:
   - Allow negative balance (overdraft with warning)

### 4.4 Super Tax (Inside Fund)

For excess contribution tax (15%), the super account itself is the funding account:
- Tax events with `fundedFromAccountId` = super account ID
- Calculated at flat 15% rate
- Deducted directly from super balance

### 4.5 CGT Integration

Capital gains are **added to assessable income**, not taxed separately:
1. CGT event creates tax event with discounted gain amount
2. Tax event grouped with other personal income
3. Combined amount taxed at marginal rates
4. Total tax deducted from the personal funding account (bank)

---

## 5. Transaction Timing & Growth Calculation

### 5.1 Closing Balance Display

All asset and liability values in the spreadsheet represent **closing (end-of-year) balances**. The UI labels sections as "Assets (Closing Balances)" and "Liabilities (Closing Balances)" for clarity.

### 5.2 Transaction Order Within a Year

Transactions are processed in a fixed order to ensure proper fund availability:

```
1. Opening Balance     = previous year's closing balance

2. Lifecycle Moves     = account end transfers (sell house, transfer super)
                         → Proceeds immediately available

3. User Transfer Events = explicit transfers configured by user
                         → Can use proceeds from step 2

4. Growth              = applied based on Growth Calculation Method setting
                         → Skipped if balance ≤ 0

5. Derived Flows       = income deposits, expense withdrawals

6. Auto Top-Up         = if asset balance < threshold, transfer from source account
                         → Brings balance back to threshold or target balance

7. Tax Calculation     = aggregate, calculate, and deduct from funding accounts
```

This ordering ensures that:
- When a user sells an asset and uses proceeds for transfers in the same year (e.g., house sale → downsizer contribution), the funds are available
- Auto top-ups happen after expenses are withdrawn, ensuring the account is replenished before tax is calculated

### 5.3 Growth Calculation Method

Configurable in Settings. Determines the balance used for growth calculations:

| Method | Formula | Description |
|--------|---------|-------------|
| **Opening Balance** (default) | Growth on opening balance only | Conservative - transfers don't earn growth in the year received |
| **Average Balance** | Growth on `opening + 0.5 × all transfers` | Assumes transactions happen mid-year, so they earn half a year's growth |

**Example:** Bank receives $500k house proceeds, has $100k opening balance, 10% growth rate:

| Method | Growth Base | Growth | End Value |
|--------|-------------|--------|-----------|
| Opening Balance | $100k | $10k | $610k |
| Average Balance | $100k + $250k = $350k | $35k | $635k |

### 5.4 Negative Balance Handling

Accounts can go negative (overdrawn) but:
- No growth is applied when balance ≤ 0
- Negative balances are highlighted with a red background in the UI
- A warning tooltip is shown: "⚠️ Negative balance (overdrawn)"

---

## 6. Engine Tax Computation Flow

### 6.1 Generate Tax Events

For each year, generate tax events from:
- Income accounts (assessable income → income tax)
- Asset sales with `endBehavior: 'sell'` (capital gains → CGT)
- Super contributions over cap (excess → contribution tax)

```typescript
type TaxEvent = {
  id: string
  year: number
  type: 'incomeTax' | 'capitalGainsTax' | 'superContributionTax'
  description: string
  sourceAccountId?: string
  sourceAccountName?: string
  assessableAmount: number      // Amount that contributes to tax base
  fundedFromAccountId: string   // Which account pays this tax
  fundedFromAccountName?: string
}
```

### 5.2 Aggregate by Funding Account

Group tax events by `fundedFromAccountId` and sum assessable amounts:

```typescript
type TaxAggregation = {
  fundedFromAccountId: string
  fundedFromAccountName: string
  taxSchedule: 'marginalRates' | 'flatRate15'
  totalAssessableAmount: number
  taxEvents: TaxEvent[]
}
```

**Determining Tax Schedule:**
- If funding account is a super account → `flatRate15`
- Otherwise → `marginalRates`

### 5.3 Calculate Tax per Group

For each aggregation group:

```typescript
if (taxSchedule === 'marginalRates') {
  calculatedTax = calculateIncomeTax(totalAssessableAmount, year)
} else {
  calculatedTax = totalAssessableAmount * 0.15
}
```

### 5.4 Deduct Tax from Funding Accounts

For each aggregation group:
1. Look up the funding account
2. Reduce account balance by `calculatedTax`
3. Record the withdrawal in account results

### 5.5 Output Structure

```typescript
type YearlyTaxSummary = {
  year: number
  
  // Individual tax events (for reporting/transparency)
  taxEvents: TaxEvent[]
  
  // Aggregated results (for calculation)
  aggregations: {
    fundedFromAccountId: string
    totalAssessable: number
    calculatedTax: number
    taxSchedule: 'marginalRates' | 'flatRate15'
  }[]
  
  // Totals
  totalTaxPayable: number
}
```

This ensures:
- Tax section shows individual events for transparency
- Actual tax calculated on aggregated amounts
- Correct tax schedule applied per funding account

---

## 7. UX Design

### 7.1 Spreadsheet View (Simple)

Keep the main grid uncluttered with a single Tax row:

```
═ CALCULATED
  Total Income      150,000  154,500  159,135
  Total Expenses     65,000   66,950   68,959
  Tax                32,000   33,500   35,100  ← Click for details
  Net Worth         650,000  795,000  948,731
```

### 7.2 Tax Detail Panel

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

### 7.3 Account Configuration

Add "Tax treatment" section to account editor:

**For Income accounts:**
- Dropdown: "Taxable income" / "Tax-free (pension)" / "None"

**For Asset accounts:**
- Dropdown: "Capital gains asset" / "Non-CGT asset"
- If CGT: fields for cost base, acquisition year

**For Super accounts:**
- Mode: "Accumulation phase" / "Pension phase"
- If accumulation: contribution settings

### 7.4 End Behavior Configuration

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

### 7.5 Tax Funding Configuration

**Person settings:**
- Default tax funding account: [Account dropdown]

**Account/Event override (optional):**
- Pay tax from: [Account dropdown] (defaults to person's default)

---

## 8. Schema Changes Required

### 8.1 New File: `src/schemas/tax.ts`

- `TaxClassificationSchema` (discriminated union)
- `TaxBracketSchema`
- `IncomeTaxScheduleSchema`
- `CapitalGainsPolicySchema`
- `SuperConcessionalCapSchema`
- `TaxPolicySchema`

### 8.2 Update: `src/schemas/person.ts`

- Add `defaultTaxFundingAccountId: string` (required)

### 8.3 Update: `src/schemas/account.ts`

- Add `taxClassification?: TaxClassification`
- Add `endBehavior: 'zero' | 'hold' | 'transfer' | 'sell'`
- Add `transferTo?: string` (account ID)
- Add `costBase?: number`
- Add `acquisitionYear?: number`

### 8.4 Update: `src/schemas/event.ts`

- Add `taxClassification?: TaxClassification`
- Add `taxFundedFrom?: string` (account ID, optional override)

---

## 9. Implementation Phases

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 1 (MVP) | Income tax with aggregation, tax funded from default account | ✅ Implemented |
| Phase 1.1 | CGT on `sell` end behavior, transaction timing fix, growth calculation methods | ✅ Implemented |
| Phase 2 | Super contribution tracking, carry-forward caps, excess contribution tax (15% flat) | Planned |

### Phase 1 Implemented Features:
- Tax events generated for income
- Tax aggregation by funding account
- Tax schedule selection (marginal rates vs flat 15%)
- Tax deducted from funding account
- Tax section in spreadsheet UI showing calculated tax per funding account
- Default tax funding account configurable in Settings

### Phase 1.1 Implemented Features:
- CGT calculation for accounts with `endBehavior: 'sell'`
- 50% CGT discount for holdings > 12 months
- Fixed transaction timing: lifecycle events (sales) happen before user transfers
- Negative balance support with warnings
- Growth calculation method setting (Opening Balance vs Average Balance)
- UI labels clarifying "Closing Balances"
- Auto top-up for asset accounts (transfer from source when balance falls below threshold)

---

## 10. Superannuation Pension Minimum Drawdown

Australian law requires account-based pension (allocated pension) holders to withdraw a minimum amount each financial year. This is calculated based on the person's age and the pension account balance.

### 10.1 Minimum Drawdown Rates

The minimum drawdown percentage is determined by the account holder's age at 1 July each year (or at commencement if started mid-year):

| Age | Minimum % of Account Balance |
|-----|------------------------------|
| Under 65 | 4% |
| 65-74 | 5% |
| 75-79 | 6% |
| 80-84 | 7% |
| 85-89 | 9% |
| 90-94 | 11% |
| 95+ | 14% |

**Calculation:** `Minimum Drawdown = Account Balance on 1 July × Age-based %`

### 10.2 Implementation in Forecast Engine

The forecast engine handles minimum drawdown as follows:

1. **Identify allocated pension accounts** - Accounts with `assetSubType: 'allocatedPension'`
2. **Calculate owner's age** - Based on person's birth year and the current forecast year
3. **Determine minimum rate** - Look up the appropriate percentage based on age
4. **Calculate minimum amount** - `pensionBalance × rate`
5. **Ensure withdrawal occurs** - If actual withdrawals are less than minimum, the shortfall is added as a mandatory withdrawal
6. **Track compliance** - Flag if minimum is not met for validation/warning purposes

### 10.3 Interaction with Auto-Topup

The minimum drawdown is processed in Phase 8 (before auto-topup) in the following order:

```
8a. Minimum Pension Drawdown  → Forces withdrawal from allocated pension accounts
8b. Auto-Topup                → Can draw from any account including pension if needed
```

This ensures:
- Pension accounts first satisfy their minimum drawdown requirement
- Auto-topup can then draw from pension accounts if needed (to top up other accounts)
- The order prevents circular logic

### 10.4 Transition to Retirement (TTR) Pensions

TTR pensions have both a minimum and maximum drawdown:
- **Minimum:** Same as standard (4%-14% based on age)
- **Maximum:** 10% of account balance

For TTR pensions, the system should validate that withdrawals are within the min-max range.

---

## 11. Open Questions

- [ ] Should we track cost base per lot for shares (FIFO/LIFO)?
- [ ] How to handle principal residence CGT exemption?
- [ ] Medicare levy and surcharge - include in Phase 4?
- [ ] Franking credits on dividends - include?
- [x] How to aggregate tax events from multiple sources? → Aggregate by funding account
