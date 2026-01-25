import { useState, useEffect } from 'react';
import { useAccounts, usePersons, useForecast, useAssumptions, useEvents, useSettings } from './hooks';
import { SpreadsheetView } from './components/spreadsheet';
import { NetWorthChart, IncomeExpenseChart } from './components/charts';
import { AccountModal, AssumptionsPanel, EventModal } from './components/configuration';
import { Header } from './components/Header';
import { Modal, Button } from './components/ui';
import type { Account } from './schemas/account';
import type { Event } from './schemas/event';
import type { Assumptions as PanelAssumptions } from './schemas/assumption';

function App() {
  const { accounts, create: createAccount, update: updateAccount, reorder: reorderAccounts } = useAccounts();
  const { events, create: createEvent, update: updateEvent, remove: removeEvent } = useEvents();
  const { persons } = usePersons();
  const { assumptions, update: updateAssumptions } = useAssumptions();
  const { settings, updateSettings } = useSettings();

  const currentYear = new Date().getFullYear();
  const { forecast, loading, refresh: refreshForecast } = useForecast(currentYear, currentYear + 40);

  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [showEvents, setShowEvents] = useState(false);
  const [showEventHighlights, setShowEventHighlights] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    refreshForecast();
  }, [accounts, assumptions, events, settings, refreshForecast]);

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

  const handleSaveAssumptions = async (updated: PanelAssumptions) => {
    await updateAssumptions(updated as never);
    setShowAssumptions(false);
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

  const panelAssumptions: PanelAssumptions | null = assumptions
    ? {
        cpi: { baseValue: assumptions.cpi.baseValue, overrides: [] },
        investmentGrowth: { baseValue: assumptions.investmentGrowth.baseValue, overrides: [] },
        superGrowth: { baseValue: assumptions.superGrowth.baseValue, overrides: [] },
      }
    : null;

  return (
    <div className="min-h-screen bg-gray-100">
      <Header 
        onAddAccount={handleAddAccount} 
        onShowAssumptions={() => setShowAssumptions(true)}
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
                Settings
              </Button>
            </div>
            <SpreadsheetView
              forecast={forecast}
              accounts={accounts as unknown as Account[]}
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
        onSubmit={handleSaveAccount as (data: Omit<Account, 'id'>) => void}
      />
      <Modal isOpen={showAssumptions} onClose={() => setShowAssumptions(false)} title="Assumptions">
        {panelAssumptions && (
          <AssumptionsPanel assumptions={panelAssumptions} onSave={handleSaveAssumptions} />
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
        forecast={forecast}
        onSave={handleSaveEvent}
      />
      <Modal isOpen={showSettings} onClose={() => setShowSettings(false)} title="Settings">
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
        </div>
      </Modal>
    </div>
  );
}

export default App;
