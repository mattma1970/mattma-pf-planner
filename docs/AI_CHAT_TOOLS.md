# AI Chat Tool Layer — Design Notes

**Status:** Planning (not implemented)  
**Last Updated:** 2026-05-31

---

## Goal

Expose every app feature to an LLM so a user can drive the retirement planner entirely
through a chat interface. The LLM should be able to:

- Read the current financial state and forecast
- Create, update, and delete accounts / events / assumptions
- Set up Australian-specific structures (employer SG, pension drawdown, scenarios)
- Run the forecast and verify its own changes before reporting back to the user

---

## Architecture Decision: Primitives + Skills

Two approaches were considered:

### Option A — Domain-semantic tools (~13 tools)

Each tool encodes Australian-specific logic in its parameter schema:
`addEmployerSuperContributions`, `configurePensionDrawdown`, `addIncomeSource`, etc.

### Option B — Primitives + Skills (~6 tools) ✅ Chosen

A small set of thin, orthogonal tool calls. Domain knowledge (what fields to set, in what
order, with what validation) lives in **skill prompts** — not in tool signatures.

**Why Option B:**
- Tools are stable even as Australian rules change (e.g. SG rate goes from 11.5% → 12%)
- Domain logic lives in one place (the skill prompt), not spread across tool parameters
- Edge cases are handled by the LLM improvising on primitives rather than hitting a tool's
  rigid constraint
- Fewer tools to implement, test, and maintain

**Tradeoff accepted:** Multi-step use cases require 2–3 LLM round-trips (read → mutate →
verify) rather than 1. This is acceptable; latency is not a primary concern for a planning
tool used reflectively.

---

## The 6 Primitive Tools

### 1. `getState`

Read-only snapshot of all app state. Called first in every skill to establish context
before mutating anything.

```typescript
getState(): {
  persons: Array<{
    id: string;
    name: string;
    birthYear: number;
    retirementYear: number;
    preservationAge: number;
    taxFundingAccountId?: string;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    type: 'income' | 'expense' | 'asset' | 'liability';
    currentValue: number;
    growthProfileSummary: string;  // human-readable, e.g. "fixed 6%"
    activeYears: string;           // e.g. "2025–2040" or "always"
  }>;
  events: Array<{
    id: string;
    name: string;
    year: number;
    accountId: string;
    delta: 'credit' | 'debit';
    amount: number;
  }>;
  assumptions: {
    cpi: number;
    defaultGrowthRate: number;
    overrides: AssumptionOverride[];
  };
  activeScenarioId: string;
  warnings: ForecastWarning[];
}
```

### 2. `runForecast`

Triggers a forecast recalculation and returns summary output. Read-only — never mutates
state. Used by skills to verify changes after mutations.

```typescript
runForecast(params?: { scenarioId?: string }): {
  years: Array<{
    year: number;
    netWorth: number;
    totalIncome: number;
    totalExpenses: number;
    tax: number;
  }>;
  depletionYear?: number;   // first year netWorth < 0, if any
  warnings: ForecastWarning[];
}
```

### 3. `upsertAccount`

Create or update any account. Pass `id` to update an existing account; omit to create new.
The `AccountInput` type is the existing Zod-validated schema — all fields are the same as
the current account editor.

Schema-level guards enforced by this tool (not delegated to the LLM):
- If `drawnFromAccountId` is set, `type` must be `'income'`
- If `superContributionConfig` is set, `type` must be `'income'`
- If `basedOnAccountId` is set, the referenced account must exist

```typescript
upsertAccount(params: { id?: string } & AccountInput): {
  accountId: string;
  created: boolean;  // true if new, false if updated
}
```

### 4. `deleteAccount`

```typescript
deleteAccount(params: { accountId: string }): {
  ok: boolean;
  transferWarning?: string;  // if another account references this as transferToAccountId
}
```

### 5. `upsertEvent`

Create or update a one-time financial event. Pass `id` to update; omit to create.

```typescript
upsertEvent(params: {
  id?: string;
  name: string;
  year: number;
  accountId: string;
  delta: 'credit' | 'debit';
  amount: number;
  // optional: if this is a transfer between accounts (not external money)
  counterpartAccountId?: string;
}): { eventId: string }
```

### 6. `manageScenario`

All scenario operations in one tool, discriminated by `op`.

```typescript
manageScenario(params:
  | { op: 'create'; name: string; description?: string; cloneBaseline: boolean }
  | { op: 'activate'; scenarioId: string }
  | { op: 'override'; scenarioId: string; accountId: string; patch: Partial<AccountInput> }
  | { op: 'delete'; scenarioId: string }
): {
  scenarioId?: string;
  ok: boolean;
}
```

