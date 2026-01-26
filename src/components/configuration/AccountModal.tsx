import { Modal } from '../ui';
import { AccountForm } from './AccountForm';
import type { Account } from '../../schemas/account';
import type { Settings } from '../../schemas/settings';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  account?: Account;
  accounts: Account[];
  settings?: Settings;
  onSubmit: (data: Omit<Account, 'id'>) => void;
}

export function AccountModal({ isOpen, onClose, account, accounts, settings, onSubmit }: AccountModalProps) {
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
        settings={settings}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </Modal>
  );
}
