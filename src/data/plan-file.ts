import {
  CURRENT_PLAN_VERSION,
  PlanFileLooseSchema,
  PlanDataSchema,
  type PlanFile,
  type PlanData,
} from '../schemas/plan-file';
import { repository } from './repository';
import { defaultAssumptions } from './defaults';
import { defaultSettings } from '../schemas/settings';
import { createPerson } from '../actions/persons';

// Migration functions: each migrates from version N to N+1
type MigrationFn = (data: Record<string, unknown>) => Record<string, unknown>;

const migrations: Record<number, MigrationFn> = {
  // Example for future migrations:
  // 1: (data) => {
  //   // Migrate from v1 to v2
  //   return { ...data, newField: 'default' };
  // },
};

/**
 * Migrate data from an older version to the current version
 */
function migrateToLatest(data: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let currentData = data;
  let currentVersion = fromVersion;

  while (currentVersion < CURRENT_PLAN_VERSION) {
    const migrate = migrations[currentVersion];
    if (!migrate) {
      throw new Error(`No migration defined for version ${currentVersion} to ${currentVersion + 1}`);
    }
    currentData = migrate(currentData);
    currentVersion++;
  }

  return currentData;
}

/**
 * Export current plan data to a PlanFile object
 */
export async function exportPlan(name?: string, description?: string): Promise<PlanFile> {
  const [persons, accounts, events, epochs, assumptions, settings] = await Promise.all([
    repository.getPersons(),
    repository.getAccounts(),
    repository.getEvents(),
    repository.getEpochs(),
    repository.getAssumptions(),
    repository.getSettings(),
  ]);

  const planFile: PlanFile = {
    metadata: {
      version: CURRENT_PLAN_VERSION,
      exportedAt: new Date().toISOString(),
      name,
      description,
    },
    data: {
      persons,
      accounts,
      events,
      epochs,
      assumptions,
      settings,
    },
  };

  return planFile;
}

/**
 * Export plan to a JSON string
 */
export async function exportPlanToJson(name?: string, description?: string): Promise<string> {
  const planFile = await exportPlan(name, description);
  return JSON.stringify(planFile, null, 2);
}

/**
 * Download plan as a JSON file
 */
export async function downloadPlan(filename?: string): Promise<void> {
  const json = await exportPlanToJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const defaultFilename = `retirement-plan-${new Date().toISOString().split('T')[0]}.json`;
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export type ImportResult = 
  | { success: true; data: PlanData }
  | { success: false; error: string };

/**
 * Parse and validate a plan file from JSON string
 */
export function parsePlanFile(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { success: false, error: 'Invalid JSON format' };
  }

  // First, loosely parse to get version
  const looseResult = PlanFileLooseSchema.safeParse(parsed);
  if (!looseResult.success) {
    return { success: false, error: 'Invalid plan file structure: missing metadata or version' };
  }

  const { metadata, data } = looseResult.data;
  const fileVersion = metadata.version;

  // Check if version is newer than what we support
  if (fileVersion > CURRENT_PLAN_VERSION) {
    return { 
      success: false, 
      error: `Plan file version ${fileVersion} is newer than supported version ${CURRENT_PLAN_VERSION}. Please update the app.` 
    };
  }

  // Migrate if needed
  let migratedData: Record<string, unknown>;
  try {
    migratedData = fileVersion < CURRENT_PLAN_VERSION 
      ? migrateToLatest(data, fileVersion)
      : data;
  } catch (err) {
    return { success: false, error: `Migration failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }

  // Validate against current schema (with defaults applied)
  const validationResult = PlanDataSchema.safeParse(migratedData);
  if (!validationResult.success) {
    const issues = validationResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { success: false, error: `Validation failed: ${issues}` };
  }

  return { success: true, data: validationResult.data };
}

/**
 * Import plan data into the database (replaces all existing data)
 */
export async function importPlan(data: PlanData): Promise<void> {
  // Clear existing data
  await repository.clearAll();

  // Import all data
  await Promise.all([
    ...data.persons.map(p => repository.savePerson(p)),
    ...data.accounts.map(a => repository.saveAccount(a)),
    ...data.events.map(e => repository.saveEvent(e)),
    ...data.epochs.map(ep => repository.saveEpoch(ep)),
    repository.saveAssumptions(data.assumptions),
    repository.saveSettings(data.settings),
  ]);
}

/**
 * Import plan from a JSON string
 */
export async function importPlanFromJson(json: string): Promise<ImportResult> {
  const result = parsePlanFile(json);
  if (!result.success) {
    return result;
  }

  await importPlan(result.data);
  return result;
}

/**
 * Import plan from a File object (from file input)
 */
export async function importPlanFromFile(file: File): Promise<ImportResult> {
  const text = await file.text();
  return importPlanFromJson(text);
}

/**
 * Create a new blank plan (clears all data)
 */
export async function createNewPlan(): Promise<void> {
  await repository.clearAll();
  // Initialize with defaults
  await repository.saveAssumptions(defaultAssumptions);
  await repository.saveSettings(defaultSettings);
  
  // Create a default person (this also creates their tax accounts)
  const currentYear = new Date().getFullYear();
  await createPerson({
    name: 'You',
    birthYear: currentYear - 35,
    retirementYear: currentYear + 30,
    color: 'indigo',
  });
}
