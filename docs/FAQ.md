# Frequently Asked Questions

## Liabilities & Loans

### How do I set up a loan linked to an asset sale?

When you have a loan (like a car loan or investment property mortgage) that should be paid off when the associated asset is sold, you can link them together. Here's how:

#### Step 1: Create the Asset

1. Add an asset account (e.g., "Investment Property" or "Car")
2. Set the initial value (current market value)
3. Configure the growth rate
4. Set an **End Condition** (year or age when you plan to sell)
5. Set **End Behavior** to:
   - `Sell` - triggers CGT calculation on the gain
   - `Sell (No CGT)` - for assets exempt from CGT (e.g., personal use items, main residence)
6. Set **Transfer To** to the account that should receive the sale proceeds (usually your bank account)

#### Step 2: Create the Liability

1. Add a liability account (e.g., "Car Loan" or "Investment Property Mortgage")
2. Set the initial value (current loan balance)
3. Configure the **Interest Rate** (e.g., 6.5% as 6.5)
4. Set **Payment Type**:
   - `Principal & Interest` - regular amortizing loan
   - `Interest Only` - interest payments only, principal unchanged
5. Set **Payments From** to your bank account (where regular payments come from)
6. Set **Pay Off When Asset Sells** to the linked asset (e.g., "Investment Property")

#### How it works

When the forecast reaches the year the asset is sold:

1. **Asset sells** - The full sale proceeds are deposited into the destination account (e.g., bank)
2. **Loan is paid off** - A withdrawal is made from the loan's funding account to pay off the remaining balance
3. **Liability zeroes out** - The loan balance becomes $0

Both transactions appear as separate line items in the account analysis:
- Bank receives: `+$500,000` (contribution from property sale)
- Bank pays out: `-$200,000` (withdrawal to pay off mortgage)
- Net effect: `+$300,000`

This approach keeps the transactions explicit and auditable, rather than just showing a netted amount.

#### Example: Investment Property with Mortgage

| Account | Type | Initial Value | Settings |
|---------|------|---------------|----------|
| Bank Account | Asset | $50,000 | - |
| Investment Property | Asset | $800,000 | End: 2030, Behavior: Sell, Transfer To: Bank |
| Property Mortgage | Liability | $400,000 | Interest: 6%, P&I, Funded By: Bank, Payoff From: Investment Property |

In 2030:
- Property sells for $800,000 (after growth) → Bank receives $800,000
- Mortgage balance is $350,000 (after payments) → Bank pays $350,000 to clear loan
- Net cash to bank: $450,000
- CGT applies on the capital gain (sale price - cost base)

#### Example: Car Loan (No CGT)

| Account | Type | Initial Value | Settings |
|---------|------|---------------|----------|
| Bank Account | Asset | $20,000 | - |
| Car | Asset | $35,000 | End: 2027, Behavior: Sell (No CGT), Transfer To: Bank |
| Car Loan | Liability | $25,000 | Interest: 8%, P&I, Funded By: Bank, Payoff From: Car |

In 2027:
- Car sells for $28,000 (after depreciation) → Bank receives $28,000
- Loan balance is $10,000 → Bank pays $10,000 to clear loan
- Net cash to bank: $18,000
- No CGT applies (personal use asset)

---

## Offset Accounts

### How do offset accounts work with loans?

An offset account reduces the interest charged on a loan by offsetting the loan balance with the account balance.

1. Create an asset account for the offset (e.g., "Offset Account")
2. On the liability, set **Offset Account** to this asset
3. Interest is calculated on: `Loan Balance - Offset Balance`

Example: $500,000 mortgage with $100,000 in offset = interest charged on $400,000.

---

## Net Worth

### Why doesn't my loan affect the Net Worth chart?

Ensure the liability account is included in net worth calculations:
- Check that `Include in Net Worth` is enabled (default is true)
- Verify the account type is set to `Liability`

Net Worth = Total Assets - Total Liabilities

Both values are shown in the Calculated Totals section of the spreadsheet view.
