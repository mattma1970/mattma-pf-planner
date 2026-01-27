# Handover Documentation - Super Contribution Source Configuration

## Summary

This document provides context for continuing work on configuring super contribution source defaults in the Settings UI.

## What Was Completed in This Thread

### 1. Contribution Caps as Off-Balance Sheet Accounts (Task #66)
- Both concessional and non-concessional caps now display in spreadsheet with opening/movement/closing
- Non-concessional bring-forward rule: Opens at $120k if prior closing >= 0, else adds $120k to prior
- Blocking when opening <= 0, excess when closing < -$240k
- Excess concessional flows to non-concessional cap

### 2. Contribution Type Simplification
Changed from many contribution types to three:
- `concessional` - Pre-tax, 15% contributions tax, uses concessional cap
- `nonConcessional` - After-tax, no contributions tax, uses non-concessional cap
- `capExempt` - Not subject to any caps, no contributions tax

### 3. Tax Treatment Changes
- Deduction is now limited upfront to available concessional cap (not claimed then added back)
- `calculateEffectiveIncomeReduction()` function added to cap deductions
- Excess concessional contributions count towards non-concessional cap
- Full contribution amount always goes to super account regardless of cap allocation

### 4. Schema Changes Made
```typescript
// src/schemas/event.ts
export const SuperContributionTypeSchema = z.enum([
  'concessional',
  'nonConcessional', 
  'capExempt',
]);

export const SuperContributionSourceSchema = z.enum([
  'employerSG',
  'employerAdditional',
  'salarySacrifice',
  'personalDeductible',
  'personalAfterTax',
  'spouseContribution',
  'governmentCoContribution',
  'downsizer',
]);

export const SuperContributionConfigSchema = z.object({
  contributionType: SuperContributionTypeSchema,
  source: SuperContributionSourceSchema,
  memberPersonId: z.string(),
  reducesAssessableIncome: z.boolean().default(false),
  exemptFromCap: z.boolean().optional(), // Legacy - now derived from contributionType
});
```

## Next Task: Source Configuration in Settings UI

### Goal
Allow users to configure default behaviors for each super contribution source in the Settings/Defaults UI. When a user selects a source in the EventForm, it should auto-populate:
- Default contribution type (concessional/nonConcessional/capExempt)
- Default "reduces assessable income" checkbox state

### Proposed Schema for Source Configuration

Add to `src/schemas/settings.ts`:

```typescript
export const SuperContributionSourceConfigSchema = z.object({
  source: SuperContributionSourceSchema,
  label: z.string(), // Display name in dropdown
  defaultContributionType: SuperContributionTypeSchema,
  defaultReducesAssessableIncome: z.boolean(),
  // Future: could add validation rules, max amounts, etc.
});

export const SuperSettingsSchema = z.object({
  preservationAge: z.number().int().default(67),
  concessionalCap: z.number().default(30000),
  nonConcessionalCap: z.number().default(120000),
  carryForwardYears: z.number().int().default(5),
  contributionsTaxRate: z.number().default(0.15),
  div293Threshold: z.number().default(250000),
  div293Rate: z.number().default(0.15),
  // NEW: Source configurations
  sourceConfigs: z.array(SuperContributionSourceConfigSchema).optional(),
});
```

### Default Source Configurations

```typescript
export const defaultSourceConfigs: SuperContributionSourceConfig[] = [
  { source: 'employerSG', label: 'Employer SG (mandatory)', defaultContributionType: 'concessional', defaultReducesAssessableIncome: false },
  { source: 'employerAdditional', label: 'Employer Additional', defaultContributionType: 'concessional', defaultReducesAssessableIncome: false },
  { source: 'salarySacrifice', label: 'Salary Sacrifice', defaultContributionType: 'concessional', defaultReducesAssessableIncome: true },
  { source: 'personalDeductible', label: 'Personal (tax deductible)', defaultContributionType: 'concessional', defaultReducesAssessableIncome: true },
  { source: 'personalAfterTax', label: 'Personal (after-tax)', defaultContributionType: 'nonConcessional', defaultReducesAssessableIncome: false },
  { source: 'spouseContribution', label: 'Spouse Contribution', defaultContributionType: 'nonConcessional', defaultReducesAssessableIncome: false },
  { source: 'governmentCoContribution', label: 'Government Co-contribution', defaultContributionType: 'capExempt', defaultReducesAssessableIncome: false },
  { source: 'downsizer', label: 'Downsizer Contribution', defaultContributionType: 'capExempt', defaultReducesAssessableIncome: false },
];
```

### Implementation Steps

1. **Schema Changes** (`src/schemas/settings.ts`)
   - Add `SuperContributionSourceConfigSchema`
   - Add `sourceConfigs` to `SuperSettingsSchema`
   - Create `defaultSourceConfigs` array

2. **Settings UI** (`src/components/configuration/SettingsForm.tsx` or new component)
   - Table showing all sources with columns: Label, Default Type, Reduces Income
   - Allow editing each source's defaults
   - Future: Allow adding custom sources

3. **EventForm Integration** (`src/components/configuration/EventForm.tsx`)
   - When source changes, look up defaults from settings
   - Auto-set contribution type and reduces assessable income based on source config
   - User can still override these defaults

4. **Data Migration**
   - Ensure `getSettings()` merges stored settings with defaults
   - Handle missing `sourceConfigs` gracefully

### Key Files

| File | Purpose |
|------|---------|
| `src/schemas/settings.ts` | SuperSettings schema, add sourceConfigs |
| `src/schemas/event.ts` | Super contribution types and sources |
| `src/components/configuration/EventForm.tsx` | Super contribution UI, lines 209-245 |
| `src/components/configuration/SettingsForm.tsx` | Existing settings UI (if exists) |
| `src/data/repository.ts` | `getSettings()` with defaults merging |
| `src/engine/superContributions.ts` | `isCapExempt()`, `getContributionTaxCategory()` |

### Test Scenarios

```typescript
// Auto-apply source defaults
it('applies source defaults when source changes', () => {
  // Select 'downsizer' source
  // Expect contribution type to auto-set to 'capExempt'
  // Expect reduces assessable income to be false
});

// Override defaults
it('allows user to override source defaults', () => {
  // Select 'salarySacrifice' (defaults to concessional, reduces income)
  // Manually change to nonConcessional
  // Should persist the override, not revert to default
});

// Custom source config
it('uses custom source config from settings', () => {
  // Configure 'personalAfterTax' to default to capExempt
  // When selected, should apply custom default, not built-in
});
```

## Current Test Status

- 132 tests passing
- Build succeeds
- All super contribution cap logic working

## Commands

```bash
npm run dev        # Start dev server
npm run build      # TypeScript check + build
npm test           # Run all tests
npm run test:watch # Watch mode
```

## Related Tasks

- Task #66: Contribution caps as off-balance sheet accounts ✅ COMPLETED
- Task #67-73: Sub-tasks for #66 ✅ COMPLETED
- Next: Settings UI for source configuration (create new task)
