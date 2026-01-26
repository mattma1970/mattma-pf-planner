import { v4 as uuidv4 } from 'uuid';
import type { Epoch } from '../schemas';
import { repository } from '../data';
import { createDefaultEpochs } from '../data/defaults';

let defaultsInitialized = false;
let initializingDefaults: Promise<Epoch[]> | null = null;

export async function createEpoch(data: Omit<Epoch, 'id'>): Promise<Epoch> {
  const epoch: Epoch = {
    ...data,
    id: uuidv4(),
  };
  await repository.saveEpoch(epoch);
  return epoch;
}

export async function updateEpoch(id: string, updates: Partial<Epoch>): Promise<Epoch> {
  const existing = await repository.getEpoch(id);
  if (!existing) {
    throw new Error(`Epoch not found: ${id}`);
  }
  const updated: Epoch = { ...existing, ...updates, id };
  await repository.saveEpoch(updated);
  return updated;
}

export async function deleteEpoch(id: string): Promise<void> {
  await repository.deleteEpoch(id);
}

export async function getEpochs(): Promise<Epoch[]> {
  let epochs = await repository.getEpochs();
  
  if (epochs.length === 0 && !defaultsInitialized) {
    if (initializingDefaults) {
      return initializingDefaults;
    }
    
    initializingDefaults = (async () => {
      const existingCheck = await repository.getEpochs();
      if (existingCheck.length > 0) {
        defaultsInitialized = true;
        return existingCheck.sort((a, b) => a.order - b.order);
      }
      
      const defaults = createDefaultEpochs();
      for (const epoch of defaults) {
        await repository.saveEpoch(epoch);
      }
      defaultsInitialized = true;
      initializingDefaults = null;
      return defaults;
    })();
    
    return initializingDefaults;
  }
  
  defaultsInitialized = true;
  return epochs.sort((a, b) => a.order - b.order);
}

export async function reorderEpochs(epochIds: string[]): Promise<void> {
  const epochs = await repository.getEpochs();
  
  for (let i = 0; i < epochIds.length; i++) {
    const epoch = epochs.find((e) => e.id === epochIds[i]);
    if (epoch) {
      await repository.saveEpoch({ ...epoch, order: i });
    }
  }
}
