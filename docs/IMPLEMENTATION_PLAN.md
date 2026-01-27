# Implementation Plan: Retirement Financial Planner

**Version:** 0.2  
**Last Updated:** 2026-01-27  
**Status:** In Development

---

## Overview

This document outlines the staged delivery plan for the Retirement Financial Planner. Each phase builds on the previous, progressively adding functionality while maintaining a working application at each stage.

---

## Phase 1: Foundation (MVP)

**Goal:** Single-user, single-period forecast with configurable accounts and year-level visibility

| Feature | Description |
|---------|-------------|
| Single forecast period | One configurable epoch with start/end age |
| Configurable accounts | User creates accounts of type: income, expense, asset, liability |
| Account properties | Name, type, starting value, growth rate |
| Personal income tax | Marginal tax rates (hardcoded for MVP) |
| Capital gains tax | CGT on asset sales with 50% discount for long-term holdings |
| CPI assumption | Single rate for period |
| Investment growth | Configurable per account or default |
| Growth calculation methods | Opening Balance or Average Balance (configurable in Settings) |
| Auto top-up | Assets can auto-transfer from source account when balance falls below threshold |
| **Spreadsheet view** | Accounts as rows, years as columns, horizontal scroll |
| Sticky account names | Left column fixed during horizontal scroll |
| Closing balances | Asset/liability values show end-of-year balances |
| Negative balance warnings | Visual indicator when accounts go overdrawn |
| Expandable assumptions | Click account row to see underlying assumptions |
| Grouped sections | Income, Expenses, Assets, Liabilities, Calculated |
| Simple charts | Net worth over time, income vs expenses |

**Account Configuration (Phase 1):**
- Add/edit/delete accounts
- Set account type (income/expense/asset/liability)
- Set initial value
- Set growth profile (fixed %, CPI + x%, or +/- x% per year)
- Set start/end year (optional)
- Set end behavior (zero, transfer to account, hold value, sell with CGT)
- Auto top-up: enable automatic transfers from source account when balance falls below threshold

**Out of Scope for Phase 1:**
- Multi-person, multi-period, superannuation rules, scenarios, rule engine

---

## Phase 2: Epoch-Based Assumptions & Super Contributions

**Goal:** Allow assumptions to vary over time and make superannuation contributions configurable

| Feature | Description |
|---------|-------------|
| User-defined epochs | Create named time periods (e.g., "Accumulation", "Retirement") |
| Per-epoch assumptions | Configure growth, CPI, investment returns per epoch |
| Assumption sculpting | Different assumption profiles for different life stages |
| Concessional tracking | Off-balance sheet tracking of concessional contributions |
| Configurable caps | Set annual concessional contribution cap (e.g., $30,000) |
| Excess contribution tax | Configurable penalty rate for contributions exceeding cap |

---

## Phase 3: Rule Engine & Advanced Super

**Goal:** Configurable tax and regulatory rules

| Feature | Description |
|---------|-------------|
| Rule definition interface | Configurators can define rules |
| Condition-based logic | If age > X and contribution > Y, then... |
| Superannuation rules | Non-concessional caps, excess penalties, Division 293 |
| Tax offset rules | SAPTO, LITO, etc. |
| Rule versioning | Track rule changes over time |

---

## Phase 4: Scenarios & Stress Testing

**Goal:** Enable users to model alternative futures and compare outcomes

### Core Scenario Features

| Feature | Description | Stories |
|---------|-------------|---------|
| Scenario CRUD | Create, edit, delete named scenarios | US-13.1, 13.2, 13.9 |
| Assumption overrides | Override CPI, growth rates for year ranges | US-13.3 |
| Account overrides | Add, modify, or exclude accounts per scenario | US-13.4 |
| Event overrides | Add, modify, or remove events per scenario | US-13.5 |
| Scenario viewing | Switch active scenario, see forecast | US-13.6 |
| Promote to base | Make a scenario the new base case | US-13.10 |

### Scenario Comparison

| Feature | Description | Stories |
|---------|-------------|---------|
| Net Worth comparison chart | Overlay up to 5 scenarios on single chart | US-13.7 |
| Summary metrics table | Key metrics per scenario with deltas | US-13.8 |
| Scenario toggle | Show/hide individual scenarios on chart | US-13.7 |

### Schema Design (Delta-Based)

```typescript
// Scenario stores only differences from base case
ScenarioSchema = {
  id: string,
  name: string,
  description?: string,
  
  // Assumption overrides: { assumptionKey: { yearRanges: [...] } }
  assumptionOverrides: Map<string, YearRangeOverride[]>,
  
  // Account overrides
  accountAdditions: Account[],           // New accounts
  accountModifications: Map<string, Partial<Account>>,  // Changed properties
  accountExclusions: string[],           // Account IDs to exclude
  
  // Event overrides
  eventAdditions: Event[],
  eventModifications: Map<string, Partial<Event>>,
  eventExclusions: string[],
}
```

### Implementation Order

1. **Schema & Storage** - Define scenario schema, add to IndexedDB
2. **Scenario CRUD UI** - List, create, edit, delete scenarios
3. **Scenario Switching** - Select active scenario, recalculate forecast
4. **Override UI** - Interface for assumption/account/event overrides
5. **Comparison Page** - New route with chart + table
6. **Polish** - Visual indicators, promote to base

---

## Phase 5: Monte Carlo & Advanced Analysis

**Goal:** Probabilistic forecasting and deeper insights

| Feature | Description | Stories |
|---------|-------------|---------|
| Monte Carlo simulation | Run N simulations with randomized assumptions | US-13.11 |
| Percentile bands | Show 10th/25th/50th/75th/90th percentiles on charts | US-13.11 |
| Success probability | "X% chance of not running out" metric | US-13.11 |
| Assumption sensitivity | Configure which assumptions vary and by how much | US-13.11 |
| Sensitivity analysis | Which assumptions have the biggest impact? | — |

---

## Phase 6: Polish & Advanced Features

| Feature | Description |
|---------|-------------|
| Goal setting | "I want $X/year in retirement" → required savings |
| Export/reporting | PDF reports, CSV data export |
| What-if calculator | Quick adjustments without full scenario |
| Mobile-responsive | Tablet support |
| Audit trail | Track changes to inputs over time |
| Cloud sync | Persist data to remote storage |

---

## Phase Summary

| Phase | Focus | Key Deliverable |
|-------|-------|-----------------|
| 1 | Foundation (MVP) | Single-user spreadsheet view with configurable accounts |
| 2 | Epoch-Based Assumptions & Super | Per-epoch assumptions, concessional contribution tracking |
| 3 | Rule Engine | Configurable tax and super rules |
| 4 | Scenarios | Create, compare, and analyze alternative futures |
| 5 | Monte Carlo | Probabilistic forecasting with confidence bands |
| 6 | Polish | Goal setting, exports, cloud sync, mobile support |
| Future | AI Chat | Conversational scenario creation and insights |

> **Note:** Multi-person/household support was removed from the roadmap. Multiple people can be effectively modeled using separate accounts with appropriate naming conventions.
