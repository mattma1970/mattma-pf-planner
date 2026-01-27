# User Stories

**Version:** 0.2 (Draft)  
**Last Updated:** 2026-01-27

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

### Epic 9: Tax Funding

#### US-9.1: Set default tax funding account
**As a** user  
**I want to** specify which account pays my tax  
**So that** tax actually reduces my available funds

**Acceptance Criteria:**
- [ ] Can select a default tax funding account per person
- [ ] Tax amount is deducted from this account each year
- [ ] If account balance goes negative, show warning
- [ ] Tax payment appears as outflow in the funding account

---

#### US-9.2: Verify tax reduces account balance
**As a** user  
**I want to** see that calculated tax is actually paid  
**So that** my net worth reflects real after-tax position

**Acceptance Criteria:**
- [ ] Tax shown in Calculated section matches deduction from funding account
- [ ] Net worth calculation accounts for tax paid
- [ ] Funding account balance is reduced by tax amount

**Test Case:**
```
Given: Salary $100,000, Cash account $50,000, tax funding = Cash
When: Year 1 tax calculated as $22,000
Then: Cash account balance reduced by $22,000
And: Net worth reflects the tax payment
```

---

## Phase 2: Multi-Period & Scenarios (Future)

### Epic 10: Capital Gains Tax

#### US-10.1: Trigger CGT on asset sale
**As a** user  
**I want to** pay capital gains tax when I sell an asset  
**So that** my forecast reflects the true sale proceeds

**Acceptance Criteria:**
- [ ] Can set account end behavior to "sell"
- [ ] CGT calculated as: (sale price - cost base)
- [ ] CGT amount added to assessable income
- [ ] Tax on CGT paid from tax funding account

**Test Case:**
```
Given: Shares account with cost base $50,000
And: Current value $100,000, end year 2030, behavior = sell
When: Shares sold in 2030
Then: Capital gain = $100,000 - $50,000 = $50,000
And: $50,000 added to assessable income for 2030
```

---

#### US-10.2: Apply 50% CGT discount for long-term holdings
**As a** user  
**I want to** receive the CGT discount for assets held over 12 months  
**So that** my tax is calculated correctly

**Acceptance Criteria:**
- [ ] Discount applies if (sale year - acquisition year) >= 1
- [ ] Only 50% of capital gain is assessable
- [ ] UI shows both gross gain and discounted gain

**Test Case:**
```
Given: Shares bought in 2025, cost base $50,000
And: Sold in 2030 for $100,000
When: Holding period = 5 years (>12 months)
Then: Gross capital gain = $50,000
And: Discounted gain = $25,000 (50%)
And: $25,000 added to assessable income
```

---

#### US-10.3: No CGT discount for short-term holdings
**As a** user  
**I want to** pay full CGT on assets held less than 12 months  
**So that** short-term gains are taxed correctly

**Test Case:**
```
Given: Shares bought in 2029, cost base $50,000
And: Sold in 2029 for $100,000
When: Holding period < 12 months
Then: No discount applied
And: Full $50,000 added to assessable income
```

---

### Epic 11: Tax-Free Income

#### US-11.1: Pension income not taxed
**As a** user  
**I want to** receive pension phase super income tax-free  
**So that** my retirement income is not reduced by tax

**Acceptance Criteria:**
- [ ] Can mark account as "tax-free (pension)"
- [ ] Income from this account excluded from assessable income
- [ ] Tax calculation ignores pension income
- [ ] Pension income still appears in Total Income

**Test Case:**
```
Given: Salary $50,000 (taxable), Pension income $40,000 (tax-free)
When: Tax calculated for the year
Then: Tax based only on $50,000 salary
And: Total income shows $90,000
And: Tax calculated on $50,000 (not $90,000)
```

---

### Epic 12: Superannuation Contributions

#### US-12.1: Employer super contributions count toward cap
**As a** user  
**I want to** track employer super contributions against my cap  
**So that** I know how much personal contribution room I have

