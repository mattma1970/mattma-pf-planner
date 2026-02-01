# Capital Loss Carry-Forward Implementation

**Status:** Planned  
**Last Updated:** 2026-02-01

---

## Overview

Implement capital loss carry-forward tracking to accurately model Australian CGT rules where unused capital losses offset future capital gains.

---

## Australian Tax Rules

- Capital losses offset capital gains in the same year first
- Unused losses carry forward indefinitely (no time limit)
- Losses are applied in order they were made (oldest first)
- Losses are applied BEFORE the 50% CGT discount
- Capital losses cannot offset other income (salary, dividends, etc.)
- NOT implementing collectable-specific rules (out of scope)

---

## Implementation Plan

### 1. Add Per-Person Off-Balance-Sheet Account

Similar to super contribution caps tracking, add a capital loss carry-forward balance per person.

**Schema changes (`src/schemas/forecast.ts`):**
- Add `capitalLossCarryForward` to off-balance-sheet types
- Track per person (personId)
- Store balance at end of each year

### 2. Modify CGT Calculation in Forecast Engine

**In `src/engine/forecast.ts`:**

When processing a CGT event (asset sale):

```
1. Calculate raw gain/loss = sale proceeds - cost base
2. If LOSS:
   - Add loss amount to carry-forward balance
   - No CGT payable
3. If GAIN:
   - Reduce gain by carried-forward losses (oldest first)
   - Update carry-forward balance (reduce by amount used)
   - Apply 50% CGT discount to remaining gain (if held 12+ months)
   - Add discounted gain to assessable income
```

### 3. Update Tax Calculation

**In `src/engine/tax.ts`:**

Modify `calculateCapitalGain` function to:
- Accept current carry-forward balance as input
- Return updated balance after applying losses
- Return the gain amount to add to assessable income (after discount)

### 4. Display in Spreadsheet

**In `src/components/spreadsheet/SpreadsheetView.tsx`:**

Add capital loss carry-forward balance to the off-balance-sheet section, alongside super contribution caps.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/schemas/forecast.ts` | Add capital loss off-balance-sheet type |
| `src/engine/forecast.ts` | Modify CGT calculation, add carry-forward state |
| `src/engine/tax.ts` | Update `calculateCapitalGain` to support loss offset |
| `src/components/spreadsheet/SpreadsheetView.tsx` | Display capital loss balance |

---

## Test Cases

### Case 1: Loss Recorded
```
Year 1: Sell asset for $50,000 loss
Result: Capital loss balance = $50,000, no CGT payable
```

### Case 2: Gain Offset by Prior Loss
```
Year 1: Capital loss balance = $50,000
Year 2: Sell asset for $80,000 gain (held 2 years)
Result:
  - Offset $50,000 loss → remaining gain = $30,000
  - Apply 50% discount → assessable gain = $15,000
  - Capital loss balance = $0
```

### Case 3: Partial Loss Usage
```
Year 1: Capital loss balance = $100,000
Year 2: Sell asset for $40,000 gain (held 2 years)
Result:
  - Offset $40,000 loss → remaining gain = $0
  - No CGT payable
  - Capital loss balance = $60,000 (carried forward)
```

### Case 4: Short-Term Gain (No Discount)
```
Year 1: Capital loss balance = $20,000
Year 2: Sell asset for $50,000 gain (held 6 months)
Result:
  - Offset $20,000 loss → remaining gain = $30,000
  - No 50% discount (held < 12 months)
  - Assessable gain = $30,000
  - Capital loss balance = $0
```

---

## Related User Stories

- **US-10.1 to US-10.3:** CGT on asset sales
- **US-14.0:** Capital Loss Carry-Forward (this feature)

---

## Out of Scope

- Collectable-specific loss rules (losses on collectables can only offset collectable gains)
- Capital loss transfers between spouses
- Foreign capital gains/losses
