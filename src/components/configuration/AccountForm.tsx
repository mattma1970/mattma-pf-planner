import { useState } from 'react';
import { Button, Input, Select } from '../ui';
import type { Account, GrowthProfile, AccountCondition, EndBehavior, LiquidityType, IncomeTaxTreatment, GrowthOperation, LiabilityPaymentType } from '../../schemas/account';

interface AccountFormProps {
  account?: Account;
  accounts: Account[];
  onSubmit: (data: Omit<Account, 'id'>) => void;
  onCancel: () => void;
}

export function AccountForm({ account, accounts, onSubmit, onCancel }: AccountFormProps) {
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState(account?.type ?? 'income');
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
  const [depositsToAccountId, setDepositsToAccountId] = useState(account?.depositsToAccountId ?? '');
  const [fundedByAccountId, setFundedByAccountId] = useState(account?.fundedByAccountId ?? '');
  const [returnRate, setReturnRate] = useState(account?.returnRate ? (account.returnRate * 100).toString() : '');
  const [incomeTargetAccountId, setIncomeTargetAccountId] = useState(account?.incomeTargetAccountId ?? '');
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

  const otherAccounts = accounts.filter((a) => a.id !== account?.id);
  const assetAccounts = accounts.filter((a) => a.type === 'asset' && a.id !== account?.id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

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
      initialValue: parseFloat(initialValue) || 0,
      growthProfile,
      returnRate: type === 'asset' && returnRate ? parseFloat(returnRate) / 100 : undefined,
      incomeTargetAccountId: type === 'asset' && incomeTargetAccountId ? incomeTargetAccountId : undefined,
      liquidityType: type === 'asset' && liquidityType ? liquidityType : undefined,
      startCondition,
      endCondition,
      endBehavior: endCondition ? endBehavior : undefined,
      transferToAccountId: (endBehavior === 'transfer' || endBehavior === 'sell') ? transferToAccountId : undefined,
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
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Account Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />

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

      {type === 'income' && (
        <>
          <Select
            label="Deposits To"
            value={depositsToAccountId}
            onChange={(e) => setDepositsToAccountId(e.target.value)}
          >
            <option value="">None</option>
            {assetAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
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

      {(type === 'expense' || type === 'asset') && (
        <Select
          label="Funded By"
          value={fundedByAccountId}
          onChange={(e) => setFundedByAccountId(e.target.value)}
        >
          <option value="">None</option>
          {assetAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      )}

      {type === 'asset' && (
        <Select
          label="Liquidity"
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
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Return Rate (%)"
              type="number"
              step="0.1"
              value={returnRate}
              onChange={(e) => setReturnRate(e.target.value)}
              placeholder="e.g. 5 for 5%"
            />
            <Select
              label="Generates Income To"
              value={incomeTargetAccountId}
              onChange={(e) => setIncomeTargetAccountId(e.target.value)}
            >
              <option value="">None</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </div>
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
              label="Payments From"
              value={fundedByAccountId}
              onChange={(e) => setFundedByAccountId(e.target.value)}
            >
              <option value="">None</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            <Select
              label="Offset Account"
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
              value={payoffFromAccountId}
              onChange={(e) => setPayoffFromAccountId(e.target.value)}
            >
              <option value="">None</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            <p className="text-xs text-gray-500 mt-1">
              Liability will be paid off when the selected asset is sold
            </p>
          </div>
        </div>
      )}

      <div className="border-t pt-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Start Condition</h3>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Condition Type"
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
              </Select>
              {(endBehavior === 'transfer' || endBehavior === 'sell') && (
                <Select
                  label={endBehavior === 'sell' ? 'Proceeds To' : 'Transfer To'}
                  value={transferToAccountId}
                  onChange={(e) => setTransferToAccountId(e.target.value)}
                >
                  <option value="" disabled>Select account...</option>
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

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
