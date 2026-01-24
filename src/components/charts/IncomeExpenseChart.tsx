import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ForecastResult } from '../../schemas/forecast';

interface IncomeExpenseChartProps {
  forecast: ForecastResult | null;
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

export function IncomeExpenseChart({ forecast }: IncomeExpenseChartProps) {
  if (!forecast) return null;

  const data = forecast.years.map((y) => ({
    year: y.year,
    income: y.totalIncome,
    expenses: y.totalExpenses,
  }));

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Income vs Expenses</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" />
          <YAxis tickFormatter={formatYAxis} />
          <Tooltip
            formatter={(value, name) => [
              typeof value === 'number' ? currencyFormatter.format(value) : '-',
              name === 'income' ? 'Income' : 'Expenses',
            ]}
            labelFormatter={(label) => `Year: ${label}`}
          />
          <Legend />
          <Bar dataKey="income" name="Income" fill="#22c55e" />
          <Bar dataKey="expenses" name="Expenses" fill="#ef4444" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
