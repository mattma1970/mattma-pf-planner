# System Architecture

**Version:** 1.0  
**Last Updated:** 2026-11-08  
**Status:** Current

---

## Overview

The Retirement Financial Planner is a client-side web application for Australian retirement financial planning. After the refactor, the system is organized around **pluggable rule registries** and a **decomposable forecast pipeline**, making legislation changes and new features injectable without modifying core engine code.

All monetary values are in Australian dollars (AUD).

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Browser (React 19 + Vite)                       │
├─────────────────────────────────────────────────────────────────────────┤
│  Presentation Layer                                                   │
│  ├─ SpreadsheetView  — TanStack Table grid (accounts × years)        │
│  ├─ Charts          — Net worth, income vs expense (Recharts)         │
│  ├─ Configuration   — Account/Event/Epoch editors                    │
│  └─ UI Plugin Registry — Pluggable renderers & editors               │
├─────────────────────────────────────────────────────────────────────────┤
│  Application Layer (Actions / Hooks / Stores)                         │
│  ├─ Actions         — Business logic (createAccount, runForecast…)    │
│  ├─ Hooks           — React wrappers over Zustand stores              │
│  ├─ Stores          — Zustand state (session/UI)                      │
│  └─ ForecastOrchestrator — Runs the pluggable pipeline per year      │
├─────────────────────────────────────────────────────────────────────────┤
│  Domain Layer (NEW — pluggable rules & behaviors)                     │
│  ├─ RuleRegistry    — Tax, CGT, Div293, Super cap rules              │
│  ├─ Pipeline Stages — 8 ordered forecast stages                      │
│  ├─ AccountBehavior — Pluggable account type behaviors              │
│  └─ Types           — Core domain value objects                      │
├─────────────────────────────────────────────────────────────────────────┤
│  Engine Layer (Pure calculation functions)                            │
│  ├─ tax.ts          — calculateIncomeTax, calculateCapitalGain        │
│  ├─ accounts.ts     — isAccountActive, projectAccountValue            │
│  ├─ superContributions.ts — Contribution cap processing              │
│  ├─ ledger.ts       — Classified ledger + conservation check         │
│  ├─ assumptions.ts  — ResolvedAssumptions per year                   │
│  └─ forecast.ts     — Orchestrates pipeline stages                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Data Layer (IndexedDB via Dexie.js)                                  │
│  └─ Repository      — Plan persistence & retrieval                    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Design Principles

| Principle | Description |
|-----------|-------------|
| **Legislation as data, not code** | Tax brackets, caps, thresholds live in pluggable rule classes, not hardcoded constants |
| **Pipeline-first** | The forecast is 8 ordered stages; each stage is independently replaceable |
| **Domain model independent of calculation** | Schemas describe *what exists*; rules describe *how it behaves* |
| **Explicit extension points** | Every area where legislation or features might change has a typed interface |
| **Incremental migration** | The refactor is adopted module-by-module; existing API is backward compatible |

## Layer Responsibilities

### Presentation Layer
React components render the spreadsheet view, charts, and configuration forms. UI components query the **UI Plugin Registry** to render account types they don't natively know about.

### Application Layer
Zustand stores hold UI/session state. Actions orchestrate the engine and data layer. `useForecast` triggers recalculation when inputs change.

### Domain Layer (new)
- **RuleRegistry** — registers and resolves legislation rules (tax, CGT, Div293, super caps) by year
- **Pipeline stages** — each stage implements `IForecastStage` and transforms a `ForecastContext`
- **AccountBehavior** — pluggable behaviors for account types (income, expense, asset, liability, and future custom types)
- **Types** — domain value objects: `Money`, `Year`, `PersonId`, `AccountId`, `RuleId`

### Engine Layer
Pure calculation functions with no React dependencies. Provides the low-level building blocks (tax brackets, CGT math, ledger entries, conservation checks) that pipeline stages call.

