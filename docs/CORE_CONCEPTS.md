# Core Concepts: Retirement Financial Planner

**Version:** 1.0  
**Audience:** Sophisticated users (accountants, financial planners) and developers  
**Purpose:** Shared mental model for how the forecast engine works, so you can trust the numbers you see and extend the system safely.

---

## 1. How a Forecast Is Built

The planner does not calculate your entire 40-year future in one pass. It builds a year-by-year pipeline. For every year from `startYear` to `endYear`, a `ForecastContext` object flows through eight ordered stages. Each stage reads what the previous stage wrote, applies its own logic, and passes the result forward.

### The eight stages (in order)

| Order | Stage | What it does |
|-------|-------|--------------|
| 1 | **Lifecycle Transfer** | Detects accounts ending this year (`endBehavior: transfer`, `sell`, or `sellNoCgt`). Moves proceeds to destination accounts. Computes capital gains tax on sales. |
| 2 | **User Transfer** | Applies explicit transfer events and super contribution events. Enforces concessional and non-concessional contribution caps, carry-forward, and bring-forward rules. |
| 3 | **Growth** | Applies growth profiles (fixed, CPI-linked, increasing, decreasing) to account balances. Computes income and expenses. Tracks franking credits. |
| 4 | **Derived Flows** | Emits ledger entries for income deposits, expense funding, pension drawdowns, asset returns, and asset purchases. These are deferred until all accounts are processed (see section 2). |
| 5 | **Liability** | Accrues interest on loans, applies principal-and-interest or interest-only payments, handles offset accounts and asset-sale payoffs. |
| 6 | **Tax** | Generates income tax, CGT, super contributions tax, Division 293, and franking credit events. Aggregates by funding account and deducts tax payments. |
| 7 | **Auto Top-up** | Replenishes asset accounts that fall below a threshold from a nominated source account. |
| 8 | **Conservation Check** | Verifies that every internal transfer balances (debits equal credits) and that no value has silently appeared or disappeared. |

### What this means for you

If you change an account in year 2027, the effect may not appear until year 2028 or later, because growth is calculated on opening balances and derived flows (like income deposits) are applied after the account loop closes. Always check the year column, not just the account row.

---

## 2. Timing & the Deferred Ledger

This is the most important concept for understanding the numbers you see.

### The problem

Accounts are processed one at a time inside a loop. If Account A (salary) deposits money into Account B (bank) while Account B is still waiting to be processed, Account B's growth calculation would use a stale opening balance.

### The solution: deferred ledger entries

During the account-processing loop, derived flows (income deposits, expense withdrawals, asset returns, pension drawdowns) are **collected but not applied**. They are stored in a `deferredLedgerEntries` list. Only after every account has been processed are these entries applied in bulk via `applyDeferredLedger()`.

### Why this matters

- **Opening values are settled first.** Every account's growth is calculated on its true start-of-year balance.
- **Derived flows layer on top.** A salary deposit in 2026 increases your bank balance for 2026, but it does not earn growth in 2026 (it was not there at opening). It earns growth in 2027.
- **Order is deterministic.** Regardless of the order accounts appear in the UI, the ledger is applied consistently.

> **For developers:** If you add a new stage that mutates `accountValues` directly instead of going through `emitLedgerEntry()`, you break this sequencing. Always route money movements through the ledger.

---

## 3. Double-Entry & Flow Kinds

Not every movement of money is the same. The ledger classifies every flow into one of four kinds:

| Kind | Meaning | Double-entry? | Example |
|------|---------|---------------|---------|
| `externalIn` | Money enters the model from the real world | No (no source account inside the model) | Salary deposited to bank; employer SG into super |
| `externalOut` | Money leaves the model to the real world | No (no destination account inside the model) | Living expenses; tax paid to ATO |
| `synthetic` | Value created inside the model | No (no counterparty account) | Investment price appreciation; asset revaluation |
| `internalTransfer` | Money moves between two model accounts | **Yes — must be paired debit + credit** | Pension drawdown (debit pension, credit cash); bank funds asset purchase |

### The conservation invariant

After every year, the engine checks:

