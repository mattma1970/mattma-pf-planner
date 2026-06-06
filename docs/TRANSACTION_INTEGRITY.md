# Transaction Integrity

## History

### V1 Problem: Silent failures

The original forecast engine calculated financial flows by directly mutating a shared
`accountResults` map. Two silent failure modes existed:

1. **Missing destination account** — if `depositsToAccountId` or `fundedByAccountId`
   referenced a non-existent account ID, the flow was silently skipped. Money was drawn
   from a source but deposited nowhere.

2. **Half-transfers** — pension drawdown was modelled as external income (one credit to
   cash) rather than an internal transfer. The pension balance never decreased.

### V1 Fix: Classified Ledger

A `LedgerEntry` type with a `kind` field (`externalIn`, `externalOut`, `synthetic`,
`internalTransfer`) was introduced. `checkConservation()` verified that `internalTransfer`
entries netted to zero after each year.

**V1 limitation:** the conservation check was post-hoc. A developer could still write
`result.endValue += 5000` directly and the check would never see it. Conservation was
caught after the fact on `internalTransfer` entries only — `externalIn`, `externalOut`,
and `synthetic` had no matching counterpart requirement.

---

## V2 Design: Two-Sided Journal Entries

### Core Principle

Every mutation to an account balance is expressed as a **two-sided journal entry** — a
debit account and a credit account, both required. It is structurally impossible to emit
a one-sided entry. Conservation is enforced at the call site, not checked after the fact.

For transactions involving the outside world (salary, tax, growth), the counterpart is a
reserved system account: `__equity__`. The equity account is never shown to users — it
exists solely to satisfy the two-sided requirement and to track net worth as a running
balance.

### The `__equity__` Account

The equity account is a fictional account that absorbs all external flows:

- Money entering the model from outside (salary, employer SG) → credit equity
- Money leaving the model to outside (tax, expenses) → debit equity
- Value created inside the model (asset growth) → credit equity
- Internal transfers between two real accounts → equity not involved

The equity account balance at year end equals the change in net worth for that year.
This is the same formula as the V1 wealth drift check — but now it holds by construction
rather than being computed and compared.

### `emitJournalEntry` Signature

```typescript
type JournalEntry = {
  seq: number;              // sequence within the forecast run
  year: number;
  userId: string;           // for multi-user audit trails
  timestamp: string;        // ISO 8601, when entry was emitted
  debitAccountId: string;
  debitAccountName: string;
  creditAccountId: string;
  creditAccountName: string;
  amount: number;
  label: string;
  kind?: FlowKind;          // optional metadata for engine interpretation
};

function emitJournalEntry(params: {
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  label: string;
  kind?: FlowKind;
}): void
```

`FlowKind` is retained as optional metadata. The engine uses it to interpret entries
(e.g. identify salary sacrifice contributions for cap tracking) but it no longer does
integrity work — the two-sided structure handles that.

### How Every Flow Maps to Journal Entries

| Flow | Debit | Credit | Notes |
|---|---|---|---|
| Salary to bank | `bank` | `__equity__` | External income |
| Employer SG to super | `super` | `__equity__` | External income, direct to super |
| Salary sacrifice (step 1: full salary) | `bank` | `__equity__` | Full package amount |
| Salary sacrifice (step 2: route sacrifice) | `super` | `bank` | Internal transfer to super |
| Pension drawdown (AP → cash) | `cash` | `pension` | Internal transfer, both real accounts |
| Living expenses | `__equity__` | `bank` | Money leaves model |
| Tax payment to ATO | `__equity__` | `funding-account` | Money leaves model |
| Asset appreciation | `asset` | `__equity__` | Synthetic value creation |
| Employer SG contributions tax (15%) | `__equity__` | `super` | Reduces super, leaves model |
| Division 293 tax | `__equity__` | `funding-account` | Additional tax to ATO |
| Lifecycle transfer (super → pension) | `pension` | `super` | Internal transfer |
| Liability principal payment | `liability` | `bank` | Reduces debt and cash equally |
| Liability interest payment | `__equity__` | `bank` | Interest leaves model to lender |
| Auto top-up | `target` | `source` | Internal transfer |

### Salary Sacrifice Example

The journal entry function has no opinion on Australian tax rules — it just records
movements. The engine applies rules separately:

```
1. Dr bank      +$120,000  /  Cr __equity__  +$120,000   label: 'salary'
2. Dr super     +$10,000   /  Cr bank        -$10,000    label: 'salary sacrifice'
3. Dr super     +$13,800   /  Cr __equity__  +$13,800    label: 'employer SG'
4. Dr __equity__ -$3,570   /  Cr super       -$3,570     label: 'contributions tax'
5. Dr __equity__ -$22,000  /  Cr bank        -$22,000    label: 'income tax'
```

Net: bank +$88k, super +$20,230, equity +$108,230. The engine knows from entry 2's label
that $10k reduces assessable income; the journal entry itself does not encode that rule.

---

## Enforcement: Account Results Are Immutable

### Module Encapsulation

The mutable account results store lives entirely inside `ledger.ts` and is never exported.
External code — including the forecast engine — receives only a read-only view:

```typescript
// ledger.ts — internal only, never exported
type MutableResult = { endValue: number; contributions: number; withdrawals: number; /* ... */ }
const _store = new Map<string, MutableResult>();

// Exported read-only view — what the rest of the app sees
export type AccountYearResult = Readonly<MutableResult>;
export function getResults(): ReadonlyMap<string, AccountYearResult> { return _store; }

// The only mutation path
export function emitJournalEntry(params: { ... }): void {
  const debit = _store.get(params.debitAccountId);
  const credit = _store.get(params.creditAccountId);
  debit.endValue  -= params.amount;
  credit.endValue += params.amount;
  // ... update contributions/withdrawals/transfers fields
  _journal.push({ seq: _seq++, year: _currentYear, userId: _userId, timestamp: new Date().toISOString(), ... });
}
```

### TypeScript `readonly` (compile-time)

`AccountYearResult` uses `readonly` on all balance fields. Any code outside `ledger.ts`
that attempts `result.endValue += 5000` is a compile error.

### `Object.freeze` (runtime, optional)

The objects returned by `getResults()` can be frozen to add a runtime layer on top of
the compile-time check. Any attempted mutation throws a `TypeError` immediately.

### What This Prevents

| Before V2 | After V2 |
|---|---|
| `result.endValue += 5000` silently mutates | Compile error — `endValue` is `readonly` |
| Direct map write bypasses conservation check | Map is private — no external reference |
| One-sided `emitLedgerEntry` call | Impossible — function requires both account IDs |
| Growth applied outside ledger | Growth must go through `emitJournalEntry` |

---

## Audit Log

Every call to `emitJournalEntry` appends one record to an append-only journal. The
complete journal for a forecast run is included in `ForecastResult`:

```
seq  year  userId  timestamp             debit        credit       amount    label
1    2025  u-123   2026-01-15T09:23:41Z  bank         __equity__   120,000   salary
2    2025  u-123   2026-01-15T09:23:41Z  super        bank         10,000    salary sacrifice
3    2025  u-123   2026-01-15T09:23:41Z  super        __equity__   13,800    employer SG
4    2025  u-123   2026-01-15T09:23:41Z  __equity__   super        3,570     contributions tax
5    2025  u-123   2026-01-15T09:23:41Z  __equity__   bank         22,000    income tax
6    2025  u-123   2026-01-15T09:23:41Z  __equity__   bank         65,000    living expenses
7    2025  u-123   2026-01-15T09:23:41Z  house        __equity__   45,000    house appreciation
```

From this log alone you can:
- Reconstruct any account's balance at any point in the forecast
- Filter to a specific account to see every movement that touched it
- Assert `sum(all debit amounts) == sum(all credit amounts)` — always true by construction
- Diff journals across code changes to detect silent engine behaviour changes in tests
- Export to a spreadsheet for a financial adviser or accountant

The journal is held in memory per forecast run. It does not need to be persisted to
IndexedDB for debugging purposes, but can be if historical audit trails across sessions
are required.

---

## Conservation Check

With V2, the conservation invariant is trivially true by construction:

```
sum(all debit amounts) == sum(all credit amounts)
```

`checkConservation()` becomes a sanity assertion rather than a real check — if it ever
fails, something other than `emitJournalEntry` modified a balance. This is a bug detector,
not a routine check.

The equity account balance at year end provides the wealth drift figure:

```
__equity__.endValue == Δ(net worth for the year)
```

This is now exact, not "best-effort" as in V1, because all flows including asset growth
pass through the journal.

---

## Adding a New Transaction Type

1. Identify both sides: which account is debited and which is credited.
2. If money comes from or goes to the outside world, the other side is `__equity__`.
3. If money moves between two model accounts, both sides are real account IDs.
4. Call `emitJournalEntry({ debitAccountId, creditAccountId, amount, label, kind? })`.
5. Add the `kind` metadata if the engine needs to interpret this entry for tax or cap
   tracking purposes.
6. Run `npx vitest` — the journal diff test will catch any unexpected changes to the
   entry sequence for existing scenarios.

---

## Migration from V1

| V1 | V2 |
|---|---|
| `emitLedgerEntry({ accountId, delta: 'credit', ... })` | `emitJournalEntry({ debitAccountId: '__equity__', creditAccountId: accountId, ... })` for externalIn |
| `emitLedgerEntry({ accountId, delta: 'debit', ... })` | `emitJournalEntry({ debitAccountId: accountId, creditAccountId: '__equity__', ... })` for externalOut |
| `internalTransfer` pair (two `emitLedgerEntry` calls) | Single `emitJournalEntry({ debitAccountId, creditAccountId, ... })` |
| `result.growth = startValue * rate` (direct mutation) | `emitJournalEntry({ debit: accountId, credit: '__equity__', amount: growthAmount, label: 'appreciation' })` |
| `checkConservation()` — post-hoc verification | Sanity assertion only — conservation holds by construction |

---

## File Layout

```
src/engine/ledger.ts          — JournalEntry type, emitJournalEntry, getResults, checkConservation
src/engine/forecast.ts        — consumes the journal in all phases
src/schemas/account.ts        — drawnFromAccountId field (retained from V1)
src/schemas/forecast.ts       — ForecastWarning type; ForecastResult includes journal[]
```