### Data Layer
Dexie.js IndexedDB repository. Plan data (persons, accounts, events, epochs, assumptions, settings) is persisted locally.

---

# Pipeline Stage Reference

The forecast runs year-by-year from `startYear` to `endYear`. For each year, a `ForecastContext` flows through 8 ordered stages. Each stage returns a (possibly mutated) context to the next.

## Stage Order Summary

| Order | Stage ID | Stage Class | Purpose |
|-------|----------|-------------|---------|
| 1 | `lifecycle-transfer` | `LifecycleTransferStage` | Detect accounts ending this year; move proceeds via transfer/sell/sellNoCgt |
| 2 | `user-transfer` | `UserTransferStage` | Apply user transfer events + super contribution events; enforce caps |
| 3 | `growth` | `GrowthStage` | Apply growth profiles; compute opening→closing values |
| 4 | `derived-flows` | `DerivedFlowsStage` | Emit income deposits, expense funding, asset returns, pension drawdowns |
| 5 | `liability` | `LiabilityStage` | Accrue interest; apply P&I or interest-only payments |
| 6 | `tax` | `TaxStage` | Generate tax events; calculate income tax, CGT, Div293, super tax |
| 7 | `auto-topup` | `AutoTopupStage` | Replenish assets below threshold from a source account |
| 8 | `conservation-check` | `ConservationCheckStage` | Verify ledger integrity (transfer balance + wealth drift) |

---

## Stage 1 — Lifecycle Transfer

**File:** `src/domain/pipeline/stages/lifecycle-transfer.ts`  
**Class:** `LifecycleTransferStage`  
**Order:** 1

### What it does
1. Captures **opening balances** for all accounts at the start of the year (first active year uses `initialValue`; income accounts start at 0)
2. Identifies accounts whose `endCondition` is met this year with `endBehavior: 'transfer' | 'sell' | 'sellNoCgt'`
3. Applies **lifecycle transfers**: source account loses its value; destination gains it
4. Computes **CGT** for `sell` behavior (50% discount if held ≥ 1 year)
5. Identifies **liability payoffs** triggered when a linked asset sells (`payoffFromAccountId`)

### State written to context
- `openingValues` — map of account ID → opening balance
- `lifecycleTransfers` — list of transfers with source/destination/amount/behavior
- `lifecycleFlows` — net change per account from lifecycle moves
- `pendingCgtEvents` — CGT events awaiting processing in the Tax stage
- `liabilityPayoffs` — liabilities to be zeroed via asset sale proceeds

### Extension points
- Add new `endBehavior` values by modifying `handleAccountTransfer` in `src/engine/accounts.ts`
- Add new CGT rules by registering an `ICGTRule` in the `RuleRegistry`

---

## Stage 2 — User Transfer

**File:** `src/domain/pipeline/stages/user-transfer.ts`  
**Class:** `UserTransferStage`  
**Order:** 2

### What it does
1. Processes **user transfer events** (explicit moves between accounts, including `transferAll`)
2. Processes **super contribution events**, applying concessional/non-concessional caps, carry-forward, and bring-forward limits
3. Generates **warnings** for blocked contributions (non-concessional cap exhausted)

### State written to context
- `userTransferFlows` — net change per account from user transfers
- `superContributionFlows` — contribution amounts per super account
- `superContributionsByAccount` — per-super-account contribution totals (concessional/non-concessional/pre-tax/post-tax)
- `contributionCapResultsByPerson` — cap utilization per person
- `contributionProcessingResults` — full cap processing results per person
- `carryForwardStates` — updated concessional carry-forward state
- `nonConcessionalCapStates` — updated non-concessional cap state

### Extension points
- New contribution types → add to `SuperContributionTypeSchema` in `src/schemas/event.ts` and update `getContributionTaxCategory`
- New cap rules → implement `ISuperCapRule` and register in `RuleRegistry`

---

## Stage 3 — Growth

**File:** `src/domain/pipeline/stages/growth.ts`  
**Class:** `GrowthStage`  
**Order:** 3

