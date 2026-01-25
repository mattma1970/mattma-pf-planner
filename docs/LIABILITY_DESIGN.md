# Liability Design

**Version:** 0.1  
**Last Updated:** 2026-01-26  
**Status:** Draft

---

## Overview

Liabilities represent debts that accrue interest and require regular payments. This document outlines how liabilities are modeled in the forecast engine.

---

## Liability Properties

| Field | Type | Description |
|-------|------|-------------|
| `interestRate` | number | Annual interest rate as percentage (e.g., 6.5 for 6.5%) |
| `paymentType` | enum | How payments are structured |
| `annualPayment` | number | Fixed annual payment amount (if applicable) |
| `calculatePayment` | boolean | Auto-calculate payment to pay off by end date |
| `fundedByAccountId` | uuid | Asset account payments are drawn from |
| `offsetAccountId` | uuid? | Optional asset account that offsets interest calculation |
| `payoffFromAccountId` | uuid? | Pay off remaining balance when this account sells |

---

## Payment Types

### Principal & Interest (P&I)
- Fixed annual payment covers interest + principal reduction
- Balance reduces each year until paid off
- User can specify fixed payment OR have it auto-calculated

### Interest Only
- Payment covers interest only, principal unchanged
- Useful for investment loans or temporary periods
- Balance remains constant until refinanced/sold

### Income Contingent (HECS/HELP style)
- Modeled as a simple debt with 0% interest
- User estimates annual repayment as fixed amount
- Balance reduces by payment amount each year

---

## Calculation Logic

### Per-Year Processing

```
1. Opening balance = previous year's closing balance
2. Calculate effective balance = balance - offset account balance (if any)
3. Interest accrued = effective balance × (interestRate / 100)
4. Payment made = annualPayment (or calculated amount)
5. If P&I: principal reduction = payment - interest accrued
6. If Interest Only: principal reduction = 0
7. Closing balance = opening balance + interest accrued - principal reduction
8. Withdraw payment amount from fundedByAccount
```

### Auto-Calculate Payment

When `calculatePayment` is true, use the amortization formula:

```
P = (r × PV) / (1 - (1 + r)^-n)

Where:
- P = annual payment
- r = annual interest rate (decimal)
- PV = current balance
- n = years remaining until end condition
```

---

## Offset Account Behavior

When `offsetAccountId` is set:
- Interest is calculated on `max(0, liability balance - offset balance)`
- The offset account balance is NOT reduced
- The offset account can still earn its own growth/returns
- Common use: Transaction/savings account offsets mortgage

**Example:**
- Mortgage balance: $400,000
- Offset account balance: $50,000
- Interest charged on: $350,000

---

## Payoff from Asset Sale

When `payoffFromAccountId` is set:
- When the linked asset sells (endBehavior: 'sell'), liability is paid off
- Sale proceeds are reduced by the remaining liability balance
- Common use: Selling investment property pays off the property loan

**Example:**
- Investment property sells for $800,000
- Property loan balance: $300,000
- Net proceeds to transfer account: $500,000

---

## UI Changes Required

### Liability Form Fields

```
┌─────────────────────────────────────────────────────┐
│ Liability Details                                    │
├─────────────────────────────────────────────────────┤
│ Name: [___________________]                          │
│ Initial Balance: [___________]                       │
│                                                      │
│ Interest Rate (%): [____]                            │
│                                                      │
│ Payment Type: [Principal & Interest ▼]               │
│   ○ Fixed Payment: $[________] per year             │
│   ○ Calculate payment to pay off by end date        │
│                                                      │
│ Payments From: [Bank Account ▼]                      │
│ Offset Account: [Savings Account ▼] (optional)       │
│                                                      │
│ ─── End Condition ───                                │
│ End When: [Age ▼] [65] for [Person ▼]               │
│ End Behavior: [Pay off ▼]                            │
│ Pay Off From: [Property Sale ▼] (if selling asset)   │
└─────────────────────────────────────────────────────┘
```

---

## Schema Changes

```typescript
// Additions to AccountSchema for type: 'liability'
interestRate: z.number().optional(),
paymentType: z.enum(['principalAndInterest', 'interestOnly']).optional(),
annualPayment: z.number().optional(),
calculatePayment: z.boolean().optional(),
offsetAccountId: z.string().uuid().optional(),
payoffFromAccountId: z.string().uuid().optional(),
```

---

## Account Analysis Display

For liabilities, the Account Analysis section shows:
- Opening Balance
- \+ Interest Accrued
- − Payment Made
- − Principal Reduction (for P&I)
- = Closing Balance

---

## Edge Cases

1. **Payment exceeds balance**: Final payment is capped at remaining balance
2. **Offset > Liability**: Effective balance is 0, no interest charged
3. **No end condition**: Liability continues indefinitely (interest-only common)
4. **Payoff account sells before liability end**: Liability paid off early
5. **Insufficient funds in payment account**: Allow negative balance (warn user)

---

## Examples

### Standard Mortgage
- Balance: $500,000
- Interest: 6%
- Payment type: P&I, auto-calculate
- End: Age 65
- Payments from: Bank Account
- Offset: Savings Account

### Investment Property Loan  
- Balance: $400,000
- Interest: 6.5%
- Payment type: Interest Only
- End: Year 2035 (when property sells)
- Payoff from: Investment Property

### HECS/HELP Debt
- Balance: $45,000
- Interest: 0%
- Payment type: P&I, fixed $5,000/year
- End: When balance reaches 0
- Payments from: Bank Account

---

## Implementation Tasks

1. [ ] Add liability-specific fields to AccountSchema
2. [ ] Update AccountForm UI for liability fields
3. [ ] Update forecast engine to handle liability interest/payments
4. [ ] Add offset account logic to interest calculation
5. [ ] Add payoff logic when linked asset sells
6. [ ] Add liability rows to Account Analysis section
7. [ ] Write tests for liability calculations