**Acceptance Criteria:**
- [ ] Employer contributions counted toward concessional cap
- [ ] Current cap shown (e.g., $30,000)
- [ ] Remaining cap = $30,000 - employer contributions
- [ ] Contribution tracking visible in Tax detail panel

**Test Case:**
```
Given: Concessional cap = $30,000
And: Employer contributes $12,000 (11.5% of $104,000 salary)
When: Year ends
Then: Used cap = $12,000
And: Available cap = $18,000
```

---

#### US-12.2: Personal deductible contributions reduce taxable income
**As a** user  
**I want to** claim a tax deduction for personal super contributions  
**So that** I reduce my tax bill

**Acceptance Criteria:**
- [ ] Personal contributions (up to cap) deductible
- [ ] Deduction reduces assessable income
- [ ] Tax saving = contribution × marginal rate
- [ ] Contribution must be within cap to be deductible

**Test Case:**
```
Given: Salary $120,000, marginal rate 32.5%
And: Personal super contribution $10,000 (within cap)
When: Tax calculated
Then: Taxable income = $120,000 - $10,000 = $110,000
And: Tax saving = $10,000 × 32.5% = $3,250
```

---

#### US-12.3: Carry forward unused concessional cap
**As a** user  
**I want to** use unused cap from previous years  
**So that** I can make larger contributions in high-income years

**Acceptance Criteria:**
- [ ] Track unused cap for up to 5 years
- [ ] Carry-forward available if super balance < $500,000 (simplified: always available for MVP)
- [ ] Available cap = current year cap + sum of unused caps from prior 5 years
- [ ] Oldest unused cap expires after 5 years

**Test Case:**
```
Given: Yearly cap = $30,000
And: Year 1: contributed $20,000 (unused $10,000)
And: Year 2: contributed $25,000 (unused $5,000)
And: Year 3: want to contribute $50,000
When: Calculating available cap for Year 3
Then: Available = $30,000 + $10,000 + $5,000 = $45,000
And: Can contribute $45,000 (within carry-forward)
And: Remaining $5,000 would be excess
```

---

#### US-12.4: Excess contributions taxed at 15%
**As a** user  
**I want to** see tax on excess contributions  
**So that** I understand the cost of over-contributing

**Acceptance Criteria:**
- [ ] Excess = contributions - available cap (including carry-forward)
- [ ] Excess taxed at 15% within the super fund
- [ ] Tax deducted from super account balance (not external account)
- [ ] Warning shown when contribution exceeds cap

**Test Case:**
```
Given: Available cap = $30,000 (no carry-forward)
And: Total contributions = $40,000
When: Year ends
Then: Excess = $10,000
And: Excess tax = $10,000 × 15% = $1,500
And: Super account reduced by $1,500
And: Warning displayed: "Excess concessional contribution"
```

---

### Epic 13: Scenarios

Scenarios enable users to model alternative futures by overriding assumptions, modifying accounts, or changing events. This is a core feature for answering "what if" questions about retirement planning.

**Common Scenario Examples:**
- Market downturn: Super returns -1% for 3 years starting 2027
- Investment property purchase: Buy $1M property in 2027 with rental income
- Renovation: Increase rent on existing property after 2030 renovation
- Early retirement: Stop working in 2027 instead of 2030
- Skip contribution: Keep downsizer amount in bank instead of super
- Spending change: Increase retirement spending to $130k/year indexed
- Capital loss: Sell investment property at $100k loss

---

#### US-13.1: Create a scenario
**As a** user  
**I want to** create a new scenario from my current financial state  
**So that** I can explore alternative assumptions without affecting my base case

**Acceptance Criteria:**
- [ ] Can create a new scenario (starts as clone of current state)
- [ ] Can create a blank scenario (no overrides)
- [ ] Must provide a name (required)
- [ ] Can optionally provide a description
- [ ] New scenario appears in scenario list
- [ ] Scenario is persisted

---

#### US-13.2: Edit scenario metadata
**As a** user  
**I want to** edit a scenario's name and description  
**So that** I can keep my scenarios organized and documented