### What it does
1. Resolves assumptions (CPI) for the year, accounting for epoch overrides
2. For each active, non-ending account, computes:
   - **Balance for growth** (opening balance or average balance method)
   - **Projected value** after applying the growth profile (fixed, CPI-linked, increasing, decreasing)
   - **Growth amount** (projected − base)
3. Applies lifecycle transfers, user transfers, and super contributions after growth
4. Processes events affecting the account (income deposits, expense withdrawals)
5. Tracks **income by account/person** for tax and Div293
6. Tracks **franking credits** by asset owner

### Growth profile types
| Type | Formula |
|------|---------|
| `fixed` | `rate` (possibly epoch-overridden) |
| `cpiLinked` | `CPI + value` (add) or `CPI − value` (subtract) or `CPI × value` (multiply) |
| `increasing` | `rate + changePerYear × (year − 1)` |
| `decreasing` | `max(0, rate − changePerYear × (year − 1))` |

### Account type handling
- **Income**: growth based on prior year's inflows (pass-through; opening balance always 0)
- **Expense**: supports balance-based (`% of reference account`) and periodic (every X years) calculations
- **Asset**: growth on balance; generates returns if `incomeTargetAccountId` set
- **Liability**: no growth; interest handled in Stage 5

### State written to context
- `resolvedAssumptions`, `yearWarnings`, `incomeByAccount`, `incomeByPerson`, `frankingCreditsByPerson`, `totalIncome`, `totalExpenses`, `liabilityPayoffs`, `accountResults`, `accountValues`

---

## Stage 4 — Derived Flows

**File:** `src/domain/pipeline/stages/derived-flows.ts`  
**Class:** `DerivedFlowsStage`  
**Order:** 4

### What it does
Emits **deferred ledger entries** for flows that must be applied after all accounts are processed:

| Flow | Ledger Kind | Description |
|------|-------------|-------------|
| Income → bank | `externalIn` credit | Salary, rent, dividends deposited |
| Super contribution (derived) | `externalIn` credit | Employer SG routed to super account |
| Pension drawdown | `internalTransfer` debit + credit | From drawnFromAccount to depositsToAccount |
| Expense | `externalOut` debit | Funded by `fundedByAccountId` |
| Asset return | `synthetic` credit | Investment return to `incomeTargetAccountId` |
| Asset funding | `internalTransfer` debit | From `fundedByAccountId` to purchase asset |
| Hold behavior | `externalIn` / `externalOut` | For ended accounts that hold value |

### State written to context
- `deferredLedgerEntries` — all ledger entries for this year
- `yearLedgerEntries` — accumulated ledger entries
- `superContributionsByAccount` — updated with derived income contributions

---

## Stage 5 — Liability

**File:** `src/domain/pipeline/stages/liability.ts`  
**Class:** `LiabilityStage`  
**Order:** 5

### What it does
For each liability account:
1. **Asset-sale payoff**: If a linked asset sold, zero the liability and debit the funding account
2. **Interest accrual**: `interest × effectiveBalance` (effective balance reduced by offset account)
3. **Payment calculation**:
   - Fixed annual payment, or
   - Auto-calculated to pay off by end date (amortization), or
   - Interest-only (payment = interest)
4. **Principal reduction**: payment − interest (0 for interest-only)
5. **Funding**: debit from `fundedByAccountId`

### State written to context
- `yearLedgerEntries` — liability payment entries
- `accountResults` — updated with interest/withdrawals/endValue
- `accountValues` — updated liability balances

---

## Stage 6 — Tax

**File:** `src/domain/pipeline/stages/tax.ts`  
**Class:** `TaxStage`  
**Order:** 6

### What it does
This is the **primary extension point for Australian tax legislation**. It:

