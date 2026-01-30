import { useState } from 'react';
import { Button, Input } from '../ui';
import type { Person, PersonColor } from '../../schemas/person';

const colorOptions: { value: PersonColor; label: string; bgClass: string; borderClass: string }[] = [
  { value: 'indigo', label: 'Indigo', bgClass: 'bg-indigo-500', borderClass: 'border-indigo-500' },
  { value: 'blue', label: 'Blue', bgClass: 'bg-blue-500', borderClass: 'border-blue-500' },
  { value: 'emerald', label: 'Emerald', bgClass: 'bg-emerald-500', borderClass: 'border-emerald-500' },
  { value: 'amber', label: 'Amber', bgClass: 'bg-amber-500', borderClass: 'border-amber-500' },
  { value: 'rose', label: 'Rose', bgClass: 'bg-rose-500', borderClass: 'border-rose-500' },
  { value: 'purple', label: 'Purple', bgClass: 'bg-purple-500', borderClass: 'border-purple-500' },
  { value: 'cyan', label: 'Cyan', bgClass: 'bg-cyan-500', borderClass: 'border-cyan-500' },
  { value: 'orange', label: 'Orange', bgClass: 'bg-orange-500', borderClass: 'border-orange-500' },
];

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
  const [color, setColor] = useState<PersonColor | undefined>(person?.color);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    onSubmit({
      name,
      birthYear: parseInt(birthYear) || new Date().getFullYear() - 30,
      retirementYear: retirementYear ? parseInt(retirementYear) : undefined,
      preservationAge: preservationAge ? parseInt(preservationAge) : undefined,
      color,
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

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
        <div className="flex flex-wrap gap-2">
          {colorOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setColor(option.value)}
              className={`w-8 h-8 rounded-full ${option.bgClass} border-2 ${
                color === option.value ? 'ring-2 ring-offset-2 ring-gray-400' : 'border-transparent'
              } hover:scale-110 transition-transform`}
              title={option.label}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