```
Σ(internalTransfer credits) − Σ(internalTransfer debits) == 0  ± $1
```

If this fails, the year shows a `conservationViolation` warning. This is your guarantee that no internal transfer is missing its counterpart.

> **For users:** If you see a conservation warning, one side of a transfer was emitted without its matching credit or debit. This is usually a configuration error (e.g., a `drawnFromAccountId` pointing to a deleted account).

### Double-entry diagram

Every transaction flows through `emitTransaction()` and must produce exactly two balanced legs:

```
┌─────────────────────────────────────────────────────────────────┐
│  Double-Entry Transaction (emitTransaction)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Leg 1                      Leg 2                               │
│  ┌─────────┐              ┌─────────┐                          │
│  │ Account │              │ Account │                          │
│  │   A     │              │   B     │                          │
│  └────┬────┘              └────┬────┘                          │
│       │                      │                                 │
│  debit ───────────────►   credit                              │
│  amount: $X               amount: $X                            │
│       │                      │                                 │
│  ┌────┴────┐              ┌────┴────┐                          │
│  │ balance │              │ balance │                          │
│  │ changes │              │ changes │                          │
│  └─────────┘              └─────────┘                          │
│                                                                 │
│  Validation: leg1.amount === leg2.amount                        │
│  Validation: leg1.delta !== leg2.delta (usually)                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Flow-kind diagram: how each kind maps to two legs

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Flow kind   │ Leg 1 (debit)      │ Leg 2 (credit)      │ Net worth Δ   │
├─────────────────────────────────────────────────────────────────────────┤
│ externalIn  │ Receiving account  │ Retained Earnings   │ +X            │
│             │   (credit)         │   (credit)          │               │
│             │                    │                     │               │
│ externalOut │ Paying account     │ Retained Earnings   │ -X            │
│             │   (debit)          │   (debit)           │               │
│             │                    │                     │               │
│ synthetic   │ Appreciating acct  │ Retained Earnings   │ +X            │
│             │   (credit)         │   (credit)          │               │
│             │                    │                     │               │
│ internalXfer│ Source account     │ Destination account │ 0             │
│             │   (debit)          │   (credit)          │               │
└─────────────────────────────────────────────────────────────────────────┘
```

**Retained Earnings (`retained-earnings`)** is the universal offsetting account. It absorbs every boundary crossing and synthetic value creation. It represents the cumulative sum of all net worth changes inside the model:

```
Retained Earnings = Σ(all externalIn) − Σ(all externalOut) + Σ(all synthetic)
```

> **For users:** You don't need to manage Retained Earnings directly. Create an account with ID `retained-earnings` in your plan, and the engine will use it automatically as the offsetting leg for every boundary-crossing flow. Hide it from the main spreadsheet if you prefer — it's an accounting integrity account, not a spending account.

---

## 4. Account Lifecycle

Every account has a type (income, expense, asset, liability) and an optional start/end condition.

### Income & expense accounts are pass-through

Their opening balance is always zero each year. Growth is based on the prior year's inflows:
- Year 1: uses `initialValue`
- Year 2+: applies the growth rate to last year's total

So a $100,000 salary with 3% growth becomes $103,000 in year 2 — not because the account "saved" money, but because the model projects last year's inflow forward.

### End behaviors

When an account reaches its `endCondition`:

| Behavior | What happens | Tax impact |
|----------|--------------|------------|
| `zero` | Balance goes to zero; income stops | None |
| `hold` | Balance remains at final value indefinitely | None |
| `transfer` | Value moves to another account | No CGT (cost base carries over) |
| `sell` | Asset is sold; proceeds move to another account | **Triggers CGT event** |
| `sellNoCgt` | Asset is sold; proceeds move to another account | No CGT event |

> **For users:** If you sell a property with `endBehavior: 'sell'`, the model calculates capital gain (sale price minus cost base), applies the 50% discount if held over one year, and adds the discounted gain to your assessable income for that year.

---

## 5. Tax & Superannuation Rules (Pluggable)

Australian tax legislation changes regularly. The planner does **not** hardcode tax brackets, caps, or thresholds in the calculation engine. Instead, legislation is implemented as **pluggable rules** stored in a `RuleRegistry`.