**Acceptance Criteria:**
- [ ] Can change scenario name
- [ ] Can change scenario description
- [ ] Changes are persisted
- [ ] Scenario list reflects updated name

---

#### US-13.3: Override assumptions in a scenario
**As a** user  
**I want to** override growth rates, CPI, or other assumptions for specific time periods  
**So that** I can model different market conditions

**Acceptance Criteria:**
- [ ] Can override any global assumption (CPI, default growth, etc.)
- [ ] Can specify year range for override (e.g., 2027-2030)
- [ ] Can specify single year override
- [ ] Override shows visually different from base values
- [ ] Can clear an override to revert to base
- [ ] Multiple overrides can be combined

**Test Case:**
```
Given: Base case has super growth at 7%
When: I create scenario "Market Downturn"
And: Override super growth to -1% for 2027-2029
Then: Forecast shows -1% growth for those years
And: 2030+ reverts to 7%
```

---

#### US-13.4: Add or modify accounts in a scenario
**As a** user  
**I want to** add new accounts or modify existing accounts within a scenario  
**So that** I can model acquiring new assets or changing existing ones

**Acceptance Criteria:**
- [ ] Can add a new account that only exists in this scenario
- [ ] Can modify an existing account's properties (growth, value, dates)
- [ ] Can "remove" an account from the scenario (exclude from forecast)
- [ ] Modifications don't affect the base case
- [ ] Added/modified accounts visually indicated as scenario-specific

**Test Case:**
```
Given: Base case has no investment property
When: I create scenario "Buy Investment Property"
And: Add asset "Investment Property" value $1,000,000 in 2027
And: Add income "Rental Income" $52,000/year starting 2027
And: Add expense "Property Costs" 0.5% of property value
Then: Forecast shows property, rental income, and costs from 2027
And: Base case remains unchanged
```

---

#### US-13.5: Add or modify events in a scenario
**As a** user  
**I want to** add one-time events or modify existing events within a scenario  
**So that** I can model specific financial occurrences

**Acceptance Criteria:**
- [ ] Can add a new event that only exists in this scenario
- [ ] Can modify an existing event's properties (year, amount, account)
- [ ] Can remove an event from the scenario
- [ ] Event modifications don't affect the base case

**Test Case:**
```
Given: Base case has downsizer contribution of $300k in 2030
When: I create scenario "No Downsizer"
And: Remove the downsizer contribution event
And: Add event "Keep in Bank" +$300k to Cash in 2030
Then: Scenario shows $300k going to cash, not super
And: Base case still has downsizer contribution
```

---

#### US-13.6: View a scenario's forecast
**As a** user  
**I want to** view the forecast for any saved scenario  
**So that** I can see the projected outcomes of that scenario

**Acceptance Criteria:**
- [ ] Can switch active scenario from dropdown/selector
- [ ] Spreadsheet view updates to show scenario's forecast
- [ ] Charts update to show scenario's projections
- [ ] Current scenario name displayed prominently
- [ ] Can switch back to "Base Case" at any time
- [ ] Overridden values highlighted in spreadsheet

---

#### US-13.7: Compare scenarios on Net Worth chart
**As a** user  
**I want to** see multiple scenarios overlaid on a Net Worth chart  
**So that** I can visually compare different financial trajectories

**Acceptance Criteria:**
- [ ] Dedicated "Compare Scenarios" page/view
- [ ] Net Worth over Time chart shows multiple scenario lines
- [ ] Can select up to 5 scenarios for comparison
- [ ] Each scenario has distinct color
- [ ] Legend shows scenario name and description
- [ ] Base case shown as solid line, alternatives as dashed
- [ ] Can toggle individual scenarios on/off
- [ ] Hover shows values for all visible scenarios at that year

**Test Case:**
```
Given: I have 3 scenarios: Base, Early Retirement, Market Downturn
When: I open Compare Scenarios view
And: Select all 3 scenarios
Then: Chart shows 3 lines with different colors
And: Legend identifies each scenario
And: I can see where trajectories diverge
```

---

