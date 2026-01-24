# Retirement Financial Planner

A web application for Australian retirement financial planning with scenario analysis.

## Features (Phase 1 - MVP)

- **Configurable Accounts**: Create income, expense, asset, and liability accounts with custom growth profiles
- **Year-by-Year Forecasting**: Spreadsheet-style view showing projections for each year
- **Australian Tax Calculation**: 2024-25 marginal tax rates applied to income
- **Account Lifecycle**: Set start/end conditions (by year or age) with transfer behavior
- **One-Time Events**: Model inheritances, property sales, and other non-recurring items
- **Assumptions Management**: Configure CPI, investment growth, and superannuation growth rates
- **Charts**: Net worth over time and income vs expenses visualizations
- **Local Persistence**: Data saved in browser (IndexedDB)

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

### Build

```bash
npm run build
```

### Test

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

## Project Structure

```
src/
├── schemas/       # Zod schemas and TypeScript types
├── engine/        # Pure calculation functions (tax, forecasting)
├── actions/       # Business logic operations
├── data/          # IndexedDB persistence layer
├── store/         # Zustand state management
├── hooks/         # React hooks for data access
├── components/
│   ├── ui/           # Reusable UI components
│   ├── spreadsheet/  # Forecast table view
│   ├── charts/       # Visualizations
│   └── configuration/ # Account/assumption editors
└── test/          # Test fixtures and setup
```

## Documentation

See the [docs](./docs) folder for:
- [PRD.md](./docs/PRD.md) - Product requirements
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) - System architecture
- [TECH_STACK.md](./docs/TECH_STACK.md) - Technology choices
- [USER_STORIES.md](./docs/USER_STORIES.md) - User stories
- [TESTING_STRATEGY.md](./docs/TESTING_STRATEGY.md) - Testing approach

## Tech Stack

- **React 19** + TypeScript + Vite
- **TanStack Table** - Spreadsheet rendering
- **Recharts** - Charts
- **Zustand** - State management
- **Dexie.js** - IndexedDB wrapper
- **Zod** - Schema validation
- **Tailwind CSS** - Styling
- **Vitest** - Testing

## License

MIT
