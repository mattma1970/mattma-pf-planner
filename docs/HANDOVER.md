# Handover Documentation - Superannuation Contribution Caps

## Summary

This document provides context for continuing work on Task #66: Refactor contribution caps as off-balance sheet accounts.

## What Was Completed in This Thread

### 1. Super Contribution Event Processing (Task #64, #65)
- Added `superContribution` event type with full UI in EventForm
- Super contributions now flow money to super accounts
- 15% contributions tax is deducted from super account (for concessional)
- Division 293 tax calculated for high-income earners (income + concessional > $250k)
- Excess concessional contributions added to assessable income

### 2. Settings Migration Fix
- Fixed `getSettings()` in `src/data/repository.ts` to merge stored settings with defaults
- Ensures `settings.super` is always defined even for older saved data

### 3. UI Simplification
- Removed unused `capitalGain` tax treatment from events
- Tax treatment section hidden for super contribution events (tax is automatic)
- Super contribution UI shows contribution type, source, target account, and source account

## Current State

### Working Features
- Super contribution events create contributions to super accounts
- 15% contributions tax deducted from super for concessional contributions
- Division 293 tax applied for high earners
- Carry-forward of unused concessional cap tracked in off-balance sheet
- All 112 tests passing

### Key Files
- `src/engine/forecast.ts` - Main forecast engine with super contribution processing (lines 245-277, 705-810)
- `src/engine/superContributions.ts` - Contribution processing logic
- `src/engine/taxRules.ts` - Division 293 calculation
- `src/schemas/settings.ts` - Super settings (caps, rates, thresholds)
- `src/schemas/event.ts` - SuperContributionConfig schema
- `src/components/configuration/EventForm.tsx` - Super contribution UI

## Next Task: #66 - Contribution Caps as Off-Balance Sheet Accounts

### Goal
Model concessional and non-concessional contribution caps as account-like structures displayed in the spreadsheet with opening/movements/closing columns.

### Non-Concessional Cap Account Logic

```
Opening balance calculation:
  - If prior year closing >= 0 → Reset to $120k (annual cap from settings)
  - If prior year closing < 0 → Prior closing + $120k (recovering from bring-forward)

Movement: −contributions (non-concessional only, excluding cap-exempt)

Closing: Opening − Contributions

Rules:
  - Can go negative (bring-forward rule)
  - If opening ≤ 0, non-concessional contributions are BLOCKED (flagged as excess)
  - Excess if closing < −$240k (exceeded 3-year bring-forward limit)
```

**Example - $360k bring-forward:**
| Year | Opening | Contribution | Closing |
|------|---------|--------------|---------|
| 1 | $120k | −$360k | −$240k |
| 2 | −$120k | $0 | −$120k |
| 3 | $0 | $0 | $0 |
| 4 | $120k (reset) | $0 | $120k |

### Concessional Cap Account Logic

```
Opening: Available carry-forward from prior 5 years + $30k annual cap

Movement: −contributions (concessional only, excluding cap-exempt)

Closing: Opening − Contributions
  - If > 0: Unused amount carries forward (up to 5 years)
  - If < 0: Excess added to assessable income
```

### Cap-Exempt Contributions

Some contributions bypass cap calculations entirely:
- Downsizer contribution ($300k from house sale proceeds)
- Government co-contribution
- Others as needed

**Schema change required:**
```typescript
// In src/schemas/event.ts
export const SuperContributionConfigSchema = z.object({
  contributionType: SuperContributionTypeSchema,
  source: SuperContributionSourceSchema,
  memberPersonId: z.string(),
  reducesAssessableIncome: z.boolean().default(false),
  exemptFromCap: z.boolean().default(false), // NEW
});
```

### Implementation Steps

1. **Schema Changes**
   - Add `exemptFromCap` to `SuperContributionConfigSchema`
   - Add new off-balance sheet item types for cap accounts

2. **Engine Changes**
   - Create `NonConcessionalCapState` interface (like `CarryForwardState`)
   - Track non-concessional cap state across years
   - Modify contribution processing to check cap availability
   - Flag excess contributions when caps are exceeded
   - Filter out `exemptFromCap` contributions from cap calculations

3. **Refactor Concessional Carry-Forward**
   - Current implementation uses `unusedCaps: { year, amount }[]`
   - Convert to account-style presentation with opening/closing
   - Keep 5-year expiry logic

4. **Spreadsheet Display**
   - Add cap accounts to off-balance sheet section
   - Show: Account name, Opening, Movements, Closing per year
   - Visual indicators for blocked/excess contributions

5. **UI Updates**
   - Add `exemptFromCap` checkbox to EventForm super contribution section
   - Update source dropdown to include "Downsizer" option

### Test Scenarios to Add

```typescript
// Non-concessional bring-forward
it('tracks non-concessional cap with bring-forward', () => {
  // Year 1: Contribute $360k, closing = -$240k
  // Year 2: Opening = -$120k, no contributions allowed
  // Year 3: Opening = $0, no contributions allowed
  // Year 4: Opening = $120k (reset), contributions allowed
});

// Non-concessional blocking
it('blocks non-concessional when opening <= 0', () => {
  // Contribution should be flagged as excess
});

// Cap-exempt contributions
it('exempt contributions bypass cap calculations', () => {
  // Downsizer contribution doesn't affect non-concessional cap
});
```

### Key Design Decisions

1. **Single member support only** - `memberPersonId` uses first person from persons array
2. **Cap accounts are per-person** - Track by personId
3. **Settings-driven caps** - Use `settings.super.concessionalCap` and `settings.super.nonConcessionalCap`
4. **Total super balance check NOT implemented** - The $1.9M TSB limit that blocks non-concessional is not currently tracked

## Commands

```bash
npm run dev        # Start dev server
npm run build      # TypeScript check + build
npm test           # Run all tests
npm run test:watch # Watch mode
```

## Related Threads

- Previous thread: T-019bf82c-9e32-76df-9670-b3de396f0010 (super settings consolidation)
- Current thread: T-019bf87d-4665-710d-965d-8bceb93a6f9f (super contribution taxes)
