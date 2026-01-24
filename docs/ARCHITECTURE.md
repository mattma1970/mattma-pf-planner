# Architecture

**Version:** 0.1 (Draft)  
**Last Updated:** 2026-01-24

---

## System Overview

The Retirement Financial Planner is a client-first web application with an optional backend for AI features.

### Phase 1: Client-Only

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  React UI   │  │   Actions   │  │   Calculation       │  │
│  │  Components │──│   Layer     │──│   Engine            │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         │                                     │              │
│         └──────────────┬──────────────────────┘              │
│                        ▼                                     │
│               ┌─────────────────┐                            │
│               │   IndexedDB     │                            │
│               │   (Dexie.js)    │                            │
│               └─────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

### Phase 2+: With Backend & AI

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  React UI   │  │   Actions   │  │   Calculation       │  │
│  │  + Chat UI  │──│   Layer     │──│   Engine            │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         │                │                                   │
│         │                ▼                                   │
│         │       ┌─────────────────┐                          │
│         │       │   IndexedDB     │                          │
│         │       └─────────────────┘                          │
└─────────┼───────────────────────────────────────────────────┘
          │ HTTPS
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Node.js Backend                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Hono API   │──│  LLM Agent  │──│  OpenAI / Anthropic │  │
│  │  Routes     │  │  (tools)    │  │  API                │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────┐                                         │
│  │  Database       │  (Optional: user accounts, sync)        │
│  └─────────────────┘                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Layer Architecture

### 1. UI Layer (React Components)

Responsible for rendering and user interaction.

| Component Group | Purpose |
|-----------------|---------|
| `spreadsheet/` | Main forecast table with sticky columns, grouped rows |
| `charts/` | Net worth, income/expense visualizations |
| `configuration/` | Account setup, assumption editors, epoch config |
| `chat/` | AI chat interface (Phase 2+) |
| `ui/` | Shared components (buttons, modals, inputs) |

**Principles:**
- Components are stateless where possible
- State from Zustand stores or props
- No business logic—delegate to Actions layer

### 2. Schemas Layer (Zod)

Single source of truth for data shapes.

```typescript
// schemas/account.ts
export const AccountTypeSchema = z.enum(['income', 'expense', 'asset', 'liability']);

export const GrowthProfileSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixed'), rate: z.number() }),
  z.object({ type: z.literal('cpiLinked'), offset: z.number() }),
  z.object({ type: z.literal('increasing'), ratePerYear: z.number() }),
  z.object({ type: z.literal('decreasing'), ratePerYear: z.number() }),
]);

export const AccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: AccountTypeSchema,
  owner: z.string().optional(),          // Person ID, or undefined for joint
  initialValue: z.number(),
  growthProfile: GrowthProfileSchema,
  startYear: z.number().int().optional(),
  endYear: z.number().int().optional(),
  endBehavior: z.enum(['zero', 'transfer', 'hold']).optional(),
  transferToAccountId: z.string().uuid().optional(),
});

export type Account = z.infer<typeof AccountSchema>;
```

### 3. Actions Layer

Discrete operations invocable by UI or LLM.

```typescript
// actions/index.ts
export const actions = {
  // Account management
  createAccount: (params: CreateAccountParams) => Account,
  updateAccount: (id: string, updates: Partial<Account>) => Account,
  deleteAccount: (id: string) => void,
  
  // Scenario management
  createScenario: (params: CreateScenarioParams) => Scenario,
  duplicateScenario: (id: string, name: string) => Scenario,
  setAssumptionOverride: (scenarioId: string, ...) => void,
  
  // Forecasting
  runForecast: (scenarioId: string) => ForecastResult,
  compareScenarios: (ids: string[]) => ComparisonResult,
  
  // Events
  addEvent: (params: AddEventParams) => Event,
  removeEvent: (id: string) => void,
};
```

**For LLM integration:** Each action has a Zod schema for parameters, which can be exported as JSON Schema for function calling.

### 4. Engine Layer (Pure Calculations)

Stateless, pure functions for all financial calculations.

