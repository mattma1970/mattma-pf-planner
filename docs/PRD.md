# Product Requirements Document: Retirement Financial Planner

**Version:** 0.1 (Draft)  
**Last Updated:** 2026-01-24  
**Status:** In Development

---

## 1. Vision & Purpose

A web application enabling Australian users to make informed predictions about their retirement finances. The app allows users to:

- Forecast savings and investment requirements leading to retirement
- Model their ability to fund retirement lifestyle
- Perform scenario analysis to stress-test predictions against market downturns, unexpected expenses, changing CPI, and tax rule changes

### Target Users

| User Type | Description |
|-----------|-------------|
| **Configurator** | Person with tax/accounting knowledge who sets up tax rules, superannuation regulations, and system defaults |
| **End User** | Regular person who inputs their financial situation and views forecasts to plan savings and spending |

---

## 2. Core Concepts

### 2.1 Forecast Periods (Epochs)

The system models financial life as a series of **configurable forecast periods**. Each period:
- Has defined start/end conditions (age, date, or event-triggered)
- Contains the same forecasting capabilities (income, assets, expenditure, tax, CPI, investment growth, pension rules)
- Outputs become inputs to the next period

**Typical Configuration:**
1. **Accumulation Phase:** Now → Retirement Date
2. **Early Retirement:** Retirement Date → Preservation Age (superannuation access)
3. **Drawdown Phase:** Preservation Age → Age 99

Users can add/remove/modify periods as needed.

### 2.2 Multi-Person Support

- Multiple individuals can be configured (e.g., a couple)
- Each person has independent forecasts and inputs
- UI displays both individual and combined positions
- Assets/income can be merged at configurable points (e.g., retirement)

### 2.3 Rule Engine (Tax & Regulations)

Rather than hardcoding complex rules (especially superannuation), the system uses a **configurable rule engine**:

- Rules are defined with conditions, thresholds, and outcomes
- Example: Concessional contribution caps, non-concessional limits, excess contribution penalties
- Configurators set up rules; end users see the effects

### 2.4 Configurable Accounts (Line Items)

Rather than hardcoding specific income sources, assets, or liabilities, the system uses **configurable accounts**:

| Account Type | Description | Examples |
|--------------|-------------|----------|
| **Income** | Regular inflows | Salary, business income, rental income, dividends |
| **Expense** | Regular outflows | Living expenses, insurance, subscriptions |
| **Asset** | Stores of value | House, cash savings, shares, superannuation, vehicles |
| **Liability** | Debts | Mortgage, car loan, credit card, HECS |

**Account Properties:**
- Name (user-defined)
- Type (income/expense/asset/liability)
- Owner (which person, or joint)
- Growth/interest rate (can reference assumptions)
- Tax treatment (how it interacts with tax rules)
- Epoch behavior (carries forward, liquidates, transfers, etc.)

This allows:
- A simple user to configure: "Salary", "House", "Super", "Living Costs"
- A complex user to configure: Multiple income streams, investment accounts, rental properties, etc.

### 2.5 Year-Level Visibility (Spreadsheet View)

**Core Principle:** The UI displays forecasts in a **spreadsheet-style layout** with horizontal scrolling.

**Layout Structure:**
- **Rows:** Accounts and calculated items (income, expenses, assets, liabilities, totals)
- **Columns:** Years (horizontally scrolling)
- **Sticky left column:** Account/item names remain fixed during horizontal scroll
- **Single unified view:** All account types visible together (no separate tabs)

**Benefits:**
- Users can trace exactly what happens each year across all accounts
- Familiar spreadsheet metaphor from accounting software
- Easy to scan across years for a single account, or down a year for full position
- Enables year-level overrides in future phases

**UI Structure:**
```
┌─────────────────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│ Account             │ 2026    │ 2027    │ 2028    │ 2029    │ ...→    │
│ (sticky)            │ Age 45  │ Age 46  │ Age 47  │ Age 48  │         │
├─────────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ ▸ INCOME            │         │         │         │         │         │
│   Salary            │ 120,000 │ 123,600 │ 127,308 │ 131,127 │         │
│   Rental Income     │  30,000 │  30,900 │  31,827 │  32,782 │         │
├─────────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ ▸ EXPENSES          │         │         │         │         │         │
│   Living Costs      │  60,000 │  61,800 │  63,654 │  65,564 │         │
│   Insurance         │   5,000 │   5,150 │   5,305 │   5,464 │         │
├─────────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ ▸ ASSETS            │         │         │         │         │         │
│   House             │ 800,000 │ 840,000 │ 882,000 │ 926,100 │         │
│   Super             │ 200,000 │ 245,000 │ 294,250 │ 348,013 │         │
│   Cash              │  50,000 │  85,000 │ 122,481 │ 162,526 │         │
├─────────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ ▸ LIABILITIES       │         │         │         │         │         │
│   Mortgage          │ 400,000 │ 375,000 │ 350,000 │ 325,000 │         │
├─────────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ ═ CALCULATED        │         │         │         │         │         │
│   Total Income      │ 150,000 │ 154,500 │ 159,135 │ 163,909 │         │
│   Total Expenses    │  65,000 │  66,950 │  68,959 │  71,028 │         │
│   Tax               │  32,000 │  33,500 │  35,100 │  36,800 │         │
│   Net Worth         │ 650,000 │ 795,000 │ 948,731 │1,111,639│         │
└─────────────────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
```

