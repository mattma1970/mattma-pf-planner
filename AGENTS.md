# Agent Instructions

## Commands

```bash
# Development
npm run dev        # Start dev server on localhost:5173
npm run build      # TypeScript check + production build
npm run lint       # ESLint

# Testing
npm test           # Run all tests once
npm run test:watch # Watch mode
npm run test:coverage # With coverage report
```

## Project Structure

- `src/schemas/` - Zod schemas, single source of truth for types
- `src/engine/` - Pure calculation functions (no React), heavily tested
- `src/actions/` - Business logic, orchestrates engine + data layer
- `src/data/` - IndexedDB persistence via Dexie.js
- `src/components/` - React UI components
- `src/hooks/` - React hooks for data access
- `src/store/` - Zustand stores for client-side state
- `src/test/` - Test utilities and setup

## Tech Stack

- **React 19** with TypeScript
- **Vite 7** for build tooling
- **Tailwind CSS 4** for styling
- **Vitest** for testing with React Testing Library
- **Zod 4** for schema validation
- **Zustand** for state management
- **Dexie.js** for IndexedDB persistence
- **Recharts** for data visualization
- **@dnd-kit** for drag-and-drop
- **@tanstack/react-table** for tables

## Key Patterns

### Schemas First
Types are derived from Zod schemas in `src/schemas/index.ts`. Don't create separate TypeScript interfaces.

### Pure Engine
Functions in `src/engine/` are pure - no side effects, no React, no data fetching. Easy to test.

### Actions Layer
The `src/actions/` layer is the API for both UI and future LLM integration. Keep actions focused and composable.

### State Management
Use Zustand stores in `src/store/` for session/UI state. Persistent data goes through `src/data/` (Dexie).

## Testing

Priority: engine > schemas > actions > components

Engine functions need comprehensive tests - financial calculations must be correct.

Run `npm test` after any changes to `src/engine/`.

### Required Tests

- **New features**: All new features must include corresponding tests before completion.
- **Bug fixes**: After debugging and fixing an issue, add a regression test that would have caught the bug.

## Australian Tax

Tax calculations use 2024-25 Australian brackets (hardcoded in `src/engine/tax.ts`). Future phases will make these configurable.

## Git Workflow

When asked to "commit the changes" or similar:

1. Stage all changes: `git add .` (respects .gitignore)
2. Write a commit message following conventional commits format:
   - Format: `type(scope): description`
   - Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
   - Include details of what changed in the body
   - Reference user story/task ID if relevant (e.g., `Closes #123`)
3. Push to remote: `git push`
