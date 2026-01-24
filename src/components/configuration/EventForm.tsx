import { useState } from 'react';
import { Button, Input, Select } from '../ui';
import type { Event, EventType } from '../../schemas/event';
import type { Account } from '../../schemas/account';
import type { ForecastResult } from '../../schemas/forecast';

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

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
