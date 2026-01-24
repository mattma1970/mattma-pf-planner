import { create } from 'zustand';

interface SessionState {
  activeScenarioId: string | null;
  selectedYear: number | null;
  expandedAccountIds: string[];
  expandedGroups: string[];

  setActiveScenario: (id: string | null) => void;
  setSelectedYear: (year: number | null) => void;
  toggleAccountExpanded: (id: string) => void;
  toggleGroupExpanded: (group: string) => void;
  setExpandedGroups: (groups: string[]) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeScenarioId: null,
  selectedYear: null,
  expandedAccountIds: [],
  expandedGroups: [],

  setActiveScenario: (id) => set({ activeScenarioId: id }),

  setSelectedYear: (year) => set({ selectedYear: year }),

  toggleAccountExpanded: (id) =>
    set((state) => ({
      expandedAccountIds: state.expandedAccountIds.includes(id)
        ? state.expandedAccountIds.filter((accountId) => accountId !== id)
        : [...state.expandedAccountIds, id],
    })),

  toggleGroupExpanded: (group) =>
    set((state) => ({
      expandedGroups: state.expandedGroups.includes(group)
        ? state.expandedGroups.filter((g) => g !== group)
        : [...state.expandedGroups, group],
    })),

  setExpandedGroups: (groups) => set({ expandedGroups: groups }),
}));