---

## What Lives in Skills (not tools)

Skills are orchestration recipes that chain the 6 primitives. They encode Australian domain
knowledge so the LLM doesn't have to figure it out from scratch each time.

### Example skill: `setup-salary`

```
1. call getState() — find or confirm the target asset account (e.g. bank/cash)
2. call upsertAccount() with:
     type: 'income'
     incomeTaxTreatment: 'assessable'
     depositsToAccountId: <bank-account-id>
     incomeSubType: 'salary'
     ... name, amount, growth from user input
3. call runForecast() — verify no ledgerError or conservationViolation warnings
4. report back: "Added salary of $X/yr, depositing to <account>"
```

### Example skill: `setup-employer-sg`

```
1. call getState() — identify salary account id and super account id
2. call upsertAccount() with:
     type: 'income'
     basedOnAccountId: <salary-id>
     basedOnPercentage: 0.115  (or user-specified rate)
     superContributionConfig: {
       targetAccountId: <super-id>,
       contributionType: 'concessional'
     }
3. call runForecast() — verify SG flows correctly, no cap warnings
4. report back: contributions figure and remaining cap
```

### Example skill: `setup-pension-drawdown`

```
1. call getState() — identify allocated pension account id and cash account id
2. call upsertAccount() with:
     type: 'income'
     name: 'Pension Income'
     drawnFromAccountId: <ap-account-id>   ← triggers internalTransfer in ledger
     depositsToAccountId: <cash-account-id>
     incomeTaxTreatment: 'taxFree'         ← pension phase income
     amount: <annual drawdown amount>
3. call runForecast() — verify no conservationViolation (both sides of transfer balanced)
4. report back: drawdown amount, pension account depletion year if any
```

### Example skill: `model-early-retirement`

```
1. call getState()
2. call manageScenario({ op: 'create', name: 'Early Retirement', cloneBaseline: true })
3. call manageScenario({ op: 'activate', scenarioId: <new-id> })
4. find the salary account; call upsertAccount() with updated endsAt
5. call runForecast() on new scenario — check depletionYear
6. report difference: "Net worth at 99 drops from $X to $Y; funds last until <year>"
```

---

## Open Design Questions

These are not resolved yet — record them here until the feature set is settled.

| # | Question | Options | Notes |
|---|----------|---------|-------|
| 1 | **Confirmation model** | ✅ Decided: Option B — optimistic writes + turn-level undo snapshot | See full discussion below |
| 2 | **Person configuration** | ✅ Decided: separate `setPerson` tool (tool 7) | Birth year, retirement year, preservation age, tax funding account — natural sentences users will say; needs a clean home for multi-person future |
| 3 | **Assumptions tool** | ✅ Decided: separate `setAssumptions` tool (tool 8); writes to active scenario | CPI and growth rate overrides per year range; activate scenario first, then call `setAssumptions` |
| 4 | **Context strategy** | ✅ Decided: compact summary prepended to each user message; system prompt static only | See full discussion below |
| 5 | **Error recovery in skills** | ✅ Decided: one auto-fix attempt if cause is unambiguous; escalate to user if auto-fix fails; never auto-undo without user consent | See rationale below |
| 6 | **Batch mutations** | ✅ Decided: one at a time — clean error attribution over marginal efficiency gain; optimise later if needed | |

---

## Confirmation Model (Decided: Option B)

This is the most consequential architectural decision. It determines whether the tools write
directly to live state or to a staging layer, and whether the user is in the loop before or
after mutations happen.

### Option A — Staged: LLM proposes, user approves before commit

The LLM assembles a plan and writes to a **pending / staging store** that is separate from
live state. Nothing changes in the actual data until the user explicitly approves.

**How the tools would be wired:**

- `upsertAccount`, `deleteAccount`, `upsertEvent` write to a `pendingChanges` map, not to
  IndexedDB or the Zustand store that drives the spreadsheet.
- `getState()` reads live state only (so the LLM sees the unchanged baseline while planning).
- `runForecast()` must accept an optional `preview: pendingChanges` parameter so it can
  show the user what the numbers would look like after approval, without committing.
- A `commitPending()` / `discardPending()` action (triggered by the user, not the LLM) applies
  or rolls back the staged changes atomically.
- The UI shows pending changes with a visual indicator ("proposed") alongside current values.

**Pros:**
- Safest for the user — no accidental data loss from a misunderstood instruction.
- The LLM can produce a full plan (multiple mutations) and show it as a coherent diff before
  anything takes effect.
