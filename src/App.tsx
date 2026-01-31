import { useState, useEffect } from 'react';
import { useAccounts, usePersons, useForecast, useAssumptions, useEvents, useSettings, useEpochs } from './hooks';
import { SpreadsheetView } from './components/spreadsheet';
import { NetWorthChart, IncomeExpenseChart } from './components/charts';
import { AccountModal, EpochAssumptionsMatrix, EventModal } from './components/configuration';
import { Header } from './components/Header';
import { Modal, Button } from './components/ui';
import type { Account, AccountInput } from './schemas/account';
import type { Event } from './schemas/event';
import type { Epoch } from './schemas/epoch';
import type { Assumptions } from './schemas/assumption';
import { defaultSourceConfigs, type SuperContributionSourceConfig } from './schemas/settings';
import type { PersonColor } from './schemas/person';

const personColorOptions: { value: PersonColor; bgClass: string }[] = [
  { value: 'indigo', bgClass: 'bg-indigo-500' },
  { value: 'blue', bgClass: 'bg-blue-500' },
  { value: 'emerald', bgClass: 'bg-emerald-500' },
  { value: 'amber', bgClass: 'bg-amber-500' },
  { value: 'rose', bgClass: 'bg-rose-500' },
  { value: 'purple', bgClass: 'bg-purple-500' },
  { value: 'cyan', bgClass: 'bg-cyan-500' },
  { value: 'orange', bgClass: 'bg-orange-500' },
];

