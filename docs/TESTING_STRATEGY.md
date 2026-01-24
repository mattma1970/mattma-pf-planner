# Testing Strategy

**Version:** 0.1 (Draft)  
**Last Updated:** 2026-01-24

---

## Testing Philosophy

For a financial planning app, **calculation correctness is paramount**. A bug in the UI is annoying; a bug in the calculation engine could lead to bad retirement decisions.

**Priority order:**
1. **Calculation Engine** - Exhaustive unit tests
2. **Actions Layer** - Integration tests for data flow
3. **Data Persistence** - Verify save/load integrity
4. **UI Components** - Focused E2E tests for critical flows

---

## Test Pyramid

```
                    ┌───────────────┐
                    │     E2E       │  Few, slow, high confidence
                    │  (Playwright) │  Critical user journeys
                    ├───────────────┤
                    │  Integration  │  Actions + Engine + Data
                    │   (Vitest)    │  together
              ┌─────┴───────────────┴─────┐
              │         Unit Tests        │  Many, fast, isolated
              │         (Vitest)          │  Engine, schemas, utils
              └───────────────────────────┘
```

---

## Layer-by-Layer Strategy

### 1. Calculation Engine (Highest Priority)

**Location:** `src/engine/`

**Why critical:** These pure functions determine all financial projections. Errors here directly mislead users.

**What to test:**

| Function | Test Cases |
|----------|------------|
| `calculateForecast()` | Multi-year projection, epoch transitions, account lifecycle |
| `projectAccount()` | All growth profiles (fixed, CPI-linked, increasing, decreasing) |
| `applyAccountCondition()` | Year-based start/end, age-based start/end |
| `handleTransfer()` | Transfer value to destination account |
| `calculateIncomeTax()` | Each bracket boundary, edge cases ($0, $18,200, $45,000, etc.) |
| `resolveAssumptions()` | Base values, overrides, year ranges |

**Example test cases for `projectAccount()`:**

```typescript
describe('projectAccount', () => {
  describe('growth profiles', () => {
    it('applies fixed growth rate correctly', () => {
      const account = createAccount({ initialValue: 100000, growthProfile: { type: 'fixed', rate: 0.05 } });
      expect(projectAccount(account, 2026, assumptions)).toBe(105000);
      expect(projectAccount(account, 2027, assumptions)).toBe(110250);
    });

    it('applies CPI-linked growth', () => {
      const assumptions = { cpi: 0.03 };
      const account = createAccount({ growthProfile: { type: 'cpiLinked', offset: 0.01 } }); // CPI + 1%
      expect(projectAccount(account, 2026, assumptions)).toBe(104000); // 4% growth
    });

    it('applies decreasing growth rate', () => {
      const account = createAccount({ growthProfile: { type: 'decreasing', ratePerYear: 0.01 } });
      // Year 1: 5%, Year 2: 4%, Year 3: 3%...
    });
  });

  describe('account lifecycle', () => {
    it('returns 0 before start year', () => {
      const account = createAccount({ startCondition: { type: 'year', year: 2030 } });
      expect(projectAccount(account, 2029, assumptions)).toBe(0);
    });

    it('returns 0 after end year with zero behavior', () => {
      const account = createAccount({ 
        endCondition: { type: 'year', year: 2030 },
        endBehavior: 'zero'
      });
      expect(projectAccount(account, 2031, assumptions)).toBe(0);
    });

    it('holds value after end year with hold behavior', () => {
      const account = createAccount({ 
        initialValue: 100000,
        endCondition: { type: 'year', year: 2030 },
        endBehavior: 'hold'
      });
      expect(projectAccount(account, 2035, assumptions)).toBe(100000); // No growth, held
    });
  });

  describe('age-based conditions', () => {
    it('converts age to year using person birth year', () => {
      const person = { id: 'p1', birthYear: 1980 };
      const account = createAccount({ 
        endCondition: { type: 'age', personId: 'p1', age: 67 }
      });
      // Age 67 = year 2047
      expect(projectAccount(account, 2046, assumptions, [person])).toBeGreaterThan(0);
      expect(projectAccount(account, 2048, assumptions, [person])).toBe(0);
    });
  });
});
```

**Example test cases for `calculateIncomeTax()`:**