```typescript
// engine/forecast.ts
export function calculateForecast(input: ForecastInput): ForecastResult {
  const years: YearProjection[] = [];
  
  for (let year = input.startYear; year <= input.endYear; year++) {
    const projection = calculateYear(year, previousYear, input);
    years.push(projection);
  }
  
  return { years, summary: calculateSummary(years) };
}

// engine/tax.ts
export function calculateIncomeTax(
  income: number,
  year: number,
  taxRules: TaxRules
): TaxResult {
  // Apply marginal rates from rules
}

// engine/accounts.ts
export function projectAccount(
  account: Account,
  year: number,
  assumptions: ResolvedAssumptions
): number {
  // Apply growth profile, handle start/end years, transfers
}
```

**Key principle:** Engine functions take all inputs as parameters. No side effects, no global state.

### 5. Store Layer (Zustand)

UI state management only. Persistent data lives in Data layer.

```typescript
// store/session.ts
export const useSessionStore = create<SessionState>((set) => ({
  activeScenarioId: null,
  selectedYear: null,
  expandedAccounts: [],
  
  setActiveScenario: (id) => set({ activeScenarioId: id }),
  toggleAccountExpanded: (id) => set((state) => ({
    expandedAccounts: state.expandedAccounts.includes(id)
      ? state.expandedAccounts.filter(a => a !== id)
      : [...state.expandedAccounts, id]
  })),
}));
```

### 6. Data Layer (Persistence)

Repository pattern for data access.

```typescript
// data/repository.ts
export interface DataRepository {
  // Accounts
  getAccounts(): Promise<Account[]>;
  saveAccount(account: Account): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  
  // Scenarios
  getScenarios(): Promise<Scenario[]>;
  saveScenario(scenario: Scenario): Promise<void>;
  
  // Assumptions
  getBaseAssumptions(): Promise<Assumptions>;
  saveBaseAssumptions(assumptions: Assumptions): Promise<void>;
  
  // Events
  getEvents(): Promise<Event[]>;
  saveEvent(event: Event): Promise<void>;
}

// data/indexeddb.ts
export class IndexedDBRepository implements DataRepository {
  private db: Dexie;
  // Implementation using Dexie.js
}
```

---

## Core Data Models

### Accounts

```typescript
interface Account {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'asset' | 'liability';
  owner?: string;                    // Person ID
  initialValue: number;
  growthProfile: GrowthProfile;
  startCondition?: AccountCondition;
  endCondition?: AccountCondition;
  endBehavior?: 'zero' | 'transfer' | 'hold';
  transferToAccountId?: string;
}

type AccountCondition = 
  | { type: 'year'; year: number }
  | { type: 'age'; personId: string; age: number };

type GrowthProfile = 
  | { type: 'fixed'; rate: number }
  | { type: 'cpiLinked'; offset: number }
  | { type: 'increasing'; ratePerYear: number }
  | { type: 'decreasing'; ratePerYear: number };
```

### Assumptions

```typescript
interface Assumptions {
  cpi: AssumptionProfile;
  investmentGrowth: AssumptionProfile;
  superGrowth: AssumptionProfile;
  // Extensible for future assumptions
}

interface AssumptionProfile {
  baseValue: number;                 // Default rate (e.g., 0.03 for 3%)
  overrides: YearRangeOverride[];    // Exceptions
}

interface YearRangeOverride {
  startYear: number;
  endYear?: number;                  // Undefined = continues indefinitely
  value: number | Formula;
}

type Formula = 
  | { type: 'fixed'; value: number }
  | { type: 'cpiPlus'; offset: number }
  | { type: 'perYear'; change: number };
```

### Scenarios

```typescript
interface Scenario {
  id: string;
  name: string;
  description?: string;
  assumptionOverrides: Partial<Assumptions>;
  accountOverrides: AccountOverride[];
  additionalEvents: Event[];
}

interface AccountOverride {
  accountId: string;
  field: keyof Account;
  value: any;
}
```

### Events

```typescript
interface Event {
  id: string;
  year: number;
  type: 'income' | 'expense' | 'assetChange' | 'liabilityChange';
  description: string;
  amount: number;
  affectedAccountId: string;
  transferToAccountId?: string;      // For asset sales
}
```

### Epochs (Forecast Periods)

```typescript
interface Epoch {
  id: string;
  name: string;                      // "Accumulation", "Early Retirement", etc.
  startCondition: EpochCondition;
  endCondition: EpochCondition;
  order: number;                     // Sequence order
}

type EpochCondition = 
  | { type: 'age'; age: number }
  | { type: 'year'; year: number }
  | { type: 'previousEpochEnd' };
```

### Persons (Multi-person support)

