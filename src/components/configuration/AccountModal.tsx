import { Modal } from '../ui';
import { AccountForm } from './AccountForm';
import type { Account } from '../../schemas/account';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  account?: Account;
  accounts: Account[];
  onSubmit: (data: Omit<Account, 'id'>) => void;
}

export function AccountModal({ isOpen, onClose, account, accounts, onSubmit }: AccountModalProps) {
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
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  );
}
