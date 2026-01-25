import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { YearCell } from './YearCell';
import type { Account } from '../../schemas/account';
import type { Person } from '../../schemas/person';
import type { YearResult } from '../../schemas/forecast';
import { getAccountEndYear } from '../../engine/accounts';

interface AccountRowProps {
  account: Account;
  years: YearResult[];
  persons?: Person[];
  onClick?: () => void;
  isDraggable?: boolean;
  eventDescriptions?: Map<number, string[]>;
  highlightColor?: string;
}

export function AccountRow({ account, years, persons = [], onClick, isDraggable = false, eventDescriptions, highlightColor }: AccountRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: account.id, disabled: !isDraggable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`hover:bg-gray-50 ${isDragging ? 'bg-blue-50' : ''}`}
    >
      <td
        className="px-3 py-2 text-left font-medium text-gray-900 sticky left-0 bg-white border-r border-gray-200 min-w-48"
      >
        <div className="flex items-center gap-2">
          {isDraggable && (
            <span
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
            >
              ⋮⋮
            </span>
          )}
          <span
            className="cursor-pointer hover:text-blue-600"
            onClick={onClick}
          >
            {account.name}
          </span>
        </div>
      </td>
      {years.map((yearData) => {
        const accountResult = yearData.accounts.find((a) => a.accountId === account.id);
        const value = accountResult?.endValue ?? 0;
        const contributions = accountResult?.contributions ?? 0;
        const descriptions = eventDescriptions?.get(yearData.year);
        const hasEvent = descriptions && descriptions.length > 0;
        // Warn for negative balances on asset accounts (overdrawn)
        const shouldWarnNegative = account.type === 'asset';
        
        // Check for contributions to a closed (transferred/sold) account
        const endYear = getAccountEndYear(account, persons);
        const isClosedAccount = (account.endBehavior === 'transfer' || account.endBehavior === 'sell') && endYear !== undefined;
        const hasContributionAfterClose = isClosedAccount && contributions > 0 && yearData.year >= endYear;
        
        // Build tooltip
        let tooltip = hasEvent ? descriptions.join('\n') : undefined;
        if (hasContributionAfterClose) {
          const closedWarning = `⚠️ Contribution to closed account: This account was ${account.endBehavior === 'sell' ? 'sold' : 'transferred'} in ${endYear}. Consider redirecting this income to another account.`;
          tooltip = tooltip ? `${tooltip}\n${closedWarning}` : closedWarning;
        }
        
        return (
          <YearCell
            key={yearData.year}
            value={value}
            highlightColor={hasEvent ? highlightColor : undefined}
            tooltip={tooltip}
            warnNegative={shouldWarnNegative}
            autoTopupApplied={accountResult?.autoTopupApplied}
            contributionAfterClose={hasContributionAfterClose}
          />
        );
      })}
    </tr>
  );
}
