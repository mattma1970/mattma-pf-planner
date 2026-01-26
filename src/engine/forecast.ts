import { v4 as uuidv4 } from 'uuid';
import type {
  Account,
  Assumptions,
  Epoch,
  Event,
  Person,
  ResolvedAssumptions,
  ForecastResult,
  YearResult,
  AccountYearResult,
  Settings,
  TaxEvent,
  TaxAggregation,
  TaxSchedule,
  OffBalanceSheetItem,
} from '../schemas';
import { calculateIncomeTax, calculateCapitalGain, type CgtCalculationResult } from './tax';
import { resolveAssumptionForYear } from './assumptions';
import { isAccountActive, projectAccountValue, handleAccountTransfer, getAccountAcquisitionYear } from './accounts';
import {
  initializeCarryForwardStates,
  aggregateContributionsByPerson,
  processPersonContributions,
  createCarryForwardOffBalanceSheetItems,
  type CarryForwardState,
  type ContributionProcessingResult,
} from './superContributions';
import { calculateDiv293 } from './taxRules';

interface PendingCgtEvent {
  accountId: string;
  accountName: string;
  cgtResult: CgtCalculationResult;
  fundedFromAccountId: string;
  fundedFromAccountName: string;
}

export interface ForecastInput {
  accounts: Account[];
  assumptions: Assumptions;
  epochs: Epoch[];
  events: Event[];
  persons: Person[];
  settings: Settings;
  startYear: number;
  endYear: number;
}

/**
 * Transaction ordering per year:
 * 1. Carry opening balances (from previous year's closing)
 * 2. Account lifecycle moves (sell/transfer from endBehavior) - makes proceeds available
 * 3. User transfer events (explicit transfers between accounts)
 * 4. Apply growth (on balance after steps 1-3, skip if balance <= 0)
 * 5. Derived flows (income deposits, expense withdrawals, asset funding, tax)
 */
