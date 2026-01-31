import { useMemo, useState } from 'react';
import type { ForecastWarning, YearResult } from '../../schemas/forecast';

interface WarningsPanelProps {
  years: YearResult[];
}

interface AggregatedWarning {
  year: number;
  warning: ForecastWarning;
}

export function WarningsPanel({ years }: WarningsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  
  const allWarnings = useMemo(() => {
    const warnings: AggregatedWarning[] = [];
    for (const year of years) {
      if (year.warnings) {
        for (const warning of year.warnings) {
          warnings.push({ year: year.year, warning });
        }
      }
    }
    return warnings;
  }, [years]);

  if (allWarnings.length === 0) {
    return null;
  }

  const severityColors = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    error: 'bg-red-50 border-red-200 text-red-800',
  };

  const severityIcons = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌',
  };

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-t-lg w-full text-left hover:bg-amber-100 transition-colors"
      >
        <span className="text-base">⚠️</span>
        <span>
          {allWarnings.length} Warning{allWarnings.length !== 1 ? 's' : ''}
        </span>
        <span className="ml-auto text-xs text-amber-600">
          {isExpanded ? '▼ Hide' : '▶ Show'}
        </span>
      </button>
      
      {isExpanded && (
        <div className="border border-t-0 border-amber-200 rounded-b-lg divide-y divide-amber-100">
          {allWarnings.map((item, index) => (
            <div
              key={index}
              className={`px-3 py-2 text-sm ${severityColors[item.warning.severity]}`}
            >
              <div className="flex items-start gap-2">
                <span className="text-base flex-shrink-0">
                  {severityIcons[item.warning.severity]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {item.year}: {item.warning.message}
                  </div>
                  {item.warning.details && (
                    <div className="text-xs mt-0.5 opacity-80">
                      {item.warning.details}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
