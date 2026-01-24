import { useState } from 'react';
import { Button, Input } from '../ui';
import type { Person } from '../../schemas/person';

interface PersonFormProps {
  person?: Person;
  onSubmit: (data: Omit<Person, 'id'>) => void;
  onCancel: () => void;
}

export function PersonForm({ person, onSubmit, onCancel }: PersonFormProps) {
  const [name, setName] = useState(person?.name ?? '');
  const [birthYear, setBirthYear] = useState(person?.birthYear?.toString() ?? '');
  const [retirementYear, setRetirementYear] = useState(person?.retirementYear?.toString() ?? '');
  const [preservationAge, setPreservationAge] = useState(person?.preservationAge?.toString() ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    onSubmit({
      name,
      birthYear: parseInt(birthYear) || new Date().getFullYear() - 30,
      retirementYear: retirementYear ? parseInt(retirementYear) : undefined,
      preservationAge: preservationAge ? parseInt(preservationAge) : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />

      <Input
        label="Birth Year"
        type="number"
        value={birthYear}
        onChange={(e) => setBirthYear(e.target.value)}
        placeholder="e.g., 1985"
        required
      />

      <Input
        label="Retirement Year (optional)"
        type="number"
        value={retirementYear}
        onChange={(e) => setRetirementYear(e.target.value)}
        placeholder="e.g., 2050"
      />

      <Input
        label="Preservation Age (optional)"
        type="number"
        value={preservationAge}
        onChange={(e) => setPreservationAge(e.target.value)}
        placeholder="e.g., 60"
      />

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
