import { useState } from 'react';
import { Button, Input, Select } from '../ui';
import type { Event, EventType, SuperContributionType, SuperContributionSource } from '../../schemas/event';
import type { Account } from '../../schemas/account';
import type { Person } from '../../schemas/person';
import type { ForecastResult } from '../../schemas/forecast';
import type { EventTaxTreatmentType } from '../../schemas/tax';
import type { Settings } from '../../schemas/settings';
import { defaultSourceConfigs } from '../../schemas/settings';

interface EventFormProps {
  event?: Event;
  accounts: Account[];
  persons?: Person[];
  forecast?: ForecastResult | null;
  settings?: Settings;
  onSubmit: (data: Omit<Event, 'id'>) => void;
  onCancel: () => void;
}

export function EventForm({ event, accounts, persons, forecast, settings, onSubmit, onCancel }: EventFormProps) {
  const getSourceConfig = (source: SuperContributionSource) => {
    const customConfigs = settings?.super?.sourceConfigs;
    if (customConfigs) {
      const custom = customConfigs.find((c) => c.source === source);
      if (custom) return custom;
    }
    return defaultSourceConfigs.find((c) => c.source === source);
  };
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
  const [personId, setPersonId] = useState(event?.personId ?? '');
  
  // Super contribution settings
  const [superContributionType, setSuperContributionType] = useState<SuperContributionType>(
    event?.superContribution?.contributionType ?? 'concessional'
  );
  const [superSource, setSuperSource] = useState<SuperContributionSource>(
    event?.superContribution?.source ?? 'employerSG'
  );
  const [reducesAssessableIncome, setReducesAssessableIncome] = useState(
    event?.superContribution?.reducesAssessableIncome ?? false
  );

  const handleSourceChange = (newSource: SuperContributionSource) => {
    setSuperSource(newSource);
    // Auto-apply defaults from source config (only for new events, not editing)
    if (!event) {
      const config = getSourceConfig(newSource);
      if (config) {
        setSuperContributionType(config.defaultContributionType);
        setReducesAssessableIncome(config.defaultReducesAssessableIncome);
      }
    }
  };
  
  const assetAccounts = accounts.filter((a) => a.type === 'asset');
  const superAccounts = accounts.filter((a) => a.type === 'asset' && a.assetSubType === 'superannuation');

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
    } else if (type === 'superContribution') {
      // Super contribution: target is the super account, source is optional (for salary sacrifice)
      data.targetAccountId = targetAccountId || undefined;
      data.sourceAccountId = sourceAccountId || undefined;
      
      // Use first person as member (single member support)
      const memberPersonId = persons?.[0]?.id ?? 'default-person';
      
      data.superContribution = {
        contributionType: superContributionType,
        source: superSource,
        memberPersonId,
        reducesAssessableIncome,
        // exemptFromCap is derived from contributionType === 'capExempt' in the engine
      };
    } else {
      data.affectedAccountId = affectedAccountId || undefined;
    }

    // Tax settings - always set these to ensure clearing works
    data.taxTreatmentType = taxTreatmentType || undefined;
    data.taxFundedFromAccountId = taxFundedFromAccountId || undefined;
    data.personId = personId || undefined;

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
        <option value="superContribution">Super Contribution</option>
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
      ) : type === 'superContribution' ? (
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-purple-800 mb-2">Super Contribution Details</h3>
          
          <Input
            label="Amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Select
              label="Contribution Name"
              value={superSource}
              onChange={(e) => handleSourceChange(e.target.value as SuperContributionSource)}
            >
              {defaultSourceConfigs.map((config) => (
                <option key={config.source} value={config.source}>
                  {getSourceConfig(config.source)?.label ?? config.label}
                </option>
              ))}
            </Select>

            <Select
              label="Contribution Type"
              value={superContributionType}
              onChange={(e) => setSuperContributionType(e.target.value as SuperContributionType)}
            >
              <option value="concessional">Concessional (pre-tax)</option>
              <option value="nonConcessional">Non-Concessional (after-tax)</option>
              <option value="capExempt">Cap-Exempt</option>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4">
            <Select
              label="From Account (optional)"
              value={sourceAccountId}
              onChange={(e) => setSourceAccountId(e.target.value)}
            >
              <option value="">None (employer contribution)</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>

            <Select
              label="To Super Account"
              value={targetAccountId}
              onChange={(e) => setTargetAccountId(e.target.value)}
            >
              <option value="">Select super account...</option>
              {superAccounts.length > 0 ? (
                superAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.owner ? ` (${persons?.find(p => p.id === a.owner)?.name ?? 'Unknown'})` : ''}</option>
                ))
              ) : (
                assetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.owner ? ` (${persons?.find(p => p.id === a.owner)?.name ?? 'Unknown'})` : ''}</option>
                ))
              )}
            </Select>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            The super account's owner determines whose contribution cap this applies to.
          </p>

          {superContributionType === 'concessional' && (superSource === 'salarySacrifice' || superSource === 'personalDeductible') && (
            <div className="mt-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reducesAssessableIncome}
                  onChange={(e) => setReducesAssessableIncome(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                <span className="text-sm text-gray-700">Reduces assessable income</span>
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Check this if the contribution reduces your taxable income (salary sacrifice or claimed deduction)
              </p>
            </div>
          )}

          <div className="mt-4 bg-purple-50 border border-purple-200 rounded-lg p-3">
            <p className="text-sm text-purple-700">
              {superContributionType === 'concessional' && (
                <>Concessional contributions are taxed at 15% within the fund. Cap: $30,000/year (+ unused carry-forward).</>
              )}
              {superContributionType === 'nonConcessional' && (
                <>Non-concessional contributions are not taxed (already after-tax). Cap: $120,000/year (bring-forward available).</>
              )}
              {superContributionType === 'capExempt' && (
                <>Cap-exempt contributions (e.g. downsizer, government co-contribution) are not subject to contribution caps.</>
              )}
            </p>
          </div>
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

      {/* Tax Settings Section - not shown for super contributions (tax is handled automatically) */}
      {type !== 'superContribution' && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Tax Treatment</h3>
          <Select
            label="Tax Treatment"
            value={taxTreatmentType}
            onChange={(e) => setTaxTreatmentType(e.target.value as EventTaxTreatmentType | '')}
          >
            <option value="">None (no tax impact)</option>
            <option value="taxable">Taxable Income (adds to assessable income)</option>
            <option value="taxDeduction">Tax Deduction (reduces taxable income)</option>
          </Select>

          {taxTreatmentType === 'taxable' && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-700">
                This event will add {amount ? `$${parseFloat(amount).toLocaleString()}` : 'the specified amount'} to assessable income.
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Examples: Ad-hoc income, bonus payments, one-off consulting fees
              </p>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <Select
                  label="Applies to Person"
                  value={personId}
                  onChange={(e) => setPersonId(e.target.value)}
                >
                  <option value="">Select person...</option>
                  {persons?.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
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
            </div>
          )}

          {taxTreatmentType === 'taxDeduction' && (
            <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm text-green-700">
                This event will reduce assessable income by {amount ? `$${parseFloat(amount).toLocaleString()}` : 'the specified amount'}.
              </p>
              <p className="text-xs text-green-600 mt-1">
                Examples: Work-related deductions, investment expenses
              </p>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <Select
                  label="Applies to Person"
                  value={personId}
                  onChange={(e) => setPersonId(e.target.value)}
                >
                  <option value="">Select person...</option>
                  {persons?.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
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
            </div>
          )}
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
