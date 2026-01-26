import { Modal } from '../ui';
import { EventForm } from './EventForm';
import type { Event } from '../../schemas/event';
import type { Account } from '../../schemas/account';
import type { Person } from '../../schemas/person';
import type { ForecastResult } from '../../schemas/forecast';
import type { Settings } from '../../schemas/settings';

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  event?: Event;
  accounts: Account[];
  persons?: Person[];
  forecast?: ForecastResult | null;
  settings?: Settings;
  onSave: (data: Omit<Event, 'id'>) => void;
}

export function EventModal({ isOpen, onClose, event, accounts, persons, forecast, settings, onSave }: EventModalProps) {
  const title = event ? 'Edit Event' : 'Add Event';

  const handleSubmit = (data: Omit<Event, 'id'>) => {
    onSave(data);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <EventForm
        event={event}
        accounts={accounts}
        persons={persons}
        forecast={forecast}
        settings={settings}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  );
}
