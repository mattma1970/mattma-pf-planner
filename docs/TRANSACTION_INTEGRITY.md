# Transaction Integrity

## The Problem

The forecast engine calculates financial flows by processing accounts in phases and writing
derived amounts into a shared `accountResults` map. Before this design, two silent failure
modes existed:

1. **Missing destination account** — if `depositsToAccountId` or `fundedByAccountId`
   referenced a non-existent account ID, the flow was silently skipped. Money was drawn
   from a source but deposited nowhere, or an expense was never funded.

2. **Half-transfers** — pension drawdown was modelled as external income (one credit to
   cash) rather than an internal transfer (debit pension account, credit cash). The pension
   balance never decreased.

Both produced results that looked plausible but were wrong.

## The Fix: Classified Ledger

Every financial movement is expressed as a `LedgerEntry` with a `kind` field:

```typescript
type FlowKind =
  | 'externalIn'      // money enters the model from the real world (salary, employer SG)
  | 'externalOut'     // money leaves the model (expenses, tax payments to ATO)
  | 'synthetic'       // value created inside the model (investment growth, returns)
  | 'internalTransfer'; // moves between two accounts — must be emitted in matched pairs
```

The invariant: **`internalTransfer` entries must sum to zero** (every debit has a
matching credit of equal amount). Any other result means one side of a transfer was
emitted without its counterpart.

## How Every Flow Is Classified

| Flow | Kind | Notes |
|---|---|---|
| Salary deposited to bank | `externalIn` credit to bank | Employer pays into the model |
| Employer SG to super | `externalIn` credit to super | Employer's money, not from another model account |
| Pension drawdown (AP → cash) | `internalTransfer` debit AP + credit cash | Both sides required |
| Living expenses from bank | `externalOut` debit from bank | Money leaves to real world |
| Tax payment to ATO | `externalOut` debit from funding account | |
| Asset price appreciation | `synthetic` (implicit in `result.growth`) | Not a ledger entry; captured via account processing |
| Investment return → income account | `synthetic` credit to income account | Return created by market |
| Asset purchased from bank | `internalTransfer` debit from bank | Asset credit implicit in account processing |
| Lifecycle transfer (super → pension account) | `internalTransfer` | Handled via `lifecycleFlows` |
| Liability principal payment | `internalTransfer` debit from bank | Reduces debt = NW-neutral |
| Liability interest payment | `externalOut` debit from bank | Interest leaves model to lender |
| Auto top-up (bank → emergency fund) | `internalTransfer` debit + credit | Both sides explicit |
| Super contributions tax (15%) | `externalOut` debit from super | Goes to ATO |
| Division 293 tax | `externalOut` debit from funding account | |

## The Pension Drawdown Fix

Pension drawdown from an allocated pension account must be modelled as an
`internalTransfer`, not external income. To enable this, set `drawnFromAccountId`
on the income account representing the drawdown:

```typescript
// Account schema (income type, represents AP drawdown)
{
  type: 'income',
  name: 'Pension Income',
  depositsToAccountId: '<cash-account-id>',
  drawnFromAccountId: '<allocated-pension-account-id>',  // ← new field
  incomeTaxTreatment: 'taxFree',
}
```

The engine then emits:
```
internalTransfer debit  $X  from allocated-pension-account
internalTransfer credit $X  to   cash-account
```

Both sides balance. The pension account balance decreases correctly.

Without `drawnFromAccountId`, the income account emits `externalIn` to the cash
account — correct for salary, but wrong for drawdowns. A `conservationViolation`
warning is raised if the transfer pair is unbalanced.

## Conservation Invariant

After all phases complete for a given year, `checkConservation()` verifies:

**Transfer balance** (fully reliable):
```
Σ(internalTransfer credits) - Σ(internalTransfer debits) == 0  ±$1
```

**Wealth drift** (best-effort, informational):
```
Δ(net wealth) == assetGrowth + externalIn - externalOut + synthetic  ±$1
```

Where `assetGrowth` is taken from account result `.growth` fields (price appreciation
already baked into `endValue`), and the other terms are summed from classified ledger
entries.

Known limitation: income accounts that receive synthetic investment returns and also
deposit to bank via `externalIn` are counted twice in the wealth drift formula. The
drift check is therefore informational only until investment-return routing is
refactored to use `internalTransfer` for the income-account→bank leg.

## Adding a New Transaction Type

1. Identify which `FlowKind` applies to each leg of the transaction.
2. Call `emitLedgerEntry()` (for immediate application in phases 6–8) or push to
   `deferredLedgerEntries` (for deferred application after the phase-4/5 account loop).
3. For `internalTransfer`: always emit BOTH the debit and the credit entry. The
   conservation check will catch missing pairs automatically.
4. Run `npx vitest` — the conservation check runs inside the forecast engine on every
   year and emits `conservationViolation` warnings if any invariant breaks.

## File Layout

```
src/engine/ledger.ts          — LedgerEntry type, emitLedgerEntry, checkConservation
src/engine/forecast.ts        — consumes the ledger in phases 5–8
src/schemas/account.ts        — drawnFromAccountId field
src/schemas/forecast.ts       — ForecastWarning type includes conservationViolation
```