- Naturally atomic: the whole plan is committed or discarded as one unit.

**Cons:**
- Requires a staging layer that does not currently exist in the app (new Zustand slice or
  parallel IndexedDB collection).
- `runForecast()` needs to be able to run against non-live state — either by merging the
  pending changes in-memory or by duplicating the forecast engine call.
- Skill prompts must track which actions are "proposed" vs "live", which adds complexity.
- Two-pass UX: user sees the plan, then approves — adds a click but feels deliberate.

---

### Option B — Optimistic: LLM writes live, shows summary diff at end ✅ Recommended

The LLM writes directly to live state (IndexedDB / Zustand) as it goes, exactly as the
manual UI does today. At the end of the skill, it reports a human-readable summary of what
changed. The user can undo the whole conversation turn via a single rollback action.

**How the tools would be wired:**

- `upsertAccount`, `deleteAccount`, `upsertEvent` write directly to the existing Zustand
  store (same code path as the account editor). No staging layer needed.
- `getState()` always reads live state — consistent with what the manual UI shows.
- `runForecast()` always runs against live state — no special preview mode needed.
- Each LLM turn that makes mutations is bracketed by a **turn snapshot**: before the first
  tool call, the current state is snapshot-ed; after the last tool call, a diff is generated
  and shown to the user with an "Undo this turn" button.
- The undo action restores from the snapshot (replacing IndexedDB records for all changed
  accounts/events).

**Pros:**
- No new staging infrastructure — tools reuse the existing mutation path.
- `runForecast()` is always accurate (it always runs against what is actually stored).
- Skills are simpler: they just call tools and read results; no "am I in pending mode?" logic.
- The user sees the spreadsheet update in real time as the LLM works through a multi-step
  skill — immediate visual feedback.

**Cons:**
- Intermediate states are briefly visible in the UI (e.g., salary added but SG not yet wired).
  This can look odd for 1–2 seconds during a multi-step skill.
- Undo is coarse-grained: the whole turn is undone, not individual mutations.
- If the LLM crashes mid-turn (e.g., network timeout after step 2 of 4), partial state is
  left in IndexedDB. The turn snapshot allows full recovery but it needs to be stored
  reliably.

**Snapshot / undo mechanics:**

```
Turn starts
  → snapshot current state (all accounts + events) → store in sessionStorage or IndexedDB
LLM tool calls execute (write to live state)
  → user sees spreadsheet updating
Turn ends
  → LLM emits summary: "Added salary $120k, wired SG at 11.5% to Super. Forecast shows
    depletion at 2058. Undo this?"
User approves silently or clicks Undo
  → Undo restores from snapshot
```

---

### Option C — Direct: LLM writes live, no undo

Same as Option B but without the snapshot/undo mechanism. The LLM mutates live state and
simply reports what it did.

**Wiring:** Identical to Option B minus the snapshot logic.

**Pros:** Simplest implementation — zero new infrastructure.

**Cons:** No safety net. A misunderstood instruction ("remove the old salary account") is
irreversible. Not appropriate for a tool that manages someone's retirement numbers.

---

### Comparison

| | A — Staged | B — Optimistic + undo | C — Direct |
|---|---|---|---|
| New infrastructure needed | Staging store + preview forecast | Turn snapshot + restore | None |
| Tools write to | Pending store | Live state | Live state |
| `runForecast` runs against | Pending state (needs preview param) | Live state | Live state |
| User sees changes | Only after approval | In real time | In real time |
| Undo granularity | Per plan (atomic) | Per turn (coarse) | None |
| Partial failure recovery | Discard pending | Restore from snapshot | Manual |
| Skill complexity | Higher (must track pending vs live) | Low | Low |
| Implementation effort | High | Medium | Low |

**Recommendation:** Option B. It reuses the existing mutation path with minimal new
infrastructure (snapshot store only), gives the user real-time feedback as the LLM works,
and provides a meaningful undo safety net without requiring a full staging architecture.
The coarse undo granularity is acceptable because skills are designed to be short (2–4
mutations) and self-contained.

---

## Deferred: `setAssumptions` (candidate tool 7)

Setting CPI and growth overrides per year range is frequent enough to warrant a dedicated
tool rather than routing through `manageScenario`. Defer until we know how assumptions feed
into scenario overrides.

```typescript
// Candidate — not committed
setAssumptions(params: {
  cpi?: number;
  defaultGrowthRate?: number;
  overrides?: Array<{
    assumption: 'cpi' | 'growth';
    years: { from: number; to: number } | { year: number };
    value: number;
  }>;
}): { ok: boolean }
```