### What this means

- Each rule has an `id`, a `version` (e.g., `"2024-25"`), and an `applicableYearRange` (start and end year).
- Multiple versions of the same rule can coexist (e.g., `marginal-income-tax-2024-25` and `marginal-income-tax-2025-26`).
- The engine resolves which rules apply to a given year automatically.
- A new tax year, a new offset, or a changed super cap is a **new rule registration**, not a change to the forecast engine code.

### What this means for you

The specific rates, brackets, caps, and thresholds that apply to your forecast depend on the rules registered for each year. Because these are data structures, they can be updated without recompiling the application.

**Do not rely on this document for current rates.** They will change. Instead, use the application's built-in rule viewer:

### Viewing the current configuration in the app

To see exactly which tax and superannuation rules are active for your forecast:

1. Open **Settings** → **Tax & Super Rules** (or the equivalent configuration panel).
2. The screen lists every registered rule, its version, its applicable year range, and whether it is enabled.
3. Hover over any tax cell in the spreadsheet view to see which rule version produced that amount.
4. Use the **Export** function to download a snapshot of the current rule configuration as JSON or CSV.

If you are an accountant reviewing a client's plan, export this configuration and keep it with the client file. It is the audit trail for *which rules produced these numbers*.

> **For developers:** To add a new tax year, implement `ITaxRule` (or `ICGTRule`, `IDiv293Rule`, `ISuperCapRule`) and register it in `RuleRegistry`. Do not edit `src/engine/tax.ts` or hardcode brackets.

---

## 6. Reading the Forecast Spreadsheet

The main view shows accounts as rows and years as columns. All asset and liability values represent **closing (end-of-year) balances** after all transactions for that year.

### Key rows

| Row | What it shows |
|-----|---------------|
| Total Income | Sum of all taxable and non-taxable income for the year |
| Total Expenses | Sum of all expenses for the year |
| Tax | Total tax payable, aggregated by funding account |
| Net Worth | Total assets minus total liabilities at year-end |

### Events

One-time items (inheritances, property sales, one-off expenses) appear in the year they occur. They are merged into the relevant account rows but do not cascade into future years unless they change an account balance (e.g., an inheritance deposited to bank increases that account's closing balance, which then earns growth in subsequent years).

### Warnings

The engine may emit warnings for a given year:
- `blockedContribution` — super contribution exceeded a cap
- `incompleteEmployerSg` — salary account missing a linked super account
- `conservationViolation` — transfer imbalance detected
- `ledgerError` — a ledger entry referenced a missing account

---

## 7. Developer Notes

These callouts appear throughout this document and are collected here for quick reference:

1. **Never mutate `accountValues` or `result.endValue` outside `emitLedgerEntry()`** — bypassing the ledger breaks the conservation invariant and the deferred-flow sequencing.
2. **Every `internalTransfer` must be paired** — a debit without a matching credit of equal amount will trigger a `conservationViolation`.
3. **Rules are resolved by year** — when adding legislation, always set `applicableYearRange`. Do not assume a rule applies to all years.
4. **Stages run in fixed order** — if you add a new `IForecastStage`, choose its `order` carefully. Placing it before Growth means it sees opening balances; placing it after Tax means it sees post-tax balances.
5. **Deferred entries are applied after the account loop** — do not expect a derived flow emitted in DerivedFlowsStage to affect GrowthStage calculations in the same year.

---

## 8. Glossary

| Term | Definition |
|------|------------|
| **Epoch** | A forecast period with defined start/end and consistent rules |
| **Preservation Age** | Age at which superannuation can be accessed |
| **Concessional Contributions** | Pre-tax super contributions (employer + salary sacrifice) |
| **Non-Concessional Contributions** | After-tax super contributions |
| **CPI** | Consumer Price Index — inflation measure |
| **Flow Kind** | Classification of a money movement: `externalIn`, `externalOut`, `synthetic`, `internalTransfer` |
| **Deferred Ledger** | Ledger entries collected during the account loop and applied after all accounts are processed |
| **Conservation Check** | Per-year integrity check verifying transfer balance and wealth drift |
