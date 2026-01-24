import type { Assumptions } from '../schemas';
import { repository } from '../data';

export async function getAssumptions(): Promise<Assumptions> {
  return repository.getAssumptions();
}

export async function updateAssumptions(updates: Partial<Assumptions>): Promise<Assumptions> {
  const existing = await repository.getAssumptions();
  const updated: Assumptions = { ...existing, ...updates };
  await repository.saveAssumptions(updated);
  return updated;
}