```typescript
interface Person {
  id: string;
  name: string;
  birthYear: number;
  retirementYear?: number;
  preservationAge?: number;          // Super access age
}
```

### Forecast Result

```typescript
interface ForecastResult {
  years: YearProjection[];
  summary: ForecastSummary;
}

interface YearProjection {
  year: number;
  epoch: string;
  accounts: AccountProjection[];
  totals: {
    income: number;
    expenses: number;
    tax: number;
    assets: number;
    liabilities: number;
    netWorth: number;
    cashFlow: number;
  };
  events: Event[];                   // Events occurring this year
}

interface AccountProjection {
  accountId: string;
  value: number;
  breakdown?: {                      // For expandable row detail
    baseValue: number;
    growth: number;
    cpiAdjustment?: number;
    eventImpact?: number;
  };
}

interface ForecastSummary {
  finalNetWorth: number;
  yearsUntilRetirement: number;
  yearFundsDeplete?: number;         // If applicable
  totalTaxPaid: number;
}
```

---

## Data Flow

### Forecast Calculation Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Accounts   │     │  Assumptions │     │    Events    │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │ Scenario        │
                   │ (applies        │
                   │  overrides)     │
                   └────────┬────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │ Resolve         │
                   │ Assumptions     │
                   │ (per year)      │
                   └────────┬────────┘
                            │
                            ▼
          ┌─────────────────────────────────────┐
          │  For each year in forecast range:   │
          │  ┌───────────────────────────────┐  │
          │  │ 1. Project each account       │  │
          │  │ 2. Apply events for year      │  │
          │  │ 3. Calculate totals           │  │
          │  │ 4. Calculate tax              │  │
          │  │ 5. Update running balances    │  │
          │  └───────────────────────────────┘  │
          └─────────────────┬───────────────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │ ForecastResult  │
                   │ (years array +  │
                   │  summary)       │
                   └─────────────────┘
```

---

## UI Component Structure

### Main Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Header: Scenario Selector | Assumptions Summary | Settings        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────┬─────────────────────────────────────────────┐   │
│  │ Account       │ ← Years (horizontally scrollable) →         │   │
│  │ (sticky)      │                                              │   │
│  ├───────────────┼─────────────────────────────────────────────┤   │
│  │ ▸ INCOME      │                                              │   │
│  │   Salary      │  120K │ 124K │ 128K │ ...                   │   │
│  │   Rental      │   30K │  31K │  32K │ ...                   │   │
│  ├───────────────┼─────────────────────────────────────────────┤   │
│  │ ▸ EXPENSES    │                                              │   │
│  │   ...         │                                              │   │
│  ├───────────────┼─────────────────────────────────────────────┤   │
│  │ ═ EVENTS      │       │      │ Sell House: +1M │            │   │
│  └───────────────┴─────────────────────────────────────────────┘   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  Charts: Net Worth Over Time | Income vs Expenses                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Hierarchy

```
<App>
  <Header>
    <ScenarioSelector />
    <AssumptionsSummary />
    <SettingsButton />
  </Header>
  
  <MainContent>
    <SpreadsheetView>
      <StickyColumn>
        <AccountGroup type="income" />
        <AccountGroup type="expense" />
        <AccountGroup type="asset" />
        <AccountGroup type="liability" />
        <CalculatedSection />
        <EventsSummary />
      </StickyColumn>
      <YearsGrid>
        <YearColumn year={2026} />
        <YearColumn year={2027} />
        ...
      </YearsGrid>
    </SpreadsheetView>
    
    <ChartsPanel>
      <NetWorthChart />
      <IncomeExpenseChart />
    </ChartsPanel>
  </MainContent>
  
  <ConfigurationModal />    {/* Account/assumption editors */}
  <ChatPanel />             {/* Phase 2+ */}
</App>
```

---

## Phase 1 Scope (Architecture Subset)

For MVP, implement:

- [x] Schemas: Account, Assumptions (basic), Event
- [x] Actions: Account CRUD, runForecast
- [x] Engine: Basic forecast calculation, simple income tax
- [x] Data: IndexedDB repository
- [x] UI: Spreadsheet view, account configuration, basic charts

Defer to later phases:

- [ ] Scenarios (Phase 2)
- [ ] Multi-person (Phase 3)
- [ ] Rule engine for complex tax (Phase 4)
- [ ] LLM integration (Phase 5+)
- [ ] Backend API (Phase 5+)