```typescript
describe('calculateIncomeTax', () => {
  it('applies 0% for income under $18,200', () => {
    expect(calculateIncomeTax(18000)).toBe(0);
  });

  it('applies 19% for $18,201 - $45,000 bracket', () => {
    expect(calculateIncomeTax(45000)).toBe(5092); // (45000 - 18200) * 0.19
  });

  it('calculates correctly at bracket boundaries', () => {
    expect(calculateIncomeTax(18200)).toBe(0);
    expect(calculateIncomeTax(18201)).toBe(0.19);
  });

  it('applies all brackets for high income', () => {
    // $200,000 income:
    // $0-18,200: $0
    // $18,201-45,000: $5,092
    // $45,001-120,000: $24,375
    // $120,001-190,000: $25,900
    // $190,001-200,000: $4,500
    // Total: $59,867
    expect(calculateIncomeTax(200000)).toBe(59867);
  });
});
```

### 2. Schemas (Zod Validation)

**Location:** `src/schemas/`

**What to test:**
- Valid data parses correctly
- Invalid data is rejected with clear errors
- Edge cases (empty strings, negative numbers, etc.)

```typescript
describe('AccountSchema', () => {
  it('accepts valid account', () => {
    const result = AccountSchema.safeParse({
      id: 'abc-123',
      name: 'Salary',
      type: 'income',
      initialValue: 120000,
      growthProfile: { type: 'fixed', rate: 0.03 }
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative initial value', () => {
    const result = AccountSchema.safeParse({
      ...validAccount,
      initialValue: -1000
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid account type', () => {
    const result = AccountSchema.safeParse({
      ...validAccount,
      type: 'invalid'
    });
    expect(result.success).toBe(false);
  });
});
```

### 3. Actions Layer (Integration)

**Location:** `src/actions/`

**What to test:** Actions correctly orchestrate engine + data layer.

```typescript
describe('runForecast action', () => {
  it('loads accounts from repository and calculates forecast', async () => {
    // Setup: seed repository with test accounts
    await repository.saveAccount(salaryAccount);
    await repository.saveAccount(houseAccount);
    
    const result = await actions.runForecast({ startYear: 2026, endYear: 2030 });
    
    expect(result.years).toHaveLength(5);
    expect(result.years[0].totals.income).toBe(120000);
  });

  it('applies scenario overrides', async () => {
    const scenario = await actions.createScenario({ 
      name: 'Low Growth',
      assumptionOverrides: { investmentGrowth: { baseValue: 0.02 } }
    });
    
    const result = await actions.runForecast({ scenarioId: scenario.id });
    
    // Verify lower growth applied
  });
});
```

### 4. Data Persistence

**Location:** `src/data/`

**What to test:** Data round-trips correctly.

```typescript
describe('IndexedDBRepository', () => {
  beforeEach(async () => {
    await repository.clear(); // Fresh state
  });

  it('saves and retrieves accounts', async () => {
    const account = createAccount({ name: 'Test Salary' });
    await repository.saveAccount(account);
    
    const accounts = await repository.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Test Salary');
  });

  it('updates existing account', async () => {
    const account = createAccount({ name: 'Original' });
    await repository.saveAccount(account);
    
    await repository.saveAccount({ ...account, name: 'Updated' });
    
    const accounts = await repository.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Updated');
  });

  it('deletes account', async () => {
    const account = createAccount({ name: 'To Delete' });
    await repository.saveAccount(account);
    await repository.deleteAccount(account.id);
    
    const accounts = await repository.getAccounts();
    expect(accounts).toHaveLength(0);
  });
});
```

### 5. E2E Tests (Critical Journeys)

**Location:** `e2e/`

**What to test:** Complete user flows work end-to-end.

**Critical journeys for Phase 1:**

| Journey | Steps |
|---------|-------|
| Create first forecast | Open app → Add salary → Add expense → See projection |
| Account with transfer | Add house → Set end year → Transfer to cash → Verify cash increases |
| Assumption override | Set CPI → Add override for specific years → Verify rates applied |
| Data persists | Add accounts → Refresh page → Accounts still there |

