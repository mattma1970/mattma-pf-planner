# Tech Stack

**Version:** 0.1 (Draft)  
**Last Updated:** 2026-01-24

---

## Recommended Stack

| Layer | Choice | Alternatives Considered |
|-------|--------|------------------------|
| **Framework** | React 19 | Vue, Svelte, SolidJS |
| **Language** | TypeScript | - |
| **Build Tool** | Vite | Next.js, Create React App |
| **Styling** | Tailwind CSS | CSS Modules, styled-components |
| **State Management** | Zustand | Redux, Jotai, React Context |
| **Table/Spreadsheet** | TanStack Table | AG Grid, react-virtualized |
| **Data Persistence** | IndexedDB (via Dexie.js) | localStorage, server-backed |
| **Charts** | Recharts | Chart.js, Visx, D3 |
| **Testing** | Vitest + Playwright | Jest, Cypress |
| **Linting/Formatting** | ESLint + Prettier | Biome |
| **Schema Validation** | Zod | Yup, io-ts |
| **Backend (Phase 2+)** | Node.js + Hono | Express, Fastify |
| **LLM Integration** | Vercel AI SDK | LangChain, direct API calls |

---

## Rationale

### React 19

**Why:** Mature ecosystem with excellent support for complex, data-dense UIs. The spreadsheet-style interface with sticky columns, virtualization, and reactive updates is well-served by React's component model and library ecosystem.

**Why not Svelte/SolidJS:** Both offer better performance characteristics, but the table library ecosystem is less mature. Given the complex spreadsheet requirements, React's ecosystem advantage outweighs raw performance (which is sufficient for our scale of ~50-100 rows × ~50 columns).

### TypeScript

**Why:** Financial calculations require precision and correctness. Type safety catches errors at compile time, makes refactoring safer, and serves as documentation for the calculation engine.

### Vite

**Why:** Fast development builds, excellent HMR, simple configuration. No need for SSR (desktop web app), so Next.js overhead isn't justified.

### Tailwind CSS

**Why:** Rapid UI development, consistent spacing/sizing, easy responsive design. Component-scoped styling without CSS-in-JS runtime overhead.

### Zustand

**Why:** Lightweight state management (< 1KB) with simple API. Perfect for app-wide state like:
- Current scenario selection
- User preferences
- Calculation results cache

React Context handles component-local state; Zustand handles cross-cutting concerns.

### TanStack Table (Headless)

