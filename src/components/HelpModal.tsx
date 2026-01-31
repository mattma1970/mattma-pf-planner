import { useState, useMemo } from 'react';
import { Button } from './ui';

interface HelpSection {
  id: string;
  title: string;
  content: string;
  keywords?: string[];
}

const helpSections: HelpSection[] = [
  {
    id: 'overview',
    title: 'Overview',
    keywords: ['about', 'introduction', 'what is', 'overview', 'disclaimer'],
    content: `
## About Retirement Planner

Retirement Planner is a personal financial forecasting tool designed to help you model and explore your path to retirement. It provides a comprehensive view of your financial future by projecting income, expenses, assets, and liabilities over time.

### Important Disclaimer

This is a **planning and modelling tool**, not accounting software. It makes simplifying assumptions and may not capture every nuance that a qualified financial professional would consider. The projections are estimates based on the assumptions you provide—actual results will vary.

**Always consult a licensed financial advisor or accountant** before making significant financial decisions. This tool is for educational and planning purposes only.

### Key Features

- **Multi-person support**: Model finances for individuals or couples, with taxes calculated separately for each person
- **Australian tax system**: Built specifically for Australian income tax, superannuation, and capital gains tax rules
- **Comprehensive modelling**: Includes income tax brackets, CGT with discount, super contributions tax, Division 293, franking credits, principal & interest loans, and expenses linked to asset values
- **Flexible scenarios**: Save and load different plans to compare strategies and explore what-if scenarios
- **Transparency**: Expand sections in the forecast to see detailed breakdowns of transactions, tax calculations, and off-balance sheet items like franking credit accounts and concessional contribution carry-forward

### Designed for Australia

The tax calculations, superannuation rules, and default settings are based on Australian regulations (2024-25 tax year). If you're planning for a different jurisdiction, the tax calculations won't apply.
`,
  },
  {
    id: 'quick-start',
    title: 'Quick Start',
    keywords: ['getting started', 'setup', 'begin', 'new'],
    content: `
## Getting Started

Follow these steps to set up your first retirement plan:

### 1. Set Up Your Profile
Click **Settings** in the toolbar, then under "People":
- Update the default person name from "You" to your actual name
- Set your birth year and expected retirement year
- Choose a color to identify your accounts

### 2. Add a Bank Account
Click **+ Account** and create:
- **Name**: "Bank Account" or "Savings"
- **Type**: Asset
- **Initial Value**: Your current savings balance
- **Growth**: Fixed rate (e.g., 4% for a high-interest account)

### 3. Add Your Income
Click **+ Account** and create:
- **Name**: "Salary" or your income source
- **Type**: Income
- **Initial Value**: Your annual gross income
- **Growth**: CPI-linked or fixed percentage increase
- **Owner**: Select yourself
- **Deposits To**: Your bank account

### 4. Add Superannuation
Click **+ Account** and create:
- **Name**: "Super"
- **Type**: Asset
- **Sub-type**: Superannuation
- **Initial Value**: Current super balance
- **Growth**: Expected return (e.g., 7%)
- **Owner**: Select yourself

### 5. Add Your Home (Optional)
Click **+ Account** and create:
- **Name**: "Home"
- **Type**: Asset
- **Initial Value**: Current property value
- **Growth**: Expected property growth (e.g., 3-5%)

### 6. Add a Mortgage (Optional)
If you have a mortgage:
- **Name**: "Mortgage"
- **Type**: Liability
- **Initial Value**: Outstanding balance (as positive number)
- **Interest Rate**: Your current rate
- **Funded By**: Your bank account
`,
  },
  {
    id: 'accounts',
    title: 'Accounts',
    keywords: ['income', 'expense', 'asset', 'liability', 'super', 'superannuation', 'bank', 'mortgage'],
    content: `
## Account Types

### Income
Money coming in each year (salary, dividends, rental income). Income accounts:
- Start fresh each year (no carried balance)
- Can deposit to an asset account
- Can be assigned to a person for tax purposes

### Expense
Regular outgoings (living costs, insurance, rates). Expense accounts:
- Are funded from an asset account
- Can be linked to another account's value (e.g., 0.5% of property value for rates)
- Can recur every X years for irregular expenses

### Asset
Things you own (bank accounts, shares, property, super). Assets:
- Carry a balance that grows over time
- Can receive deposits and make withdrawals
- Super accounts have special tax treatment

### Liability
Debts you owe (mortgage, loans). Liabilities:
- Have an interest rate
- Can be principal & interest or interest-only
- Can be offset by a linked asset account
`,
  },
  {
    id: 'assumptions',
    title: 'Assumptions & Epochs',
    keywords: ['growth', 'cpi', 'inflation', 'epochs', 'periods', 'phases'],
    content: `
## Epochs

Epochs are time periods in your plan with different assumptions. Common epochs:
- **Accumulation**: Working years with high income and growth
- **Transition**: Winding down work, accessing super
- **Retirement**: Drawing down on savings

### Setting Up Epochs
Click **Assumptions** to:
1. Define epoch time ranges
2. Set CPI/inflation for each epoch
3. Override growth rates per account per epoch

### Growth Profiles
Accounts can grow by:
- **Fixed rate**: Same percentage each year
- **CPI-linked**: Tracks inflation (add/subtract from CPI)
- **Increasing/Decreasing**: Rate changes over time
`,
  },
  {
    id: 'events',
    title: 'Events',
    keywords: ['one-time', 'lump sum', 'windfall', 'sale', 'purchase', 'transfer'],
    content: `
## Events

Events are one-time financial occurrences:

### Event Types
- **Income**: Bonus, inheritance, tax refund
- **Expense**: One-off purchase, medical costs
- **Asset Change**: Property revaluation
- **Transfer**: Move money between accounts
- **Super Contribution**: Lump sum to super

### Using Events
1. Click **Events** in the toolbar
2. Click **Add Event**
3. Set the year, type, amount, and affected accounts
4. Toggle **Highlights** to see events in the forecast

### Tax Treatment
Events can be:
- Taxable income
- Tax-free (gifts, tax-free super)
- Capital gains (with CGT discount if held >12 months)
`,
  },
  {
    id: 'tax',
    title: 'Tax',
    keywords: ['tax', 'income tax', 'capital gains', 'cgt', 'super', 'franking', 'deductions'],
    content: `
## Tax Calculations

The planner calculates Australian income tax including:

### Personal Income Tax
- Progressive tax brackets (2024-25 rates)
- Medicare levy
- Tax-free threshold

### Superannuation Tax
- 15% contributions tax on concessional contributions
- Division 293 (extra 15%) for high income earners
- Contribution caps and carry-forward

### Capital Gains Tax
- 50% CGT discount for assets held >12 months
- Added to assessable income

### Franking Credits
- Dividend imputation credits
- Reduces tax payable

### Viewing Tax Details
Expand the **Tax** section in the forecast to see:
- Per-person tax breakdown
- Income sources and deductions
- Calculated tax payable
`,
  },
  {
    id: 'settings',
    title: 'Settings',
    keywords: ['people', 'person', 'defaults', 'preferences', 'configuration'],
    content: `
## Settings

Click **Settings** to configure:

### People
- Add/remove people in your plan
- Set birth year and retirement year
- Assign colors for visual identification

### Default Accounts
- **Default Bank Account**: Where income deposits and expenses are funded
- **Tax Funding Account**: Where tax is paid from

### Super Settings
- Preservation age
- Contribution caps (concessional & non-concessional)
- Carry-forward years
- Division 293 threshold

### Display Options
- Event highlight color
- Growth calculation method (opening vs average balance)
`,
  },
  {
    id: 'saving-loading',
    title: 'Saving & Loading',
    keywords: ['save', 'load', 'open', 'file', 'export', 'import', 'backup'],
    content: `
## Saving Your Plan

### Save As
Click **Save As** to download your plan as a JSON file:
- Includes all accounts, events, settings, and assumptions
- Filename includes timestamp to avoid overwriting
- Keep backups of important plan versions

### Open
Click **Open** to load a previously saved plan:
- Replaces all current data
- Save your current plan first if needed

### New
Click **New** to start fresh:
- Creates a blank plan with a default person
- Clears all accounts and events

### Tips
- Save before making major changes
- Use descriptive filenames (e.g., "retirement-plan-conservative.json")
- Keep multiple scenarios as separate files
`,
  },
  {
    id: 'tips',
    title: 'Tips & Best Practices',
    keywords: ['tips', 'advice', 'best practices', 'recommendations'],
    content: `
## Tips for Better Planning

### Start Simple
Begin with core accounts (income, bank, super) and add complexity gradually.

### Use Epochs
Model different life phases with appropriate growth assumptions.

### Review Tax
Expand the Tax section to understand your tax position and optimisation opportunities.

### Model Scenarios
Save different versions to compare strategies:
- Conservative vs aggressive growth
- Early vs late retirement
- Different contribution strategies

### Check the Charts
The Net Worth and Income/Expense charts provide quick visual summaries.

### Keep It Updated
Review and update your plan annually with actual figures.
`,
  },
  {
    id: 'faq',
    title: 'FAQ',
    keywords: ['faq', 'frequently asked', 'questions', 'how to', 'rollover', 'pension', 'transfer'],
    content: `
## Frequently Asked Questions

### How do I transfer super to a pension at retirement?

To model rolling your super (accumulation phase) into a pension (retirement phase):

**1. Set up the Super Account (Accumulation)**
- **Type**: Asset
- **Sub-type**: Superannuation
- **Initial Value**: Your current super balance
- **End Condition**: Age-based (e.g., age 60 for preservation)
- **End Behavior**: Transfer
- **Transfer To**: Your pension account

**2. Set up the Pension Account**
- **Type**: Asset
- **Sub-type**: Superannuation
- **Initial Value**: **$0** (important!)
- **Start Condition**: Same age as super ends (e.g., age 60)
- **Funded By**: None (leave empty)

The pension receives its balance from the transfer.

### How do I model selling an investment property?

- **End Condition**: The year you plan to sell
- **End Behavior**: Sell
- **Transfer To**: Where proceeds should go (e.g., bank account)
- **Cost Base**: Original purchase price (for CGT calculation)
- **Acquisition Year**: When you bought it
- **Eligible for CGT Discount**: Yes (if held >12 months)

The capital gain will be calculated and added to your taxable income.

### How do I model a mortgage offset account?

Create both the mortgage and the offset account, then link them:

**Mortgage**
- **Type**: Liability
- **Offset Account**: Select your offset account

**Offset Account**
- **Type**: Asset
- Regular savings/transaction account

Interest is calculated on (mortgage balance - offset balance).

### Why isn't my expense growing with inflation?

Check the expense account's growth profile:
- **CPI-linked**: Will grow with inflation
- **Fixed**: Stays at the same dollar amount

For living expenses, use CPI-linked to model real purchasing power.

### How do I add a one-time bonus or inheritance?

Use **Events** for one-time occurrences:
1. Click **Events** in the toolbar
2. Add Event with type **Income**
3. Set the year and amount
4. Optionally set tax treatment (taxable or tax-free for inheritance)

### Why is my super contribution showing as blocked?

Contributions over the cap are blocked. Check:
- **Concessional cap**: $30,000/year (plus carry-forward if eligible)
- **Non-concessional cap**: $120,000/year (or up to $360,000 with bring-forward)

Expand the Off-Balance Sheet section to see cap usage and carry-forward amounts.

### How do I model income from dividends with franking credits?

For a share portfolio with franked dividends:
- **Return Rate**: Your expected dividend yield
- **Franking Percentage**: Portion that's franked (e.g., 1.0 for fully franked)
- **Income Target Account**: Where to deposit the dividend income

Franking credits will be calculated and applied as a tax offset.
`,
  },
];

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSection, setActiveSection] = useState('overview');

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return helpSections;
    
    const query = searchQuery.toLowerCase();
    return helpSections.filter(section => 
      section.title.toLowerCase().includes(query) ||
      section.content.toLowerCase().includes(query) ||
      section.keywords?.some(k => k.toLowerCase().includes(query))
    );
  }, [searchQuery]);

  const currentSection = helpSections.find(s => s.id === activeSection) ?? helpSections[0];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[80vh] mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Help</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-200">
          <input
            type="text"
            placeholder="Search help..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <nav className="w-48 border-r border-gray-200 overflow-y-auto flex-shrink-0">
            <ul className="py-2">
              {filteredSections.map(section => (
                <li key={section.id}>
                  <button
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full text-left px-4 py-2 text-sm ${
                      activeSection === section.id
                        ? 'bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-600'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {section.title}
                  </button>
                </li>
              ))}
              {filteredSections.length === 0 && (
                <li className="px-4 py-2 text-sm text-gray-500">
                  No results found
                </li>
              )}
            </ul>
          </nav>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="prose prose-sm max-w-none">
              <HelpContent content={currentSection.content} searchQuery={searchQuery} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-gray-200">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

interface HelpContentProps {
  content: string;
  searchQuery: string;
}

function HelpContent({ content, searchQuery }: HelpContentProps) {
  const lines = content.trim().split('\n');
  
  const highlightText = (text: string): React.ReactNode => {
    if (!searchQuery.trim()) return text;
    
    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, i) => 
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200 rounded px-0.5">{part}</mark>
      ) : (
        part
      )
    );
  };

  const formatText = (text: string): React.ReactNode => {
    const parts = text.split(/(\*\*[^*]+\*\*)/).filter(Boolean);
    
    return parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j}>{highlightText(part.slice(2, -2))}</strong>;
      }
      return <span key={j}>{highlightText(part)}</span>;
    });
  };

  return (
    <>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        
        if (!trimmed) return <div key={i} className="h-2" />;
        
        if (trimmed.startsWith('## ')) {
          return (
            <h2 key={i} className="text-xl font-bold text-gray-900 mt-6 mb-3 first:mt-0">
              {formatText(trimmed.slice(3))}
            </h2>
          );
        }
        
        if (trimmed.startsWith('### ')) {
          return (
            <h3 key={i} className="text-lg font-semibold text-gray-800 mt-4 mb-2">
              {formatText(trimmed.slice(4))}
            </h3>
          );
        }
        
        if (trimmed.startsWith('- ')) {
          return (
            <li key={i} className="ml-4 text-gray-700">
              {formatText(trimmed.slice(2))}
            </li>
          );
        }
        
        return (
          <p key={i} className="text-gray-700 mb-2">
            {formatText(trimmed)}
          </p>
        );
      })}
    </>
  );
}
