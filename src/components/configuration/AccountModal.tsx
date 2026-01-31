import { Modal } from '../ui';
import { AccountForm } from './AccountForm';
import type { Account, AccountInput } from '../../schemas/account';
import type { Person } from '../../schemas/person';
import type { Settings } from '../../schemas/settings';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  account?: Account;
  accounts: Account[];
  persons: Person[];
  settings?: Settings;
  onSubmit: (data: Omit<AccountInput, 'id'>) => void;
}

export function AccountModal({ isOpen, onClose, account, accounts, persons, settings, onSubmit }: AccountModalProps) {
  const title = account ? 'Edit Account' : 'Add Account';

  const handleSubmit = (data: Omit<AccountInput, 'id'>) => {
    onSubmit(data);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <AccountForm
        account={account}
        accounts={accounts}
        persons={persons}
        settings={settings}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  );
}