export function calculateForecast(input: ForecastInput): ForecastResult {
  const { accounts, assumptions, epochs, events, persons, settings, startYear, endYear } = input;
  
  const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);

  const years: YearResult[] = [];
  const accountValues: Map<string, number> = new Map();
  const accountStartYears: Map<string, number> = new Map();

  accounts.forEach((account) => {
    accountValues.set(account.id, account.initialValue);
  });

  let peakAssets = 0;
  let peakAssetsYear = startYear;
  
  // Initialize carry-forward state for super contributions
  let carryForwardStates = initializeCarryForwardStates(persons);

  for (let year = startYear; year <= endYear; year++) {
    const resolvedAssumptions = resolveAssumptions(assumptions, year, sortedEpochs);
    const yearAccounts: AccountYearResult[] = [];
    let totalIncome = 0;
    let totalExpenses = 0;

    const yearEvents = events.filter((e) => e.year === year);
    const pendingCgtEvents: PendingCgtEvent[] = [];
    const accountResults = new Map<string, AccountYearResult>();
    
    // Track per-account income for itemized tax events
    const incomeByAccount: { accountId: string; accountName: string; amount: number; fundedFromAccountId?: string }[] = [];

    // ===========================================
    // PHASE 1: Calculate opening balances and identify lifecycle transfers
    // ===========================================
    
    // First pass: determine which accounts are ending and their transfer amounts
    const lifecycleTransfers: { 
      sourceId: string; 
      destinationId: string; 
      amount: number;
      endBehavior: 'transfer' | 'sell';
      account: Account;
    }[] = [];

    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isFirstActiveYear = !accountStartYears.has(account.id) && isActive;
      
      if (isFirstActiveYear) {
        accountStartYears.set(account.id, year);
      }

      // Pass-through income accounts start from 0 each year (only show contributions)
      // Regular income accounts carry forward with growth
      // Other accounts carry forward their balance
      const openingValue = isFirstActiveYear
        ? account.initialValue
        : (account.type === 'income' && account.passThrough)
          ? 0
          : (accountValues.get(account.id) ?? account.initialValue);

      // Check if this account ends this year with a transfer/sell
      if (isActive) {
        const transfer = handleAccountTransfer(account, year, persons, openingValue);
        if (transfer.isTransferYear && transfer.destinationId && transfer.endBehavior) {
          lifecycleTransfers.push({
            sourceId: account.id,
            destinationId: transfer.destinationId,
            amount: transfer.amount,
            endBehavior: transfer.endBehavior,
            account,
          });
        }
      }
    }

    // ===========================================
    // PHASE 2: Apply lifecycle transfers (sell/transfer from endBehavior)
    // These happen FIRST so proceeds are available for user transfers
    // ===========================================
    
    const lifecycleFlows = new Map<string, number>(); // accountId -> net change from lifecycle events
    
    for (const transfer of lifecycleTransfers) {
      // Source account loses its value
      lifecycleFlows.set(
        transfer.sourceId,
        (lifecycleFlows.get(transfer.sourceId) ?? 0) - transfer.amount
      );
      
      // Destination account gains the value
      lifecycleFlows.set(
        transfer.destinationId,
        (lifecycleFlows.get(transfer.destinationId) ?? 0) + transfer.amount
      );

      // Handle CGT for sell behavior
      if (transfer.endBehavior === 'sell') {
        const account = transfer.account;
        const costBase = account.costBase ?? account.initialValue;
        const acquisitionYear = getAccountAcquisitionYear(account, persons);
        const eligibleForDiscount = account.eligibleForCgtDiscount ?? true;
        
        const cgtResult = calculateCapitalGain(
          transfer.amount,
          costBase,
          acquisitionYear,
          year,
          eligibleForDiscount
        );
        
        const fundingAccountId = account.taxFundedFromAccountId ?? settings.defaultTaxFundingAccountId ?? 'unassigned';
        const fundingAccount = accounts.find(a => a.id === fundingAccountId);
        
        pendingCgtEvents.push({
          accountId: account.id,
          accountName: account.name,
          cgtResult,
          fundedFromAccountId: fundingAccountId,
          fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
        });
        
        // Pay off any liabilities linked to this asset
        for (const liability of accounts) {
          if (liability.type === 'liability' && liability.payoffFromAccountId === account.id) {
            const liabilityBalance = accountValues.get(liability.id) ?? liability.initialValue;
            if (liabilityBalance > 0) {
              // Reduce the transfer proceeds by liability amount
              const payoffAmount = Math.min(liabilityBalance, transfer.amount);
              lifecycleFlows.set(
                transfer.destinationId,
                (lifecycleFlows.get(transfer.destinationId) ?? 0) - payoffAmount
              );
              // Mark liability as paid off
              lifecycleFlows.set(
                liability.id,
                (lifecycleFlows.get(liability.id) ?? 0) - liabilityBalance
              );
            }
          }
        }
      }
    }

    // ===========================================
    // PHASE 3: Apply user transfer events and super contributions
    // These happen AFTER lifecycle transfers, so proceeds are available
    // ===========================================
    
    const userTransferFlows = new Map<string, number>(); // accountId -> net change from user transfers
    
    // Track super contributions for this year (for tax calculations)
    const superContributionsByAccount = new Map<string, { 
      concessional: number; 
      nonConcessional: number; 
      personId: string;
    }>();
    
    // Track super contribution flows separately from transfers (for proper reporting as contributions)
    const superContributionFlows = new Map<string, number>(); // accountId -> contribution amount
    
    for (const event of yearEvents) {
      if (event.type === 'transfer' && event.sourceAccountId && event.targetAccountId) {
        // For transferAll, we need to calculate the balance at this point
        // (opening + lifecycle flows)
        let transferAmount = event.amount;
        if (event.transferAll) {
          const sourceAccount = accounts.find(a => a.id === event.sourceAccountId);
          if (sourceAccount) {
            const isFirstActive = !accountStartYears.has(event.sourceAccountId) && isAccountActive(sourceAccount, year, persons);
            const openingValue = isFirstActive
              ? sourceAccount.initialValue
              : (accountValues.get(event.sourceAccountId) ?? sourceAccount.initialValue);
            const lifecycleChange = lifecycleFlows.get(event.sourceAccountId) ?? 0;
            transferAmount = openingValue + lifecycleChange;
          }
        }
        
        userTransferFlows.set(
          event.sourceAccountId,
          (userTransferFlows.get(event.sourceAccountId) ?? 0) - transferAmount
        );
        userTransferFlows.set(
          event.targetAccountId,
          (userTransferFlows.get(event.targetAccountId) ?? 0) + transferAmount
        );
      }
      
      // Handle super contribution events
      if (event.type === 'superContribution' && event.superContribution && event.targetAccountId) {
        const { contributionType, memberPersonId } = event.superContribution;
        
        // Track contribution to target super account separately (not as a transfer)
        superContributionFlows.set(
          event.targetAccountId,
          (superContributionFlows.get(event.targetAccountId) ?? 0) + event.amount
        );
        
        // If there's a source account (salary sacrifice, personal contribution), deduct as transfer
        if (event.sourceAccountId) {
          userTransferFlows.set(
            event.sourceAccountId,
            (userTransferFlows.get(event.sourceAccountId) ?? 0) - event.amount
          );
        }
        
        // Track contributions by super account for tax calculations
        const existing = superContributionsByAccount.get(event.targetAccountId) ?? { 
          concessional: 0, 
          nonConcessional: 0, 
          personId: memberPersonId 
        };
        if (contributionType === 'concessional') {
          existing.concessional += event.amount;
        } else {
          existing.nonConcessional += event.amount;
        }
        superContributionsByAccount.set(event.targetAccountId, existing);
      }
    }

    // ===========================================
    // PHASE 4 & 5: Process each account - apply growth and derived flows
    // ===========================================
    
    const derivedFlows: { accountId: string; amount: number; type: 'contribution' | 'withdrawal'; description: string; sourceAccountId?: string; sourceAccountName?: string }[] = [];

    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isFirstActiveYear = accountStartYears.get(account.id) === year;
      const isLifecycleEnding = lifecycleTransfers.some(t => t.sourceId === account.id);

      const openingValue = isFirstActiveYear
        ? account.initialValue
        : (accountValues.get(account.id) ?? account.initialValue);

      // Get flow amounts
      const lifecycleChange = lifecycleFlows.get(account.id) ?? 0;
      const userTransferChange = userTransferFlows.get(account.id) ?? 0;
      const superContributionChange = superContributionFlows.get(account.id) ?? 0;

      let growth = 0;
      let projectedValue = openingValue;
      let contributions = 0;
      let withdrawals = 0;
      let transfers = 0;
      let endValue = openingValue;
      
      // Track lifecycle transfers: outflows as transfers, inflows as contributions
      const lifecycleContribution = Math.max(0, lifecycleChange);
      if (lifecycleChange < 0) {
        transfers = lifecycleChange; // Outflow (source account)
      } else if (lifecycleChange > 0) {
        contributions = lifecycleChange; // Inflow (destination account) - for reporting
      }
      
      // Track user transfers as transfers (both in and out)
      transfers += userTransferChange;
      
      // Track super contributions as contributions (not transfers)
      contributions += superContributionChange;

      if (isActive && !isLifecycleEnding) {
        // Calculate balance for growth based on settings.growthCalculationMethod
        const totalTransfers = lifecycleChange + userTransferChange + superContributionChange;
        let balanceForGrowth: number;
        
        if (settings.growthCalculationMethod === 'averageBalance') {
          // Average balance: opening + 0.5 * all transfers (assumes mid-year transactions)
          balanceForGrowth = openingValue + 0.5 * totalTransfers;
        } else {
          // Opening balance (default): opening + lifecycle outflows only (inflows added after growth)
          balanceForGrowth = openingValue + Math.min(0, lifecycleChange) + userTransferChange;
        }
        
        // PHASE 4: Apply growth (only if balance > 0)
        // Skip growth for liabilities - interest is handled separately in liability processing phase
        if (account.type === 'liability') {
          // For liabilities, just track the opening balance + any transfers
          // Interest will be calculated in the liability processing phase
          projectedValue = openingValue + lifecycleChange + userTransferChange;
          growth = 0;
        } else if (balanceForGrowth > 0) {
          const yearsSinceStart = year - (accountStartYears.get(account.id) ?? year) + 1;
          const epochGrowthOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
          projectedValue = projectAccountValue(account, year, balanceForGrowth, resolvedAssumptions, yearsSinceStart, epochGrowthOverride);
          growth = projectedValue - balanceForGrowth;
        } else {
          // No growth on zero or negative balances
          projectedValue = balanceForGrowth;
          growth = 0;
        }
        
        // Add remaining transfer amounts not included in growth base
        if (settings.growthCalculationMethod === 'averageBalance') {
          // For average balance, the full transfer is already factored in via 0.5 multiplier
          // Add the other half that wasn't in the growth base
          projectedValue += 0.5 * totalTransfers;
        } else {
          // For opening balance method, add lifecycle inflows and super contributions after growth
          projectedValue += lifecycleContribution + superContributionChange;
        }

        // Process non-transfer events (contributions/withdrawals) - don't add to contributions again
        let eventContributions = 0;
        let eventWithdrawals = 0;
        for (const event of yearEvents) {
          if (event.affectedAccountId === account.id) {
            if (event.type === 'income' || event.type === 'assetChange') {
              eventContributions += event.amount;
            } else if (event.type === 'expense' || event.type === 'liabilityChange') {
              eventWithdrawals += event.amount;
            }
          }
        }
        contributions += eventContributions;
        withdrawals += eventWithdrawals;

        endValue = projectedValue + eventContributions - eventWithdrawals;

        // PHASE 5: Derived flows
        if (account.type === 'income' && account.depositsToAccountId) {
          // Pass-through: deposit only contributions; Regular: deposit projectedValue + contributions
          const totalIncomeToDeposit = account.passThrough
            ? contributions
            : projectedValue + contributions;
          if (totalIncomeToDeposit > 0) {
            derivedFlows.push({ accountId: account.depositsToAccountId, amount: totalIncomeToDeposit, type: 'contribution', description: `Income: ${account.name}`, sourceAccountId: account.id, sourceAccountName: account.name });
          }
        }
        if (account.type === 'expense' && account.fundedByAccountId) {
          derivedFlows.push({ accountId: account.fundedByAccountId, amount: projectedValue, type: 'withdrawal', description: `Expense: ${account.name}`, sourceAccountId: account.id, sourceAccountName: account.name });
        }
        if (account.type === 'asset' && account.incomeTargetAccountId && balanceForGrowth > 0) {
          const epochReturnOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'returnRate');
          const effectiveReturnRate = epochReturnOverride ?? account.returnRate;
          if (effectiveReturnRate) {
            const incomeGenerated = balanceForGrowth * effectiveReturnRate;
            derivedFlows.push({ accountId: account.incomeTargetAccountId, amount: incomeGenerated, type: 'contribution', description: `Return: ${account.name}`, sourceAccountId: account.id, sourceAccountName: account.name });
          }
        }
        if (account.type === 'asset' && account.fundedByAccountId) {
          // Only fund actual cash contributions, NOT unrealized growth (appreciation)
          // Growth is paper value increase - no cash changes hands
          let fundingAmount = contributions - withdrawals;
          if (isFirstActiveYear) {
            fundingAmount += account.initialValue;
          }
          if (fundingAmount > 0) {
            derivedFlows.push({ accountId: account.fundedByAccountId, amount: fundingAmount, type: 'withdrawal', description: `Fund asset: ${account.name}`, sourceAccountId: account.id, sourceAccountName: account.name });
          }
        }
      } else if (isLifecycleEnding) {
        // Account ended this year via transfer/sell - its opening balance was moved out,
        // but it may still receive income deposits that should accumulate
        endValue = contributions;
        projectedValue = contributions;
      } else if (!isActive) {
        // Account not active
        if (account.endBehavior === 'hold') {
          endValue = openingValue;
          projectedValue = openingValue;
        } else if (account.endBehavior === 'transfer' || account.endBehavior === 'sell') {
          // After transfer/sell, keep accumulated contributions (e.g., income deposits)
          endValue = openingValue + contributions;
          projectedValue = openingValue + contributions;
        } else {
          // 'zero' or default - set to zero
          endValue = 0;
          projectedValue = 0;
        }

        if (account.type === 'income' && account.depositsToAccountId && account.endBehavior === 'hold') {
          derivedFlows.push({ accountId: account.depositsToAccountId, amount: projectedValue, type: 'contribution', description: `Income (held): ${account.name}`, sourceAccountId: account.id, sourceAccountName: account.name });
        }
        if (account.type === 'expense' && account.fundedByAccountId && account.endBehavior === 'hold') {
          derivedFlows.push({ accountId: account.fundedByAccountId, amount: projectedValue, type: 'withdrawal', description: `Expense (held): ${account.name}`, sourceAccountId: account.id, sourceAccountName: account.name });
        }
      }

      accountValues.set(account.id, endValue);

      if (account.type === 'income') {
        // For pass-through accounts, taxable income is just contributions received
        // For regular income accounts, it's projectedValue + contributions
        const taxableIncome = account.passThrough
          ? contributions
          : projectedValue + contributions;
        totalIncome += taxableIncome;
        // Track income per account for itemized tax events (skip tax-free income)
        if (taxableIncome > 0 && account.incomeTaxTreatment !== 'taxFree') {
          incomeByAccount.push({
            accountId: account.id,
            accountName: account.name,
            amount: taxableIncome,
            fundedFromAccountId: account.taxFundedFromAccountId,
          });
        }
        // For pass-through: show contributions only, for regular: show full taxable income
        if (account.passThrough) {
          endValue = contributions;
        }
      } else if (account.type === 'expense') {
        totalExpenses += projectedValue;
      }

      accountResults.set(account.id, {
        accountId: account.id,
        year,
        startValue: openingValue,
        growth,
        contributions,
        withdrawals,
        transfers,
        endValue,
      });
    }

    // Handle events without affected accounts
    for (const event of yearEvents) {
      if (!event.affectedAccountId && !event.sourceAccountId) {
        if (event.type === 'income') {
          totalIncome += event.amount;
        } else if (event.type === 'expense') {
          totalExpenses += event.amount;
        }
      }
    }

    // Apply derived flows
    for (const flow of derivedFlows) {
      const result = accountResults.get(flow.accountId);
      if (result) {
        if (flow.type === 'contribution') {
          result.contributions += flow.amount;
          result.endValue += flow.amount;
        } else {
          result.withdrawals += flow.amount;
          result.endValue -= flow.amount;
        }
        accountValues.set(flow.accountId, result.endValue);
        
        // Track cashflow detail
        if (!result.cashflowDetails) {
          result.cashflowDetails = [];
        }
        result.cashflowDetails.push({
          description: flow.description,
          amount: flow.amount,
          type: flow.type,
          sourceAccountId: flow.sourceAccountId,
          sourceAccountName: flow.sourceAccountName,
        });
      }
    }

    // ===========================================
    // PHASE 6: Liability interest and payment processing
    // ===========================================
    
    for (const account of accounts) {
      if (account.type !== 'liability') continue;
      
      const result = accountResults.get(account.id);
      if (!result) continue;
      
      // Skip if liability is already paid off
      if (result.endValue <= 0) continue;
      
      const interestRate = account.interestRate ?? 0;
      
      // Calculate effective balance for interest (considering offset account)
      let effectiveBalance = result.endValue;
      if (account.offsetAccountId) {
        const offsetResult = accountResults.get(account.offsetAccountId);
        if (offsetResult) {
          effectiveBalance = Math.max(0, result.endValue - offsetResult.endValue);
        }
      }
      
      // Calculate interest
      const interestAmount = effectiveBalance * interestRate;
      
      // Calculate payment amount
      let paymentAmount = account.annualPayment ?? 0;
      
      if (account.calculatePayment && account.endCondition) {
        // Auto-calculate payment to pay off by end date using amortization formula
        // Use effective balance (considering offset) for accurate payment calculation
        const owner = persons.find(p => p.id === account.owner);
        let endYear: number;
        if (account.endCondition.type === 'year') {
          endYear = account.endCondition.year;
        } else if (account.endCondition.type === 'age' && owner) {
          endYear = owner.birthYear + account.endCondition.age;
        } else {
          endYear = year + 30; // Default to 30 years if no end condition
        }
        
        const yearsRemaining = Math.max(1, endYear - year + 1);
        
        // Calculate payment needed to pay off the FULL balance by end date,
        // but using the EFFECTIVE interest rate (reduced by offset)
        // This gives the correct payment: interest on effective balance + principal reduction
        if (interestRate > 0 && effectiveBalance > 0) {
          // With offset account: interest is charged on effective balance,
          // but we're paying down the full principal
          const principalToPay = result.endValue;
          
          // Calculate required principal payment per year to pay off by end date
          // Payment = principal / years remaining + interest on effective balance
          const principalPaymentPerYear = principalToPay / yearsRemaining;
          paymentAmount = principalPaymentPerYear + interestAmount;
        } else if (interestRate > 0) {
          // Effective balance is 0 (offset >= balance), just pay principal
          paymentAmount = result.endValue / yearsRemaining;
        } else {
          // No interest: simple division
          paymentAmount = result.endValue / yearsRemaining;
        }
      }
      
      // For interest-only, payment only covers interest
      if (account.paymentType === 'interestOnly') {
        paymentAmount = interestAmount;
      }
      
      // Cap payment at remaining balance + interest (don't overpay)
      const maxPayment = result.endValue + interestAmount;
      paymentAmount = Math.min(paymentAmount, maxPayment);
      
      // Calculate principal reduction
      // For interest-only, the payment covers interest so principal unchanged
      // For P&I, the payment covers interest + principal reduction
      const principalReduction = account.paymentType === 'interestOnly' 
        ? 0 
        : Math.max(0, paymentAmount - interestAmount);
      
      // Update liability balance
      // Interest is tracked for display but the net balance change depends on payment type
      result.growth = interestAmount; // Interest accrued (shown for transparency)
      result.withdrawals = principalReduction; // Principal reduction
      
      // For interest-only: balance stays same (interest is paid off each year)
      // For P&I: balance = balance + interest - payment = balance - principal reduction
      if (account.paymentType === 'interestOnly') {
        // Interest paid, balance unchanged
        result.endValue = result.endValue;
      } else {
        // P&I: add interest, subtract the full payment, but cap at not going negative
        result.endValue = Math.max(0, result.endValue + interestAmount - paymentAmount);
      }
      accountValues.set(account.id, result.endValue);
      
      // Withdraw payment from funding account
      if (account.fundedByAccountId && paymentAmount > 0) {
        const fundingResult = accountResults.get(account.fundedByAccountId);
        if (fundingResult) {
          fundingResult.withdrawals += paymentAmount;
          fundingResult.endValue -= paymentAmount;
          accountValues.set(account.fundedByAccountId, fundingResult.endValue);
          
          // Track cashflow detail
          if (!fundingResult.cashflowDetails) fundingResult.cashflowDetails = [];
          fundingResult.cashflowDetails.push({
            description: `Liability: ${account.name}`,
            amount: paymentAmount,
            type: 'withdrawal',
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
      }
    }

    // ===========================================
    // PHASE 7: Tax calculations
    // ===========================================
    
    const taxEvents: TaxEvent[] = [];
    
    const defaultFundingAccountId = settings.defaultTaxFundingAccountId ?? 'unassigned';
    const defaultFundingAccount = settings.defaultTaxFundingAccountId 
      ? accounts.find(a => a.id === settings.defaultTaxFundingAccountId) 
      : undefined;

    // Generate per-account income tax events
    for (const income of incomeByAccount) {
      const fundingAccountId = income.fundedFromAccountId ?? defaultFundingAccountId;
      const fundingAccount = income.fundedFromAccountId
        ? accounts.find(a => a.id === income.fundedFromAccountId)
        : defaultFundingAccount;
      
      taxEvents.push({
        id: uuidv4(),
        year,
        type: 'incomeTax',
        description: income.accountName,
        sourceAccountId: income.accountId,
        sourceAccountName: income.accountName,
        assessableAmount: income.amount,
        fundedFromAccountId: fundingAccountId,
        fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
      });
    }

    // Generate tax deduction events from events with taxTreatmentType: 'taxDeduction'
    for (const event of yearEvents) {
      if (event.taxTreatmentType === 'taxDeduction' && event.amount > 0) {
        const fundingAccountId = event.taxFundedFromAccountId ?? defaultFundingAccountId;
        const fundingAccount = event.taxFundedFromAccountId
          ? accounts.find(a => a.id === event.taxFundedFromAccountId)
          : defaultFundingAccount;
        
        taxEvents.push({
          id: uuidv4(),
          year,
          type: 'taxDeduction',
          description: event.description,
          assessableAmount: -event.amount, // Negative to reduce taxable income
          fundedFromAccountId: fundingAccountId,
          fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
        });
      }
    }

    // Add CGT events
    for (const cgtEvent of pendingCgtEvents) {
      if (cgtEvent.cgtResult.discountedGain > 0) {
        taxEvents.push({
          id: uuidv4(),
          year,
          type: 'capitalGainsTax',
          description: `CGT: ${cgtEvent.accountName}`,
          sourceAccountId: cgtEvent.accountId,
          sourceAccountName: cgtEvent.accountName,
          assessableAmount: cgtEvent.cgtResult.discountedGain,
          fundedFromAccountId: cgtEvent.fundedFromAccountId,
          fundedFromAccountName: cgtEvent.fundedFromAccountName,
          grossCapitalGain: cgtEvent.cgtResult.grossCapitalGain,
          discountApplied: cgtEvent.cgtResult.discountApplied,
          costBase: cgtEvent.cgtResult.costBase,
          saleProceeds: cgtEvent.cgtResult.saleProceeds,
        });
      }
    }

    // ===========================================
    // Super contribution tax processing
    // 1. 15% contributions tax (deducted from super account)
    // 2. Division 293 tax (for high-income earners)
    // ===========================================
    
    // Track super contribution processing results for tax calculations
    const superContributionResults: ContributionProcessingResult[] = [];
    
    if (settings.super && superContributionsByAccount.size > 0) {
      for (const [superAccountId, contribs] of superContributionsByAccount) {
        const superAccount = accounts.find(a => a.id === superAccountId);
        if (!superAccount) continue;
        
        const superResult = accountResults.get(superAccountId);
        if (!superResult) continue;
        
        // Get or initialize carry-forward state for this person
        const currentState = carryForwardStates.get(contribs.personId) ?? { 
          personId: contribs.personId, 
          unusedCaps: [] 
        };
        
        // Process contributions
        const result = processPersonContributions(
          contribs.personId,
          year,
          contribs.concessional,
          contribs.nonConcessional,
          currentState,
          settings.super
        );
        
        superContributionResults.push(result);
        
        // Deduct 15% contributions tax from super account (for concessional contributions within cap)
        if (result.contributionsTax > 0) {
          superResult.withdrawals += result.contributionsTax;
          superResult.endValue -= result.contributionsTax;
          accountValues.set(superAccountId, superResult.endValue);
          
          if (!superResult.cashflowDetails) superResult.cashflowDetails = [];
          superResult.cashflowDetails.push({
            description: `Super contributions tax (15%)`,
            amount: result.contributionsTax,
            type: 'withdrawal',
          });
          
          // Add tax event for contributions tax
          taxEvents.push({
            id: uuidv4(),
            year,
            type: 'superContributionTax',
            description: `Contributions Tax: ${superAccount.name}`,
            sourceAccountId: superAccountId,
            sourceAccountName: superAccount.name,
            assessableAmount: 0, // Not assessable income - already taxed at source
            fundedFromAccountId: superAccountId, // Paid from super account
            fundedFromAccountName: superAccount.name,
          });
        }
        
        // Calculate Division 293 tax if applicable
        const div293Result = calculateDiv293(
          totalIncome, // Use total assessable income for the year
          contribs.concessional,
          settings.super
        );
        
        if (div293Result.applies && div293Result.taxAmount > 0) {
          // Division 293 is paid from the default tax funding account (or super account)
          const div293FundingAccountId = superAccount.taxFundedFromAccountId ?? 
            settings.defaultTaxFundingAccountId ?? superAccountId;
          const div293FundingAccount = accounts.find(a => a.id === div293FundingAccountId) ?? superAccount;
          
          // Deduct from funding account
          const fundingResult = accountResults.get(div293FundingAccountId);
          if (fundingResult) {
            fundingResult.withdrawals += div293Result.taxAmount;
            fundingResult.endValue -= div293Result.taxAmount;
            accountValues.set(div293FundingAccountId, fundingResult.endValue);
            
            if (!fundingResult.cashflowDetails) fundingResult.cashflowDetails = [];
            fundingResult.cashflowDetails.push({
              description: `Division 293 tax`,
              amount: div293Result.taxAmount,
              type: 'withdrawal',
            });
          }
          
          taxEvents.push({
            id: uuidv4(),
            year,
            type: 'division293Tax',
            description: `Div 293: ${superAccount.name}`,
            sourceAccountId: superAccountId,
            sourceAccountName: superAccount.name,
            assessableAmount: 0, // Not assessable income
            fundedFromAccountId: div293FundingAccountId,
            fundedFromAccountName: div293FundingAccount.name,
          });
        }
        
        // Handle excess concessional contributions (added to assessable income)
        if (result.excessConcessional > 0) {
          taxEvents.push({
            id: uuidv4(),
            year,
            type: 'incomeTax',
            description: `Excess concessional contributions`,
            sourceAccountId: superAccountId,
            sourceAccountName: superAccount.name,
            assessableAmount: result.excessConcessional,
            fundedFromAccountId: defaultFundingAccountId,
            fundedFromAccountName: defaultFundingAccount?.name ?? 'Not configured',
          });
        }
      }
    }

    // Aggregate tax by funding account
    const aggregationMap = new Map<string, { 
      fundedFromAccountName: string;
      taxSchedule: TaxSchedule;
      totalAssessable: number;
      events: TaxEvent[];
    }>();

    for (const taxEvent of taxEvents) {
      const existing = aggregationMap.get(taxEvent.fundedFromAccountId);
      if (existing) {
        existing.totalAssessable += taxEvent.assessableAmount;
        existing.events.push(taxEvent);
      } else {
        const fundingAccount = accounts.find(a => a.id === taxEvent.fundedFromAccountId);
        const isSuperAccount = fundingAccount?.type === 'asset' && 
          fundingAccount.name?.toLowerCase().includes('super');
        
        aggregationMap.set(taxEvent.fundedFromAccountId, {
          fundedFromAccountName: taxEvent.fundedFromAccountName ?? 'Unknown',
          taxSchedule: isSuperAccount ? 'flatRate15' : 'marginalRates',
          totalAssessable: taxEvent.assessableAmount,
          events: [taxEvent],
        });
      }
    }

    const taxAggregations: TaxAggregation[] = [];
    let taxPayable = 0;

    for (const [fundedFromAccountId, agg] of aggregationMap) {
      let calculatedTax: number;
      if (agg.taxSchedule === 'marginalRates') {
        calculatedTax = calculateIncomeTax(agg.totalAssessable, year);
      } else {
        calculatedTax = agg.totalAssessable * 0.15;
      }

      taxAggregations.push({
        fundedFromAccountId,
        fundedFromAccountName: agg.fundedFromAccountName,
        taxSchedule: agg.taxSchedule,
        totalAssessable: agg.totalAssessable,
        calculatedTax,
      });

      taxPayable += calculatedTax;

      // Deduct tax from funding account
      if (fundedFromAccountId !== 'unassigned') {
        const fundingResult = accountResults.get(fundedFromAccountId);
        if (fundingResult) {
          fundingResult.withdrawals += calculatedTax;
          fundingResult.endValue -= calculatedTax;
          accountValues.set(fundedFromAccountId, fundingResult.endValue);
          
          // Track cashflow detail
          if (!fundingResult.cashflowDetails) fundingResult.cashflowDetails = [];
          fundingResult.cashflowDetails.push({
            description: `Tax payment (${agg.taxSchedule === 'flatRate15' ? '15% flat' : 'marginal rates'})`,
            amount: calculatedTax,
            type: 'withdrawal',
          });
        }
      }
    }

    const netPosition = totalIncome - totalExpenses - taxPayable;

    // ===========================================
    // PHASE 8: Auto-topup processing
    // Runs AFTER liability payments and tax so balance reflects all withdrawals
    // ===========================================
    
    for (const account of accounts) {
      if (account.type !== 'asset' || !account.autoTopup?.enabled) continue;
      
      const result = accountResults.get(account.id);
      if (!result) continue;
      
      const threshold = account.autoTopup.threshold ?? 0;
      
      // Check if balance is below threshold
      if (result.endValue < threshold) {
        const sourceResult = accountResults.get(account.autoTopup.fromAccountId);
        if (!sourceResult) continue;
        
        // Calculate topup amount
        const targetBalance = account.autoTopup.targetBalance ?? threshold;
        const topupAmount = targetBalance - result.endValue;
        
        if (topupAmount > 0) {
          const sourceAccount = accounts.find(a => a.id === account.autoTopup!.fromAccountId);
          
          // Apply topup to target account
          result.contributions += topupAmount;
          result.endValue += topupAmount;
          result.autoTopupApplied = true;
          accountValues.set(account.id, result.endValue);
          if (!result.cashflowDetails) result.cashflowDetails = [];
          result.cashflowDetails.push({
            description: `Auto top-up from: ${sourceAccount?.name ?? 'Unknown'}`,
            amount: topupAmount,
            type: 'contribution',
            sourceAccountId: account.autoTopup.fromAccountId,
            sourceAccountName: sourceAccount?.name,
          });
          
          // Withdraw from source account (allow negative balance)
          sourceResult.withdrawals += topupAmount;
          sourceResult.endValue -= topupAmount;
          sourceResult.autoTopupApplied = true;
          accountValues.set(account.autoTopup.fromAccountId, sourceResult.endValue);
          if (!sourceResult.cashflowDetails) sourceResult.cashflowDetails = [];
          sourceResult.cashflowDetails.push({
            description: `Auto top-up to: ${account.name}`,
            amount: topupAmount,
            type: 'withdrawal',
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
      }
    }

    for (const account of accounts) {
      const result = accountResults.get(account.id);
      if (result) {
        yearAccounts.push(result);
      }
    }

    let totalAssets = 0;
    let totalLiquidAssets = 0;
    let totalLiabilities = 0;
    for (const account of accounts) {
      const value = accountValues.get(account.id) ?? 0;
      if (account.type === 'asset') {
        totalAssets += value;
        if (account.liquidityType === 'liquid') {
          totalLiquidAssets += value;
        }
      } else if (account.type === 'liability') {
        totalLiabilities += value;
      }
    }

    if (totalAssets > peakAssets) {
      peakAssets = totalAssets;
      peakAssetsYear = year;
    }

    // ===========================================
    // Process super contributions and carry-forward
    // ===========================================
    const offBalanceSheet: OffBalanceSheetItem[] = [];
    
    if (persons.length > 0 && settings.super) {
      // Aggregate contributions by person for this year
      const contributionsByPerson = aggregateContributionsByPerson(events, year, persons);
      
      // Process each person's contributions
      const newCarryForwardStates = new Map<string, CarryForwardState>();
      
      for (const person of persons) {
        const personContribs = contributionsByPerson.get(person.id);
        const currentState = carryForwardStates.get(person.id) ?? { 
          personId: person.id, 
          unusedCaps: [] 
        };
        
        const result = processPersonContributions(
          person.id,
          year,
          personContribs?.concessional ?? 0,
          personContribs?.nonConcessional ?? 0,
          currentState,
          settings.super
        );
        
        newCarryForwardStates.set(person.id, result.newCarryForwardState);
      }
      
      // Update carry-forward states for next year
      carryForwardStates = newCarryForwardStates;
      
      // Create off-balance sheet items for carry-forward balances
      const carryForwardItems = createCarryForwardOffBalanceSheetItems(
        carryForwardStates,
        persons,
        year,
        settings.super
      );
      offBalanceSheet.push(...carryForwardItems);
    }

    years.push({
      year,
      accounts: yearAccounts,
      totalAssets,
      totalLiquidAssets,
      totalIncome,
      totalExpenses,
      taxPayable,
      taxEvents,
      taxAggregations,
      netPosition,
      resolvedAssumptions,
      offBalanceSheet: offBalanceSheet.length > 0 ? offBalanceSheet : undefined,
    });
  }

  const finalAssets = years.length > 0 ? years[years.length - 1].totalAssets : 0;

  return {
    years,
    summary: {
      startYear,
      endYear,
      peakAssets,
      peakAssetsYear,
      finalAssets,
    },
  };
}

function resolveAssumptions(
  assumptions: Assumptions,
  year: number,
  epochs: Epoch[]
): ResolvedAssumptions {
  const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);
  
  const getCpiForEpoch = (): number | undefined => {
    for (let i = sortedEpochs.length - 1; i >= 0; i--) {
      const epoch = sortedEpochs[i];
      if (year >= epoch.startYear && year <= epoch.endYear) {
        const override = epoch.globalAssumptions?.cpi;
        if (override !== undefined) return override;
        
        for (let j = i - 1; j >= 0; j--) {
          const prevOverride = sortedEpochs[j].globalAssumptions?.cpi;
          if (prevOverride !== undefined) return prevOverride;
        }
        break;
      }
    }
    return undefined;
  };

  const cpiOverride = getCpiForEpoch();
  const cpi = cpiOverride ?? resolveAssumptionForYear(assumptions.cpi, year);

  return { cpi };
}

function getAccountAssumptionForEpoch(
  account: Account,
  year: number,
  epochs: Epoch[],
  field: 'growthRate' | 'returnRate'
): number | undefined {
  const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);
  
  for (let i = sortedEpochs.length - 1; i >= 0; i--) {
    const epoch = sortedEpochs[i];
    if (year >= epoch.startYear && year <= epoch.endYear) {
      const override = epoch.accountAssumptions?.[account.id]?.[field];
      if (override !== undefined) return override;
      
      for (let j = i - 1; j >= 0; j--) {
        const prevOverride = sortedEpochs[j].accountAssumptions?.[account.id]?.[field];
        if (prevOverride !== undefined) return prevOverride;
      }
      break;
    }
  }
  return undefined;
}
