import { Modal } from '../ui';
import { AccountForm } from './AccountForm';
import type { Account, AccountInput } from '../../schemas/account';
import type { Person } from '../../schemas/person';
import type { Settings } from '../../schemas/settings';
import type { AccountReference } from '../../actions/accounts';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  account?: Account;
  accounts: Account[];
  persons: Person[];
  settings?: Settings;
  onSubmit: (data: Omit<AccountInput, 'id'>) => void;
  onDelete?: (id: string) => Promise<{ success: boolean; references?: AccountReference[] }>;
}

export function AccountModal({ isOpen, onClose, account, accounts, persons, settings, onSubmit, onDelete }: AccountModalProps) {
  const title = account ? 'Edit Account' : 'Add Account';

  const handleSubmit = (data: Omit<AccountInput, 'id'>) => {
    onSubmit(data);
    onClose();
  };

  const handleDelete = async () => {
    if (!account || !onDelete) {
      return { success: false, references: [] };
    }
    const result = await onDelete(account.id);
    if (result.success) {
      onClose();
    }
    return result;
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
        onDelete={account && onDelete ? handleDelete : undefined}
      />
    </Modal>
  );
}
