/**
 * Filing annotations (the viewer's "Annotate" notes), keyed by the viewer's
 * filing address (cik_accession_document).
 *
 * The scoped localStorage map is the synchronous cache, exactly as before.
 * When signed in, each save of one filing's notes is also queued for the
 * account copy (userData.ts, migration 026); signed out it stays local.
 */

import { scopedStorageKey } from './storageNamespace';
import { ANNOTATIONS_STORAGE_KEY, annotationsToItems } from './userDataCodecs';
import { getUserDataStatus, onUserDataHydrated, syncUserCollection } from './userData';

export interface FilingAnnotation {
  id: string;
  quote: string;
  note: string;
  section: string | null;
  createdAt: string;
}

export function loadAnnotations(filingId: string): FilingAnnotation[] {
  if (typeof window === 'undefined') return [];
  try {
    const storageKey = scopedStorageKey(ANNOTATIONS_STORAGE_KEY);
    if (!storageKey) return [];
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, FilingAnnotation[]>;
    return parsed[filingId] || [];
  } catch {
    return [];
  }
}

export function saveAnnotations(filingId: string, annotations: FilingAnnotation[]): void {
  if (typeof window === 'undefined') return;
  try {
    const storageKey = scopedStorageKey(ANNOTATIONS_STORAGE_KEY);
    if (!storageKey) return;
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as Record<string, FilingAnnotation[]>) : {};
    parsed[filingId] = annotations;
    window.localStorage.setItem(storageKey, JSON.stringify(parsed));
  } catch {
    // Ignore storage failures and keep notes in-memory.
    return;
  }
  syncUserCollection('annotations', annotationsToItems(filingId, annotations), {
    partition: item => item.filingKey === filingId,
  });
}

/** Notifies when the account's annotations have replaced the local cache. */
export function subscribeRestoredAnnotations(listener: () => void): () => void {
  return onUserDataHydrated('annotations', listener);
}

/** Status line after a note is saved: says where it actually goes. */
export function annotationSavedMessage(): string {
  return getUserDataStatus().mode === 'server'
    ? 'Annotation saved for this filing and syncing to your account.'
    : 'Annotation saved locally for this filing.';
}
