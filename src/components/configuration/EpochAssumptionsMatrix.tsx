import { useState, useEffect } from 'react';
import { Button } from '../ui';
import type { Epoch, Account, Assumptions } from '../../schemas';
import { DEFAULT_EPOCH_COLORS } from '../../schemas/epoch';

interface EpochAssumptionsMatrixProps {
  epochs: Epoch[];
  accounts: Account[];
  assumptions: Assumptions;
  onSaveEpoch: (id: string, updates: Partial<Epoch>) => Promise<void>;
  onCreateEpoch: (epoch: Omit<Epoch, 'id'>) => Promise<void>;
  onDeleteEpoch: (id: string) => Promise<void>;
  onSaveAssumptions: (assumptions: Assumptions) => Promise<void>;
}

type AccountField = 'growthRate' | 'returnRate';

type EditingCell = {
  epochId: string;
  rowKey: string;
  field: 'global' | AccountField;
} | null;

const GLOBAL_ROWS = [
  { key: 'cpi', label: 'CPI' },
] as const;

type GlobalKey = typeof GLOBAL_ROWS[number]['key'];

function formatPercent(value: number | undefined): string {
  if (value === undefined) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function parsePercent(value: string): number | undefined {
  const num = parseFloat(value);
  if (isNaN(num)) return undefined;
  return num / 100;
}

function getGrowthParamFromProfile(account: Account): number {
  const profile = account.growthProfile;
  switch (profile.type) {
    case 'fixed':
    case 'increasing':
    case 'decreasing':
      return profile.rate;
    case 'cpiLinked':
      return profile.value;
    default:
      return 0;
  }
}

function getGrowthFormulaLabel(account: Account): string {
  const profile = account.growthProfile;
  switch (profile.type) {
    case 'fixed':
      return 'fixed';
    case 'cpiLinked':
      switch (profile.operation) {
        case 'add':
          return 'CPI +';
        case 'subtract':
          return 'CPI −';
        case 'multiply':
          return 'CPI ×';
        default:
          return 'CPI +';
      }
    case 'increasing':
      return 'incr.';
    case 'decreasing':
      return 'decr.';
    default:
      return '';
  }
}

export function EpochAssumptionsMatrix({
  epochs,
  accounts,
  assumptions,
  onSaveEpoch,
  onCreateEpoch,
  onDeleteEpoch,
  onSaveAssumptions: _onSaveAssumptions,
}: EpochAssumptionsMatrixProps) {
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState('');
  const [editingEpochName, setEditingEpochName] = useState<string | null>(null);
  const [epochNameValue, setEpochNameValue] = useState('');
  const [editingEpochYears, setEditingEpochYears] = useState<string | null>(null);
  const [epochStartYearValue, setEpochStartYearValue] = useState('');
  const [epochEndYearValue, setEpochEndYearValue] = useState('');
  const [showAddEpoch, setShowAddEpoch] = useState(false);
  const [newEpochName, setNewEpochName] = useState('');
  const [newEpochStartYear, setNewEpochStartYear] = useState('');
  const [newEpochEndYear, setNewEpochEndYear] = useState('');

  const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);

  const groupedAccounts = {
    income: accounts.filter(a => a.type === 'income'),
    expense: accounts.filter(a => a.type === 'expense'),
    asset: accounts.filter(a => a.type === 'asset'),
    liability: accounts.filter(a => a.type === 'liability'),
  };

  const getGlobalValue = (epochId: string, key: GlobalKey): number | undefined => {
    const epoch = epochs.find(e => e.id === epochId);
    if (!epoch) return undefined;
    
    const override = epoch.globalAssumptions?.[key];
    if (override !== undefined) return override;
    
    const epochIndex = sortedEpochs.findIndex(e => e.id === epochId);
    if (epochIndex > 0) {
      for (let i = epochIndex - 1; i >= 0; i--) {
        const prevOverride = sortedEpochs[i].globalAssumptions?.[key];
        if (prevOverride !== undefined) return prevOverride;
      }
    }
    
    return assumptions[key]?.baseValue;
  };

  const isGlobalOverridden = (epochId: string, key: GlobalKey): boolean => {
    const epoch = epochs.find(e => e.id === epochId);
    return epoch?.globalAssumptions?.[key] !== undefined;
  };

  const getAccountFieldValue = (epochId: string, accountId: string, field: AccountField): number | undefined => {
    const epoch = epochs.find(e => e.id === epochId);
    const account = accounts.find(a => a.id === accountId);
    if (!account) return undefined;
    
    const override = epoch?.accountAssumptions?.[accountId]?.[field];
    if (override !== undefined) return override;
    
    const epochIndex = sortedEpochs.findIndex(e => e.id === epochId);
    if (epochIndex > 0) {
      for (let i = epochIndex - 1; i >= 0; i--) {
        const prevOverride = sortedEpochs[i].accountAssumptions?.[accountId]?.[field];
        if (prevOverride !== undefined) return prevOverride;
      }
    }
    
    if (field === 'growthRate') {
      return getGrowthParamFromProfile(account);
    } else if (field === 'returnRate') {
      return account.returnRate;
    }
    return undefined;
  };

  const isAccountFieldOverridden = (epochId: string, accountId: string, field: AccountField): boolean => {
    const epoch = epochs.find(e => e.id === epochId);
    return epoch?.accountAssumptions?.[accountId]?.[field] !== undefined;
  };

  const handleCellClick = (epochId: string, rowKey: string, field: 'global' | AccountField, currentValue: number | undefined) => {
    setEditingCell({ epochId, rowKey, field });
    setEditValue(currentValue !== undefined ? (currentValue * 100).toFixed(1) : '');
  };

  const handleCellSave = async () => {
    if (!editingCell) return;
    
    const { epochId, rowKey, field } = editingCell;
    const newValue = parsePercent(editValue);
    const epoch = epochs.find(e => e.id === epochId);
    if (!epoch) return;

    if (field === 'global') {
      const key = rowKey as GlobalKey;
      const currentAssumptions = epoch.globalAssumptions || {};
      await onSaveEpoch(epochId, {
        globalAssumptions: {
          ...currentAssumptions,
          [key]: newValue,
        },
      });
    } else {
      const currentAssumptions = epoch.accountAssumptions || {};
      const currentAccountAssumptions = currentAssumptions[rowKey] || {};
      await onSaveEpoch(epochId, {
        accountAssumptions: {
          ...currentAssumptions,
          [rowKey]: { ...currentAccountAssumptions, [field]: newValue },
        },
      });
    }
    
    setEditingCell(null);
    setEditValue('');
  };

  const handleCellClear = async () => {
    if (!editingCell) return;
    
    const { epochId, rowKey, field } = editingCell;
    const epoch = epochs.find(e => e.id === epochId);
    if (!epoch) return;

    if (field === 'global') {
      const key = rowKey as GlobalKey;
      const currentAssumptions = { ...epoch.globalAssumptions };
      delete currentAssumptions[key];
      await onSaveEpoch(epochId, { globalAssumptions: currentAssumptions });
    } else {
      const currentAssumptions = { ...epoch.accountAssumptions };
      if (currentAssumptions[rowKey]) {
        const updated = { ...currentAssumptions[rowKey] };
        delete updated[field];
        if (Object.keys(updated).length === 0) {
          delete currentAssumptions[rowKey];
        } else {
          currentAssumptions[rowKey] = updated;
        }
      }
      await onSaveEpoch(epochId, { accountAssumptions: currentAssumptions });
    }
    
    setEditingCell(null);
    setEditValue('');
  };

  const handleAddEpoch = async () => {
    if (!newEpochName || !newEpochStartYear || !newEpochEndYear) return;
    
    await onCreateEpoch({
      name: newEpochName,
      startYear: parseInt(newEpochStartYear),
      endYear: parseInt(newEpochEndYear),
      order: epochs.length,
    });
    
    setShowAddEpoch(false);
    setNewEpochName('');
    setNewEpochStartYear('');
    setNewEpochEndYear('');
  };

  const handleEpochNameSave = async (epochId: string) => {
    if (!epochNameValue.trim()) return;
    await onSaveEpoch(epochId, { name: epochNameValue });
    setEditingEpochName(null);
  };

  const handleEpochYearsSave = async (epochId: string) => {
    const startYear = parseInt(epochStartYearValue);
    const endYear = parseInt(epochEndYearValue);
    if (isNaN(startYear) || isNaN(endYear)) return;
    await onSaveEpoch(epochId, { startYear, endYear });
    setEditingEpochYears(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingCell(null);
        setEditingEpochName(null);
        setEditingEpochYears(null);
        setShowAddEpoch(false);
      }
      if (e.key === 'Enter' && editingCell) {
        handleCellSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingCell, editValue]);

  const renderCell = (epochId: string, rowKey: string, field: 'global' | AccountField, value: number | undefined, isOverridden: boolean) => {
    const isEditing = editingCell?.epochId === epochId && editingCell?.rowKey === rowKey && editingCell?.field === field;
    
    if (isEditing) {
      return (
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="0.1"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="w-16 px-1 py-0.5 text-sm border rounded"
            autoFocus
          />
          <span className="text-xs text-gray-500">%</span>
          <button onClick={handleCellSave} className="text-green-600 text-xs px-1">✓</button>
          <button onClick={handleCellClear} className="text-red-600 text-xs px-1">✕</button>
        </div>
      );
    }
    
    return (
      <button
        onClick={() => handleCellClick(epochId, rowKey, field, value)}
        className={`w-full text-left px-2 py-1 rounded hover:bg-gray-100 ${isOverridden ? 'font-semibold text-blue-700' : 'text-gray-600'}`}
      >
        {formatPercent(value)}
      </button>
    );
  };

  const renderAccountGroup = (type: 'income' | 'expense' | 'asset' | 'liability', label: string, showReturn: boolean) => {
    const groupAccounts = groupedAccounts[type];
    if (groupAccounts.length === 0) return null;
    
    return (
      <>
        <tr className="bg-gray-100">
          <td colSpan={sortedEpochs.length + 1} className="px-3 py-2 text-sm font-semibold text-gray-700 uppercase tracking-wide">
            {label}
          </td>
        </tr>
        {groupAccounts.map(account => (
          <>
            <tr key={`${account.id}-growth`} className="border-t border-gray-100">
              <td className="px-3 py-2 text-sm text-gray-700">
                {account.name}
                <span className="text-xs text-gray-400 ml-1">({getGrowthFormulaLabel(account)})</span>
              </td>
              {sortedEpochs.map(epoch => (
                <td key={epoch.id} className="px-2 py-1 text-sm">
                  {renderCell(
                    epoch.id,
                    account.id,
                    'growthRate',
                    getAccountFieldValue(epoch.id, account.id, 'growthRate'),
                    isAccountFieldOverridden(epoch.id, account.id, 'growthRate')
                  )}
                </td>
              ))}
            </tr>
            {showReturn && (
              <tr key={`${account.id}-return`} className="border-t border-gray-50">
                <td className="px-3 py-2 text-sm text-gray-500 pl-6">
                  <span className="text-xs">(return)</span>
                </td>
                {sortedEpochs.map(epoch => (
                  <td key={epoch.id} className="px-2 py-1 text-sm">
                    {renderCell(
                      epoch.id,
                      account.id,
                      'returnRate',
                      getAccountFieldValue(epoch.id, account.id, 'returnRate'),
                      isAccountFieldOverridden(epoch.id, account.id, 'returnRate')
                    )}
                  </td>
                ))}
              </tr>
            )}
          </>
        ))}
      </>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-gray-300">
            <th className="px-3 py-2 text-left text-sm font-semibold text-gray-900 w-48">
              Assumption
            </th>
            {sortedEpochs.map(epoch => (
              <th key={epoch.id} className="px-3 py-2 text-left text-sm font-semibold text-gray-900 min-w-32">
                {editingEpochName === epoch.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={epochNameValue}
                      onChange={(e) => setEpochNameValue(e.target.value)}
                      className="w-24 px-1 py-0.5 text-sm border rounded"
                      autoFocus
                      onBlur={() => handleEpochNameSave(epoch.id)}
                      onKeyDown={(e) => e.key === 'Enter' && handleEpochNameSave(epoch.id)}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => {
                        setEditingEpochName(epoch.id);
                        setEpochNameValue(epoch.name);
                      }}
                      className="hover:text-blue-600 text-left"
                    >
                      {epoch.name}
                    </button>
                    {editingEpochYears === epoch.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={epochStartYearValue}
                          onChange={(e) => setEpochStartYearValue(e.target.value)}
                          className="w-14 px-1 py-0.5 text-xs border rounded font-normal"
                          autoFocus
                          onKeyDown={(e) => e.key === 'Enter' && handleEpochYearsSave(epoch.id)}
                        />
                        <span className="text-xs">–</span>
                        <input
                          type="number"
                          value={epochEndYearValue}
                          onChange={(e) => setEpochEndYearValue(e.target.value)}
                          className="w-14 px-1 py-0.5 text-xs border rounded font-normal"
                          onKeyDown={(e) => e.key === 'Enter' && handleEpochYearsSave(epoch.id)}
                        />
                        <button onClick={() => handleEpochYearsSave(epoch.id)} className="text-green-600 text-xs">✓</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingEpochYears(epoch.id);
                          setEpochStartYearValue(epoch.startYear.toString());
                          setEpochEndYearValue(epoch.endYear.toString());
                        }}
                        className="text-xs font-normal text-gray-500 hover:text-blue-600 text-left"
                      >
                        {epoch.startYear}–{epoch.endYear}
                      </button>
                    )}
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-xs text-gray-400">Color:</span>
                      <div className="flex gap-1">
                        {DEFAULT_EPOCH_COLORS.map(color => (
                          <button
                            key={color}
                            onClick={() => onSaveEpoch(epoch.id, { color })}
                            className={`w-4 h-4 rounded-full border-2 ${epoch.color === color ? 'border-gray-800' : 'border-transparent'}`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </th>
            ))}
            <th className="px-3 py-2">
              {showAddEpoch ? (
                <div className="flex flex-col gap-1 text-left">
                  <input
                    type="text"
                    placeholder="Name"
                    value={newEpochName}
                    onChange={(e) => setNewEpochName(e.target.value)}
                    className="w-24 px-1 py-0.5 text-sm border rounded font-normal"
                  />
                  <div className="flex gap-1">
                    <input
                      type="number"
                      placeholder="Start"
                      value={newEpochStartYear}
                      onChange={(e) => setNewEpochStartYear(e.target.value)}
                      className="w-16 px-1 py-0.5 text-sm border rounded font-normal"
                    />
                    <input
                      type="number"
                      placeholder="End"
                      value={newEpochEndYear}
                      onChange={(e) => setNewEpochEndYear(e.target.value)}
                      className="w-16 px-1 py-0.5 text-sm border rounded font-normal"
                    />
                  </div>
                  <div className="flex gap-1">
                    <button onClick={handleAddEpoch} className="text-green-600 text-xs px-1">Add</button>
                    <button onClick={() => setShowAddEpoch(false)} className="text-gray-500 text-xs px-1">Cancel</button>
                  </div>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setShowAddEpoch(true)} className="text-xs px-2 py-1">
                  + Epoch
                </Button>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-blue-50">
            <td colSpan={sortedEpochs.length + 2} className="px-3 py-2 text-sm font-semibold text-blue-800 uppercase tracking-wide">
              Global
            </td>
          </tr>
          {GLOBAL_ROWS.map(row => (
            <tr key={row.key} className="border-t border-gray-100">
              <td className="px-3 py-2 text-sm text-gray-700">{row.label}</td>
              {sortedEpochs.map(epoch => (
                <td key={epoch.id} className="px-2 py-1 text-sm">
                  {renderCell(
                    epoch.id,
                    row.key,
                    'global',
                    getGlobalValue(epoch.id, row.key),
                    isGlobalOverridden(epoch.id, row.key)
                  )}
                </td>
              ))}
              <td></td>
            </tr>
          ))}
          {renderAccountGroup('income', 'Income', false)}
          {renderAccountGroup('expense', 'Expenses', false)}
          {renderAccountGroup('asset', 'Assets', true)}
          {renderAccountGroup('liability', 'Liabilities', false)}
        </tbody>
      </table>

      {sortedEpochs.length > 1 && (
        <div className="mt-4 pt-4 border-t">
          <p className="text-xs text-gray-500 mb-2">Delete epoch:</p>
          <div className="flex gap-2 flex-wrap">
            {sortedEpochs.map(epoch => (
              <button
                key={epoch.id}
                onClick={() => onDeleteEpoch(epoch.id)}
                className="text-xs text-red-600 hover:text-red-800 px-2 py-1 border border-red-200 rounded hover:bg-red-50"
              >
                Delete {epoch.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 pt-4 border-t">
        <p className="text-xs text-gray-500">
          <span className="font-semibold text-blue-700">Bold blue</span> = overridden for this epoch. 
          Click any cell to edit. Values inherit from previous epochs or account defaults.
        </p>
      </div>
    </div>
  );
}
