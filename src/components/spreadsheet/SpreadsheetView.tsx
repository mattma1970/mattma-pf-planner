import { Fragment, useMemo, useState } from 'react';
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
import type { Epoch } from '../../schemas/epoch';
import type { Event } from '../../schemas/event';
import type { Person } from '../../schemas/person';
import type { ForecastResult, YearResult } from '../../schemas/forecast';
import type { TaxAggregation, TaxEvent } from '../../schemas/tax';
import { TaxDetailPanel } from '../tax';

interface SpreadsheetViewProps {
  forecast: ForecastResult | null;
  accounts: Account[];
  epochs?: Epoch[];
  persons?: Person[];
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

export function SpreadsheetView({ forecast, accounts, epochs = [], persons = [], events = [], showEventHighlights = false, eventHighlightColor, onAccountClick, onReorder }: SpreadsheetViewProps) {
  const years = forecast?.years ?? [];
  const [selectedTaxDetail, setSelectedTaxDetail] = useState<TaxDetailState | null>(null);
  const [isTaxExpanded, setIsTaxExpanded] = useState(false);
  const [isCashflowExpanded, setIsCashflowExpanded] = useState(false);

  const sortedEpochs = useMemo(() => [...epochs].sort((a, b) => a.order - b.order), [epochs]);

  const getEpochForYear = (year: number): Epoch | undefined => {
    return sortedEpochs.find(e => year >= e.startYear && year <= e.endYear);
  };

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

  const taxByPersonDetailed = useMemo(() => {
    const personIds = new Set<string>();
    const personNames = new Map<string, string>();
    
    // Structure: personId -> taxType -> sourceKey -> year -> data
    type TaxEventData = { assessableAmount: number; description: string };
    const eventsByPersonTypeSource = new Map<string, Map<string, Map<string, Map<number, TaxEventData>>>>();
    
    // Subtotals: personId -> taxType -> year -> subtotal
    const subtotalsByPersonType = new Map<string, Map<string, Map<number, number>>>();
    
    // Totals: personId -> year -> { totalAssessable, calculatedTax }
    const totalsByPerson = new Map<string, Map<number, { totalAssessable: number; calculatedTax: number }>>();
    
    // Super fund taxes (for reporting below the line): personId -> sourceKey -> year -> { amount, description }
    type SuperFundTaxData = { amount: number; description: string; type: string };
    const superFundTaxesByPerson = new Map<string, Map<string, Map<number, SuperFundTaxData>>>();
    
    for (const yearResult of years) {
      // Build totals from taxByPerson
      if (yearResult.taxByPerson) {
        for (const personTax of yearResult.taxByPerson) {
          personIds.add(personTax.personId);
          personNames.set(personTax.personId, personTax.personName);
          
          if (!totalsByPerson.has(personTax.personId)) {
            totalsByPerson.set(personTax.personId, new Map());
          }
          totalsByPerson.get(personTax.personId)!.set(yearResult.year, {
            totalAssessable: personTax.totalAssessable,
            calculatedTax: personTax.calculatedTax,
          });
        }
      }
      
      // Build detailed events by person, type, source
      for (const taxEvent of yearResult.taxEvents) {
        const personId = taxEvent.personId ?? 'unassigned';
        const personName = taxEvent.personName ?? 'Unassigned';
        
        // Track super fund taxes separately (for reporting below the line)
        if (taxEvent.type === 'superContributionTax' || taxEvent.type === 'division293Tax') {
          personIds.add(personId);
          if (!personNames.has(personId)) {
            personNames.set(personId, personName);
          }
          
          const sourceKey = taxEvent.sourceAccountId ?? `__${taxEvent.type}__${taxEvent.description}`;
          if (!superFundTaxesByPerson.has(personId)) {
            superFundTaxesByPerson.set(personId, new Map());
          }
          const personSuperTaxes = superFundTaxesByPerson.get(personId)!;
          if (!personSuperTaxes.has(sourceKey)) {
            personSuperTaxes.set(sourceKey, new Map());
          }
          personSuperTaxes.get(sourceKey)!.set(yearResult.year, {
            amount: taxEvent.type === 'superContributionTax' 
              ? (yearResult.accounts.find(a => a.accountId === taxEvent.sourceAccountId)?.cashflowDetails?.find(d => d.description.includes('contributions tax'))?.amount ?? 0)
              : (yearResult.accounts.find(a => a.accountId === taxEvent.fundedFromAccountId)?.cashflowDetails?.find(d => d.description.includes('Division 293'))?.amount ?? 0),
            description: taxEvent.description,
            type: taxEvent.type,
          });
          continue;
        }
        
        const taxType = taxEvent.type;
        const sourceKey = taxEvent.sourceAccountId ?? `__${taxEvent.type}__${taxEvent.description}`;
        const sourceName = taxEvent.sourceAccountName ?? taxEvent.description;
        
        personIds.add(personId);
        if (!personNames.has(personId)) {
          personNames.set(personId, personName);
        }
        
        // Initialize nested maps for events
        if (!eventsByPersonTypeSource.has(personId)) {
          eventsByPersonTypeSource.set(personId, new Map());
        }
        const personEvents = eventsByPersonTypeSource.get(personId)!;
        if (!personEvents.has(taxType)) {
          personEvents.set(taxType, new Map());
        }
        const typeEvents = personEvents.get(taxType)!;
        if (!typeEvents.has(sourceKey)) {
          typeEvents.set(sourceKey, new Map());
        }
        typeEvents.get(sourceKey)!.set(yearResult.year, {
          assessableAmount: taxEvent.assessableAmount,
          description: sourceName,
        });
        
        // Track subtotals by type
        if (!subtotalsByPersonType.has(personId)) {
          subtotalsByPersonType.set(personId, new Map());
        }
        const personSubtotals = subtotalsByPersonType.get(personId)!;
        if (!personSubtotals.has(taxType)) {
          personSubtotals.set(taxType, new Map());
        }
        const typeSubtotals = personSubtotals.get(taxType)!;
        typeSubtotals.set(yearResult.year, (typeSubtotals.get(yearResult.year) ?? 0) + taxEvent.assessableAmount);
      }
    }
    
    return {
      personIds: Array.from(personIds),
      personNames,
      eventsByPersonTypeSource,
      subtotalsByPersonType,
      totalsByPerson,
      superFundTaxesByPerson,
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

  const offBalanceSheetData = useMemo(() => {
    const itemsById = new Map<string, { id: string; label: string; type: string; personId?: string; valuesByYear: Map<number, number> }>();
    const personNames = new Map(persons.map(p => [p.id, p.name]));
    
    for (const yearResult of years) {
      for (const item of yearResult.offBalanceSheet ?? []) {
        if (!itemsById.has(item.id)) {
          itemsById.set(item.id, {
            id: item.id,
            label: item.label,
            type: item.type,
            personId: item.personId,
            valuesByYear: new Map(),
          });
        }
        itemsById.get(item.id)!.valuesByYear.set(yearResult.year, item.value ?? item.closing ?? 0);
      }
    }
    
    const itemsByType = new Map<string, typeof itemsById extends Map<string, infer V> ? V[] : never>();
    for (const item of itemsById.values()) {
      if (!itemsByType.has(item.type)) {
        itemsByType.set(item.type, []);
      }
      itemsByType.get(item.type)!.push(item);
    }
    
    const typeLabels: Record<string, string> = {
      carryForwardContribution: 'Carry Forward Contributions',
      frankingCredits: 'Franking Credits',
      concessionalCapAccount: 'Concessional Cap',
      nonConcessionalCapAccount: 'Non-Concessional Cap',
    };
    
    return {
      hasItems: itemsById.size > 0,
      itemsByType,
      typeLabels,
      personNames,
    };
  }, [years, persons]);

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
          {sortedEpochs.length > 0 && (
            <tr>
              <th className="sticky left-0 bg-gray-50 border-r border-gray-200 z-10"></th>
              {years.map((y) => {
                const epoch = getEpochForYear(y.year);
                return (
                  <th
                    key={`epoch-${y.year}`}
                    className="h-1 p-0"
                    style={{ backgroundColor: epoch?.color || 'transparent' }}
                  />
                );
              })}
            </tr>
          )}
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
                      persons={persons}
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

          {taxByPersonDetailed.personIds.length > 0 && (
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
                      }).format(yearData.taxPayable)}
                    </td>
                  );
                })}
              </tr>
              
              {/* Expanded: Show per-person tax details */}
              {isTaxExpanded && taxByPersonDetailed.personIds.map((personId) => {
                const person = persons.find(p => p.id === personId);
                const personName = taxByPersonDetailed.personNames.get(personId) ?? (personId === 'unassigned' ? 'Unassigned' : personId);
                const eventsByType = taxByPersonDetailed.eventsByPersonTypeSource.get(personId);
                const subtotals = taxByPersonDetailed.subtotalsByPersonType.get(personId);
                const totals = taxByPersonDetailed.totalsByPerson.get(personId);

                const formatCurrency = (value: number) => new Intl.NumberFormat('en-AU', {
                  style: 'currency',
                  currency: 'AUD',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                }).format(value);

                // Get color classes based on person's configured color
                const colorConfig: Record<string, { headerBg: string; headerText: string; totalsBg: string; totalsText: string }> = {
                  indigo: { headerBg: 'bg-indigo-100/50', headerText: 'text-indigo-800', totalsBg: 'bg-indigo-100/70', totalsText: 'text-indigo-800' },
                  blue: { headerBg: 'bg-blue-100/50', headerText: 'text-blue-800', totalsBg: 'bg-blue-100/70', totalsText: 'text-blue-800' },
                  emerald: { headerBg: 'bg-emerald-100/50', headerText: 'text-emerald-800', totalsBg: 'bg-emerald-100/70', totalsText: 'text-emerald-800' },
                  amber: { headerBg: 'bg-amber-100/50', headerText: 'text-amber-800', totalsBg: 'bg-amber-100/70', totalsText: 'text-amber-800' },
                  rose: { headerBg: 'bg-rose-100/50', headerText: 'text-rose-800', totalsBg: 'bg-rose-100/70', totalsText: 'text-rose-800' },
                  purple: { headerBg: 'bg-purple-100/50', headerText: 'text-purple-800', totalsBg: 'bg-purple-100/70', totalsText: 'text-purple-800' },
                  cyan: { headerBg: 'bg-cyan-100/50', headerText: 'text-cyan-800', totalsBg: 'bg-cyan-100/70', totalsText: 'text-cyan-800' },
                  orange: { headerBg: 'bg-orange-100/50', headerText: 'text-orange-800', totalsBg: 'bg-orange-100/70', totalsText: 'text-orange-800' },
                };
                const personColor = person?.color ?? 'indigo';
                const colors = colorConfig[personColor] ?? colorConfig.indigo;

                const taxTypeConfig: Record<string, { label: string; bgClass: string; textClass: string }> = {
                  incomeTax: { label: 'Income', bgClass: 'bg-blue-100', textClass: 'text-blue-700' },
                  capitalGainsTax: { label: 'Capital Gains', bgClass: 'bg-purple-100', textClass: 'text-purple-700' },
                  taxDeduction: { label: 'Deductions', bgClass: 'bg-green-100', textClass: 'text-green-700' },
                  superContributionTax: { label: 'Super Contributions', bgClass: 'bg-orange-100', textClass: 'text-orange-700' },
                  frankingCreditOffset: { label: 'Franking Credit', bgClass: 'bg-teal-100', textClass: 'text-teal-700' },
                };

                const taxTypes = eventsByType ? Array.from(eventsByType.keys()) : [];
                
                return (
                  <>
                    {/* Person header row */}
                    <tr key={personId} className={colors.headerBg}>
                      <td className={`px-3 py-1.5 text-left ${colors.headerText} sticky left-0 ${colors.headerBg} border-r border-gray-200 min-w-48 pl-8`}>
                        <span className="font-medium text-sm">{personName}</span>
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
                              <tr key={`${personId}-${taxType}-${sourceKey}`} className="bg-white">
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
                                  const isOffset = taxType === 'taxDeduction' || taxType === 'frankingCreditOffset';
                                  return (
                                    <td
                                      key={yearData.year}
                                      className={`px-3 py-1 text-right text-sm ${
                                        isOffset ? 'text-green-600' : 'text-gray-600'
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
                          <tr key={`${personId}-${taxType}-subtotal`} className="bg-gray-50">
                            <td className="px-3 py-1 text-left text-gray-700 sticky left-0 bg-gray-50 border-r border-gray-200 min-w-48 pl-12">
                              <span className="text-sm font-medium">Subtotal {typeConfig.label}</span>
                            </td>
                            {years.map((yearData) => {
                              const subtotal = typeSubtotals?.get(yearData.year) ?? 0;
                              const isOffset = taxType === 'taxDeduction' || taxType === 'frankingCreditOffset';
                              return (
                                <td
                                  key={yearData.year}
                                  className={`px-3 py-1 text-right text-sm font-medium ${
                                    isOffset ? 'text-green-700' : 'text-gray-700'
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
                    <tr key={`${personId}-total-assessable`} className={colors.headerBg}>
                      <td className={`px-3 py-1.5 text-left text-gray-800 sticky left-0 ${colors.headerBg} border-r border-gray-200 min-w-48 pl-10`}>
                        <span className="text-sm font-semibold">Total Assessable</span>
                      </td>
                      {years.map((yearData) => {
                        const yearTotals = totals?.get(yearData.year);
                        return (
                          <td key={yearData.year} className="px-3 py-1.5 text-right text-gray-800 text-sm font-semibold">
                            {formatCurrency(yearTotals?.totalAssessable ?? 0)}
                          </td>
                        );
                      })}
                    </tr>
                    
                    {/* Tax Payable row */}
                    <tr key={`${personId}-tax-payable`} className={colors.totalsBg}>
                      <td className={`px-3 py-1.5 text-left ${colors.totalsText} sticky left-0 ${colors.totalsBg} border-r border-gray-200 min-w-48 pl-10`}>
                        <span className="text-sm font-semibold">Tax Payable</span>
                      </td>
                      {years.map((yearData) => {
                        const yearTotals = totals?.get(yearData.year);
                        return (
                          <td
                            key={yearData.year}
                            className={`px-3 py-1.5 text-right ${colors.totalsText} text-sm font-semibold`}
                          >
                            {formatCurrency(yearTotals?.calculatedTax ?? 0)}
                          </td>
                        );
                      })}
                    </tr>
                    
                    {/* Super Fund Taxes (for reporting) */}
                    {(() => {
                      const superTaxes = taxByPersonDetailed.superFundTaxesByPerson.get(personId);
                      if (!superTaxes || superTaxes.size === 0) return null;
                      
                      const sourceKeys = Array.from(superTaxes.keys());
                      return (
                        <>
                          <tr key={`${personId}-super-taxes-header`} className="bg-orange-50">
                            <td className="px-3 py-1 text-left text-orange-700 sticky left-0 bg-orange-50 border-r border-gray-200 min-w-48 pl-10">
                              <span className="text-xs font-medium">Super Fund Taxes (info only)</span>
                            </td>
                            {years.map((yearData) => (
                              <td key={yearData.year} className="px-3 py-1 text-right text-xs text-gray-400">
                                Amount
                              </td>
                            ))}
                          </tr>
                          {sourceKeys.map((sourceKey) => {
                            const taxByYear = superTaxes.get(sourceKey);
                            const firstEntry = taxByYear?.values().next().value;
                            const description = firstEntry?.description ?? 'Unknown';
                            const taxType = firstEntry?.type;
                            const label = taxType === 'superContributionTax' ? '15% Contributions Tax' : 'Division 293';
                            
                            return (
                              <tr key={`${personId}-super-tax-${sourceKey}`} className="bg-white">
                                <td className="px-3 py-1 text-left text-gray-500 sticky left-0 bg-white border-r border-gray-200 min-w-48 pl-12">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                                      {label}
                                    </span>
                                    <span className="text-xs text-gray-500">{description.replace('Contributions Tax: ', '').replace('Div 293: ', '')}</span>
                                  </div>
                                </td>
                                {years.map((yearData) => {
                                  const taxData = taxByYear?.get(yearData.year);
                                  return (
                                    <td key={yearData.year} className="px-3 py-1 text-right text-xs text-gray-500">
                                      {taxData && taxData.amount > 0 ? formatCurrency(taxData.amount) : '-'}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </>
                      );
                    })()}
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
          
          {isCashflowExpanded && accounts.filter(a => a.type === 'asset' || a.type === 'liability').map((account) => {
            const isLiability = account.type === 'liability';
            const formatCurrency = (value: number) => new Intl.NumberFormat('en-AU', {
              style: 'currency',
              currency: 'AUD',
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            }).format(value);
            
            return (
              <>
                {/* Account header */}
                <tr key={`cf-${account.id}-header`} className={isLiability ? 'bg-rose-100/50' : 'bg-cyan-100/50'}>
                  <td className={`px-3 py-1.5 text-left font-medium sticky left-0 border-r border-gray-200 min-w-48 ${isLiability ? 'text-rose-800 bg-rose-100/50' : 'text-cyan-800 bg-cyan-100/50'}`}>
                    {account.name} {isLiability && '(Liability)'}
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
                
                {/* Contributions (inflows) / Borrowing (for liabilities) */}
                <tr key={`cf-${account.id}-contrib`} className="bg-white">
                  <td className="px-3 py-1 text-left text-gray-600 text-sm sticky left-0 bg-white border-r border-gray-200 min-w-48 pl-6">
                    {isLiability ? '+ New Borrowing' : '+ Contributions'}
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
                
                {/* Withdrawals (outflows) / Principal Payments (for liabilities) */}
                <tr key={`cf-${account.id}-withdraw`} className="bg-white">
                  <td className="px-3 py-1 text-left text-gray-600 text-sm sticky left-0 bg-white border-r border-gray-200 min-w-48 pl-6">
                    {isLiability ? '− Principal Paid' : '− Withdrawals (Total)'}
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
                
                {/* Withdrawal breakdown (for non-liabilities with cashflow details) */}
                {!isLiability && (() => {
                  // Get all unique withdrawal descriptions across all years
                  const allDescriptions = new Set<string>();
                  years.forEach((yearData) => {
                    const result = yearData.accounts.find(a => a.accountId === account.id);
                    result?.cashflowDetails?.filter(d => d.type === 'withdrawal').forEach(d => allDescriptions.add(d.description));
                  });
                  
                  return Array.from(allDescriptions).map((description) => (
                    <tr key={`cf-${account.id}-detail-${description}`} className="bg-gray-50/50">
                      <td className="px-3 py-0.5 text-left text-gray-500 text-xs sticky left-0 bg-gray-50/50 border-r border-gray-200 min-w-48 pl-10">
                        {description}
                      </td>
                      {years.map((yearData) => {
                        const result = yearData.accounts.find(a => a.accountId === account.id);
                        const detail = result?.cashflowDetails?.find(d => d.description === description && d.type === 'withdrawal');
                        return (
                          <td key={yearData.year} className="px-3 py-0.5 text-right text-xs text-gray-500">
                            {detail ? formatCurrency(-detail.amount) : '-'}
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })()}
                
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
                
                {/* Growth / Interest (for liabilities) */}
                <tr key={`cf-${account.id}-growth`} className="bg-white">
                  <td className="px-3 py-1 text-left text-gray-600 text-sm sticky left-0 bg-white border-r border-gray-200 min-w-48 pl-6">
                    {isLiability ? '+ Interest Accrued' : '+ Growth'}
                  </td>
                  {years.map((yearData) => {
                    const result = yearData.accounts.find(a => a.accountId === account.id);
                    const value = result?.growth ?? 0;
                    return (
                      <td key={yearData.year} className={`px-3 py-1 text-right text-sm ${isLiability ? (value > 0 ? 'text-red-600' : 'text-gray-400') : (value > 0 ? 'text-blue-600' : value < 0 ? 'text-red-600' : 'text-gray-400')}`}>
                        {value !== 0 ? formatCurrency(value) : '-'}
                      </td>
                    );
                  })}
                </tr>
                
                {/* Interest Paid (for liabilities only) - interest is always paid */}
                {isLiability && (
                  <tr key={`cf-${account.id}-interest-paid`} className="bg-white">
                    <td className="px-3 py-1 text-left text-gray-600 text-sm sticky left-0 bg-white border-r border-gray-200 min-w-48 pl-6">
                      − Interest Paid
                    </td>
                    {years.map((yearData) => {
                      const result = yearData.accounts.find(a => a.accountId === account.id);
                      const value = result?.growth ?? 0; // Interest paid equals interest accrued
                      return (
                        <td key={yearData.year} className={`px-3 py-1 text-right text-sm ${value > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                          {value !== 0 ? formatCurrency(-value) : '-'}
                        </td>
                      );
                    })}
                  </tr>
                )}
                
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

          {/* Off-Balance Sheet Items within Account Analysis */}
          {isCashflowExpanded && offBalanceSheetData.hasItems && Array.from(offBalanceSheetData.itemsByType.entries()).map(([type, items]) => {
            const formatCurrency = (value: number) => new Intl.NumberFormat('en-AU', {
              style: 'currency',
              currency: 'AUD',
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            }).format(value);
            
            return (
              <Fragment key={`obs-type-${type}`}>
                <tr className="bg-purple-100/50">
                  <td className="px-3 py-1.5 text-left font-medium text-purple-800 sticky left-0 bg-purple-100/50 border-r border-gray-200 min-w-48">
                    {offBalanceSheetData.typeLabels[type] ?? type}
                  </td>
                  {years.map((yearData) => (
                    <td key={yearData.year} className="px-3 py-1.5 text-right text-xs text-gray-400">
                      {yearData.year}
                    </td>
                  ))}
                </tr>
                
                {items.map((item) => {
                  const personName = item.personId ? offBalanceSheetData.personNames.get(item.personId) : undefined;
                  const displayLabel = personName ? `${personName}` : item.label;
                  
                  return (
                    <tr key={`obs-${item.id}`} className="bg-white">
                      <td className="px-3 py-1 text-left text-gray-600 text-sm sticky left-0 bg-white border-r border-gray-200 min-w-48 pl-6">
                        {displayLabel}
                      </td>
                      {years.map((yearData) => {
                        const value = item.valuesByYear.get(yearData.year) ?? 0;
                        return (
                          <td key={yearData.year} className="px-3 py-1 text-right text-sm text-gray-600">
                            {value !== 0 ? formatCurrency(value) : '-'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
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
