import { Modal } from '../ui';
import { EventForm } from './EventForm';
import type { Event } from '../../schemas/event';
import type { Account } from '../../schemas/account';
import type { ForecastResult } from '../../schemas/forecast';

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  event?: Event;
  accounts: Account[];
  forecast?: ForecastResult | null;
  onSave: (data: Omit<Event, 'id'>) => void;
}

export function EventModal({ isOpen, onClose, event, accounts, forecast, onSave }: EventModalProps) {
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
        forecast={forecast}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  );
}
