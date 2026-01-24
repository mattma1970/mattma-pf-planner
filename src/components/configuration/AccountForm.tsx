import { useState } from 'react';
import { Button, Input, Select } from '../ui';
import type { Account, GrowthProfile, AccountCondition, EndBehavior, LiquidityType } from '../../schemas/account';

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
    if (gp?.type === 'fixed') return gp.rate.toString();
    if (gp?.type === 'cpiLinked') return gp.offset.toString();
    if (gp?.type === 'increasing') return gp.rate.toString();
    if (gp?.type === 'decreasing') return gp.rate.toString();
    return '0';
  });
  const [changePerYear, setChangePerYear] = useState(() => {
    const gp = account?.growthProfile;
    if (gp?.type === 'increasing') return gp.changePerYear.toString();
    if (gp?.type === 'decreasing') return gp.changePerYear.toString();
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
  const [returnRate, setReturnRate] = useState(account?.returnRate?.toString() ?? '');
  const [incomeTargetAccountId, setIncomeTargetAccountId] = useState(account?.incomeTargetAccountId ?? '');
  const [liquidityType, setLiquidityType] = useState<LiquidityType | ''>(account?.liquidityType ?? '');

  const otherAccounts = accounts.filter((a) => a.id !== account?.id);
  const assetAccounts = accounts.filter((a) => a.type === 'asset' && a.id !== account?.id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const growthProfile: GrowthProfile = (() => {
      const rate = parseFloat(growthRate) || 0;
      const change = parseFloat(changePerYear) || 0;
      switch (growthType) {
        case 'fixed':
          return { type: 'fixed' as const, rate };
        case 'cpiLinked':
          return { type: 'cpiLinked' as const, offset: rate };
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

    onSubmit({
      name,
      type,
      initialValue: parseFloat(initialValue) || 0,
      growthProfile,
      returnRate: type === 'asset' && returnRate ? parseFloat(returnRate) : undefined,
      incomeTargetAccountId: type === 'asset' && incomeTargetAccountId ? incomeTargetAccountId : undefined,
      liquidityType: type === 'asset' && liquidityType ? liquidityType : undefined,
      startCondition,
      endCondition,
      endBehavior: endCondition ? endBehavior : undefined,
      transferToAccountId: endBehavior === 'transfer' ? transferToAccountId : undefined,
      depositsToAccountId: type === 'income' && depositsToAccountId ? depositsToAccountId : undefined,
      fundedByAccountId: (type === 'expense' || type === 'asset') && fundedByAccountId ? fundedByAccountId : undefined,
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
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Growth Type"
            value={growthType}
            onChange={(e) => setGrowthType(e.target.value as GrowthProfile['type'])}
          >
            <option value="fixed">Fixed Rate</option>
            <option value="cpiLinked">CPI Linked</option>
            <option value="increasing">Increasing Rate</option>
            <option value="decreasing">Decreasing Rate</option>
          </Select>
          <Input
            label={growthType === 'cpiLinked' ? 'CPI Offset (%)' : 'Rate (%)'}
            type="number"
            step="0.1"
            value={growthRate}
            onChange={(e) => setGrowthRate(e.target.value)}
          />
          {(growthType === 'increasing' || growthType === 'decreasing') && (
            <Input
              label="Change Per Year (%)"
              type="number"
              step="0.1"
              value={changePerYear}
              onChange={(e) => setChangePerYear(e.target.value)}
            />
          )}
        </div>
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
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Select
              label="End Behavior"
              value={endBehavior}
              onChange={(e) => setEndBehavior(e.target.value as EndBehavior)}
            >
              <option value="zero">Set to Zero</option>
              <option value="transfer">Transfer to Account</option>
              <option value="hold">Hold Value</option>
            </Select>
            {endBehavior === 'transfer' && (
              <Select
                label="Transfer To"
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
        )}
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
