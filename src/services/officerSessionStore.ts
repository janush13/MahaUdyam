import { useSyncExternalStore } from 'react';
import { DossierWork, initDossierWork } from '../components/officer/OfficerDossierWorkspace';
import { DEFAULT_SELECTED_APPLICATION, officerQueueService } from './officerQueueService';

/**
 * In-memory, per-tab officer session shared by Screen 26 (queue) and Screen 27 (application workspace),
 * so the dossier an officer selects, and every scrutiny change made to it, carries across both screens.
 * Only the selected application number is mirrored to sessionStorage (to survive a reload).
 */
interface OfficerSessionState {
  selectedNo: string;
  workMap: Record<string, DossierWork>;
  assignees: Record<string, string>;
}

const SELECTED_KEY = 'mahaudyam_one_officer_selected_application';

const readInitialSelection = (): string => {
  try {
    const stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(SELECTED_KEY) : null;
    if (stored && officerQueueService.getRecord(stored)) return stored;
  } catch {
    // ignore — fall back to the deterministic default
  }
  return DEFAULT_SELECTED_APPLICATION;
};

let state: OfficerSessionState = { selectedNo: readInitialSelection(), workMap: {}, assignees: {} };
const listeners = new Set<() => void>();

const commit = (next: OfficerSessionState) => {
  state = next;
  listeners.forEach((l) => l());
};

export const officerSessionStore = {
  getState: (): OfficerSessionState => state,

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  setSelected(applicationNo: string) {
    if (!officerQueueService.getRecord(applicationNo) || applicationNo === state.selectedNo) return;
    try {
      window.sessionStorage.setItem(SELECTED_KEY, applicationNo);
    } catch {
      // ignore
    }
    commit({ ...state, selectedNo: applicationNo });
  },

  getWork(applicationNo: string): DossierWork | undefined {
    const existing = state.workMap[applicationNo];
    if (existing) return existing;
    const dossier = officerQueueService.getDossier(applicationNo);
    return dossier ? initDossierWork(dossier) : undefined;
  },

  updateWork(applicationNo: string, patch: Partial<DossierWork>) {
    const base = officerSessionStore.getWork(applicationNo);
    if (!base) return;
    commit({ ...state, workMap: { ...state.workMap, [applicationNo]: { ...base, ...patch } } });
  },

  assign(applicationNos: string[], officer: string) {
    commit({ ...state, assignees: { ...state.assignees, ...Object.fromEntries(applicationNos.map((n) => [n, officer])) } });
  },
};

export const useOfficerSession = (): OfficerSessionState =>
  useSyncExternalStore(officerSessionStore.subscribe, officerSessionStore.getState, officerSessionStore.getState);
