import { useState, useRef } from 'react';
import { Button, Input, Select } from '../ui';
import type { Account, AccountInput, GrowthProfile, AccountCondition, EndBehavior, LiquidityType, IncomeTaxTreatment, GrowthOperation, LiabilityPaymentType, AssetSubType, SuperPhase, IncomeSubType, IncomeAsSuperContributionConfig } from '../../schemas/account';
import type { Person } from '../../schemas/person';
import type { Settings } from '../../schemas/settings';
import type { AccountReference } from '../../actions/accounts';

interface AccountFormProps {
  account?: Account;
  accounts: Account[];
  persons: Person[];
  settings?: Settings;
  onSubmit: (data: Omit<AccountInput, 'id'>) => void;
  onCancel: () => void;
  onDelete?: () => Promise<{ success: boolean; references?: AccountReference[] }>;
}

// Check if an account is a tax/off-balance sheet account
function isTaxAccount(account?: Account): boolean {
  return account?.category !== undefined && account.category !== 'standard';
}

export function AccountForm({ account, accounts, persons, settings, onSubmit, onCancel, onDelete }: AccountFormProps) {
  // If this is a tax account, show a simplified form
  const isTax = isTaxAccount(account);
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState(account?.type ?? 'income');
  const [deleteError, setDeleteError] = useState<{ message: string; references: AccountReference[] } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [initialValue, setInitialValue] = useState(account?.initialValue?.toString() ?? '0');
  const [growthType, setGrowthType] = useState<GrowthProfile['type']>(account?.growthProfile?.type ?? 'fixed');
  const [growthRate, setGrowthRate] = useState(() => {
    const gp = account?.growthProfile;
    if (gp?.type === 'fixed') return (gp.rate * 100).toString();
    if (gp?.type === 'increasing') return (gp.rate * 100).toString();
    if (gp?.type === 'decreasing') return (gp.rate * 100).toString();
    return '0';
  });
  const [cpiOperation, setCpiOperation] = useState<GrowthOperation>(() => {
    const gp = account?.growthProfile;
    if (gp?.type === 'cpiLinked') return gp.operation ?? 'add';
    return 'add';
  });
  const [cpiValue, setCpiValue] = useState(() => {
    const gp = account?.growthProfile;
    if (gp?.type === 'cpiLinked') return ((gp.value ?? 0) * 100).toString();
    return '0';
  });
  const [changePerYear, setChangePerYear] = useState(() => {
    const gp = account?.growthProfile;
    if (gp?.type === 'increasing') return (gp.changePerYear * 100).toString();
    if (gp?.type === 'decreasing') return (gp.changePerYear * 100).toString();
    return '0';
  });

  const [startConditionType, setStartConditionType] = useState<'none' | 'year' | 'age'>(() => {
    if (!account?.startCondition) return 'none';
    return account.startCondition.type;
  });
  const [startConditionValue, setStartConditionValue] = useState(() => {
    const sc = account?.startCondition;
    if (sc?.type === 'year') return sc.year.toString();
    if (sc?.type === 'age') return sc.age.toString();
    return '';
  });
  const [startConditionPersonId, _setStartConditionPersonId] = useState(() => {
    const sc = account?.startCondition;
    if (sc?.type === 'age') return sc.personId;
    return '';
  });

  const [endConditionType, setEndConditionType] = useState<'none' | 'year' | 'age'>(() => {
    if (!account?.endCondition) return 'none';
    return account.endCondition.type;
  });
  const [endConditionValue, setEndConditionValue] = useState(() => {
    const ec = account?.endCondition;
    if (ec?.type === 'year') return ec.year.toString();
    if (ec?.type === 'age') return ec.age.toString();
    return '';
  });
  const [endConditionPersonId, _setEndConditionPersonId] = useState(() => {
    const ec = account?.endCondition;
    if (ec?.type === 'age') return ec.personId;
    return '';
  });

  const [endBehavior, setEndBehavior] = useState<EndBehavior>(account?.endBehavior ?? 'zero');
  const [transferToAccountId, setTransferToAccountId] = useState(account?.transferToAccountId ?? '');
  
  // Owner - which person owns this account
  const [owner, setOwner] = useState(account?.owner ?? '');
  
  // Use default bank account from settings for new accounts
  const defaultBankAccount = settings?.defaultBankAccountId ?? '';
  const [depositsToAccountId, setDepositsToAccountId] = useState(account?.depositsToAccountId ?? (account ? '' : defaultBankAccount));
  const [fundedByAccountId, setFundedByAccountId] = useState(account?.fundedByAccountId ?? (account ? '' : defaultBankAccount));
  const [returnRate, setReturnRate] = useState(account?.returnRate ? (account.returnRate * 100).toString() : '');
  const [frankingPercentage, setFrankingPercentage] = useState(account?.frankingPercentage !== undefined ? (account.frankingPercentage * 100).toString() : '');
  const [incomeTargetAccountId, setIncomeTargetAccountId] = useState(account?.incomeTargetAccountId ?? (account ? '' : defaultBankAccount));
  const [liquidityType, setLiquidityType] = useState<LiquidityType | ''>(account?.liquidityType ?? '');

  // Tax settings
  const [incomeTaxTreatment, setIncomeTaxTreatment] = useState<IncomeTaxTreatment | ''>(account?.incomeTaxTreatment ?? '');
  const [taxFundedFromAccountId, setTaxFundedFromAccountId] = useState(account?.taxFundedFromAccountId ?? '');
  
  // CGT settings for assets with endBehavior: 'sell'
  const [costBase, setCostBase] = useState(account?.costBase?.toString() ?? '');
  const [acquisitionYear, setAcquisitionYear] = useState(account?.acquisitionYear?.toString() ?? '');
  const [eligibleForCgtDiscount, setEligibleForCgtDiscount] = useState(account?.eligibleForCgtDiscount ?? true);

  // Auto-topup settings for assets
  const [autoTopupEnabled, setAutoTopupEnabled] = useState(account?.autoTopup?.enabled ?? false);
  const [autoTopupThreshold, setAutoTopupThreshold] = useState(account?.autoTopup?.threshold?.toString() ?? '0');
  const [autoTopupFromAccountId, setAutoTopupFromAccountId] = useState(account?.autoTopup?.fromAccountId ?? '');
  const [autoTopupTargetBalance, setAutoTopupTargetBalance] = useState(account?.autoTopup?.targetBalance?.toString() ?? '');

  // Liability-specific settings
  const [interestRate, setInterestRate] = useState(account?.interestRate ? (account.interestRate * 100).toString() : '');
  const [paymentType, setPaymentType] = useState<LiabilityPaymentType>(account?.paymentType ?? 'principalAndInterest');
  const [annualPayment, setAnnualPayment] = useState(account?.annualPayment?.toString() ?? '');
  const [calculatePayment, setCalculatePayment] = useState(account?.calculatePayment ?? false);
  const [offsetAccountId, setOffsetAccountId] = useState(account?.offsetAccountId ?? '');
  const [payoffFromAccountId, setPayoffFromAccountId] = useState(account?.payoffFromAccountId ?? '');

  // Superannuation-specific settings
  const [assetSubType, setAssetSubType] = useState<AssetSubType>(account?.assetSubType ?? 'generic');
  const [superPhase, setSuperPhase] = useState<SuperPhase>(account?.superConfig?.phase ?? 'accumulation');
  const [preservationYear, setPreservationYear] = useState(account?.superConfig?.preservationYear?.toString() ?? '');

  // Expense-specific settings
  const [basedOnAccountId, setBasedOnAccountId] = useState(account?.basedOnAccountId ?? '');
  const [basedOnPercentage, setBasedOnPercentage] = useState(
    account?.basedOnPercentage !== undefined ? (account.basedOnPercentage * 100).toString() : ''
  );
  const [occursEveryYears, setOccursEveryYears] = useState(account?.occursEveryYears?.toString() ?? '');

  // Income-specific settings
  const [incomeSubType, setIncomeSubType] = useState<IncomeSubType>(account?.incomeSubType ?? 'salary');
  
  // Super contribution config for derived income (e.g., employer SG)
  const [superContribEnabled, setSuperContribEnabled] = useState(!!account?.superContributionConfig);
  const [superContribTargetAccountId, setSuperContribTargetAccountId] = useState(
    account?.superContributionConfig?.targetSuperAccountId ?? ''
  );
  const [superContribType, _setSuperContribType] = useState<IncomeAsSuperContributionConfig['contributionType']>(
    account?.superContributionConfig?.contributionType ?? 'concessional'
  );
  const [superContribSource, setSuperContribSource] = useState<IncomeAsSuperContributionConfig['source']>(
    account?.superContributionConfig?.source ?? 'employerSG'
  );

  const otherAccounts = accounts.filter((a) => a.id !== account?.id);
  const assetAccounts = accounts.filter((a) => a.type === 'asset' && a.id !== account?.id);
  const incomeAccounts = accounts.filter((a) => a.type === 'income' && a.id !== account?.id);
  const superAccounts = accounts.filter((a) => a.type === 'asset' && a.assetSubType === 'superannuation' && a.id !== account?.id);
  
  // For derived income, also include any income account (for flexibility)
  const derivableIncomeAccounts = accounts.filter((a) => a.type === 'income' && a.id !== account?.id && !a.basedOnAccountId);

  // Validation state
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const errorRef = useRef<HTMLDivElement>(null);

  // Derived validation requirements
  // For derived income accounts with super contribution config, they don't need depositsTo
  const isDerivedSuperIncome = type === 'income' && basedOnAccountId && superContribEnabled;
  const requiresDepositsTo = type === 'income' && !isDerivedSuperIncome;
  const requiresFundedBy = type === 'expense' || type === 'liability';
  const requiresIncomeTarget = type === 'asset' && returnRate !== '';
  const requiresTransferTo = endConditionType !== 'none' && (endBehavior === 'transfer' || endBehavior === 'sell' || endBehavior === 'sellNoCgt');
  const requiresSuperTarget = isDerivedSuperIncome;

  const handleDelete = async () => {
    if (!onDelete) return;
    
    setIsDeleting(true);
    setDeleteError(null);
    
    try {
      const result = await onDelete();
      if (!result.success && result.references) {
        setDeleteError({
          message: 'Cannot delete this account because it is referenced by:',
          references: result.references,
        });
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required cash flow accounts
    const errors: string[] = [];
    
    if (requiresDepositsTo && !depositsToAccountId) {
      errors.push('Income accounts require a "Deposits To" account');
    }
    if (requiresFundedBy && !fundedByAccountId) {
      errors.push(`${type === 'expense' ? 'Expense' : 'Liability'} accounts require a "Funded By" account`);
    }
    if (requiresIncomeTarget && !incomeTargetAccountId) {
      errors.push('Assets with a return rate require a "Generates Income To" account');
    }
    if (requiresTransferTo && !transferToAccountId) {
      errors.push('Accounts with sell or transfer end behavior require a destination account');
    }
    if (requiresSuperTarget && !superContribTargetAccountId) {
      errors.push('Derived super contributions require a target super account');
    }
    if (type === 'income' && basedOnAccountId && !basedOnPercentage) {
      errors.push('Derived income accounts require a percentage');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      // Scroll error message into view
      setTimeout(() => {
        errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
      return;
    }
    setValidationErrors([]);

    const growthProfile: GrowthProfile = (() => {
      const rate = (parseFloat(growthRate) || 0) / 100;
      const change = (parseFloat(changePerYear) || 0) / 100;
      const cpiVal = (parseFloat(cpiValue) || 0) / 100;
      switch (growthType) {
        case 'fixed':
          return { type: 'fixed' as const, rate };
        case 'cpiLinked':
          return { type: 'cpiLinked' as const, operation: cpiOperation, value: cpiVal };
        case 'increasing':
          return { type: 'increasing' as const, rate, changePerYear: change };
        case 'decreasing':
          return { type: 'decreasing' as const, rate, changePerYear: change };
      }
    })();

    const startCondition: AccountCondition | undefined = (() => {
      if (startConditionType === 'none') return undefined;
      if (startConditionType === 'year') {
        return { type: 'year' as const, year: parseInt(startConditionValue) || 0 };
      }
      return {
        type: 'age' as const,
        personId: startConditionPersonId,
        age: parseInt(startConditionValue) || 0,
      };
    })();

    const endCondition: AccountCondition | undefined = (() => {
      if (endConditionType === 'none') return undefined;
      if (endConditionType === 'year') {
        return { type: 'year' as const, year: parseInt(endConditionValue) || 0 };
      }
      return {
        type: 'age' as const,
        personId: endConditionPersonId,
        age: parseInt(endConditionValue) || 0,
      };
    })();

    const isSellBehavior = endBehavior === 'sell';
    
    onSubmit({
      name,
      type,
      owner: owner || undefined,
      initialValue: parseFloat(initialValue) || 0,
      growthProfile,
      returnRate: type === 'asset' && returnRate ? parseFloat(returnRate) / 100 : undefined,
      frankingPercentage: type === 'asset' && frankingPercentage ? parseFloat(frankingPercentage) / 100 : undefined,
      incomeTargetAccountId: type === 'asset' && incomeTargetAccountId ? incomeTargetAccountId : undefined,
      liquidityType: type === 'asset' && liquidityType ? liquidityType : undefined,
      startCondition,
      endCondition,
      endBehavior: endCondition ? endBehavior : undefined,
      transferToAccountId: (endBehavior === 'transfer' || endBehavior === 'sell' || endBehavior === 'sellNoCgt') ? transferToAccountId : undefined,
      depositsToAccountId: type === 'income' && depositsToAccountId ? depositsToAccountId : undefined,
      fundedByAccountId: (type === 'expense' || type === 'asset' || type === 'liability') && fundedByAccountId ? fundedByAccountId : undefined,
      
      // Tax settings
      incomeTaxTreatment: type === 'income' && incomeTaxTreatment ? incomeTaxTreatment : undefined,
      taxFundedFromAccountId: taxFundedFromAccountId || undefined,
      
      // CGT settings (for assets with sell behavior)
      costBase: type === 'asset' && isSellBehavior && costBase ? parseFloat(costBase) : undefined,
      acquisitionYear: type === 'asset' && isSellBehavior && acquisitionYear ? parseInt(acquisitionYear) : undefined,
      eligibleForCgtDiscount: type === 'asset' && isSellBehavior ? eligibleForCgtDiscount : undefined,
      
      // Auto-topup settings (for assets)
      autoTopup: type === 'asset' && autoTopupEnabled && autoTopupFromAccountId ? {
        enabled: true,
        threshold: parseFloat(autoTopupThreshold) || 0,
        fromAccountId: autoTopupFromAccountId,
        targetBalance: autoTopupTargetBalance ? parseFloat(autoTopupTargetBalance) : undefined,
      } : undefined,
      
      // Liability-specific settings
      interestRate: type === 'liability' && interestRate ? parseFloat(interestRate) / 100 : undefined,
      paymentType: type === 'liability' ? paymentType : undefined,
      annualPayment: type === 'liability' && !calculatePayment && annualPayment ? parseFloat(annualPayment) : undefined,
      calculatePayment: type === 'liability' ? calculatePayment : undefined,
      offsetAccountId: type === 'liability' && offsetAccountId ? offsetAccountId : undefined,
      payoffFromAccountId: type === 'liability' && payoffFromAccountId ? payoffFromAccountId : undefined,
      
      // Superannuation settings (for assets)
      assetSubType: type === 'asset' ? assetSubType : undefined,
      superConfig: type === 'asset' && assetSubType === 'superannuation' ? {
        phase: superPhase,
        preservationYear: preservationYear ? parseInt(preservationYear) : undefined,
      } : undefined,
      
      // Expense-specific settings
      occursEveryYears: type === 'expense' && occursEveryYears 
        ? parseInt(occursEveryYears) 
        : undefined,
      
      // Income-specific settings
      incomeSubType: type === 'income' ? incomeSubType : undefined,
      
      // Derived account settings (for both income and expense)
      basedOnAccountId: (type === 'expense' || type === 'income') && basedOnAccountId ? basedOnAccountId : undefined,
      basedOnPercentage: (type === 'expense' || type === 'income') && basedOnAccountId && basedOnPercentage 
        ? parseFloat(basedOnPercentage) / 100 
        : undefined,
      
      // Super contribution config for derived income accounts
      superContributionConfig: type === 'income' && basedOnAccountId && superContribEnabled && superContribTargetAccountId ? {
        targetSuperAccountId: superContribTargetAccountId,
        contributionType: superContribType,
        source: superContribSource,
        reducesAssessableIncome: false, // Employer SG doesn't reduce assessable income
      } : undefined,
    });
  };

  // Simplified submit handler for tax accounts
  const handleTaxAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Tax accounts keep most of their existing values, only update editable fields
    onSubmit({
      name,
      type: account?.type ?? 'asset',
      category: account?.category,
      includeInNetWorth: false,
      specialConfig: account?.specialConfig,
      owner: owner || undefined,
      initialValue: parseFloat(initialValue) || 0,
      growthProfile: { type: 'fixed', rate: 0 },
    });
  };

  // Simplified form for tax/off-balance sheet accounts
  if (isTax) {
    const categoryLabels: Record<string, string> = {
      taxCap: 'Tax Cap Account',
      taxCarryForward: 'Tax Carry-Forward Account',
      taxLoss: 'Tax Loss Account',
      capitalLoss: 'Capital Loss Account',
      hecsDebt: 'HECS Debt Account',
      cgtDiscountTracker: 'CGT Discount Tracker',
    };
    
    return (
      <form onSubmit={handleTaxAccountSubmit} className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-800">
            <strong>{categoryLabels[account?.category ?? ''] || 'Tax Account'}</strong>
            <br />
            This is an automatically managed tax tracking account. Only the name, owner, and opening balance can be edited.
          </p>
        </div>
        
        <Input
          label="Account Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <Select
          label="Owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">No owner</option>
          {persons.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>

        <Input
          label="Opening Balance"
          type="number"
          value={initialValue}
          onChange={(e) => setInitialValue(e.target.value)}
          placeholder="0"
        />
        <p className="text-xs text-gray-500 -mt-3">
          The balance at the start of the forecast. For carry-forward accounts, this is the total available cap.
        </p>

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {validationErrors.length > 0 && (
        <div ref={errorRef} className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm font-medium text-red-800 mb-1">Please fix the following:</p>
          <ul className="list-disc list-inside text-sm text-red-700">
            {validationErrors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      
      <Input
        label="Account Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />

      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Account Type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
        >
          <option value="income">Income</option>
          <option value="expense">Expense</option>
          <option value="asset">Asset</option>
          <option value="liability">Liability</option>
        </Select>

        <Select
          label="Owner"
          hint="The person who owns this account. Income and capital gains will be attributed to this person for tax calculations."
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">No owner</option>
          {persons.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </div>

      {type === 'asset' && (
        <Select
          label="Asset Sub-Type"
          value={assetSubType}
          onChange={(e) => setAssetSubType(e.target.value as AssetSubType)}
        >
          <option value="generic">Generic Asset</option>
          <option value="superannuation">Superannuation</option>
        </Select>
      )}

      {type === 'asset' && assetSubType === 'superannuation' && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-purple-800 mb-3">Superannuation Settings</h4>
          
          <Select
            label="Phase"
            value={superPhase}
            onChange={(e) => setSuperPhase(e.target.value as SuperPhase)}
          >
            <option value="accumulation">Accumulation</option>
            <option value="pension">Pension</option>
          </Select>
          
          <div className="mt-4">
            <Input
              label="Year of Preservation Age"
              type="number"
              value={preservationYear}
              onChange={(e) => setPreservationYear(e.target.value)}
              placeholder="e.g. 2045"
            />
            <p className="text-xs text-purple-600 mt-1">
              The year you turn {settings?.super?.preservationAge ?? 67}. This age is configurable in Settings.
            </p>
          </div>
          
          <div className="mt-3 text-xs text-purple-600 space-y-1">
            <p><strong>Accumulation:</strong> 15% tax on earnings, cannot withdraw until preservation age</p>
            <p><strong>Pension:</strong> 0% tax on earnings, regular pension payments</p>
            {superPhase === 'accumulation' && (
              <p className="mt-2">
                💡 Tip: Set an end condition at retirement age with "Transfer" behavior to 
                automatically move to a pension-phase super account.
              </p>
            )}
          </div>
        </div>
      )}

      {type === 'income' && (
        <>
          <Select
            label="Income Type"
            hint="Type of income. Salary income is eligible for employer super contributions."
            value={incomeSubType}
            onChange={(e) => setIncomeSubType(e.target.value as IncomeSubType)}
          >
            <option value="salary">Salary / Wages</option>
            <option value="business">Business / Contractor</option>
            <option value="investment">Investment</option>
            <option value="other">Other</option>
          </Select>
          
          {/* Derived income section (for employer SG, etc.) */}
          <div className="border-t pt-4 mt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Derived Income (Optional)</h3>
            <p className="text-xs text-gray-500 mb-3">
              Create income that is calculated as a percentage of another income account (e.g., employer super at 11.5% of salary).
            </p>
            
            <Select
              label="Calculate Based On"
              value={basedOnAccountId}
              onChange={(e) => {
                setBasedOnAccountId(e.target.value);
                if (e.target.value && !basedOnPercentage) {
                  setBasedOnPercentage('11.5'); // Default to SG rate
                }
              }}
            >
              <option value="">None (use initial value)</option>
              {derivableIncomeAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            
            {basedOnAccountId && (
              <div className="mt-3 space-y-3">
                <Input
                  label="Percentage (%)"
                  hint="e.g., 11.5 for employer super guarantee"
                  type="number"
                  step="0.1"
                  value={basedOnPercentage}
                  onChange={(e) => setBasedOnPercentage(e.target.value)}
                />
                
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={superContribEnabled}
                      onChange={(e) => setSuperContribEnabled(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    Route as super contribution
                  </label>
                  <p className="text-xs text-amber-700 mt-1">
                    Enable this to flow the derived amount directly to a superannuation account as a concessional contribution (counts towards contribution caps).
                  </p>
                  
                  {superContribEnabled && (
                    <div className="mt-3 space-y-3">
                      <Select
                        label="Target Super Account *"
                        value={superContribTargetAccountId}
                        onChange={(e) => setSuperContribTargetAccountId(e.target.value)}
                      >
                        <option value="">Select super account...</option>
                        {superAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </Select>
                      
                      <Select
                        label="Contribution Source"
                        value={superContribSource}
                        onChange={(e) => setSuperContribSource(e.target.value as IncomeAsSuperContributionConfig['source'])}
                      >
                        <option value="employerSG">Employer SG (mandatory)</option>
                        <option value="employerAdditional">Employer Additional</option>
                        <option value="salarySacrifice">Salary Sacrifice</option>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          
          {!isDerivedSuperIncome && (
            <Select
              label="Deposits To *"
              hint="The asset account where this income will be deposited each year."
              value={depositsToAccountId}
              onChange={(e) => setDepositsToAccountId(e.target.value)}
            >
              <option value="">Select account...</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          )}
          
          <Select
            label="Tax Treatment"
            value={incomeTaxTreatment}
            onChange={(e) => setIncomeTaxTreatment(e.target.value as IncomeTaxTreatment | '')}
          >
            <option value="">Taxable (default)</option>
            <option value="taxable">Taxable</option>
            <option value="taxFree">Tax Free</option>
          </Select>
        </>
      )}

      {type === 'expense' && (
        <Select
          label="Funded By *"
          hint="The asset account that will pay for this expense. Withdrawals will be recorded on that account."
          value={fundedByAccountId}
          onChange={(e) => setFundedByAccountId(e.target.value)}
        >
          <option value="">Select account...</option>
          {assetAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      )}

      {type === 'asset' && (
        <Select
          label="Funded By"
          hint="If set, the initial value will be withdrawn from this account when the asset starts."
          value={fundedByAccountId}
          onChange={(e) => setFundedByAccountId(e.target.value)}
        >
          <option value="">None</option>
          {assetAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      )}

      {type === 'expense' && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Expense Options</h3>
          
          <div className="space-y-4">
            <div>
              <Select
                label="Calculate Based On"
                value={basedOnAccountId}
                onChange={(e) => setBasedOnAccountId(e.target.value)}
              >
                <option value="">Fixed amount (use initial value)</option>
                {assetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>% of {a.name}</option>
                ))}
              </Select>
              {basedOnAccountId && (
                <div className="mt-2">
                  <Input
                    label="Percentage (%)"
                    type="number"
                    step="0.1"
                    value={basedOnPercentage}
                    onChange={(e) => setBasedOnPercentage(e.target.value)}
                    placeholder="e.g., 0.5 for 0.5%"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Expense will be calculated as this percentage of the selected account's balance each year
                  </p>
                </div>
              )}
            </div>

            <div>
              <Input
                label="Occurs Every X Years"
                type="number"
                min="1"
                value={occursEveryYears}
                onChange={(e) => setOccursEveryYears(e.target.value)}
                placeholder="Leave empty for annual"
              />
              <p className="text-xs text-gray-500 mt-1">
                {occursEveryYears && parseInt(occursEveryYears) > 1
                  ? `Expense will occur every ${occursEveryYears} years starting from the account's start year`
                  : 'Expense occurs every year (default)'}
              </p>
            </div>
          </div>
        </div>
      )}

      {type === 'asset' && (
        <Select
          label="Liquidity"
          hint="Used for reporting. 'Liquid' assets (e.g., bank accounts, shares) are shown separately in charts to help track easily accessible funds."
          value={liquidityType}
          onChange={(e) => setLiquidityType(e.target.value as LiquidityType | '')}
        >
          <option value="">None</option>
          <option value="liquid">Liquid</option>
          <option value="fixed">Fixed</option>
        </Select>
      )}

      <Input
        label="Initial Value"
        type="number"
        value={initialValue}
        onChange={(e) => setInitialValue(e.target.value)}
      />

      <div className="border-t pt-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Growth Profile</h3>
        <Select
          label="Growth Type"
          value={growthType}
          onChange={(e) => setGrowthType(e.target.value as GrowthProfile['type'])}
        >
          <option value="fixed">Fixed Rate</option>
          <option value="cpiLinked">CPI Based</option>
          <option value="increasing">Increasing Rate</option>
          <option value="decreasing">Decreasing Rate</option>
        </Select>

        {growthType === 'fixed' && (
          <div className="mt-3">
            <Input
              label="Rate (%)"
              type="number"
              step="0.1"
              value={growthRate}
              onChange={(e) => setGrowthRate(e.target.value)}
            />
          </div>
        )}

        {growthType === 'cpiLinked' && (
          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-medium text-blue-800">CPI</span>
              <Select
                label=""
                value={cpiOperation}
                onChange={(e) => setCpiOperation(e.target.value as GrowthOperation)}
              >
                <option value="add">+</option>
                <option value="subtract">−</option>
                <option value="multiply">×</option>
              </Select>
              <Input
                label=""
                type="number"
                step="0.1"
                value={cpiValue}
                onChange={(e) => setCpiValue(e.target.value)}
                className="w-24"
              />
              <span className="text-sm text-blue-600">
                {cpiOperation === 'multiply' ? '' : '%'}
              </span>
            </div>
            <p className="text-xs text-blue-600">
              {cpiOperation === 'add' && `If CPI is 3%, growth = ${(3 + (parseFloat(cpiValue) || 0)).toFixed(1)}%`}
              {cpiOperation === 'subtract' && `If CPI is 3%, growth = ${(3 - (parseFloat(cpiValue) || 0)).toFixed(1)}%`}
              {cpiOperation === 'multiply' && `If CPI is 3%, growth = ${(3 * (parseFloat(cpiValue) || 0)).toFixed(1)}%`}
            </p>
          </div>
        )}

        {(growthType === 'increasing' || growthType === 'decreasing') && (
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Input
              label="Starting Rate (%)"
              type="number"
              step="0.1"
              value={growthRate}
              onChange={(e) => setGrowthRate(e.target.value)}
            />
            <Input
              label="Change Per Year (%)"
              type="number"
              step="0.1"
              value={changePerYear}
              onChange={(e) => setChangePerYear(e.target.value)}
            />
          </div>
        )}
      </div>

      {type === 'asset' && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Income Generation</h3>
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Return Rate (%)"
              type="number"
              step="0.1"
              value={returnRate}
              onChange={(e) => setReturnRate(e.target.value)}
              placeholder="e.g. 5 for 5%"
            />
            <Input
              label="Franking (%)"
              type="number"
              step="1"
              min="0"
              max="100"
              value={frankingPercentage}
              onChange={(e) => setFrankingPercentage(e.target.value)}
              placeholder="e.g. 100 for fully franked"
            />
            <Select
              label={returnRate ? "Generates Income To *" : "Generates Income To"}
              value={incomeTargetAccountId}
              onChange={(e) => setIncomeTargetAccountId(e.target.value)}
            >
              <option value="">{returnRate ? 'Select account...' : 'None'}</option>
              {incomeAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {returnRate 
              ? 'Required when return rate is set. Franking credits gross up the income and provide a tax offset.'
              : 'Select an income account to receive investment returns. Set franking % for dividend imputation credits.'}
          </p>
        </div>
      )}

      {type === 'liability' && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Liability Details</h3>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Input
              label="Interest Rate (%)"
              type="number"
              step="0.1"
              value={interestRate}
              onChange={(e) => setInterestRate(e.target.value)}
              placeholder="e.g. 6.5 for 6.5%"
            />
            <Select
              label="Payment Type"
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as LiabilityPaymentType)}
            >
              <option value="principalAndInterest">Principal & Interest</option>
              <option value="interestOnly">Interest Only</option>
            </Select>
          </div>
          
          <div className="mb-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={calculatePayment}
                onChange={(e) => setCalculatePayment(e.target.checked)}
                className="rounded border-gray-300"
              />
              Auto-calculate payment to pay off by end date
            </label>
          </div>
          
          {!calculatePayment && (
            <Input
              label="Annual Payment"
              type="number"
              value={annualPayment}
              onChange={(e) => setAnnualPayment(e.target.value)}
              placeholder="Fixed annual payment amount"
            />
          )}
          
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Select
              label="Payments From *"
              hint="The asset account used to make loan payments. Interest and principal payments will be withdrawn from this account."
              value={fundedByAccountId}
              onChange={(e) => setFundedByAccountId(e.target.value)}
            >
              <option value="">Select account...</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            <Select
              label="Offset Account"
              hint="An offset account reduces interest charged. Interest is calculated on: Loan Balance - Offset Balance."
              value={offsetAccountId}
              onChange={(e) => setOffsetAccountId(e.target.value)}
            >
              <option value="">None</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </div>
          
          <div className="mt-4">
            <Select
              label="Pay Off When Asset Sells"
              hint="Links this loan to an asset. When the asset is sold (or transferred), the loan will be automatically paid off from the 'Payments From' account."
              value={payoffFromAccountId}
              onChange={(e) => setPayoffFromAccountId(e.target.value)}
            >
              <option value="">None</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </div>
        </div>
      )}

      <div className="border-t pt-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Start Condition</h3>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Condition Type"
            hint="When this account becomes active. Before this, the account has no value or flows. Use 'Person Age' for life-event triggers (e.g., retirement)."
            value={startConditionType}
            onChange={(e) => setStartConditionType(e.target.value as typeof startConditionType)}
          >
            <option value="none">None</option>
            <option value="year">Specific Year</option>
            <option value="age">Person Age</option>
          </Select>
          {startConditionType !== 'none' && (
            <Input
              label={startConditionType === 'year' ? 'Year' : 'Age'}
              type="number"
              value={startConditionValue}
              onChange={(e) => setStartConditionValue(e.target.value)}
            />
          )}
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">End Condition</h3>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Condition Type"
            hint="When this account ends. After this, the 'End Behavior' determines what happens to the value (e.g., transfer, sell, or zero out)."
            value={endConditionType}
            onChange={(e) => setEndConditionType(e.target.value as typeof endConditionType)}
          >
            <option value="none">None</option>
            <option value="year">Specific Year</option>
            <option value="age">Person Age</option>
          </Select>
          {endConditionType !== 'none' && (
            <Input
              label={endConditionType === 'year' ? 'Year' : 'Age'}
              type="number"
              value={endConditionValue}
              onChange={(e) => setEndConditionValue(e.target.value)}
            />
          )}
        </div>

        {endConditionType !== 'none' && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="End Behavior"
                value={endBehavior}
                onChange={(e) => setEndBehavior(e.target.value as EndBehavior)}
              >
                <option value="zero">Set to Zero</option>
                <option value="transfer">Transfer to Account</option>
                <option value="hold">Hold Value</option>
                {type === 'asset' && <option value="sell">Sell (triggers CGT)</option>}
                {type === 'asset' && <option value="sellNoCgt">Sell (no CGT)</option>}
              </Select>
              {(endBehavior === 'transfer' || endBehavior === 'sell' || endBehavior === 'sellNoCgt') && (
                <Select
                  label={`${endBehavior === 'sell' || endBehavior === 'sellNoCgt' ? 'Proceeds To' : 'Transfer To'} *`}
                  value={transferToAccountId}
                  onChange={(e) => setTransferToAccountId(e.target.value)}
                >
                  <option value="">Select account...</option>
                  {otherAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </Select>
              )}
            </div>
            
            {endBehavior === 'sell' && type === 'asset' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-amber-800 mb-3">Capital Gains Tax Settings</h4>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Cost Base ($)"
                    type="number"
                    value={costBase}
                    onChange={(e) => setCostBase(e.target.value)}
                    placeholder="Original purchase price"
                  />
                  <Input
                    label="Acquisition Year"
                    type="number"
                    value={acquisitionYear}
                    onChange={(e) => setAcquisitionYear(e.target.value)}
                    placeholder="e.g. 2020"
                  />
                </div>
                <div className="mt-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={eligibleForCgtDiscount}
                      onChange={(e) => setEligibleForCgtDiscount(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    Eligible for 50% CGT discount (held &gt; 12 months)
                  </label>
                </div>
                <p className="text-xs text-amber-600 mt-2">
                  If cost base is not set, initial value will be used.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {(type === 'income' || type === 'asset') && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Tax Funding Override</h3>
          <Select
            label="Pay Tax From"
            value={taxFundedFromAccountId}
            onChange={(e) => setTaxFundedFromAccountId(e.target.value)}
          >
            <option value="">Use default (from Settings)</option>
            {assetAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
          <p className="text-xs text-gray-500 mt-1">
            Override which account pays tax generated by this account.
          </p>
        </div>
      )}

      {type === 'asset' && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Auto Top-Up</h3>
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={autoTopupEnabled}
                onChange={(e) => setAutoTopupEnabled(e.target.checked)}
                className="rounded border-gray-300"
              />
              Enable automatic top-up when balance falls below threshold
            </label>
            
            {autoTopupEnabled && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
                <Select
                  label="Top Up From"
                  value={autoTopupFromAccountId}
                  onChange={(e) => setAutoTopupFromAccountId(e.target.value)}
                >
                  <option value="" disabled>Select source account...</option>
                  {assetAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </Select>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Threshold ($)"
                    type="number"
                    value={autoTopupThreshold}
                    onChange={(e) => setAutoTopupThreshold(e.target.value)}
                    placeholder="0"
                  />
                  <Input
                    label="Target Balance ($)"
                    type="number"
                    value={autoTopupTargetBalance}
                    onChange={(e) => setAutoTopupTargetBalance(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <p className="text-xs text-blue-600">
                  When balance falls below threshold, transfer from source account. 
                  If target balance is set, top up to that amount; otherwise top up to threshold.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {deleteError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-medium text-red-800 mb-2">{deleteError.message}</p>
          <ul className="text-sm text-red-700 list-disc list-inside space-y-1">
            {deleteError.references.map((ref, idx) => (
              <li key={idx}>
                <span className="font-medium">{ref.name}</span>
                <span className="text-red-600"> ({ref.type === 'account' ? 'Account' : 'Event'} → {ref.field})</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-red-600 mt-2">
            Update or delete these references first, then try again.
          </p>
        </div>
      )}

      <div className="flex justify-between pt-4 border-t">
        <div>
          {account && onDelete && (
            <Button
              type="button"
              variant="secondary"
              onClick={handleDelete}
              disabled={isDeleting}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </div>
    </form>
  );
}
