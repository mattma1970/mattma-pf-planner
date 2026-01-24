# User Stories

**Version:** 0.1 (Draft)  
**Last Updated:** 2026-01-24

---

## Phase 1: Foundation (MVP)

### Epic 1: Account Management

#### US-1.1: Create an account
**As a** user  
**I want to** create a new financial account  
**So that** I can include it in my retirement forecast

**Acceptance Criteria:**
- [ ] Can specify account name
- [ ] Can select account type (income, expense, asset, liability)
- [ ] Can set initial value
- [ ] Can set growth profile (fixed %, CPI + x%, +/- x% per year)
- [ ] Account appears in spreadsheet view after creation
- [ ] Account is persisted (survives page refresh)

---

#### US-1.2: Edit an account
**As a** user  
**I want to** edit an existing account's properties  
**So that** I can correct mistakes or update my financial situation

**Acceptance Criteria:**
- [ ] Can change account name
- [ ] Can change growth profile
- [ ] Can change initial value
- [ ] Changes immediately reflect in forecast
- [ ] Changes are persisted

---

#### US-1.3: Delete an account
**As a** user  
**I want to** delete an account I no longer need  
**So that** my forecast only includes relevant items

**Acceptance Criteria:**
- [ ] Confirmation prompt before deletion
- [ ] Account removed from spreadsheet
- [ ] Forecast recalculates without this account
- [ ] If account is a transfer target, warn user before deletion

---

#### US-1.4: Set account start/end conditions
**As a** user  
**I want to** specify when an account starts or ends (by year or age)  
**So that** I can model life changes like retirement or asset sales

**Acceptance Criteria:**
- [ ] Can set optional start condition: year OR age
- [ ] Can set optional end condition: year OR age
- [ ] Can set end behavior: zero out, transfer, or hold value
- [ ] If "transfer", can select destination account
- [ ] Transfer moves the full account value to destination
- [ ] Spreadsheet shows $0 for years outside active range
- [ ] Transfer amount appears in destination account in the end year

**Examples:**
- Salary: ends age 65, behavior = zero (retirement)
- House: ends 2040, behavior = transfer to "Cash" (sell house for $1.2M)
- Superannuation: ends age 67, behavior = transfer to "Pension Fund" (preservation age reached)
- Business Income: starts 2027, no end (new venture)

---

### Epic 2: Spreadsheet View

#### US-2.1: View forecast as spreadsheet
**As a** user  
**I want to** see my forecast in a spreadsheet layout  
**So that** I can understand my financial trajectory year by year

**Acceptance Criteria:**
- [ ] Rows are accounts grouped by type (Income, Expenses, Assets, Liabilities)
- [ ] Columns are years
- [ ] Can scroll horizontally through years
- [ ] Account names column stays fixed during horizontal scroll
- [ ] Values formatted as currency (e.g., $120,000)

---

#### US-2.2: View calculated totals
**As a** user  
**I want to** see calculated totals for each year  
**So that** I can quickly assess my financial position

**Acceptance Criteria:**
- [ ] "Calculated" section shows: Total Income, Total Expenses, Tax, Net Worth
- [ ] Net Worth = Total Assets - Total Liabilities
- [ ] Totals update when accounts change
- [ ] Calculated rows visually distinct from account rows

---

#### US-2.3: Expand account to see assumptions
**As a** user  
**I want to** expand an account row to see its assumptions  
**So that** I can verify the calculations are correct

**Acceptance Criteria:**
- [ ] Click expand icon (▸) on account row
- [ ] Shows: growth profile, start/end years, end behavior
- [ ] Shows calculated breakdown: base value, growth applied, CPI adjustment
- [ ] Can collapse back to single row

---

#### US-2.4: See epoch transitions
**As a** user  
**I want to** see where forecast epochs begin and end  
**So that** I understand different life phases

**Acceptance Criteria:**
- [ ] Visual indicator (color band or divider) at epoch boundaries
- [ ] Epoch name displayed (e.g., "Retirement starts")
- [ ] Age displayed alongside year in column headers

