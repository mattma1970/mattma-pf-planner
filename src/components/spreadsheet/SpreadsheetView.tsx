import { useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { AccountRow } from './AccountRow';
import { GroupHeader } from './GroupHeader';
import { YearCell } from './YearCell';
import type { Account, AccountType } from '../../schemas/account';
import type { Event } from '../../schemas/event';
import type { ForecastResult, YearResult } from '../../schemas/forecast';
import type { TaxAggregation, TaxEvent } from '../../schemas/tax';
import { TaxDetailPanel } from '../tax';

interface SpreadsheetViewProps {
  forecast: ForecastResult | null;
  accounts: Account[];
  events?: Event[];
  showEventHighlights?: boolean;
  eventHighlightColor?: string;
  onAccountClick?: (accountId: string) => void;
  onReorder?: (type: AccountType, accountIds: string[]) => void;
}



type TotalsRow = {
  label: string;
  getValue: (year: YearResult) => number;
  isBold?: boolean;
};

const totalsRows: TotalsRow[] = [
  { label: 'Total Income', getValue: (y) => y.totalIncome },
  { label: 'Total Expenses', getValue: (y) => y.totalExpenses },
  { label: 'Total Tax', getValue: (y) => y.taxPayable },
  { label: 'Cash Flow', getValue: (y) => y.totalIncome - y.totalExpenses - y.taxPayable },
  { label: 'Net Worth', getValue: (y) => y.totalAssets, isBold: true },
];



interface TaxDetailState {
  year: number;
  fundingAccountId: string;
  aggregation: TaxAggregation;
  taxEvents: TaxEvent[];
}

export function SpreadsheetView({ forecast, accounts, events = [], showEventHighlights = false, eventHighlightColor, onAccountClick, onReorder }: SpreadsheetViewProps) {
  const years = forecast?.years ?? [];
  const [selectedTaxDetail, setSelectedTaxDetail] = useState<TaxDetailState | null>(null);
  const [isTaxExpanded, setIsTaxExpanded] = useState(false);
  const [isCashflowExpanded, setIsCashflowExpanded] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const accountsByType = useMemo(() => {
    return {
      income: accounts.filter((a) => a.type === 'income'),
      expense: accounts.filter((a) => a.type === 'expense'),
      asset: accounts.filter((a) => a.type === 'asset'),
      liability: accounts.filter((a) => a.type === 'liability'),
    };
  }, [accounts]);

  const taxAggregationsByFundingAccount = useMemo(() => {
    const fundingAccounts = new Set<string>();
    const aggregationsByYear = new Map<string, Map<number, { calculatedTax: number; totalAssessable: number; fundedFromAccountName: string; taxSchedule: string }>>();
    
    // Track tax events by type and source: fundingAccountId -> taxType -> sourceKey -> year -> data
    type TaxEventData = { assessableAmount: number; description: string };
    const eventsByTypeAndSource = new Map<string, Map<string, Map<string, Map<number, TaxEventData>>>>();
    
    // Track subtotals by type: fundingAccountId -> taxType -> year -> subtotal
    const subtotalsByType = new Map<string, Map<string, Map<number, number>>>();
    
    for (const yearResult of years) {
      for (const agg of yearResult.taxAggregations) {
        fundingAccounts.add(agg.fundedFromAccountId);
        
        if (!aggregationsByYear.has(agg.fundedFromAccountId)) {
          aggregationsByYear.set(agg.fundedFromAccountId, new Map());
        }
        aggregationsByYear.get(agg.fundedFromAccountId)!.set(yearResult.year, {
          calculatedTax: agg.calculatedTax,
          totalAssessable: agg.totalAssessable,
          fundedFromAccountName: agg.fundedFromAccountName,
          taxSchedule: agg.taxSchedule,
        });
      }
      
      // Organize tax events by type, then by source
      for (const taxEvent of yearResult.taxEvents) {
        const fundingId = taxEvent.fundedFromAccountId;
        const taxType = taxEvent.type;
        const sourceKey = taxEvent.sourceAccountId ?? `__${taxEvent.type}__${taxEvent.description}`;
        const sourceName = taxEvent.sourceAccountName ?? taxEvent.description;
        
        // Initialize nested maps
        if (!eventsByTypeAndSource.has(fundingId)) {
          eventsByTypeAndSource.set(fundingId, new Map());
        }
        const fundingEvents = eventsByTypeAndSource.get(fundingId)!;
        if (!fundingEvents.has(taxType)) {
          fundingEvents.set(taxType, new Map());
        }
        const typeEvents = fundingEvents.get(taxType)!;
        if (!typeEvents.has(sourceKey)) {
          typeEvents.set(sourceKey, new Map());
        }
        typeEvents.get(sourceKey)!.set(yearResult.year, {
          assessableAmount: taxEvent.assessableAmount,
          description: sourceName,
        });
        
        // Track subtotals by type
        if (!subtotalsByType.has(fundingId)) {
          subtotalsByType.set(fundingId, new Map());
        }
        const fundingSubtotals = subtotalsByType.get(fundingId)!;
        if (!fundingSubtotals.has(taxType)) {
          fundingSubtotals.set(taxType, new Map());
        }
        const typeSubtotals = fundingSubtotals.get(taxType)!;
        typeSubtotals.set(yearResult.year, (typeSubtotals.get(yearResult.year) ?? 0) + taxEvent.assessableAmount);
      }
    }
    
    // Calculate total tax across all funding accounts per year
    const totalTaxByYear = new Map<number, number>();
    for (const yearResult of years) {
      totalTaxByYear.set(yearResult.year, yearResult.taxPayable);
    }
    
    return {
      fundingAccounts: Array.from(fundingAccounts),
      aggregationsByYear,
      eventsByTypeAndSource,
      subtotalsByType,
      totalTaxByYear,
    };
  }, [years]);

  const eventDescriptionsByAccount = useMemo(() => {
    if (!showEventHighlights) return new Map<string, Map<number, string[]>>();
    
    const map = new Map<string, Map<number, string[]>>();
    
    const addDescription = (accountId: string, year: number, description: string) => {
      if (!map.has(accountId)) {
        map.set(accountId, new Map());
      }
      const yearMap = map.get(accountId)!;
      if (!yearMap.has(year)) {
        yearMap.set(year, []);
      }
      yearMap.get(year)!.push(description);
    };
    
    for (const event of events) {
      if (event.affectedAccountId) {
        addDescription(event.affectedAccountId, event.year, event.description);
      }
      if (event.sourceAccountId) {
        addDescription(event.sourceAccountId, event.year, `${event.description} (transfer out)`);
      }
      if (event.targetAccountId) {
        addDescription(event.targetAccountId, event.year, `${event.description} (transfer in)`);
      }
    }
    return map;
  }, [events, showEventHighlights]);

  const handleDragEnd = (type: AccountType) => (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const items = accountsByType[type];
      const oldIndex = items.findIndex((a) => a.id === active.id);
      const newIndex = items.findIndex((a) => a.id === over.id);

      const newItems = [...items];
      const [removed] = newItems.splice(oldIndex, 1);
      newItems.splice(newIndex, 0, removed);

      onReorder?.(type, newItems.map((a) => a.id));
    }
  };

  const colSpan = years.length + 1;

  if (!forecast) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No forecast data. Run a forecast to see projections.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 border-r border-gray-200 z-10 min-w-48">
              Account
            </th>
            {years.map((y) => (
              <th
                key={y.year}
                className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {y.year}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {accountsByType.income.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd('income')}
            >
              <SortableContext
                items={accountsByType.income.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                <GroupHeader title="Income" colSpan={colSpan}>
                  {accountsByType.income.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      years={years}
                      onClick={() => onAccountClick?.(account.id)}
                      isDraggable={!!onReorder}
                      eventDescriptions={eventDescriptionsByAccount.get(account.id)}
                      highlightColor={eventHighlightColor}
                    />
                  ))}
                </GroupHeader>
              </SortableContext>
            </DndContext>
          )}

          {accountsByType.expense.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd('expense')}
            >
              <SortableContext
                items={accountsByType.expense.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                <GroupHeader title="Expenses" colSpan={colSpan}>
                  {accountsByType.expense.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      years={years}
                      onClick={() => onAccountClick?.(account.id)}
                      isDraggable={!!onReorder}
                      eventDescriptions={eventDescriptionsByAccount.get(account.id)}
                      highlightColor={eventHighlightColor}
                    />
                  ))}
                </GroupHeader>
              </SortableContext>
            </DndContext>
          )}

          {accountsByType.asset.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd('asset')}
            >
              <SortableContext
                items={accountsByType.asset.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                <GroupHeader title="Assets (Closing Balances)" colSpan={colSpan}>
                  {accountsByType.asset.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      years={years}
                      onClick={() => onAccountClick?.(account.id)}
                      isDraggable={!!onReorder}
                      eventDescriptions={eventDescriptionsByAccount.get(account.id)}
                      highlightColor={eventHighlightColor}
                    />
                  ))}
                </GroupHeader>
              </SortableContext>
            </DndContext>
          )}

          {accountsByType.liability.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd('liability')}
            >
              <SortableContext
                items={accountsByType.liability.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                <GroupHeader title="Liabilities (Closing Balances)" colSpan={colSpan}>
                  {accountsByType.liability.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      years={years}
                      onClick={() => onAccountClick?.(account.id)}
                      isDraggable={!!onReorder}
                      eventDescriptions={eventDescriptionsByAccount.get(account.id)}
                      highlightColor={eventHighlightColor}
                    />
                  ))}
                </GroupHeader>
              </SortableContext>
            </DndContext>
          )}

          {taxAggregationsByFundingAccount.fundingAccounts.length > 0 && (
            <>
              <tr className="bg-amber-50">
                <th
                  colSpan={colSpan}
                  className="px-3 py-2 text-left font-semibold text-amber-800 sticky left-0 bg-amber-50"
                >
                  Tax
                </th>
              </tr>
              
              {/* Single Total Tax row */}
              <tr className="bg-amber-50/30">
                <td className="px-3 py-2 text-left text-gray-900 sticky left-0 bg-white border-r border-gray-200 min-w-48">
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => setIsTaxExpanded(!isTaxExpanded)}
                      className="mt-0.5 text-gray-400 hover:text-gray-600 flex-shrink-0"
                    >
                      {isTaxExpanded ? '▼' : '▶'}
                    </button>
                    <span className="font-medium">Total Tax</span>
                  </div>
                </td>
                {years.map((yearData) => {
                  const totalTax = taxAggregationsByFundingAccount.totalTaxByYear.get(yearData.year) ?? 0;
                  return (
                    <td
                      key={yearData.year}
                      className="px-3 py-2 text-right text-gray-900 font-medium"
                    >
                      {new Intl.NumberFormat('en-AU', {
                        style: 'currency',
                        currency: 'AUD',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      }).format(totalTax)}
                    </td>
                  );
                })}
              </tr>
              
              {/* Expanded: Show funding account sections */}
              {isTaxExpanded && taxAggregationsByFundingAccount.fundingAccounts.map((fundingAccountId) => {
                const aggsByYear = taxAggregationsByFundingAccount.aggregationsByYear.get(fundingAccountId);
                const firstAgg = aggsByYear?.values().next().value;
                const fundedFromName = firstAgg?.fundedFromAccountName ?? 'Not configured';
                const taxSchedule = firstAgg?.taxSchedule === 'flatRate15' ? '15% flat' : 'Marginal rates';
                
                const eventsByType = taxAggregationsByFundingAccount.eventsByTypeAndSource.get(fundingAccountId);
                const subtotals = taxAggregationsByFundingAccount.subtotalsByType.get(fundingAccountId);
                
                const handleTaxCellClick = (yearData: YearResult) => {
                  const taxEventsForYear = yearData.taxEvents.filter(
                    e => e.fundedFromAccountId === fundingAccountId
                  );
                  const aggForYear = yearData.taxAggregations.find(
                    a => a.fundedFromAccountId === fundingAccountId
                  );
                  if (aggForYear) {
                    setSelectedTaxDetail({
                      year: yearData.year,
                      fundingAccountId,
                      aggregation: aggForYear,
                      taxEvents: taxEventsForYear,
                    });
                  }
                };

                const formatCurrency = (value: number) => new Intl.NumberFormat('en-AU', {
                  style: 'currency',
                  currency: 'AUD',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                }).format(value);

                const taxTypeConfig: Record<string, { label: string; bgClass: string; textClass: string }> = {
                  incomeTax: { label: 'Income', bgClass: 'bg-blue-100', textClass: 'text-blue-700' },
                  capitalGainsTax: { label: 'Capital Gains', bgClass: 'bg-purple-100', textClass: 'text-purple-700' },
                  taxDeduction: { label: 'Deductions', bgClass: 'bg-green-100', textClass: 'text-green-700' },
                  superContributionTax: { label: 'Super Contributions', bgClass: 'bg-orange-100', textClass: 'text-orange-700' },
                };

                const taxTypes = eventsByType ? Array.from(eventsByType.keys()) : [];
                
                return (
                  <>
                    {/* Funding account header row */}
                    <tr key={fundingAccountId} className="bg-amber-100/50">
                      <td className="px-3 py-1.5 text-left text-gray-800 sticky left-0 bg-amber-100/50 border-r border-gray-200 min-w-48 pl-8">
                        <div>
                          <span className="font-medium text-sm">Paid from: {fundedFromName}</span>
                          <span className="text-xs text-gray-500 ml-2">({taxSchedule})</span>
                        </div>
                      </td>
                      {years.map((yearData) => (
                        <td key={yearData.year} className="px-3 py-1.5 text-right text-gray-400 text-xs">
                          Assessable
                        </td>
                      ))}
                    </tr>
                    
                    {/* Tax type sections with individual accounts */}
                    {taxTypes.map((taxType) => {
                      const typeConfig = taxTypeConfig[taxType] ?? { label: taxType, bgClass: 'bg-gray-100', textClass: 'text-gray-700' };
                      const sourcesByKey = eventsByType?.get(taxType);
                      const typeSubtotals = subtotals?.get(taxType);
                      
                      if (!sourcesByKey) return null;
                      
                      const sourceKeys = Array.from(sourcesByKey.keys());
                      
                      return (
                        <>
                          {/* Individual account rows for this tax type */}
                          {sourceKeys.map((sourceKey) => {
                            const sourceEventsByYear = sourcesByKey.get(sourceKey);
                            const firstEvent = sourceEventsByYear?.values().next().value;
                            const sourceName = firstEvent?.description ?? 'Unknown';
                            
                            return (
                              <tr key={`${fundingAccountId}-${taxType}-${sourceKey}`} className="bg-white">
                                <td className="px-3 py-1 text-left text-gray-600 sticky left-0 bg-white border-r border-gray-200 min-w-48 pl-12">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${typeConfig.bgClass} ${typeConfig.textClass}`}>
                                      {typeConfig.label}
                                    </span>
                                    <span className="text-sm">{sourceName}</span>
                                  </div>
                                </td>
                                {years.map((yearData) => {
                                  const eventData = sourceEventsByYear?.get(yearData.year);
                                  return (
                                    <td
                                      key={yearData.year}
                                      className={`px-3 py-1 text-right text-sm ${
                                        taxType === 'taxDeduction' ? 'text-green-600' : 'text-gray-600'
                                      }`}
                                    >
                                      {eventData ? formatCurrency(eventData.assessableAmount) : '-'}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                          
                          {/* Subtotal row for this tax type */}
                          <tr key={`${fundingAccountId}-${taxType}-subtotal`} className="bg-gray-50">
                            <td className="px-3 py-1 text-left text-gray-700 sticky left-0 bg-gray-50 border-r border-gray-200 min-w-48 pl-12">
                              <span className="text-sm font-medium">Subtotal {typeConfig.label}</span>
                            </td>
                            {years.map((yearData) => {
                              const subtotal = typeSubtotals?.get(yearData.year) ?? 0;
                              return (
                                <td
                                  key={yearData.year}
                                  className={`px-3 py-1 text-right text-sm font-medium ${
                                    taxType === 'taxDeduction' ? 'text-green-700' : 'text-gray-700'
                                  }`}
                                >
                                  {formatCurrency(subtotal)}
                                </td>
                              );
                            })}
                          </tr>
                        </>
                      );
                    })}
                    
                    {/* Total Assessable row */}
                    <tr key={`${fundingAccountId}-total-assessable`} className="bg-amber-50">
                      <td className="px-3 py-1.5 text-left text-gray-800 sticky left-0 bg-amber-50 border-r border-gray-200 min-w-48 pl-10">
                        <span className="text-sm font-semibold">Total Assessable</span>
                      </td>
                      {years.map((yearData) => {
                        const agg = aggsByYear?.get(yearData.year);
                        return (
                          <td key={yearData.year} className="px-3 py-1.5 text-right text-gray-800 text-sm font-semibold">
                            {formatCurrency(agg?.totalAssessable ?? 0)}
                          </td>
                        );
                      })}
                    </tr>
                    
                    {/* Tax Payable row */}
                    <tr key={`${fundingAccountId}-tax-payable`} className="bg-amber-100/70">
                      <td className="px-3 py-1.5 text-left text-amber-800 sticky left-0 bg-amber-100/70 border-r border-gray-200 min-w-48 pl-10">
                        <span className="text-sm font-semibold">Tax Payable</span>
                      </td>
                      {years.map((yearData) => {
                        const agg = aggsByYear?.get(yearData.year);
                        return (
                          <td
                            key={yearData.year}
                            onClick={() => handleTaxCellClick(yearData)}
                            className="px-3 py-1.5 text-right text-amber-800 text-sm font-semibold cursor-pointer hover:bg-amber-200 transition-colors"
                          >
                            {formatCurrency(agg?.calculatedTax ?? 0)}
                          </td>
                        );
                      })}
                    </tr>
                  </>
                );
              })}
            </>
          )}

          {/* Account Analysis Section */}
          <tr className="bg-cyan-50">
            <th
              colSpan={colSpan}
              className="px-3 py-2 text-left font-semibold text-cyan-800 sticky left-0 bg-cyan-50"
            >
              <button
                onClick={() => setIsCashflowExpanded(!isCashflowExpanded)}
                className="flex items-center gap-2 hover:text-cyan-600"
              >
                <span className="text-gray-400">{isCashflowExpanded ? '▼' : '▶'}</span>
                Account Analysis
              </button>
            </th>
          </tr>
          
          {isCashflowExpanded && accounts.filter(a => a.type === 'asset').map((account) => {
            const formatCurrency = (value: number) => new Intl.NumberFormat('en-AU', {
              style: 'currency',
              currency: 'AUD',
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            }).format(value);
            
            return (
              <>
                {/* Account header */}
                <tr key={`cf-${account.id}-header`} className="bg-cyan-100/50">
                  <td className="px-3 py-1.5 text-left text-cyan-800 font-medium sticky left-0 bg-cyan-100/50 border-r border-gray-200 min-w-48">
                    {account.name}
                  </td>
                  {years.map((yearData) => (
                    <td key={yearData.year} className="px-3 py-1.5 text-right text-xs text-gray-400">
                      {yearData.year}
                    </td>
                  ))}
                </tr>
                
                {/* Opening Balance */}
                <tr key={`cf-${account.id}-open`} className="bg-white">
                  <td className="px-3 py-1 text-left text-gray-600 text-sm sticky left-0 bg-white border-r border-gray-200 min-w-48 pl-6">
                    Opening Balance
                  </td>
                  {years.map((yearData) => {
                    const result = yearData.accounts.find(a => a.accountId === account.id);
                    return (
                      <td key={yearData.year} className="px-3 py-1 text-right text-sm text-gray-600">
                        {result ? formatCurrency(result.startValue) : '-'}
                      </td>
                    );
                  })}
                </tr>
                
                {/* Contributions (inflows) */}
                <tr key={`cf-${account.id}-contrib`} className="bg-white">
                  <td className="px-3 py-1 text-left text-gray-600 text-sm sticky left-0 bg-white border-r border-gray-200 min-w-48 pl-6">
                    + Contributions
                  </td>
                  {years.map((yearData) => {
                    const result = yearData.accounts.find(a => a.accountId === account.id);
                    const value = result?.contributions ?? 0;
                    return (
                      <td key={yearData.year} className={`px-3 py-1 text-right text-sm ${value > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                        {value !== 0 ? formatCurrency(value) : '-'}
                      </td>
                    );
                  })}
                </tr>
                
                {/* Withdrawals (outflows) */}
                <tr key={`cf-${account.id}-withdraw`} className="bg-white">
                  <td className="px-3 py-1 text-left text-gray-600 text-sm sticky left-0 bg-white border-r border-gray-200 min-w-48 pl-6">
                    − Withdrawals
                  </td>
                  {years.map((yearData) => {
                    const result = yearData.accounts.find(a => a.accountId === account.id);
                    const value = result?.withdrawals ?? 0;
                    return (
                      <td key={yearData.year} className={`px-3 py-1 text-right text-sm ${value > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {value !== 0 ? formatCurrency(-value) : '-'}
                      </td>
                    );
                  })}
                </tr>
                
                {/* Transfers */}
                <tr key={`cf-${account.id}-transfer`} className="bg-white">
                  <td className="px-3 py-1 text-left text-gray-600 text-sm sticky left-0 bg-white border-r border-gray-200 min-w-48 pl-6">
                    ± Transfers
                  </td>
                  {years.map((yearData) => {
                    const result = yearData.accounts.find(a => a.accountId === account.id);
                    const value = result?.transfers ?? 0;
                    return (
                      <td key={yearData.year} className={`px-3 py-1 text-right text-sm ${value > 0 ? 'text-green-600' : value < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {value !== 0 ? formatCurrency(value) : '-'}
                      </td>
                    );
                  })}
                </tr>
                
                {/* Growth */}
                <tr key={`cf-${account.id}-growth`} className="bg-white">
                  <td className="px-3 py-1 text-left text-gray-600 text-sm sticky left-0 bg-white border-r border-gray-200 min-w-48 pl-6">
                    + Growth
                  </td>
                  {years.map((yearData) => {
                    const result = yearData.accounts.find(a => a.accountId === account.id);
                    const value = result?.growth ?? 0;
                    return (
                      <td key={yearData.year} className={`px-3 py-1 text-right text-sm ${value > 0 ? 'text-blue-600' : value < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {value !== 0 ? formatCurrency(value) : '-'}
                      </td>
                    );
                  })}
                </tr>
                
                {/* Closing Balance */}
                <tr key={`cf-${account.id}-close`} className="bg-gray-50">
                  <td className="px-3 py-1 text-left text-gray-800 text-sm font-medium sticky left-0 bg-gray-50 border-r border-gray-200 min-w-48 pl-6">
                    = Closing Balance
                  </td>
                  {years.map((yearData) => {
                    const result = yearData.accounts.find(a => a.accountId === account.id);
                    const value = result?.endValue ?? 0;
                    return (
                      <td key={yearData.year} className={`px-3 py-1 text-right text-sm font-medium ${value < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                        {formatCurrency(value)}
                      </td>
                    );
                  })}
                </tr>
              </>
            );
          })}

          <tr className="bg-gray-100">
            <th
              colSpan={colSpan}
              className="px-3 py-2 text-left font-semibold text-gray-700 sticky left-0 bg-gray-100"
            >
              Calculated Totals
            </th>
          </tr>
          {totalsRows.map((row) => (
            <tr key={row.label} className={row.isBold ? 'font-semibold bg-gray-50' : ''}>
              <td className="px-3 py-2 text-left text-gray-900 sticky left-0 bg-white border-r border-gray-200 min-w-48">
                {row.label}
              </td>
              {years.map((y) => (
                <YearCell key={y.year} value={row.getValue(y)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {selectedTaxDetail && (
        <TaxDetailPanel
          year={selectedTaxDetail.year}
          taxEvents={selectedTaxDetail.taxEvents}
          aggregation={selectedTaxDetail.aggregation}
          onClose={() => setSelectedTaxDetail(null)}
        />
      )}
    </div>
  );
}
