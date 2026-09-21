import { useSyncExternalStore } from 'react';
import { InspectionOverride, InspectionRecord, InspectionReport, InspectorAuditEvent } from '../types/inspector';
import { DEFAULT_INSPECTION_ID, INSPECTOR_LAST_SYNC, inspectorService } from './inspectorService';
import { formatDisplayDate } from './officerQueueService';

/**
 * In-memory, per-tab inspector session for Screen 28: the selected inspection, status/date changes,
 * the working copy of each Form 7 report (plus its last-saved snapshot) and the audit trail.
 * Only the selected inspection is mirrored to sessionStorage.
 */
interface InspectorSessionState {
  selectedId: string;
  overrides: Record<string, InspectionOverride>;
  reports: Record<string, InspectionReport>;
  snapshots: Record<string, InspectionReport>;
  audit: Record<string, InspectorAuditEvent[]>;
  lastSynced: string;
}

const SELECTED_KEY = 'mahaudyam_one_inspector_selected_inspection';

const readInitialSelection = (): string => {
  try {
    const stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(SELECTED_KEY) : null;
    if (stored && inspectorService.getInspection(stored)) return stored;
  } catch {
    // ignore — use the deterministic default
  }
  return DEFAULT_INSPECTION_ID;
};

let state: InspectorSessionState = {
  selectedId: readInitialSelection(),
  overrides: {},
  reports: {},
  snapshots: {},
  audit: {},
  lastSynced: INSPECTOR_LAST_SYNC,
};
const listeners = new Set<() => void>();

const commit = (next: InspectorSessionState) => {
  state = next;
  listeners.forEach((l) => l());
};

const nowLabel = (): string => {
  const d = new Date();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `18 Dec 2024, ${String(h).padStart(2, '0')}:${m} ${suffix} IST`;
};

export const inspectorSessionStore = {
  getState: (): InspectorSessionState => state,

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  setSelected(id: string) {
    if (!inspectorService.getInspection(id) || id === state.selectedId) return;
    try {
      window.sessionStorage.setItem(SELECTED_KEY, id);
    } catch {
      // ignore
    }
    commit({ ...state, selectedId: id });
  },

  /** The inspection with any status / date change applied. */
  resolve(rec: InspectionRecord): InspectionRecord {
    const o = state.overrides[rec.id];
    return o ? { ...rec, ...o } : rec;
  },

  getReport(rec: InspectionRecord): InspectionReport {
    return state.reports[rec.id] ?? inspectorService.buildInitialReport(rec);
  },

  getAudit(rec: InspectionRecord): InspectorAuditEvent[] {
    return [...inspectorService.buildBaseAudit(rec), ...(state.audit[rec.id] ?? [])];
  },

  updateReport(rec: InspectionRecord, patch: Partial<InspectionReport>) {
    const current = inspectorSessionStore.getReport(rec);
    commit({ ...state, reports: { ...state.reports, [rec.id]: { ...current, ...patch } } });
  },

  addAudit(rec: InspectionRecord, actor: string, action: string, detail?: string): Partial<InspectorSessionState> {
    const existing = state.audit[rec.id] ?? [];
    return {
      audit: { ...state.audit, [rec.id]: [...existing, { id: `S${existing.length + 1}`, at: nowLabel(), actor, action, detail }] },
      lastSynced: nowLabel(),
    };
  },

  saveDraft(rec: InspectionRecord, actor: string) {
    const current = inspectorSessionStore.getReport(rec);
    const saved: InspectionReport = { ...current, status: 'DRAFT_SAVED', savedAt: nowLabel() };
    commit({
      ...state,
      reports: { ...state.reports, [rec.id]: saved },
      snapshots: { ...state.snapshots, [rec.id]: saved },
      ...inspectorSessionStore.addAudit(rec, actor, 'Draft report saved', `Form ${rec.formNo}`),
    });
  },

  /** Discards unsaved edits, returning to the last saved draft (or the initial report). */
  revertReport(rec: InspectionRecord) {
    const base = state.snapshots[rec.id] ?? inspectorService.buildInitialReport(rec);
    commit({ ...state, reports: { ...state.reports, [rec.id]: base } });
  },

  submitReport(rec: InspectionRecord, actor: string) {
    const current = inspectorSessionStore.getReport(rec);
    const at = nowLabel();
    const submitted: InspectionReport = { ...current, status: 'SUBMITTED', submittedAt: at, submissionRef: inspectorService.submissionRefFor(rec) };
    commit({
      ...state,
      reports: { ...state.reports, [rec.id]: submitted },
      snapshots: { ...state.snapshots, [rec.id]: submitted },
      overrides: { ...state.overrides, [rec.id]: { ...state.overrides[rec.id], status: 'COMPLETED' } },
      ...inspectorSessionStore.addAudit(rec, actor, 'Statutory report submitted', `${submitted.submissionRef} • Outcome: ${current.outcome}`),
    });
  },

  markCompleted(rec: InspectionRecord, actor: string) {
    commit({
      ...state,
      overrides: { ...state.overrides, [rec.id]: { ...state.overrides[rec.id], status: 'COMPLETED' } },
      ...inspectorSessionStore.addAudit(rec, actor, 'Inspection marked as completed', 'Field visit completed; statutory report pending'),
    });
  },

  reschedule(rec: InspectionRecord, actor: string, scheduledOn: string, scheduledTime: string, reason: string) {
    commit({
      ...state,
      overrides: { ...state.overrides, [rec.id]: { status: 'RESCHEDULED', scheduledOn, scheduledTime } },
      ...inspectorSessionStore.addAudit(rec, actor, 'Inspection rescheduled', `${formatDisplayDate(scheduledOn)}, ${scheduledTime} — ${reason}`),
    });
  },
};

export const useInspectorSession = (): InspectorSessionState =>
  useSyncExternalStore(inspectorSessionStore.subscribe, inspectorSessionStore.getState, inspectorSessionStore.getState);