1. Updates capital loss carry-forward opening balances
2. Generates **income tax events** from `incomeByAccount`
3. Generates tax events from events with `taxTreatmentType: 'taxable' | 'taxDeduction'`
4. Processes **CGT events** with capital loss carry-forward (losses offset gains before discount)
5. Processes **super contribution tax**: 15% on concessional within cap, salary sacrifice add-back, personal deductible limits
6. Calculates **Division 293 tax** for high-income earners
7. **Aggregates tax by funding account** (marginal rates vs flat 15% for super)
8. Applies **franking credits** as tax offsets
9. Deducts tax from funding accounts via ledger entries
10. Computes **per-person tax aggregation**

### Tax event types
| Type | Description |
|------|-------------|
| `incomeTax` | Marginal rate tax on assessable income |
| `capitalGainsTax` | CGT on asset sales (after loss offset and discount) |
| `capitalLoss` | Capital loss recorded (carried forward) |
| `superContributionTax` | 15% on concessional contributions within cap |
| `division293Tax` | Additional 15% for income + concessional > $250k |
| `taxDeduction` | Reduces assessable income (salary sacrifice, personal deductible) |
| `frankingCreditOffset` | Reduces tax payable (can create refund) |

### Extension points
- New tax year → register a new `ITaxRule` in `RuleRegistry`
- New tax offset/rebate → new `ITaxRule` implementation
- New CGT rules → implement `ICGTRule`
- New Div293 rules → implement `IDiv293Rule`

---

## Stage 7 — Auto Topup

**File:** `src/domain/pipeline/stages/auto-topup.ts`  
**Class:** `AutoTopupStage`  
**Order:** 7

### What it does
For each asset account with `autoTopup.enabled`:
1. If `endValue < threshold`, calculate topup amount to reach `targetBalance` (or threshold)
2. Emit paired ledger entries: debit source account, credit target account
3. Mark both accounts as having auto-topup applied

### State written to context
- `yearLedgerEntries` — auto-topup transfer entries
- `accountResults` — `autoTopupApplied` flags

---

## Stage 8 — Conservation Check

**File:** `src/domain/pipeline/stages/conservation-check.ts`  
**Class:** `ConservationCheckStage`  
**Order:** 8

### What it does
Runs `checkConservation()` from the ledger module:

| Check | Formula | Reliability |
|-------|---------|-------------|
| **Transfer balance** | Σ(internalTransfer credits) − Σ(debits) == 0 ±$1 | Fully reliable |
| **Wealth drift** | Δ(net wealth) == assetGrowth + externalIn − externalOut + synthetic ±$1 | Informational (known limitation with synthetic returns) |

Emits a `conservationViolation` warning if the transfer balance check fails.

---

# Forecast Context Reference

The `ForecastContext` is the mutable state object passed through all stages. Key sections:

| Section | Fields | Purpose |
|---------|--------|---------|
| Configuration | `startYear`, `endYear`, `settings`, `rules` | Forecast configuration and rule registry |
| Input data | `accounts`, `events`, `persons`, `epochs`, `assumptions` | Read-only plan data |
| Account state | `accountValues`, `priorYearInflows`, `accountStartYears` | Running balances and tracking |
| Year state | `year`, `openingValues`, `accountResults` | Current year processing |
| Super state | `carryForwardStates`, `nonConcessionalCapStates`, `capitalLossStates` | Cross-year super/cap state |
| Lifecycle | `lifecycleTransfers`, `lifecycleFlows`, `pendingCgtEvents`, `liabilityPayoffs` | Stage 1 outputs |
| Transfers | `userTransferFlows`, `superContributionFlows`, `superContributionsByAccount` | Stage 2 outputs |
| Tax | `taxEvents`, `taxAggregations`, `taxByPerson`, `taxPayable`, `netPosition` | Stage 6 outputs |
| Ledger | `yearLedgerEntries`, `deferredLedgerEntries` | Classified money movements |
| Outputs | `results`, `warnings`, `peakAssets`, `peakAssetsYear` | Final forecast results |

---

# Playbooks: How to Extend the Application

## Playbook 1: Add a New Australian Tax Year (e.g., 2025-26)

