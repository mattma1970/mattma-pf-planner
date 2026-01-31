# Handover: Auto-Create Employer SG Accounts

**Date:** 2026-02-01  
**Thread:** T-019c1612-aa1d-77ee-a10d-ab727f06b632  
**Status:** In Progress

---

## Summary

Implementing automatic employer Super Guarantee (SG) contribution accounts when salary/wages income accounts are created.

## What's Been Completed

### 1. Derived Income Account Infrastructure (✅ Done)

Schema changes in `src/schemas/account.ts`:
- Added `IncomeSubTypeSchema` with options: `salary`, `business`, `investment`, `other`
- Added `IncomeAsSuperContributionConfigSchema` for routing derived income to super
- Extended `AccountSchema` with:
  - `incomeSubType` - classifies income type
  - `basedOnAccountId` + `basedOnPercentage` - for derived income calculations
  - `superContributionConfig` - routes to super as contributions

### 2. Forecast Engine (✅ Done)

Updates in `src/engine/forecast.ts`:
- Derived income accounts calculate value as % of reference income account
- Super contribution config routes income directly to super with proper cap tracking
- Uses `yearStartPriorInflows` snapshot to avoid order-of-processing issues
- Contributions flow through existing super contribution logic (caps, 15% tax, Div 293)

### 3. UI for Manual Creation (✅ Done)

Updates in `src/components/configuration/AccountForm.tsx`:
- "Income Type" dropdown for income accounts
- "Derived Income" section with:
  - Source account selection
  - Percentage input (defaults to 11.5%)
  - "Route as super contribution" checkbox
  - Target super account selection
  - Contribution source selection

### 4. Global SG Rate Setting (✅ Done)

Added to `src/schemas/settings.ts` in `SuperSettingsSchema`:
```typescript
employerSgRate: z.number().default(0.115),
autoCreateEmployerSg: z.boolean().default(true),
```

### 5. Tests (✅ Done)

Added tests in `src/engine/forecast.test.ts`:
- `calculates employer SG as percentage of salary and flows to super account`
- `derived income follows the source income growth`

### 6. Documentation (✅ Done)

- HelpModal updated with derived income explanation and FAQ
- USER_STORIES.md updated with US-12.0

---

## What Needs To Be Done

### 1. Auto-Create Employer SG Account on Salary Creation

**File:** `src/actions/accounts.ts`

When `createAccount()` is called with a salary income account:
1. Check if `autoCreateEmployerSg` is enabled in settings
2. Check if `incomeSubType === 'salary'`
3. If yes, auto-create a companion "Employer SG" income account:
   ```typescript
   {
     name: `${salaryAccount.name} - Employer SG`,
     type: 'income',
     incomeSubType: 'other',
     initialValue: 0,
     growthProfile: { type: 'fixed', rate: 0 },
     basedOnAccountId: salaryAccount.id,
     basedOnPercentage: settings.super.employerSgRate, // 0.115
     owner: salaryAccount.owner,
     superContributionConfig: /* see logic below */
   }
   ```

### 2. Super Account Selection Logic

When creating the SG account, determine `superContributionConfig`:

```typescript
// Find super accounts for this owner
const ownerSuperAccounts = accounts.filter(a => 
  a.type === 'asset' && 
  a.assetSubType === 'superannuation' && 
  a.owner === salaryAccount.owner
);

if (ownerSuperAccounts.length === 1) {
  // Auto-select the only super account
  superContributionConfig = {
    targetSuperAccountId: ownerSuperAccounts[0].id,
    contributionType: 'concessional',
    source: 'employerSG',
    reducesAssessableIncome: false,
  };
} else {
  // 0 or 2+ super accounts - leave unconfigured, show warning
  superContributionConfig = undefined;
  // Need to track this for warning display
}
```

### 3. Warning System for Incomplete SG Accounts

Need to implement warnings for SG accounts without configured super target:
- Add validation in `src/engine/forecast.ts` to generate warnings
- Display warnings in the UI (similar to existing `ForecastWarning`)

Suggested warning structure:
```typescript
{
  type: 'incompleteEmployerSg',
  severity: 'warning',
  message: 'Employer SG account needs configuration',
  details: 'Select a target super account for: [account name]',
  accountId: sgAccount.id,
}
```

### 4. Settings UI for SG Rate

Add to the Settings modal (`src/App.tsx` settings section):
- Input for "Employer SG Rate (%)" - default 11.5
- Checkbox for "Auto-create employer SG for salary income"

### 5. Handle Account Deletion

When deleting a salary account, consider:
- Also delete the linked SG account (or warn about it)
- Add `linkedSgAccountId` field to salary accounts to track the relationship

### 6. Handle Account Updates

When updating a salary account:
- If owner changes, update the SG account owner too
- If salary account is deleted, handle the orphaned SG account

---

## Files to Modify

1. `src/actions/accounts.ts` - Auto-create SG account logic
2. `src/schemas/account.ts` - Consider adding `linkedSgAccountId` field
3. `src/engine/forecast.ts` - Add warnings for incomplete SG config
4. `src/App.tsx` - Add SG rate settings UI
5. `src/components/configuration/AccountForm.tsx` - Show warning for incomplete SG

---

## Test Cases to Add

1. Auto-creates SG account when salary income created (with 1 super account)
2. Creates SG account without super config when 0 super accounts exist
3. Creates SG account without super config when 2+ super accounts exist
4. SG account follows salary owner changes
5. Deleting salary account handles linked SG account

---

## Current Task Status

Task ID: 100 - "Auto-create employer SG account for salary income"
Status: in_progress

---

## How to Continue

1. Read this handover document
2. Start with `src/actions/accounts.ts` - modify `createAccount()` function
3. Add the super account selection logic
4. Add warning generation for incomplete SG accounts
5. Update Settings UI for SG rate configuration
6. Run tests: `npm test`
7. Build: `npm run build`
