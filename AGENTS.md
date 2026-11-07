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
- `src/domain/` - **NEW: Pluggable rules and behaviors** (tax rules, super caps, pipeline stages, account behaviors, UI plugin registry)
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

### Pluggable Rules (Domain Layer)
Legislation (tax brackets, super caps, CGT rules) lives in pluggable rule classes in `src/domain/rules/`. Rules are registered in `RuleRegistry` (`src/domain/registry.ts`) and resolved by year. A new tax year = new rule class, no engine code changes.

### Forecast Pipeline
The forecast is decomposed into 8 ordered stages (`src/domain/pipeline/stages/`). Each stage implements `IForecastStage` and transforms a `ForecastContext`. Stages are registered in `ForecastOrchestrator` and can be added, removed, or replaced without touching other stages.

### Account Behaviors
Account behavior is decoupled via `IAccountBehavior` in `src/domain/accounts/behavior.ts`. New account types implement this interface and register in `AccountBehaviorRegistry`.

### UI Plugin Registry
UI renderers and editors are registered in `UIPluginRegistry` (`src/components/ui/registry.ts`). Components query the registry by account type instead of hardcoding switch statements.

### Pure Engine
Functions in `src/engine/` are pure - no side effects, no React, no data fetching. Easy to test.

### Actions Layer
The `src/actions/` layer is the API for both UI and future LLM integration. Keep actions focused and composable.

### State Management
Use Zustand stores in `src/store/` for session/UI state. Persistent data goes through `src/data/` (Dexie).

## Testing

Priority: engine > domain rules > schemas > actions > components

Engine functions need comprehensive tests - financial calculations must be correct.

Run `npm test` after any changes to `src/engine/` or `src/domain/`.

### Required Tests

- **New features**: All new features must include corresponding tests before completion.
- **Bug fixes**: After debugging and fixing an issue, add a regression test that would have caught the bug.
- **New tax rules**: Add tests in `src/domain/rules/tax.test.ts` proving a new year rule can be added without engine changes.

## Australian Tax

Tax calculations use pluggable rules in `src/domain/rules/tax.ts`. The 2024-25 marginal brackets are implemented in `MarginalIncomeTaxRule`. Future tax years are added by registering new `ITaxRule` implementations in `RuleRegistry` - no engine code changes needed.

## Subagent Usage

Use subagents (Task tool) to keep the main thread focused and avoid context overflow:

### When to Use Subagents
- **Implementation work**: Feature development, bug fixes, refactoring
- **Investigation/debugging**: Tracing issues across multiple files
- **Repetitive tasks**: Updating multiple similar files
- **Independent parallel work**: Tasks that don't depend on each other

### When to Stay in Main Thread
- **Quick queries**: Simple questions, file lookups, one-liner fixes
- **Planning/discussion**: Deciding on approach before implementation
- **Review of subagent results**: Summarizing what was done

### Subagent Best Practices
1. **Provide full context**: Include file paths, error messages, expected behavior
2. **Reference handover docs**: Point to `docs/HANDOVER_*.md` for complex features
3. **Specify verification**: Tell subagent to run `npm test` and `npm run build`
4. **Request summary**: Ask subagent to return what was changed for the commit message

### Example Prompt Pattern
```
Implement [feature/fix]. 

Context: [what the user reported, relevant background]
Files: [specific files to modify]
Verification: Run npm test and npm run build
Return: Summary of changes made
```

## Git Workflow

When asked to "commit the changes" or similar:

1. Stage all changes: `git add .` (respects .gitignore)
2. Write a commit message following conventional commits format:
   - Format: `type(scope): description`
   - Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
   - Include details of what changed in the body
   - Reference user story/task ID if relevant (e.g., `Closes #123`)
3. Push to remote: `git push`