**Goal:** Add new marginal tax brackets for a new financial year without touching engine code.

### Steps

1. **Create the rule class** in `src/domain/rules/tax.ts`:

```typescript
export class MarginalIncomeTaxRule2025_26 implements ITaxRule {
  readonly id = 'marginal-income-tax';
  readonly version = '2025-26';
  readonly applicableYearRange = { start: 2025, end: 2025 };
  readonly enabled = true;

  constructor(private brackets: TaxBracket[] = TAX_BRACKETS_2025_26) {}

  isApplicable(ctx: TaxRuleContext): boolean {
    return ctx.year >= 2025 && ctx.year <= 2025;
  }

  calculate(ctx: TaxRuleContext): TaxRuleResult {
    // Implement bracket calculation
    // Return { taxPayable, taxEvents: [...] }
  }
}
```

2. **Define the brackets** as a `TaxBracket[]` constant.

3. **Register the rule** in your app bootstrap or in `src/domain/registry.ts`:

```typescript
defaultRuleRegistry.registerTaxRule(new MarginalIncomeTaxRule2025_26(TAX_BRACKETS_2025_26));
```

4. **Verify**: The `TaxStage` will automatically resolve rules for year 2025. No changes to `forecast.ts`, `tax.ts`, or `TaxStage` needed.

5. **Test**: Add a test in `src/domain/rules/tax.test.ts` verifying the new brackets produce expected tax amounts.

---

## Playbook 2: Add a New Superannuation Cap Rule

**Goal:** Change concessional cap, non-concessional cap, or carry-forward rules for a new year.

### Steps

1. **Implement `ISuperCapRule`** in `src/domain/rules/super.ts`:

```typescript
export class SuperCapRule2025_26 implements ISuperCapRule {
  readonly id = 'super-caps-2025-26';
  readonly version = '2025-26';
  readonly applicableYearRange = { start: 2025, end: 2025 };
  readonly enabled = true;

  calculate(_ctx: SuperCapRuleContext): SuperCapRuleResult {
    return {
      concessionalCap: 32000,      // new cap
      nonConcessionalCap: 120000,
      carryForwardYears: 5,
      contributionsTaxRate: 0.15,
      employerSgRate: 0.12,        // new SG rate
      preservationAge: 67,
      div293Threshold: 250000,
      div293Rate: 0.15,
    };
  }
}
```

2. **Register** in `RuleRegistry`:

```typescript
defaultRuleRegistry.registerSuperCapRule(new SuperCapRule2025_26());
```

3. **Verify**: The `UserTransferStage` and `TaxStage` call `getSuperCaps()` which resolves rules by year automatically.

---

## Playbook 3: Add a New CGT Rule

**Goal:** Change capital gains discount percentage or holding period.

### Steps

1. **Implement `ICGTRule`** in `src/domain/rules/tax.ts`:

```typescript
export class NewCGTRule implements ICGTRule {
  readonly id = 'capital-gains-tax';
  readonly version = '2025-26';
  readonly applicableYearRange = { start: 2025, end: 2025 };
  readonly enabled = true;

  calculate(ctx: CGTRuleContext): CGTResult {
    const grossGain = Math.max(0, ctx.saleProceeds - ctx.costBase);
    const holdingYears = ctx.saleYear - ctx.acquisitionYear;
    const discountApplied = ctx.eligibleForDiscount && holdingYears >= 1 && grossGain > 0;
    const discountedGain = discountApplied ? grossGain * 0.5 : grossGain;
    const taxPayable = discountedGain * ctx.marginalTaxRate;
    return { grossCapitalGain: grossGain, discountApplied, discountedGain, costBase: ctx.costBase, saleProceeds: ctx.saleProceeds, taxPayable };
  }
  isApplicable(ctx: CGTRuleContext): boolean {
    return ctx.saleYear >= 2025 && ctx.saleYear <= 2025;
  }
}
```

2. **Register**: `defaultRuleRegistry.registerCGTRule(new NewCGTRule());`