**Expandable Rows:** Clicking ▸ on an account row expands to show the assumptions driving that account (growth rate, CPI linkage, etc.)

**Epoch Indicators:** Visual styling (background color or divider) marks epoch transitions (e.g., "Retirement starts here").

### 2.6 Year-Level Overrides & Events

The system supports fine-grained control via three mechanisms:

#### Assumption Profiles (for CPI, growth rates, tax rates, etc.)

Each assumption has:
- **Base value:** Default for the entire forecast
- **Year overrides:** Sparse table of year → value for exceptions

```
CPI Assumption:
  Base: 3.0%
  Overrides:
    2025-2030: 3.5%
    2031: 5.0%
    2032: 4.5%
    2033+: (reverts to base 3.0%)
```

**Profile Formula Types:**
- **Fixed value:** `3.5%` - constant rate
- **CPI-linked:** `CPI + 1%` - follows CPI assumption plus offset
- **Reducing:** `-0.5% per year` - decreases over time (e.g., risk reduction)
- **Increasing:** `+0.5% per year` - increases over time

**UX:** Click an assumption to open a profile editor. Can enter ranges ("2025-2030") or individual years. Formulas configured in settings, not cell-by-cell in spreadsheet.

#### Account Lifecycle (start/end years)

Each account can have:
- **Start year:** When the account becomes active (optional)
- **End year:** When the account stops (optional)
- **End behavior:** What happens at end:
  - Zero out (income stops)
  - Transfer to another account (sell house → cash)
  - Remain at final value (property held indefinitely)

```
Salary Account:
  Start: 2020
  End: 2035
  End behavior: Zero (retirement)
  
House Asset:
  End: 2040
  End behavior: Transfer to "Cash" ($1,200,000)
  
Business Income Account:
  Start: 2027
  End: (none - continues)
```

**UX:** Account properties panel with optional start/end fields and transfer destination picker.

#### Events (One-Time Items)

For non-recurring items that don't fit the account model:
- **Year:** When it occurs
- **Type:** Income, expense, asset change, liability change
- **Amount:** Value
- **Description:** User note

```
Events:
  - 2027: Expense "Business Startup" -$15,000
  - 2030: Asset "Inheritance" +$50,000
  - 2035: Asset "Sell Investment Property" +$600,000
```

**UX:** 
- Event values are **merged into the relevant account rows** (e.g., inheritance adds to cash in that year)
- An **Events Summary section** at the bottom of the spreadsheet shows:
  - Event name and year
  - Affected account(s) and amounts
  - Does NOT show cascading effects (e.g., shows "House: +$1M" but not "Cash: +$1M" from the transfer)
- This gives at-a-glance visibility of one-time items without cluttering the main view

### 2.7 Scenarios

**Scenarios** bundle overrides for comparison:

- **Base Case:** Uses all default assumptions
- **Named Scenarios:** Override specific assumptions or events

A scenario contains:
- Assumption profile overrides (e.g., "Super growth = 1% for 2029-2031")
- Additional events (e.g., "Market crash: Super loses 20% in 2029")
- Account overrides (e.g., "Retirement delayed to 2037")

**UX:** Scenario switcher in header. Overridden values highlighted in spreadsheet. Side-by-side comparison view in later phase.

---

## 3. Staged Delivery Plan

### Phase 1: Foundation (MVP)

**Goal:** Single-user, single-period forecast with configurable accounts and year-level visibility