---

#### US-2.5: View events summary
**As a** user  
**I want to** see a summary of one-time events  
**So that** I can quickly identify special occurrences

**Acceptance Criteria:**
- [ ] Events Summary section at bottom of spreadsheet
- [ ] Shows: event name, year, affected account, amount
- [ ] Event values merged into account rows (not separate rows)
- [ ] Clicking event scrolls to that year in spreadsheet

---

### Epic 3: Assumptions Configuration

#### US-3.1: Set CPI assumption
**As a** user  
**I want to** configure the CPI (inflation) rate  
**So that** my forecast reflects expected inflation

**Acceptance Criteria:**
- [ ] Can set base CPI rate (e.g., 3%)
- [ ] CPI applies to accounts with CPI-linked growth profiles
- [ ] Changing CPI recalculates affected accounts

---

#### US-3.2: Set investment growth assumption
**As a** user  
**I want to** configure expected investment returns  
**So that** my assets grow realistically

**Acceptance Criteria:**
- [ ] Can set base investment growth rate
- [ ] Applies to asset accounts using this assumption
- [ ] Separate from CPI (different rate)

---

#### US-3.3: Create assumption profile with overrides
**As a** user  
**I want to** override assumptions for specific year ranges  
**So that** I can model varying conditions over time

**Acceptance Criteria:**
- [ ] Can add year range overrides (e.g., "2025-2030: 3.5%")
- [ ] Can specify single years (e.g., "2031: 5%")
- [ ] Overrides take precedence over base value
- [ ] Support formula types: fixed, CPI + x%, +/- per year
- [ ] Profile editor shows full timeline of rates

**Example:**
```
CPI Profile:
  Base: 3%
  2025-2030: 3.5%
  2031: 5%
  2032: 4.5%
  2033+: reverts to 3%
```

---

### Epic 4: Events

#### US-4.1: Add a one-time event
**As a** user  
**I want to** add a one-time financial event  
**So that** I can model non-recurring items like inheritances or large purchases

**Acceptance Criteria:**
- [ ] Can specify year
- [ ] Can specify type (income, expense, asset change, liability change)
- [ ] Can specify amount
- [ ] Can specify description
- [ ] Can specify affected account
- [ ] Event appears in Events Summary section
- [ ] Event value merged into affected account's row for that year

---

#### US-4.2: Edit an event
**As a** user  
**I want to** edit an existing event  
**So that** I can update plans as they change

**Acceptance Criteria:**
- [ ] Can change year, amount, description, affected account
- [ ] Changes immediately reflected in forecast

---

#### US-4.3: Delete an event
**As a** user  
**I want to** remove an event  
**So that** I can clean up events that won't happen

**Acceptance Criteria:**
- [ ] Event removed from Events Summary
- [ ] Forecast recalculates without event

---

### Epic 5: Forecast Configuration

#### US-5.1: Set forecast period
**As a** user  
**I want to** define the forecast start and end  
**So that** I see the relevant time period

**Acceptance Criteria:**
- [ ] Can set start year (defaults to current year)
- [ ] Can set end year or end age (e.g., age 99)
- [ ] Spreadsheet shows all years in range

---

#### US-5.2: Configure a person
**As a** user  
**I want to** enter my basic details  
**So that** age-based calculations are correct

**Acceptance Criteria:**
- [ ] Can enter birth year
- [ ] Age displayed in spreadsheet column headers
- [ ] Can enter planned retirement year (for epoch transitions)

---

#### US-5.3: Configure epochs
**As a** user  
**I want to** define life phases  
**So that** I can organize my forecast into meaningful periods

**Acceptance Criteria:**
- [ ] Can create/edit/delete epochs
- [ ] Can set epoch start condition (age or year)
- [ ] Can set epoch end condition (age, year, or "next epoch starts")
- [ ] Epochs displayed as visual bands in spreadsheet

**Default epochs for Phase 1:**
1. Accumulation: now → retirement
2. Retirement: retirement → age 99

---

### Epic 6: Charts

