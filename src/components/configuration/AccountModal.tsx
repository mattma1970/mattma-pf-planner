import { Modal } from '../ui';
import { AccountForm } from './AccountForm';
import type { Account } from '../../schemas/account';
import type { Person } from '../../schemas/person';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  account?: Account;
  accounts: Account[];
  persons?: Person[];
  onSubmit: (data: Omit<Account, 'id'>) => void;
}

export function AccountModal({ isOpen, onClose, account, accounts, persons = [], onSubmit }: AccountModalProps) {
  const title = account ? 'Edit Account' : 'Add Account';

  const handleSubmit = (data: Omit<Account, 'id'>) => {
    onSubmit(data);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <AccountForm
        account={account}
        accounts={accounts}
        persons={persons}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  );
}