function App() {
  const { accounts, create: createAccount, update: updateAccount, remove: removeAccount, reorder: reorderAccounts, refresh: refreshAccounts } = useAccounts();
  const { events, create: createEvent, update: updateEvent, remove: removeEvent, refresh: refreshEvents } = useEvents();
  const { epochs, create: createEpoch, update: updateEpoch, remove: removeEpoch, refresh: refreshEpochs } = useEpochs();
  const { persons, create: createPerson, update: updatePerson, remove: removePerson, refresh: refreshPersons } = usePersons();
  const { assumptions, update: updateAssumptions, refresh: refreshAssumptions } = useAssumptions();
  const { settings, updateSettings, refresh: refreshSettings } = useSettings();

  const currentYear = new Date().getFullYear();
  const { forecast, loading, refresh: refreshForecast } = useForecast(currentYear, currentYear + 40);

  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [showEpochs, setShowEpochs] = useState(false);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [showEvents, setShowEvents] = useState(false);
  const [showEventHighlights, setShowEventHighlights] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonBirthYear, setNewPersonBirthYear] = useState('');

  useEffect(() => {
    refreshForecast();
  }, [accounts, assumptions, epochs, events, settings, refreshForecast]);

  const handleDataChange = async () => {
    await Promise.all([
      refreshPersons(),
      refreshAccounts(),
      refreshEvents(),
      refreshEpochs(),
      refreshAssumptions(),
      refreshSettings(),
    ]);
    await refreshForecast();
  };

  const handleAddAccount = () => {
    setEditingAccount(null);
    setAccountModalOpen(true);
  };

  const handleEditAccount = (account: Account) => {
    setEditingAccount(account);
    setAccountModalOpen(true);
  };

  const handleSaveAccount = async (data: Omit<AccountInput, 'id'>) => {
    if (editingAccount) {
      await updateAccount(editingAccount.id, data as never);
    } else {
      await createAccount(data as never);
    }
    setAccountModalOpen(false);
    await refreshForecast();
  };

  const handleAccountClick = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    if (account) {
      handleEditAccount(account as unknown as Account);
    }
  };

  const handleSaveEpoch = async (id: string, updates: Partial<Epoch>) => {
    await updateEpoch(id, updates);
    await refreshEpochs();
    await refreshForecast();
  };

  const handleCreateEpoch = async (data: Omit<Epoch, 'id'>) => {
    await createEpoch(data);
    await refreshEpochs();
    await refreshForecast();
  };

  const handleDeleteEpoch = async (id: string) => {
    await removeEpoch(id);
    await refreshEpochs();
    await refreshForecast();
  };

  const handleSaveAssumptions = async (updated: Assumptions) => {
    await updateAssumptions(updated as never);
    await refreshForecast();
  };

  const handleAddEvent = () => {
    setEditingEvent(null);
    setEventModalOpen(true);
  };

  const handleEditEvent = (event: Event) => {
    setEditingEvent(event);
    setEventModalOpen(true);
  };

  const handleSaveEvent = async (data: Omit<Event, 'id'>) => {
    if (editingEvent) {
      await updateEvent(editingEvent.id, data as never);
    } else {
      await createEvent(data as never);
    }
    setEventModalOpen(false);
  };

  const handleDeleteEvent = async (eventId: string) => {
    await removeEvent(eventId);
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Header 
        onAddAccount={handleAddAccount} 
        onShowAssumptions={() => setShowEpochs(true)}
        onShowEvents={() => setShowEvents(true)}
        onShowSettings={() => setShowSettings(true)}
        onDataChange={handleDataChange}
        showEventHighlights={showEventHighlights}
        onToggleEventHighlights={() => setShowEventHighlights(!showEventHighlights)}
      />
      <main className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-gray-500">
            Loading forecast...
          </div>
        ) : (
          <>
            <SpreadsheetView
              forecast={forecast}
              accounts={accounts as unknown as Account[]}
              epochs={epochs}
              persons={persons}
              events={events as unknown as Event[]}
              showEventHighlights={showEventHighlights}
              eventHighlightColor={settings.eventHighlightColor}
              onAccountClick={handleAccountClick}
              onReorder={(_type, accountIds) => reorderAccounts(accountIds)}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <NetWorthChart
                forecast={forecast}
                events={events as unknown as Event[]}
                accounts={accounts as unknown as Account[]}
                persons={persons}
              />
              <IncomeExpenseChart forecast={forecast} />
            </div>
          </>
        )}
      </main>
      <AccountModal
        isOpen={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        account={editingAccount as unknown as Account | undefined}
        accounts={accounts as unknown as Account[]}
        persons={persons}
        settings={settings}
        onSubmit={handleSaveAccount}
        onDelete={removeAccount}
      />
      <Modal isOpen={showEpochs} onClose={() => setShowEpochs(false)} title="Epochs & Assumptions" size="xl">
        {assumptions && (
          <EpochAssumptionsMatrix
            epochs={epochs}
            accounts={accounts as unknown as Account[]}
            assumptions={assumptions}
            onSaveEpoch={handleSaveEpoch}
            onCreateEpoch={handleCreateEpoch}
            onDeleteEpoch={handleDeleteEpoch}
            onSaveAssumptions={handleSaveAssumptions}
          />
        )}
      </Modal>
      <Modal isOpen={showEvents} onClose={() => setShowEvents(false)} title="Events">
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={handleAddEvent}>Add Event</Button>
          </div>
          {events.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No events configured</p>
          ) : (
            <div className="space-y-2">
              {events.map((event) => (
                <div key={event.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                  <div>
                    <span className="font-medium">{event.description}</span>
                    <span className="text-gray-500 ml-2">({event.year})</span>
                    <span className="text-gray-600 ml-2">${event.amount.toLocaleString()}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => handleEditEvent(event as unknown as Event)}>
                      Edit
                    </Button>
                    <Button variant="danger" onClick={() => handleDeleteEvent(event.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
      <EventModal
        isOpen={eventModalOpen}
        onClose={() => setEventModalOpen(false)}
        event={editingEvent ?? undefined}
        accounts={accounts as unknown as Account[]}
        persons={persons}
        forecast={forecast}
        settings={settings}
        onSave={handleSaveEvent}
      />
      <Modal isOpen={showSettings} onClose={() => setShowSettings(false)} title="Settings" size="lg">
        <div className="space-y-6">
          {/* People Section */}
          <div>
            <h3 className="text-sm font-semibold text-blue-800 mb-4">People</h3>
            <div className="space-y-2">
              {persons.map((person) => (
                <div key={person.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                  {editingPersonId === person.id ? (
                    <div className="flex items-center gap-3 flex-1" data-person-edit>
                      <div className="flex gap-1">
                        {personColorOptions.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => updatePerson(person.id, { color: opt.value })}
                            className={`w-5 h-5 rounded-full ${opt.bgClass} ${
                              person.color === opt.value ? 'ring-2 ring-offset-1 ring-gray-400' : ''
                            }`}
                          />
                        ))}
                      </div>
                      <input
                        type="text"
                        defaultValue={person.name}
                        className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                        onBlur={(e) => {
                          const relatedTarget = e.relatedTarget as HTMLElement | null;
                          const isClickingWithinEditArea = relatedTarget?.closest('[data-person-edit]');
                          if (!isClickingWithinEditArea) {
                            updatePerson(person.id, { name: e.target.value });
                            setEditingPersonId(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            updatePerson(person.id, { name: (e.target as HTMLInputElement).value });
                            setEditingPersonId(null);
                          }
                        }}
                        autoFocus
                      />
                      <input
                        type="number"
                        defaultValue={person.birthYear}
                        className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                        placeholder="Birth Year"
                        onBlur={(e) => {
                          updatePerson(person.id, { birthYear: parseInt(e.target.value) || person.birthYear });
                        }}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          const container = e.currentTarget.closest('[data-person-edit]');
                          const nameInput = container?.querySelector('input[type="text"]') as HTMLInputElement | null;
                          const birthYearInput = container?.querySelector('input[type="number"]') as HTMLInputElement | null;
                          if (nameInput) {
                            updatePerson(person.id, { 
                              name: nameInput.value,
                              birthYear: birthYearInput ? parseInt(birthYearInput.value) || person.birthYear : person.birthYear
                            });
                          }
                          setEditingPersonId(null);
                        }}
                        className="text-blue-600 hover:text-blue-800 text-xs"
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className={`w-3 h-3 rounded-full ${personColorOptions.find(o => o.value === person.color)?.bgClass ?? 'bg-indigo-500'}`} />
                      <span className="flex-1 text-sm">{person.name}</span>
                      <span className="text-xs text-gray-500">Born {person.birthYear}</span>
                      <button
                        onClick={() => setEditingPersonId(person.id)}
                        className="text-blue-600 hover:text-blue-800 text-xs"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete ${person.name}?`)) {
                            removePerson(person.id);
                          }
                        }}
                        className="text-red-600 hover:text-red-800 text-xs"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              ))}
              {persons.length === 0 && (
                <p className="text-sm text-gray-500 italic">No people configured. Add a person to track individual tax and super.</p>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={newPersonName}
                onChange={(e) => setNewPersonName(e.target.value)}
                placeholder="Name"
                className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
              />
              <input
                type="number"
                value={newPersonBirthYear}
                onChange={(e) => setNewPersonBirthYear(e.target.value)}
                placeholder="Birth Year"
                className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
              />
              <button
                onClick={() => {
                  if (newPersonName && newPersonBirthYear) {
                    createPerson({ name: newPersonName, birthYear: parseInt(newPersonBirthYear) });
                    setNewPersonName('');
                    setNewPersonBirthYear('');
                  }
                }}
                disabled={!newPersonName || !newPersonBirthYear}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              People are used to track account ownership, super contribution caps, and tax obligations.
            </p>
          </div>

          <div className="border-t pt-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Tax Funding Account
            </label>
            <select
              value={settings.defaultTaxFundingAccountId ?? ''}
              onChange={(e) => updateSettings({ defaultTaxFundingAccountId: e.target.value || undefined })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Not configured</option>
              {(accounts as unknown as Account[])
                .filter((a) => a.type === 'asset')
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Select the account that will be used to pay tax obligations
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Bank Account
            </label>
            <select
              value={settings.defaultBankAccountId ?? ''}
              onChange={(e) => updateSettings({ defaultBankAccountId: e.target.value || undefined })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">None</option>
              {(accounts as unknown as Account[])
                .filter((a) => a.type === 'asset')
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Default account for income deposits, expense funding, asset returns, and liability payments
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Growth Base Calculation Method
            </label>
            <select
              value={settings.growthCalculationMethod ?? 'openingBalance'}
              onChange={(e) => updateSettings({ growthCalculationMethod: e.target.value as 'openingBalance' | 'averageBalance' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="openingBalance">Opening Balance</option>
              <option value="averageBalance">Average Balance</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Opening Balance: Growth calculated on start-of-year balance only. 
              Average Balance: Growth on opening + 50% of transfers (assumes mid-year transactions).
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Event Highlight Color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={settings.eventHighlightColor}
                onChange={(e) => updateSettings({ eventHighlightColor: e.target.value })}
                className="h-10 w-20 rounded border border-gray-300 cursor-pointer"
              />
              <span className="text-sm text-gray-500">{settings.eventHighlightColor}</span>
            </div>
          </div>

          {/* Tax Settings */}
          <div className="border-t pt-6">
            <h3 className="text-sm font-semibold text-green-800 mb-4">Tax Settings</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company Tax Rate (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={(settings.companyTaxRate ?? 0.30) * 100}
                  onChange={(e) => updateSettings({ companyTaxRate: (parseFloat(e.target.value) || 30) / 100 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Used to calculate franking credits on dividend income (default 30% for Australian companies)
                </p>
              </div>
            </div>
          </div>

          {/* Superannuation Settings */}
          <div className="border-t pt-6">
            <h3 className="text-sm font-semibold text-purple-800 mb-4">Superannuation Settings</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Preservation Age
                </label>
                <input
                  type="number"
                  value={settings.super?.preservationAge ?? 67}
                  onChange={(e) => updateSettings({ 
                    super: { ...settings.super, preservationAge: parseInt(e.target.value) || 67 } 
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Carry Forward Years
                </label>
                <input
                  type="number"
                  value={settings.super?.carryForwardYears ?? 5}
                  onChange={(e) => updateSettings({ 
                    super: { ...settings.super, carryForwardYears: parseInt(e.target.value) || 5 } 
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Concessional Cap ($)
                </label>
                <input
                  type="number"
                  value={settings.super?.concessionalCap ?? 30000}
                  onChange={(e) => updateSettings({ 
                    super: { ...settings.super, concessionalCap: parseInt(e.target.value) || 30000 } 
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Non-Concessional Cap ($)
                </label>
                <input
                  type="number"
                  value={settings.super?.nonConcessionalCap ?? 120000}
                  onChange={(e) => updateSettings({ 
                    super: { ...settings.super, nonConcessionalCap: parseInt(e.target.value) || 120000 } 
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contributions Tax Rate (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={(settings.super?.contributionsTaxRate ?? 0.15) * 100}
                  onChange={(e) => updateSettings({ 
                    super: { ...settings.super, contributionsTaxRate: (parseFloat(e.target.value) || 15) / 100 } 
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Div 293 Rate (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={(settings.super?.div293Rate ?? 0.15) * 100}
                  onChange={(e) => updateSettings({ 
                    super: { ...settings.super, div293Rate: (parseFloat(e.target.value) || 15) / 100 } 
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Division 293 Threshold ($)
              </label>
              <input
                type="number"
                value={settings.super?.div293Threshold ?? 250000}
                onChange={(e) => updateSettings({ 
                  super: { ...settings.super, div293Threshold: parseInt(e.target.value) || 250000 } 
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Additional 15% tax applies when income + concessional contributions exceeds this threshold
              </p>
            </div>

            {/* Employer SG Settings */}
            <div className="mt-6 pt-4 border-t border-purple-200">
              <h4 className="text-sm font-medium text-purple-700 mb-3">Employer Super Guarantee</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Employer SG Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={(settings.super?.employerSgRate ?? 0.115) * 100}
                    onChange={(e) => updateSettings({ 
                      super: { ...settings.super, employerSgRate: (parseFloat(e.target.value) || 11.5) / 100 } 
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Current mandatory employer SG rate (11.5% as of 2024-25)
                  </p>
                </div>
                <div className="flex items-start pt-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.super?.autoCreateEmployerSg ?? true}
                      onChange={(e) => updateSettings({ 
                        super: { ...settings.super, autoCreateEmployerSg: e.target.checked } 
                      })}
                      className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm text-gray-700">Auto-create employer SG for salary income</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Source Configuration */}
            <div className="mt-6 pt-4 border-t border-purple-200">
              <h4 className="text-sm font-medium text-purple-700 mb-3">Contribution Source Defaults</h4>
              <p className="text-xs text-gray-500 mb-3">
                Configure default behavior for each contribution source. These defaults are applied when adding new super contribution events.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600 border-b">
                      <th className="py-2 pr-2">Source</th>
                      <th className="py-2 px-2">Default Type</th>
                      <th className="py-2 pl-2">Reduces Income</th>
                    </tr>
                  </thead>
                  <tbody>
                    {defaultSourceConfigs.map((defaultConfig) => {
                      const currentConfigs = settings.super?.sourceConfigs ?? [];
                      const currentConfig = currentConfigs.find((c) => c.source === defaultConfig.source) ?? defaultConfig;
                      
                      const updateSourceConfig = (updates: Partial<SuperContributionSourceConfig>) => {
                        const newConfigs = [...currentConfigs];
                        const existingIndex = newConfigs.findIndex((c) => c.source === defaultConfig.source);
                        const updatedConfig = { ...currentConfig, ...updates };
                        
                        if (existingIndex >= 0) {
                          newConfigs[existingIndex] = updatedConfig;
                        } else {
                          newConfigs.push(updatedConfig);
                        }
                        
                        updateSettings({
                          super: { ...settings.super, sourceConfigs: newConfigs }
                        });
                      };
                      
                      return (
                        <tr key={defaultConfig.source} className="border-b border-gray-100">
                          <td className="py-2 pr-2 text-gray-700">{currentConfig.label}</td>
                          <td className="py-2 px-2">
                            <select
                              value={currentConfig.defaultContributionType}
                              onChange={(e) => updateSourceConfig({ 
                                defaultContributionType: e.target.value as 'concessional' | 'nonConcessional' | 'capExempt'
                              })}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                            >
                              <option value="concessional">Concessional</option>
                              <option value="nonConcessional">Non-Concessional</option>
                              <option value="capExempt">Cap-Exempt</option>
                            </select>
                          </td>
                          <td className="py-2 pl-2 text-center">
                            <input
                              type="checkbox"
                              checked={currentConfig.defaultReducesAssessableIncome}
                              onChange={(e) => updateSourceConfig({ 
                                defaultReducesAssessableIncome: e.target.checked 
                              })}
                              className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default App;