**Why:** 
- **Headless:** Full control over markup and styling for our custom spreadsheet design
- **Virtualization:** Handles large row counts efficiently (though we likely won't exceed 100 rows)
- **Sticky columns:** Built-in support for pinned columns
- **Sorting/Grouping:** Native support for grouped sections (Income, Expenses, etc.)

**Why not AG Grid:** More powerful but opinionated styling. Harder to match our custom design. Community edition has some limitations.

### IndexedDB via Dexie.js

**Why:**
- **Privacy:** Financial data stays on user's device
- **Offline-capable:** Works without internet
- **No backend needed:** Simplifies Phase 1 significantly
- **Structured data:** Better than localStorage for complex nested objects

**Architecture for future:** Design data layer with repository pattern so we can add server sync later without rewriting components.

```
┌─────────────────────────────────────────────────────────┐
│  Components                                             │
├─────────────────────────────────────────────────────────┤
│  Data Repository (interface)                            │
├─────────────────────────────────────────────────────────┤
│  LocalStorageAdapter │ IndexedDBAdapter │ APIAdapter    │
│  (Phase 1 fallback)  │ (Phase 1 primary)│ (Future)      │
└─────────────────────────────────────────────────────────┘
```

### Recharts

**Why:** Built on React, declarative API, good for standard chart types (line charts for net worth over time, bar charts for income vs expenses). Simpler than D3 for our needs.

### Vitest + Playwright

**Why:**
- **Vitest:** Fast, Vite-native, great for testing the calculation engine in isolation
- **Playwright:** Cross-browser E2E testing for the spreadsheet interactions

### Zod (Schema Validation)

**Why:**
- Runtime validation of data (important for user-configured accounts, rules)
- **TypeScript inference:** Define schema once, get types automatically
- **JSON Schema generation:** Can export schemas for LLM function calling definitions
- Works at the boundary between UI, engine, and future LLM integration

```typescript
// schemas/account.ts
import { z } from 'zod';

export const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['income', 'expense', 'asset', 'liability']),
  initialValue: z.number(),
  growthProfile: GrowthProfileSchema,
  startYear: z.number().optional(),
  endYear: z.number().optional(),
});

export type Account = z.infer<typeof AccountSchema>;
// ^ TypeScript type derived from schema
```

### Node.js + Hono (Backend - Phase 2+)

**Why needed:**
- **LLM API proxy:** Keep API keys secure on server, not in browser
- **User authentication:** If we add accounts/sharing
- **Data sync:** Multi-device access

**Why Hono:**
- Lightweight, fast, modern API framework
- Works on Node.js, Cloudflare Workers, Vercel Edge
- Simple middleware pattern
- TypeScript-first

### Vercel AI SDK (LLM Integration - Phase 2+)

**Why:**
- Unified interface to multiple LLM providers (OpenAI, Anthropic, etc.)
- Built-in **tool/function calling** support
- Streaming responses for chat UI
- Works well with React (useChat hook)

---

## Project Structure (Proposed)

```
src/
├── components/           # React components
│   ├── spreadsheet/      # Table, rows, cells, sticky column
│   ├── charts/           # Net worth, income/expense charts
│   ├── configuration/    # Account setup, assumption editors
│   ├── chat/             # AI chat interface (Phase 2+)
│   └── ui/               # Shared UI components (buttons, modals)
├── schemas/              # Zod schemas (single source of truth)
│   ├── account.ts        # Account schema + types
│   ├── assumption.ts     # Assumption profile schemas
│   ├── scenario.ts       # Scenario schemas
│   └── index.ts          # Re-exports all schemas
├── actions/              # Discrete operations (UI + AI can call)
│   ├── accounts.ts       # CRUD for accounts
│   ├── scenarios.ts      # Scenario management
│   ├── forecast.ts       # Run forecasts
│   └── index.ts          # Registry of all actions (for LLM tools)
├── engine/               # Pure calculation logic (no React)
│   ├── forecast.ts       # Main forecast calculation
│   ├── tax.ts            # Tax calculation rules
│   └── accounts.ts       # Account projections
├── store/                # Zustand stores (UI state)
│   ├── ui.ts             # UI-specific state (selected year, etc.)
│   └── session.ts        # Current working state
├── data/                 # Persistence layer
│   ├── repository.ts     # Data access interface
│   └── indexeddb.ts      # Dexie.js implementation
├── hooks/                # Custom React hooks
└── utils/                # Helpers, formatters
```

### Key Principle: Separation of Calculation Engine

The `engine/` directory contains **pure TypeScript functions** with no React dependencies:

```typescript
// engine/forecast.ts
export function calculateForecast(
  accounts: Account[],
  assumptions: Assumptions,
  events: Event[],
  startYear: number,
  endYear: number
): YearlyProjection[] {
  // Pure calculation, easily testable
}
```

This allows:
- Unit testing without React/DOM
- Potential extraction to Web Worker for heavy calculations
- Reuse if we ever need a server-side version

### Key Principle: Action Layer for AI Integration

An `actions/` layer defines discrete operations that both UI and LLM can invoke:

```typescript
// actions/scenarios.ts
export const actions = {
  createScenario: (params: CreateScenarioParams) => { ... },
  duplicateScenario: (id: string, newName: string) => { ... },
  setAssumptionOverride: (scenarioId: string, assumption: string, profile: Profile) => { ... },
  runForecast: (scenarioId: string) => ForecastResult,
  compareScenarios: (ids: string[]) => ComparisonResult,
  summarizeResults: (forecastResult: ForecastResult) => Summary,
};
```

**Why this matters for AI:**
- Each action becomes an **LLM tool** with typed parameters
- Zod schemas define the parameters → JSON Schema for function calling
- LLM can chain actions: "Create a recession scenario, set super growth to -10% for 2029-2031, run the forecast, and tell me when I run out of money"

```
┌─────────────────────────────────────────────────────────────┐
│                        User Intent                          │
│   "What if there's a recession in 2030?"                    │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
   ┌─────────────┐                        ┌─────────────┐
   │  React UI   │                        │  LLM Agent  │
   │  (buttons)  │                        │  (chat)     │
   └─────────────┘                        └─────────────┘
          │                                       │
          └───────────────────┬───────────────────┘
                              ▼
                    ┌─────────────────┐
                    │  Action Layer   │
                    │  (typed funcs)  │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Engine Layer   │
                    │  (pure calcs)   │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Data Layer     │
                    │  (IndexedDB)    │
                    └─────────────────┘
```

---

## Dependencies (Estimated)

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tanstack/react-table": "^8.x",
    "zustand": "^5.x",
    "dexie": "^4.x",
    "recharts": "^2.x",
    "tailwindcss": "^4.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vite": "^6.x",
    "@vitejs/plugin-react": "^4.x",
    "vitest": "^2.x",
    "playwright": "^1.x",
    "eslint": "^9.x",
    "prettier": "^3.x"
  }
}
```

---

## Open Questions

- [ ] Do we need authentication in Phase 1? (Affects whether we need any backend)
- [ ] Export formats needed? (PDF generation may need server-side or library like jsPDF)
- [ ] Should calculation engine run in Web Worker to avoid UI blocking?
- [ ] Do we need to support multiple browsers, or can we target Chrome/Edge only?

---

## Next Steps

1. Set up project with Vite + React + TypeScript
2. Establish folder structure
3. Implement core data types in `engine/types.ts`
4. Build basic spreadsheet shell with TanStack Table
