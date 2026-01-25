import { useState } from 'react';
import { Button, Input, Select } from '../ui';
import type { Event, EventType } from '../../schemas/event';
import type { Account } from '../../schemas/account';
import type { ForecastResult } from '../../schemas/forecast';
import type { EventTaxTreatmentType } from '../../schemas/tax';

interface EventFormProps {
  event?: Event;
  accounts: Account[];
  forecast?: ForecastResult | null;
  onSubmit: (data: Omit<Event, 'id'>) => void;
  onCancel: () => void;
}

export function EventForm({ event, accounts, forecast, onSubmit, onCancel }: EventFormProps) {
  const [year, setYear] = useState(event?.year?.toString() ?? new Date().getFullYear().toString());
  const [type, setType] = useState<EventType>(event?.type ?? 'income');
  const [description, setDescription] = useState(event?.description ?? '');
  const [amount, setAmount] = useState(event?.amount?.toString() ?? '0');
  const [affectedAccountId, setAffectedAccountId] = useState(event?.affectedAccountId ?? '');
  const [sourceAccountId, setSourceAccountId] = useState(event?.sourceAccountId ?? '');
  const [targetAccountId, setTargetAccountId] = useState(event?.targetAccountId ?? '');
  const [transferAll, setTransferAll] = useState(event?.transferAll ?? false);
  
  // Tax settings
  const [taxTreatmentType, setTaxTreatmentType] = useState<EventTaxTreatmentType | ''>(event?.taxTreatmentType ?? '');
  const [taxFundedFromAccountId, setTaxFundedFromAccountId] = useState(event?.taxFundedFromAccountId ?? '');
  const [costBase, setCostBase] = useState(event?.costBase?.toString() ?? '');
  const [acquisitionYear, setAcquisitionYear] = useState(event?.acquisitionYear?.toString() ?? '');
  
  const assetAccounts = accounts.filter((a) => a.type === 'asset');

  const calculateTransferAllAmount = (eventYear: number, accountId: string): number => {
    if (!forecast || !accountId) return 0;
    
    const yearData = forecast.years.find((y) => y.year === eventYear);
    if (!yearData) {
      const lastYear = forecast.years[forecast.years.length - 1];
      if (lastYear) {
        const accountResult = lastYear.accounts.find((a) => a.accountId === accountId);
        return accountResult?.endValue ?? 0;
      }
      return 0;
    }
    
    const prevYearData = forecast.years.find((y) => y.year === eventYear - 1);
    if (prevYearData) {
      const accountResult = prevYearData.accounts.find((a) => a.accountId === accountId);
      return accountResult?.endValue ?? 0;
    }
    
    const account = accounts.find((a) => a.id === accountId);
    return account?.initialValue ?? 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const eventYear = parseInt(year) || new Date().getFullYear();
    let calculatedAmount = parseFloat(amount) || 0;

    if (type === 'transfer' && transferAll && sourceAccountId) {
      calculatedAmount = calculateTransferAllAmount(eventYear, sourceAccountId);
    }

    const data: Omit<Event, 'id'> = {
      year: eventYear,
      type,
      description,
      amount: calculatedAmount,
    };

    if (type === 'transfer') {
      data.sourceAccountId = sourceAccountId || undefined;
      data.targetAccountId = targetAccountId || undefined;
      data.transferAll = transferAll || undefined;
    } else {
      data.affectedAccountId = affectedAccountId || undefined;
    }

    // Tax settings - always set these to ensure clearing works
    data.taxTreatmentType = taxTreatmentType || undefined;
    data.taxFundedFromAccountId = taxFundedFromAccountId || undefined;
    
    if (taxTreatmentType === 'capitalGain') {
      data.costBase = costBase ? parseFloat(costBase) : undefined;
      data.acquisitionYear = acquisitionYear ? parseInt(acquisitionYear) : undefined;
    } else {
      data.costBase = undefined;
      data.acquisitionYear = undefined;
    }

    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Year"
        type="number"
        value={year}
        onChange={(e) => setYear(e.target.value)}
        required
      />

      <Select
        label="Type"
        value={type}
        onChange={(e) => setType(e.target.value as EventType)}
      >
        <option value="income">Income</option>
        <option value="expense">Expense</option>
        <option value="assetChange">Asset Change</option>
        <option value="liabilityChange">Liability Change</option>
        <option value="transfer">Transfer</option>
      </Select>

      <Input
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        required
      />

      {type === 'transfer' ? (
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Transfer Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="From Account"
              value={sourceAccountId}
              onChange={(e) => setSourceAccountId(e.target.value)}
            >
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>

            <Select
              label="To Account"
              value={targetAccountId}
              onChange={(e) => setTargetAccountId(e.target.value)}
            >
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </div>

          <div className="mt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={transferAll}
                onChange={(e) => setTransferAll(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Transfer entire account balance</span>
            </label>
          </div>

          {!transferAll && (
            <div className="mt-4">
              <Input
                label="Amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <Input
            label="Amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <Select
            label="Affected Account"
            value={affectedAccountId}
            onChange={(e) => setAffectedAccountId(e.target.value)}
          >
            <option value="">None</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </>
      )}

      {/* Tax Settings Section */}
      <div className="border-t pt-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Tax Treatment</h3>
        <Select
          label="Tax Treatment"
          value={taxTreatmentType}
          onChange={(e) => setTaxTreatmentType(e.target.value as EventTaxTreatmentType | '')}
        >
          <option value="">None (no tax impact)</option>
          <option value="taxDeduction">Tax Deduction (reduces taxable income)</option>
          <option value="capitalGain">Capital Gain (triggers CGT)</option>
          <option value="superContribution">Super Contribution</option>
        </Select>

        {taxTreatmentType === 'taxDeduction' && (
          <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-sm text-green-700">
              This event will reduce assessable income by {amount ? `$${parseFloat(amount).toLocaleString()}` : 'the specified amount'}.
            </p>
            <p className="text-xs text-green-600 mt-1">
              Examples: Salary sacrifice to super, work-related deductions
            </p>
          </div>
        )}

        {taxTreatmentType === 'capitalGain' && (
          <div className="mt-3 bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-3">
            <p className="text-sm text-purple-700">
              This event will trigger capital gains tax.
            </p>
            <div className="grid grid-cols-2 gap-3">
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
          </div>
        )}

        {taxTreatmentType === 'superContribution' && (
          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-700">
              This contribution will be tracked for super contribution caps.
            </p>
            <p className="text-xs text-blue-600 mt-1">
              Concessional cap: $30,000/year. Excess contributions taxed at 15%.
            </p>
          </div>
        )}

        {(taxTreatmentType === 'taxDeduction' || taxTreatmentType === 'capitalGain') && (
          <div className="mt-3">
            <Select
              label="Tax Funded From (override)"
              value={taxFundedFromAccountId}
              onChange={(e) => setTaxFundedFromAccountId(e.target.value)}
            >
              <option value="">Use default (from Settings)</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
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
