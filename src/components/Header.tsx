import { Button } from './ui';

interface HeaderProps {
  onAddAccount: () => void;
  onShowAssumptions: () => void;
  onShowEvents: () => void;
}

export function Header({ onAddAccount, onShowAssumptions, onShowEvents }: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Retirement Planner</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onShowAssumptions}>
            Settings
          </Button>
          <Button variant="secondary" onClick={onShowEvents}>
            Events
          </Button>
          <Button onClick={onAddAccount}>Add Account</Button>
        </div>
      </div>
    </header>
  );
}
