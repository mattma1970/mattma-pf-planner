import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ForecastResult } from '../../schemas/forecast';
import type { Event } from '../../schemas/event';
import type { Account } from '../../schemas/account';
import type { Person } from '../../schemas/person';

interface NetWorthChartProps {
  forecast: ForecastResult | null;
  events?: Event[];
  accounts?: Account[];
  persons?: Person[];
}

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const formatYAxis = (value: number) => {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return currencyFormatter.format(value);
};

function getConditionYear(
  condition: { type: 'year'; year: number } | { type: 'age'; personId: string; age: number },
  persons: Person[]
): number {
  if (condition.type === 'year') return condition.year;
  const person = persons.find((p) => p.id === condition.personId);
  if (person) return person.birthYear + condition.age;
  return 0;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: number;
  eventsByYear: Map<number, string[]>;
}

function CustomTooltip({ active, payload, label, eventsByYear }: CustomTooltipProps) {
  if (!active || !payload || !label) return null;

  const yearEvents = eventsByYear.get(label) || [];

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-900 mb-2">Year: {label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-gray-700">
          {entry.dataKey === 'netWorth' ? 'Net Worth' : 'Liquid Assets'}:{' '}
          <span className="font-medium">{currencyFormatter.format(entry.value)}</span>
        </p>
      ))}
      {yearEvents.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          <p className="font-medium text-gray-700 mb-1">Events:</p>
          <ul className="text-gray-600 space-y-1">
            {yearEvents.map((event, idx) => (
              <li key={idx} className="text-xs">• {event}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function NetWorthChart({ forecast, events = [], accounts = [], persons = [] }: NetWorthChartProps) {
  if (!forecast) return null;

  const eventsByYear = useMemo(() => {
    const map = new Map<number, string[]>();
    
    const addEvent = (year: number, description: string) => {
      if (!map.has(year)) map.set(year, []);
      map.get(year)!.push(description);
    };

    for (const event of events) {
      addEvent(event.year, event.description);
    }

    for (const account of accounts) {
      if (account.startCondition) {
        const startYear = getConditionYear(account.startCondition, persons);
        addEvent(startYear, `${account.name} starts`);
      }
      if (account.endCondition) {
        const endYear = getConditionYear(account.endCondition, persons);
        const behavior = account.endBehavior === 'transfer' ? 'transfers' : 
                        account.endBehavior === 'hold' ? 'holds value' : 'ends';
        addEvent(endYear, `${account.name} ${behavior}`);
      }
    }

    return map;
  }, [events, accounts, persons]);

  const hasLiquidAssets = forecast.years.some((y) => y.totalLiquidAssets > 0);

  const data = forecast.years.map((y) => ({
    year: y.year,
    netWorth: y.totalAssets,
    liquidAssets: y.totalLiquidAssets,
  }));

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Net Worth Over Time</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" />
          <YAxis tickFormatter={formatYAxis} />
          <Tooltip content={<CustomTooltip eventsByYear={eventsByYear} />} />
          {hasLiquidAssets && <Legend />}
          <Line
            type="monotone"
            dataKey="netWorth"
            name="Net Worth"
            stroke="#2563eb"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 6 }}
          />
          {hasLiquidAssets && (
            <Line
              type="monotone"
              dataKey="liquidAssets"
              name="Liquid Assets"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 6 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
