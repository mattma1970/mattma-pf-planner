interface YearCellProps {
  value: number;
  onClick?: () => void;
  isNegative?: boolean;
  highlightColor?: string;
  tooltip?: string;
}

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function YearCell({ value, onClick, isNegative, highlightColor, tooltip }: YearCellProps) {
  const colorClass = isNegative ?? value < 0 ? 'text-red-600' : 'text-gray-900';

  return (
    <td
      className={`px-3 py-2 text-right whitespace-nowrap ${colorClass} ${onClick ? 'cursor-pointer hover:bg-gray-100' : ''} ${tooltip ? 'cursor-help' : ''}`}
      style={highlightColor ? { backgroundColor: highlightColor } : undefined}
      onClick={onClick}
      title={tooltip}
    >
      {currencyFormatter.format(value)}
    </td>
  );
}