3. **Verify**: `LifecycleTransferStage` calls `calculateCapitalGain()` which delegates to the registry.

---

## Playbook 4: Add a New Account Type (e.g., "Reverse Mortgage")

**Goal:** Add a custom account type with its own growth, validation, and UI rendering.

### Steps

1. **Add to schema** in `src/schemas/account.ts`:
   - Add the new type to `AccountTypeSchema` (or handle via `category`/`specialConfig`)
   - Add any new fields to `AccountSchema`

2. **Implement `IAccountBehavior`** in a new file (e.g., `src/domain/accounts/behaviors/reverse-mortgage.ts`):

```typescript
export class ReverseMortgageBehavior implements IAccountBehavior {
  readonly accountType = 'reverse-mortgage';

  onYearStart(account: Account, ctx: YearContext): AccountEffect[] {
    return [];
  }

  calculateGrowth(account: Account, ctx: YearContext): GrowthResult {
    // Reverse mortgage: balance grows by interest rate
    const rate = account.interestRate ?? 0.05;
    return { rate, appliedValue: ctx.accountValues.get(account.id) ?? 0, description: 'Reverse mortgage interest' };
  }

  onYearEnd(account: Account, ctx: YearContext): AccountEffect[] {
    return [];
  }

  validate(account: Account): ValidationError[] {
    if (!account.interestRate) {
      return [{ field: 'interestRate', message: 'Reverse mortgage requires an interest rate', severity: 'error' }];
    }
    return [];
  }
}
```

3. **Register** in `AccountBehaviorRegistry`:

```typescript
defaultAccountBehaviorRegistry.register(new ReverseMortgageBehavior());
```

4. **Register UI** in `UIPluginRegistry`:

```typescript
defaultUIPluginRegistry.registerAccountRenderer({
  accountType: 'reverse-mortgage',
  component: ReverseMortgageRenderer,
});
defaultUIPluginRegistry.registerAccountEditor({
  accountType: 'reverse-mortgage',
  component: ReverseMortgageEditor,
});
```

5. **Update `SpreadsheetView`** to query the registry for renderers by `account.type`.

---

## Playbook 5: Add a New Forecast Pipeline Stage

**Goal:** Insert a new calculation step (e.g., aged care means testing, pension drawdown minimums).

### Steps

1. **Implement `IForecastStage`**:

```typescript
export class AgedCareMeansTestStage implements IForecastStage {
  readonly id = 'aged-care-means-test';
  readonly order = 6; // between Tax (6) and AutoTopup (7) — adjust as needed
  readonly enabled = true;

  execute(context: ForecastContext): ForecastContext {
    // Read context.incomeByAccount, context.accountValues, etc.
    // Compute means-tested amounts
    // Emit ledger entries or modify context as needed
    return { ...context, ...updatedState };
  }
}
```

2. **Choose an order** — stages run in ascending `order`:
   - 1: lifecycle-transfer
   - 2: user-transfer
   - 3: growth
   - 4: derived-flows
   - 5: liability
   - 6: tax
   - 7: auto-topup
   - 8: conservation-check

   Insert your stage between existing orders or renumber existing stages.

3. **Register** in `forecast.ts` or wherever the orchestrator is built:

```typescript
orchestrator.registerStage(new AgedCareMeansTestStage());
```

4. **Update `ForecastContext`** in `stages.ts` if your stage needs new state fields.

---

## Playbook 6: Add a New UI Feature Behind a Capability Flag

**Goal:** Gate a UI feature behind a configuration flag.

### Steps

1. **Define the capability** in your app bootstrap:

```typescript
defaultUIPluginRegistry.registerCapability({
  id: 'scenario-comparison',
  enabled: true,
  description: 'Allow comparing multiple scenarios',
});
```

2. **Check in component**:

```typescript
if (defaultUIPluginRegistry.isCapabilityEnabled('scenario-comparison')) {
  return <ScenarioComparison />;
}
return <FeatureComingSoon />;
```