---

## Context Strategy (Decided)

### What goes where

| Location | Content | Changes per turn? | Cached? |
|---|---|---|---|
| System prompt | AU rules, tool descriptions, skill recipes, behavioural instructions | Never | ✅ Yes — full cache hit every turn |
| Prepended to user message | Compact state summary (accounts, persons, warnings) | Yes — regenerated fresh at send time | No — expected to change |
| Conversation history | Raw turns verbatim (last N) + masked placeholders for older turns | Grows each turn | No |

### Compact state summary format

Injected at the top of each user message, generated from live Zustand state at send time.
Kept to ~80–120 tokens so it doesn't dominate short conversational turns.

```
[Persons: Alice (born 1970, retiring 2032, preservation age 60)]
[Accounts: Salary $120k · Super $380k · Cash $45k · Living Expenses $65k]
[Active scenario: Base Case | Warnings: none]
```

### Why system prompt stays static

Prompt caching hashes a prefix. Injecting state into the system prompt means the hash
changes whenever any account changes — busting the cache on every turn. Keeping the system
prompt static (rules + instructions only) means it cache-hits on every single turn, giving
50–90% cost reduction on those tokens. State belongs in the user message turn where it is
expected to change.

### History masking

Older turns that contain state summaries are masked (the summary line replaced with
`[state snapshot — superseded]`) rather than accumulated. This prevents the context window
filling with N stale copies of the account list over a long session. Masking does not affect
the system prompt cache since the system prompt is never modified.

### Query type mapping

| Query type | Context needed | Tool calls needed |
|---|---|---|
| Conversational ("explain CGT") | Compact summary sufficient | None |
| Admin ("add a salary account") | Compact summary for orientation; `getState()` for IDs before mutating | `getState()` → `upsertAccount()` → `runForecast()` |
| Specific scenario ("sell house in 2030 not 2040") | Compact summary to confirm correct account; `getState()` for ID | `getState()` → `upsertAccount()` → `runForecast()` |
| General scenario ("model a market downturn") | Compact summary to ask intelligent follow-up questions; `getState()` when ready to act | Optional web search → `getState()` → `manageScenario()` → `setAssumptions()` → `runForecast()` |

---

## Error Recovery in Skills (Decided)

When a skill mutates state and then calls `runForecast()`, warnings in the result are
treated as follows:

### `conservationViolation`

The most diagnosable warning — almost always means one side of a transfer pair was not
emitted. The skill should:

1. **Attempt one auto-fix** if the cause is unambiguous. For example, if a pension income
   account was created without `drawnFromAccountId`, the skill knows to add it and
   re-call `upsertAccount()`, then re-run `runForecast()`.
2. **Escalate to the user** if the auto-fix also fails or the cause is ambiguous. Explain
   what was done, what the warning means in plain terms, and ask the one clarifying question
   needed to resolve it. Example:
   > "I added the pension income account but the forecast shows a transaction integrity
   > warning — the pension balance isn't decreasing when income is drawn. Which account
   > should the drawdown come from?"
3. **Never auto-undo** without user consent. Partial state may still be useful. The user
   sees the undo option in the turn summary and decides.

### `ledgerError`

Means a referenced account ID does not exist. The skill should escalate immediately —
this requires a clarifying question (which account did you mean?). No auto-fix attempt.

### `negativeBalance` / `capExceeded`

Informational warnings that don't indicate a broken model — just a consequence of the
user's configuration. The skill should surface them in its report but not treat them as
errors requiring recovery.

### `blockedContribution`

Escalate to user — indicates a rule constraint the skill cannot resolve alone (e.g.
contribution cap exceeded, preservation age not met).

---

## Coverage Map

| Feature area | Covered by |
|---|---|
| Account CRUD | `upsertAccount`, `deleteAccount` |
| Tax treatment, growth profile, lifecycle | `upsertAccount` fields (existing `AccountInput`) |
| One-time events | `upsertEvent` |
| Employer SG | `upsertAccount` + `setup-employer-sg` skill |
| Pension drawdown | `upsertAccount` + `setup-pension-drawdown` skill |
| Scenarios (create/override/activate) | `manageScenario` |
| Forecast read + verification | `runForecast` |
| State read | `getState` |
| Persons / forecast config | ⚠️ Open question #2 |
| Assumptions (CPI, growth overrides) | ⚠️ Deferred (`setAssumptions` candidate) |
| Salary setup | `upsertAccount` + `setup-salary` skill |
| Early retirement modelling | `manageScenario` + `model-early-retirement` skill |