#### US-6.1: View net worth chart
**As a** user  
**I want to** see a chart of my net worth over time  
**So that** I can visualize my financial trajectory

**Acceptance Criteria:**
- [ ] Line chart showing net worth by year
- [ ] X-axis: years (with age)
- [ ] Y-axis: dollar amount
- [ ] Epoch transitions marked on chart
- [ ] Hover shows exact values

---

#### US-6.2: View income vs expenses chart
**As a** user  
**I want to** see income compared to expenses  
**So that** I can identify surplus or deficit years

**Acceptance Criteria:**
- [ ] Bar or area chart
- [ ] Income and expenses as separate series
- [ ] Gap between them visible (surplus/deficit)
- [ ] Years where expenses > income highlighted

---

### Epic 7: Tax Calculation (Basic)

#### US-7.1: Calculate personal income tax
**As a** user  
**I want to** see estimated income tax for each year  
**So that** I understand my after-tax position

**Acceptance Criteria:**
- [ ] Tax calculated using Australian marginal rates
- [ ] Tax rates hardcoded for Phase 1 (configurable later)
- [ ] Tax amount shown in Calculated section
- [ ] Net income (after tax) derivable from totals

**Australian 2024-25 tax brackets (hardcoded):**
| Income | Rate |
|--------|------|
| $0 - $18,200 | 0% |
| $18,201 - $45,000 | 19% |
| $45,001 - $120,000 | 32.5% |
| $120,001 - $190,000 | 37% |
| $190,001+ | 45% |

---

### Epic 8: Data Persistence

#### US-8.1: Auto-save data
**As a** user  
**I want to** have my data automatically saved  
**So that** I don't lose my work

**Acceptance Criteria:**
- [ ] All changes saved to IndexedDB automatically
- [ ] No explicit "Save" button needed
- [ ] Data survives page refresh
- [ ] Data survives browser restart

---

#### US-8.2: Start fresh
**As a** user  
**I want to** be able to reset all data  
**So that** I can start over if needed

**Acceptance Criteria:**
- [ ] "Reset All Data" option in settings
- [ ] Confirmation dialog with warning
- [ ] Clears all accounts, events, assumptions
- [ ] Returns to initial state

---

## Phase 2: Multi-Period & Scenarios (Future)

### US-P2.1: Create a scenario
**As a** user  
**I want to** create named scenarios  
**So that** I can compare different assumptions

---

### US-P2.2: Compare scenarios
**As a** user  
**I want to** view scenarios side by side  
**So that** I can see how different assumptions affect outcomes

---

### US-P2.3: Model superannuation
**As a** user  
**I want to** add a super account with special rules  
**So that** I can model contributions and preservation

---

## Phase 3: Multi-Person (Future)

### US-P3.1: Add a second person
**As a** user  
**I want to** add my partner's details  
**So that** we can forecast as a household

---

### US-P3.2: View combined position
**As a** user  
**I want to** see individual and combined views  
**So that** I understand both perspectives

---

## Phase 4+: AI Chat (Future)

### US-P4.1: Ask questions in natural language
**As a** user  
**I want to** ask the AI about my forecast  
**So that** I can get insights without manual analysis

**Example prompts:**
- "What if I retire 2 years earlier?"
- "When do I run out of money in the worst case?"
- "Create a scenario where the market drops 20% in 2030"

---

## Story Map Summary

```
                    Phase 1 (MVP)              Phase 2        Phase 3      Phase 4+
                    ─────────────              ───────        ───────      ────────
Accounts            US-1.1 to 1.4              
Spreadsheet         US-2.1 to 2.5              
Assumptions         US-3.1 to 3.3              
Events              US-4.1 to 4.3              
Forecast Config     US-5.1 to 5.3              
Charts              US-6.1, 6.2                
Tax                 US-7.1 (basic)             Super rules    
Persistence         US-8.1, 8.2                Sync           
Scenarios                                      US-P2.1-2.2    
Multi-Person                                                  US-P3.1-3.2  
AI Chat                                                                    US-P4.1
```
