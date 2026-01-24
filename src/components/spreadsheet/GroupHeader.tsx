import { useState } from 'react';

interface GroupHeaderProps {
  title: string;
  colSpan: number;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

export function GroupHeader({ title, colSpan, children, defaultExpanded = true }: GroupHeaderProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <>
      <tr className="bg-gray-100">
        <th
          colSpan={colSpan}
          className="px-3 py-2 text-left font-semibold text-gray-700 sticky left-0 bg-gray-100 cursor-pointer select-none"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span className="inline-flex items-center gap-2">
            <svg
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {title}
          </span>
        </th>
      </tr>
      {isExpanded && children}
    </>
  );
}
