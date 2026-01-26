import { useState, useEffect } from 'react';
import { useAccounts, usePersons, useForecast, useAssumptions, useEvents, useSettings, useEpochs } from './hooks';
import { SpreadsheetView } from './components/spreadsheet';
import { NetWorthChart, IncomeExpenseChart } from './components/charts';
import { AccountModal, EpochAssumptionsMatrix, EventModal } from './components/configuration';
import { Header } from './components/Header';
import { Modal, Button } from './components/ui';
import type { Account } from './schemas/account';
import type { Event } from './schemas/event';
import type { Epoch } from './schemas/epoch';
import type { Assumptions } from './schemas/assumption';

function App() {
  const { accounts, create: createAccount, update: updateAccount, reorder: reorderAccounts } = useAccounts();
  const { events, create: createEvent, update: updateEvent, remove: removeEvent } = useEvents();
  const { epochs, create: createEpoch, update: updateEpoch, remove: removeEpoch, refresh: refreshEpochs } = useEpochs();
  const { persons } = usePersons();
  const { assumptions, update: updateAssumptions } = useAssumptions();
  const { settings, updateSettings } = useSettings();

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

  useEffect(() => {
    refreshForecast();
  }, [accounts, assumptions, epochs, events, settings, refreshForecast]);

  const handleAddAccount = () => {
    setEditingAccount(null);
    setAccountModalOpen(true);
  };

  const handleEditAccount = (account: Account) => {
    setEditingAccount(account);
    setAccountModalOpen(true);
  };

  const handleSaveAccount = async (data: Omit<Account, 'id'>) => {
    if (editingAccount) {
      await updateAccount(editingAccount.id, data as never);
    } else {
      await createAccount(data as never);
    }
    setAccountModalOpen(false);
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
      />
      <main className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-gray-500">
            Loading forecast...
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <div className="flex gap-2">
                <Button
                  variant={showEventHighlights ? 'primary' : 'secondary'}
                  onClick={() => setShowEventHighlights(!showEventHighlights)}
                >
                  {showEventHighlights ? 'Hide Events' : 'Show Events'}
                </Button>
              </div>
              <Button variant="secondary" onClick={() => setShowSettings(true)}>
                Defaults
              </Button>
            </div>
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
        settings={settings}
        onSubmit={handleSaveAccount as (data: Omit<Account, 'id'>) => void}
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
        onSave={handleSaveEvent}
      />
      <Modal isOpen={showSettings} onClose={() => setShowSettings(false)} title="Settings" size="lg">
        <div className="space-y-6">
          <div>
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
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default App;
