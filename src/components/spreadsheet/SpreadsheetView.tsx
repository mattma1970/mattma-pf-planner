import { useMemo } from 'react';
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
import type { TaxEvent } from '../../schemas/tax';

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

const TAX_TYPE_LABELS: Record<string, string> = {
  incomeTax: 'Income Tax',
  capitalGainsTax: 'Capital Gains Tax',
  superContributionTax: 'Super Contribution Tax',
};

export function SpreadsheetView({ forecast, accounts, events = [], showEventHighlights = false, eventHighlightColor, onAccountClick, onReorder }: SpreadsheetViewProps) {
  const years = forecast?.years ?? [];

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

  const taxEventsByType = useMemo(() => {
    const eventTypes = new Set<string>();
    const eventsByYear = new Map<string, Map<number, TaxEvent>>();
    
    for (const yearResult of years) {
      for (const taxEvent of yearResult.taxEvents) {
        eventTypes.add(taxEvent.type);
        
        if (!eventsByYear.has(taxEvent.type)) {
          eventsByYear.set(taxEvent.type, new Map());
        }
        eventsByYear.get(taxEvent.type)!.set(yearResult.year, taxEvent);
      }
    }
    
    return {
      types: Array.from(eventTypes),
      eventsByYear,
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
                <GroupHeader title="Assets" colSpan={colSpan}>
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
                <GroupHeader title="Liabilities" colSpan={colSpan}>
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

          {taxEventsByType.types.length > 0 && (
            <>
              <tr className="bg-amber-50">
                <th
                  colSpan={colSpan}
                  className="px-3 py-2 text-left font-semibold text-amber-800 sticky left-0 bg-amber-50"
                >
                  Tax
                </th>
              </tr>
              {taxEventsByType.types.map((taxType) => {
                const eventsByYear = taxEventsByType.eventsByYear.get(taxType);
                const firstEvent = eventsByYear?.values().next().value;
                const fundedFromName = firstEvent?.fundedFromAccountName ?? 'Not configured';
                
                return (
                  <tr key={taxType} className="bg-amber-50/30">
                    <td className="px-3 py-2 text-left text-gray-900 sticky left-0 bg-white border-r border-gray-200 min-w-48">
                      <div>
                        <span className="font-medium">{TAX_TYPE_LABELS[taxType] ?? taxType}</span>
                        <div className="text-xs text-gray-500">Paid from: {fundedFromName}</div>
                      </div>
                    </td>
                    {years.map((yearData) => {
                      const taxEvent = eventsByYear?.get(yearData.year);
                      return (
                        <YearCell key={yearData.year} value={taxEvent?.amount ?? 0} />
                      );
                    })}
                  </tr>
                );
              })}
            </>
          )}

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
    </div>
  );
}