3. **Disable for rollout**: Set `enabled: false` without code changes.

---

## Playbook 7: Modify Transaction Classification

**Goal:** Change how a money flow is classified (externalIn, externalOut, synthetic, internalTransfer).

### Steps

1. **Identify the flow** in the relevant pipeline stage (e.g., `DerivedFlowsStage` for income deposits)
2. **Change the `kind`** in the `emitLedgerEntry` call
3. **Ensure internal transfers are paired**: every `internalTransfer` debit must have a matching credit of equal amount
4. **Run tests**: The `ConservationCheckStage` will emit `conservationViolation` warnings if transfer balance is broken
5. **Verify**: Run `npm test` to confirm all forecast tests pass

---

# Module Layout

```
src/
├── domain/                    # NEW: pluggable rules & behaviors
│   ├── types.ts               # Core value objects (Money, Year, PersonId, etc.)
│   ├── registry.ts            # RuleRegistry + defaultRuleRegistry
│   ├── index.ts               # Domain barrel exports
│   ├── rules/
│   │   ├── index.ts
│   │   ├── tax.ts             # ITaxRule, ICGTRule, IDiv293Rule + 2024-25 impls
│   │   ├── super.ts           # ISuperCapRule + 2024-25 impl
│   │   └── tax.test.ts        # Rule tests incl. extensibility tests
│   ├── accounts/
│   │   └── behavior.ts        # IAccountBehavior + AccountBehaviorRegistry
│   └── pipeline/
│       ├── stages.ts          # IForecastStage, ForecastContext, ForecastOrchestrator, STAGE_IDS
│       ├── index.ts
│       └── stages/
│           ├── lifecycle-transfer.ts   # Stage 1
│           ├── user-transfer.ts        # Stage 2
│           ├── growth.ts               # Stage 3
│           ├── derived-flows.ts        # Stage 4
│           ├── liability.ts            # Stage 5
│           ├── tax.ts                  # Stage 6
│           ├── auto-topup.ts           # Stage 7
│           └── conservation-check.ts   # Stage 8
├── engine/                    # Pure calculation functions
│   ├── forecast.ts            # Orchestrates pipeline stages (calculateForecast)
│   ├── tax.ts                 # calculateIncomeTax, calculateCapitalGain (delegates to registry)
│   ├── accounts.ts            # isAccountActive, projectAccountValue, handleAccountTransfer
│   ├── ledger.ts              # LedgerEntry, emitLedgerEntry, checkConservation
│   ├── superContributions.ts  # Contribution cap processing
│   ├── assumptions.ts         # resolveAssumptions, resolveAssumptionForYear
│   └── taxRules.ts            # Legacy Div293 (kept for compatibility)
├── components/ui/registry.ts  # UIPluginRegistry + defaultUIPluginRegistry
├── actions/                   # Business logic (runForecast, account CRUD)
├── data/                      # IndexedDB persistence (Dexie.js)
├── schemas/                   # Zod schemas (single source of truth)
├── store/                     # Zustand state
├── hooks/                     # React hooks
└── components/                # React UI
```

---

# Testing Strategy

| Area | Test Location | Focus |
|------|--------------|-------|
| Rules | `src/domain/rules/tax.test.ts` | Bracket math, CGT, Div293, extensibility (new year rules) |
| Registry | `src/domain/registry.test.ts` | Registration, year resolution, unregistration |
| Pipeline | `src/engine/forecast.test.ts` | End-to-end forecast, all 69 scenarios |
| Engine units | `src/engine/*.test.ts` | Tax, accounts, ledger, super contributions |
| Actions | `src/actions/accounts.test.ts` | Business logic operations |
| Data | `src/data/plan-file.test.ts` | Serialization/deserialization |

**Run tests:** `npm test`  
**Run type check:** `npx tsc --noEmit`  
**Run lint:** `npm run lint`

All 225 tests must pass before merging changes.
