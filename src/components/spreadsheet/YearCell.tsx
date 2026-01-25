interface YearCellProps {
  value: number;
  onClick?: () => void;
  isNegative?: boolean;
  highlightColor?: string;
  tooltip?: string;
  warnNegative?: boolean;
}

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function YearCell({ value, onClick, isNegative, highlightColor, tooltip, warnNegative }: YearCellProps) {
  const isValueNegative = isNegative ?? value < 0;
  const colorClass = isValueNegative ? 'text-red-600' : 'text-gray-900';
  
  // For warnNegative, show a subtle red background when value is negative
  const showNegativeWarning = warnNegative && value < 0;
  const bgStyle = showNegativeWarning 
    ? { backgroundColor: '#fee2e2' } // red-100
    : highlightColor 
      ? { backgroundColor: highlightColor } 
      : undefined;
  
  const warningTooltip = showNegativeWarning 
    ? `⚠️ Negative balance (overdrawn)${tooltip ? '\n' + tooltip : ''}`
    : tooltip;

  return (
    <td
      className={`px-3 py-2 text-right whitespace-nowrap ${colorClass} ${onClick ? 'cursor-pointer hover:bg-gray-100' : ''} ${warningTooltip ? 'cursor-help' : ''}`}
      style={bgStyle}
      onClick={onClick}
      title={warningTooltip}
    >
      {currencyFormatter.format(value)}
    </td>
  );
}
