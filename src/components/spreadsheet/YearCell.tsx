interface YearCellProps {
  value: number;
  onClick?: () => void;
  isNegative?: boolean;
  highlightColor?: string;
  tooltip?: string;
  warnNegative?: boolean;
  autoTopupApplied?: boolean;
  contributionAfterClose?: boolean;
}

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function YearCell({ value, onClick, isNegative, highlightColor, tooltip, warnNegative, autoTopupApplied, contributionAfterClose }: YearCellProps) {
  const isValueNegative = isNegative ?? value < 0;
  const colorClass = isValueNegative ? 'text-red-600' : 'text-gray-900';
  
  // For warnNegative, show a subtle red background when value is negative
  // Priority: negative warning (red) > contribution after close (amber) > auto top-up (amber) > highlight color
  const showNegativeWarning = warnNegative && value < 0;
  const bgStyle = showNegativeWarning 
    ? { backgroundColor: '#fee2e2' } // red-100
    : contributionAfterClose
      ? { backgroundColor: '#fef3c7' } // amber-100
      : autoTopupApplied
        ? { backgroundColor: '#fef3c7' } // amber-100
        : highlightColor 
          ? { backgroundColor: highlightColor } 
          : undefined;
  
  // Build tooltip with appropriate warnings
  let warningTooltip = tooltip;
  if (showNegativeWarning) {
    warningTooltip = `⚠️ Negative balance (overdrawn)${tooltip ? '\n' + tooltip : ''}`;
  } else if (autoTopupApplied) {
    warningTooltip = `↔️ Auto top-up applied${tooltip ? '\n' + tooltip : ''}`;
  }

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
