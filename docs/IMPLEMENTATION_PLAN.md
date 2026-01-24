# Implementation Plan: Retirement Financial Planner

**Version:** 0.1  
**Last Updated:** 2026-01-25  
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

## Phase 2: Multi-Period & Basic Super

**Goal:** Enable full retirement journey modeling

| Feature | Description |
|---------|-------------|
| Multiple forecast periods | Chain of epochs with output→input flow |
| Superannuation account type | Accumulation phase modeling |
| Concessional contributions | Employer + salary sacrifice with basic caps |
| Preservation age awareness | Flag when super becomes accessible |
| Period transitions | Define how assets transfer between periods |

---

## Phase 3: Multi-Person & Household View

**Goal:** Support couples and combined forecasting

| Feature | Description |
|---------|-------------|
| Multiple individuals | Each with own income, expenses, assets |
| Individual views | Per-person forecast sections |
| Combined view | Household-level aggregation |
| Asset merging | Configure when/how assets combine |
| Relationship modeling | Who owns what, joint assets |

---

## Phase 4: Rule Engine & Advanced Super

**Goal:** Configurable tax and regulatory rules

| Feature | Description |
|---------|-------------|
| Rule definition interface | Configurators can define rules |
| Condition-based logic | If age > X and contribution > Y, then... |
| Superannuation rules | Non-concessional caps, excess penalties, Division 293 |
| Tax offset rules | SAPTO, LITO, etc. |
| Rule versioning | Track rule changes over time |

---

## Phase 5: Scenarios & Stress Testing

**Goal:** Robust scenario analysis

| Feature | Description |
|---------|-------------|
| Named scenarios | Save and compare assumption sets |
| Year-level overrides | Specify assumptions per year |
| Monte Carlo option | Randomized scenario generation |
| Comparison dashboard | Side-by-side scenario results |
| Sensitivity analysis | Which assumptions matter most? |

---

## Phase 6: Polish & Advanced Features

| Feature | Description |
|---------|-------------|
| Goal setting | "I want $X/year in retirement" → required savings |
| Export/reporting | PDF reports, CSV data export |
| What-if calculator | Quick adjustments without full scenario |
| Mobile-responsive | Tablet support |
| Audit trail | Track changes to inputs over time |

---

## Phase Summary

| Phase | Focus | Key Deliverable |
|-------|-------|-----------------|
| 1 | Foundation (MVP) | Single-user spreadsheet view with configurable accounts |
| 2 | Multi-Period & Basic Super | Epoch chaining, superannuation modeling |
| 3 | Multi-Person | Couples support, household aggregation |
| 4 | Rule Engine | Configurable tax and super rules |
| 5 | Scenarios | Stress testing and comparisons |
| 6 | Polish | Goal setting, exports, mobile support |
