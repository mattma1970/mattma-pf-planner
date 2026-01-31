import { useState, type ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-flex items-center">
      {children}
      <button
        type="button"
        className="ml-1 text-gray-400 hover:text-gray-600 focus:outline-none"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        aria-label="More information"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {isVisible && (
        <div className="absolute z-50 bottom-full left-0 mb-2 w-64 p-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg shadow-lg">
          {content}
          <div className="absolute top-full left-4 w-2 h-2 bg-white border-r border-b border-gray-200 transform rotate-45 -mt-1" />
        </div>
      )}
    </div>
  );
}

interface HintIconProps {
  hint: string;
}

export function HintIcon({ hint }: HintIconProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <span className="relative inline-flex items-center ml-1">
      <button
        type="button"
        className="text-gray-400 hover:text-gray-600 focus:outline-none"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        aria-label="More information"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {isVisible && (
        <div className="absolute z-50 bottom-full left-0 mb-2 w-64 p-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg shadow-lg">
          {hint}
          <div className="absolute top-full left-4 w-2 h-2 bg-white border-r border-b border-gray-200 transform rotate-45 -mt-1" />
        </div>
      )}
    </span>
  );
}