#### US-13.8: Compare scenarios in summary table
**As a** user  
**I want to** see key metrics for multiple scenarios in a table  
**So that** I can quickly compare outcomes numerically

**Acceptance Criteria:**
- [ ] Summary table shows one column per selected scenario
- [ ] Rows include key metrics:
  - Final net worth (at forecast end)
  - Year assets depleted (if applicable, else "N/A")
  - Total retirement income (sum of post-retirement income)
  - Peak net worth and year achieved
  - Minimum net worth and year (excluding start)
- [ ] Delta column shows difference from base case
- [ ] Positive deltas shown in green, negative in red
- [ ] Can sort by any metric

---

#### US-13.9: Delete a scenario
**As a** user  
**I want to** delete a scenario I no longer need  
**So that** my scenario list stays manageable

**Acceptance Criteria:**
- [ ] Can delete any scenario except "Base Case"
- [ ] Confirmation prompt before deletion
- [ ] Scenario removed from list and comparisons
- [ ] If currently viewing deleted scenario, switch to Base Case

---

#### US-13.10: Set a scenario as base case
**As a** user  
**I want to** promote a scenario to become my new base case  
**So that** I can adopt a planned change as my primary forecast

**Acceptance Criteria:**
- [ ] Can promote any scenario to base case
- [ ] Confirmation prompt explaining the action
- [ ] Scenario overrides become the new default values
- [ ] Original base case can optionally be saved as a scenario
- [ ] All other scenarios now compare against new base

---

#### US-13.11: Monte Carlo simulation bands (Future)
**As a** user  
**I want to** see probability bands on my forecast  
**So that** I understand the range of possible outcomes, not just a single projection

**Acceptance Criteria:**
- [ ] Can enable Monte Carlo mode for any scenario
- [ ] Runs N simulations (configurable, default 1000)
- [ ] Randomizes key assumptions within defined ranges
- [ ] Chart shows percentile bands (e.g., 10th, 25th, 50th, 75th, 90th)
- [ ] Can configure which assumptions to randomize
- [ ] Can set standard deviation/range for each assumption
- [ ] Summary shows probability of success (e.g., "85% chance of not running out")

**Test Case:**
```
Given: Base case with 7% super growth
When: I enable Monte Carlo with growth varying ±3%
And: Run 1000 simulations
Then: Chart shows shaded bands for percentiles
And: Summary shows "78% chance of maintaining positive net worth to age 99"
```

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
                    Phase 1 (MVP)              Phase 2              Phase 3        Phase 4+
                    ─────────────              ───────              ───────        ────────
Accounts            US-1.1 to 1.4              
Spreadsheet         US-2.1 to 2.5              
Assumptions         US-3.1 to 3.3              
Events              US-4.1 to 4.3              
Forecast Config     US-5.1 to 5.3              
Charts              US-6.1, 6.2                
Tax (Income)        US-7.1 (basic)             
Tax Funding         US-9.1, 9.2                
CGT                                            US-10.1 to 10.3
Tax-Free Income                                US-11.1
Super Contributions                            US-12.1 to 12.4
Persistence         US-8.1, 8.2                                                   Cloud Sync
Scenarios                                      US-13.1 to 13.10   US-13.11 (Monte Carlo)
Multi-Person                                                       US-P3.1-3.2  
AI Chat                                                                           US-P4.1
```

### Scenario Stories Breakdown

| Story | Title | Priority |
|-------|-------|----------|
| US-13.1 | Create a scenario | Must Have |
| US-13.2 | Edit scenario metadata | Must Have |
| US-13.3 | Override assumptions in scenario | Must Have |
| US-13.4 | Add/modify accounts in scenario | Must Have |
| US-13.5 | Add/modify events in scenario | Must Have |
| US-13.6 | View scenario forecast | Must Have |
| US-13.7 | Compare scenarios on chart | Must Have |
| US-13.8 | Compare scenarios in table | Should Have |
| US-13.9 | Delete a scenario | Must Have |
| US-13.10 | Set scenario as base case | Should Have |
| US-13.11 | Monte Carlo simulation | Future |
