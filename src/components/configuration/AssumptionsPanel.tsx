import { useState, useEffect } from 'react';
import { Button, Input } from '../ui';
import type { Assumptions } from '../../schemas/assumption';

interface AssumptionsPanelProps {
  assumptions: Assumptions;
  onSave: (assumptions: Assumptions) => void;
}

export function AssumptionsPanel({ assumptions, onSave }: AssumptionsPanelProps) {
  const [cpiBase, setCpiBase] = useState(assumptions.cpi.baseValue.toString());
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setCpiBase(assumptions.cpi.baseValue.toString());
    setIsDirty(false);
  }, [assumptions]);

  const handleChange = (setter: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setIsDirty(true);
  };

  const handleSave = () => {
    onSave({
      cpi: {
        ...assumptions.cpi,
        baseValue: parseFloat(cpiBase) || 0,
      },
    });
    setIsDirty(false);
  };

  const handleReset = () => {
    setCpiBase(assumptions.cpi.baseValue.toString());
    setIsDirty(false);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Assumptions</h2>

      <div className="space-y-4">
        <Input
          label="CPI Base Rate (%)"
          type="number"
          step="0.1"
          value={cpiBase}
          onChange={handleChange(setCpiBase)}
        />

        <p className="text-xs text-gray-500">
          Year-specific overrides can be configured for advanced scenarios.
        </p>
      </div>

      {isDirty && (
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          <Button type="button" variant="secondary" onClick={handleReset}>
            Reset
          </Button>
          <Button type="button" onClick={handleSave}>
            Save Changes
          </Button>
        </div>
      )}
    </div>
  );
}