| Feature | Description |
|---------|-------------|
| Single forecast period | One configurable epoch with start/end age |
| Configurable accounts | User creates accounts of type: income, expense, asset, liability |
| Account properties | Name, type, starting value, growth rate |
| Personal income tax | Marginal tax rates (hardcoded for MVP) |
| CPI assumption | Single rate for period |
| Investment growth | Configurable per account or default |
| **Spreadsheet view** | Accounts as rows, years as columns, horizontal scroll |
| Sticky account names | Left column fixed during horizontal scroll |
| Expandable assumptions | Click account row to see underlying assumptions |
| Grouped sections | Income, Expenses, Assets, Liabilities, Calculated |
| Simple charts | Net worth over time, income vs expenses |

**Account Configuration (Phase 1):**
- Add/edit/delete accounts
- Set account type (income/expense/asset/liability)
- Set initial value
- Set growth profile (fixed %, CPI + x%, or +/- x% per year)
- Set start/end year (optional)
- Set end behavior (zero, transfer to account, hold value)

**Out of Scope for Phase 1:**
- Multi-person, multi-period, superannuation rules, scenarios, rule engine

---

### Phase 2: Multi-Period & Basic Super

**Goal:** Enable full retirement journey modeling

| Feature | Description |
|---------|-------------|
| Multiple forecast periods | Chain of epochs with output→input flow |
| Superannuation account type | Accumulation phase modeling |
| Concessional contributions | Employer + salary sacrifice with basic caps |
| Preservation age awareness | Flag when super becomes accessible |
| Period transitions | Define how assets transfer between periods |

---

### Phase 3: Multi-Person & Household View

**Goal:** Support couples and combined forecasting

| Feature | Description |
|---------|-------------|
| Multiple individuals | Each with own income, expenses, assets |
| Individual views | Per-person forecast sections |
| Combined view | Household-level aggregation |
| Asset merging | Configure when/how assets combine |
| Relationship modeling | Who owns what, joint assets |

---

### Phase 4: Rule Engine & Advanced Super

**Goal:** Configurable tax and regulatory rules

| Feature | Description |
|---------|-------------|
| Rule definition interface | Configurators can define rules |
| Condition-based logic | If age > X and contribution > Y, then... |
| Superannuation rules | Non-concessional caps, excess penalties, Division 293 |
| Tax offset rules | SAPTO, LITO, etc. |
| Rule versioning | Track rule changes over time |

---

### Phase 5: Scenarios & Stress Testing

**Goal:** Robust scenario analysis

| Feature | Description |
|---------|-------------|
| Named scenarios | Save and compare assumption sets |
| Year-level overrides | Specify assumptions per year |
| Monte Carlo option | Randomized scenario generation |
| Comparison dashboard | Side-by-side scenario results |
| Sensitivity analysis | Which assumptions matter most? |

---

### Phase 6: Polish & Advanced Features

| Feature | Description |
|---------|-------------|
| Goal setting | "I want $X/year in retirement" → required savings |
| Export/reporting | PDF reports, CSV data export |
| What-if calculator | Quick adjustments without full scenario |
| Mobile-responsive | Tablet support |
| Audit trail | Track changes to inputs over time |

---

## 4. Key Assumptions Display Requirements

The app must make assumptions **visible and transparent**:

1. **Assumptions Panel:** Always-visible summary of current assumptions
2. **Inline Indicators:** Show where assumptions affect calculations
3. **Assumption Sources:** Mark as "system default", "user override", or "scenario"
4. **Year-by-Year View:** Expandable to see assumption values per year

---

## 5. Open Questions

- [ ] What specific superannuation rules should be in scope for Phase 4?
- [ ] Should we support importing data from other financial tools?
- [ ] What level of precision is needed? (nearest dollar vs. thousands)
- [ ] How should we handle legislative changes to tax/super rules?
- [ ] Do we need user authentication, or is this single-device/local?
- [ ] Should scenarios be shareable between users?

---

## 6. Success Metrics

| Metric | Target |
|--------|--------|
| Forecast accuracy | Within 5% of actual (for backtesting) |
| Time to first forecast | < 10 minutes for basic setup |
| Scenario comparison | < 30 seconds to switch and compare |
| Assumption transparency | 100% of calculations traceable to inputs |

---

## 7. Glossary

| Term | Definition |
|------|------------|
| **Epoch** | A forecast period with defined start/end and consistent rules |
| **Preservation Age** | Age at which superannuation can be accessed (55-60 depending on birth year) |
| **Concessional Contributions** | Pre-tax super contributions (employer + salary sacrifice) |
| **Non-Concessional Contributions** | After-tax super contributions |
| **CPI** | Consumer Price Index - inflation measure |
| **SAPTO** | Seniors and Pensioners Tax Offset |

---

## Next Steps

1. Review and refine this PRD
2. Create architecture document
3. Define tech stack
4. Write detailed user stories for Phase 1
5. Create UI wireframes for Phase 1