```typescript
// e2e/create-forecast.spec.ts
import { test, expect } from '@playwright/test';

test('user can create a basic forecast', async ({ page }) => {
  await page.goto('/');
  
  // Add income account
  await page.click('[data-testid="add-account"]');
  await page.fill('[data-testid="account-name"]', 'Salary');
  await page.selectOption('[data-testid="account-type"]', 'income');
  await page.fill('[data-testid="initial-value"]', '120000');
  await page.click('[data-testid="save-account"]');
  
  // Verify appears in spreadsheet
  await expect(page.locator('text=Salary')).toBeVisible();
  await expect(page.locator('[data-account="Salary"][data-year="2026"]')).toContainText('120,000');
  
  // Add expense
  await page.click('[data-testid="add-account"]');
  await page.fill('[data-testid="account-name"]', 'Living Costs');
  await page.selectOption('[data-testid="account-type"]', 'expense');
  await page.fill('[data-testid="initial-value"]', '60000');
  await page.click('[data-testid="save-account"]');
  
  // Verify totals
  await expect(page.locator('[data-row="total-income"][data-year="2026"]')).toContainText('120,000');
  await expect(page.locator('[data-row="total-expenses"][data-year="2026"]')).toContainText('60,000');
});

test('data persists after page refresh', async ({ page }) => {
  await page.goto('/');
  
  // Add an account
  await page.click('[data-testid="add-account"]');
  await page.fill('[data-testid="account-name"]', 'Persistent Account');
  await page.click('[data-testid="save-account"]');
  
  // Refresh
  await page.reload();
  
  // Still there
  await expect(page.locator('text=Persistent Account')).toBeVisible();
});
```

---

## Test Data Strategy

### Fixtures

Create reusable test fixtures for common scenarios:

```typescript
// test/fixtures/accounts.ts
export const fixtures = {
  salary: {
    id: 'salary-1',
    name: 'Salary',
    type: 'income' as const,
    initialValue: 120000,
    growthProfile: { type: 'fixed' as const, rate: 0.03 },
  },
  
  house: {
    id: 'house-1',
    name: 'House',
    type: 'asset' as const,
    initialValue: 800000,
    growthProfile: { type: 'fixed' as const, rate: 0.05 },
    endCondition: { type: 'year' as const, year: 2040 },
    endBehavior: 'transfer' as const,
    transferToAccountId: 'cash-1',
  },
  
  superannuation: {
    id: 'super-1',
    name: 'Superannuation',
    type: 'asset' as const,
    initialValue: 200000,
    growthProfile: { type: 'fixed' as const, rate: 0.07 },
    endCondition: { type: 'age' as const, personId: 'person-1', age: 67 },
    endBehavior: 'transfer' as const,
    transferToAccountId: 'pension-1',
  },
};
```

### Golden Master Tests

For complex forecasts, use "golden master" (snapshot) testing:

```typescript
it('matches expected forecast output', () => {
  const result = calculateForecast(standardInputs);
  expect(result).toMatchSnapshot();
});
```

Update snapshots intentionally when calculation logic changes.

---

## Running Tests

### Commands

```bash
# Unit + Integration tests
pnpm test

# Watch mode during development
pnpm test:watch

# Coverage report
pnpm test:coverage

# E2E tests
pnpm test:e2e

# E2E with UI (for debugging)
pnpm test:e2e:ui
```

### CI Pipeline

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      
      - run: pnpm install
      - run: pnpm test
      - run: pnpm build
      - run: pnpm test:e2e
```

---

## Coverage Goals

| Layer | Target Coverage | Rationale |
|-------|-----------------|-----------|
| `engine/` | **95%+** | Financial calculations must be correct |
| `schemas/` | **90%+** | Data validation is critical |
| `actions/` | **80%+** | Integration points |
| `data/` | **80%+** | Persistence integrity |
| `components/` | **60%+** | UI tested mainly via E2E |

---

## What NOT to Test

- Third-party library internals (TanStack Table, Recharts)
- Styling/CSS (visual regression testing is overkill for Phase 1)
- Exact DOM structure (test behavior, not implementation)

---

## Summary

| Test Type | Tool | Focus | Count (est.) |
|-----------|------|-------|--------------|
| Unit | Vitest | Engine functions, schemas | 100+ |
| Integration | Vitest | Actions + data layer | 20-30 |
| E2E | Playwright | Critical user journeys | 5-10 |

**Key principle:** If a bug in the code could cause a user to make a bad financial decision, it needs a test.
