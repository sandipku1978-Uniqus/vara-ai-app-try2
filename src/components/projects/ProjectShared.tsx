'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { UserDataStatus } from '../../services/userData';
import { describeLoadFailure, moveToProject, type KindLoad, type Listed, type WorkspaceKind } from './projectData';
import { pageReload } from './pageReload';
import { useLazyVisible } from './useProjectData';
import styles from './Projects.module.css';

export type StorageTier = 'account' | 'browser' | 'session' | 'server-jobs';

/**
 * Where a section's data is kept, in words. Account kinds are only
 * "account-synced" once the account answered; signed out or unavailable they
 * are browser-only, which is what is true then.
 */
export function storageLabel(tier: StorageTier, status: Pick<UserDataStatus, 'mode'>, accountScope: boolean): { text: string; synced: boolean } {
  if (tier === 'session') return { text: 'Browser-only (this browser session)', synced: false };
  if (tier === 'server-jobs') return { text: 'Server job records for your account', synced: true };
  if (tier === 'browser') return { text: 'Browser-only', synced: false };
  if (!accountScope) return { text: 'Browser-only (signed out)', synced: false };
  if (status.mode === 'server') return { text: 'Account-synced', synced: true };
  if (status.mode === 'connecting') return { text: 'Connecting to your account…', synced: false };
  return { text: 'Browser-only — account storage unavailable', synced: false };
}

export function SectionShell({
  id,
  title,
  source,
  storage,
  actions,
  children,
}: {
  id: string;
  title: string;
  source: string;
  storage: { text: string; synced: boolean };
  actions?: ReactNode;
  /** Rendered once the section is near the viewport, so its read is lazy. */
  children: () => ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const visible = useLazyVisible(ref);
  const headingId = `${id}-heading`;
  return (
    <section ref={ref} id={id} className={styles.card} aria-labelledby={headingId}>
      <div className={styles.sectionHeader}>
        <h2 id={headingId}>{title}</h2>
        <span className={`${styles.badge} ${storage.synced ? styles.badgeSynced : ''}`}>{storage.text}</span>
      </div>
      <p className={styles.provenance}>Source: {source}</p>
      {actions}
      {visible ? children() : <p className={styles.muted}>Loads when you scroll here.</p>}
    </section>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p className={styles.muted} role="status">
      <Loader2 size={14} className="spinner" aria-hidden="true" /> {label}
    </p>
  );
}

/** Loading and failed states shared by every account-backed section. */
export function LoadState<K extends WorkspaceKind | 'projects'>({
  load,
  noun,
  children,
}: {
  load: KindLoad<K>;
  noun: string;
  children: (items: Listed<K>[]) => ReactNode;
}) {
  if (load.status === 'loading') return <Loading label={`Loading ${noun}…`} />;
  if (load.status === 'failed') return <p className={styles.error} role="alert">{describeLoadFailure(load)}</p>;
  return <>{children(load.items)}</>;
}

export function EmptyLine({ text }: { text: string }) {
  return <p className={styles.muted}>{text}</p>;
}

/**
 * Move one object to another project: a PUT through the existing route with
 * the full item and the new projectId, then a reload so this browser's sync
 * engine re-reads which project each object belongs to.
 */
export function MoveControl<K extends WorkspaceKind>({
  kind,
  item,
  itemLabel,
  currentProjectId,
  projects,
}: {
  kind: K;
  item: Listed<K>;
  itemLabel: string;
  currentProjectId: string;
  projects: Array<{ id?: string | null; name: string }>;
}) {
  const selectId = useId();
  const targets = projects.filter(project => project.id && project.id !== currentProjectId);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (targets.length === 0) return null;

  const move = async () => {
    if (!target) return;
    setBusy(true);
    setError('');
    const outcome = await moveToProject(kind, item, target);
    if (outcome.ok) {
      pageReload.reload();
      return;
    }
    setBusy(false);
    setError(outcome.error);
  };

  return (
    <span className={styles.rowActions}>
      <label htmlFor={selectId} className="sr-only">Move {itemLabel} to project</label>
      <select id={selectId} className={styles.select} value={target} onChange={event => setTarget(event.target.value)} disabled={busy}>
        <option value="">Move to…</option>
        {targets.map(project => <option key={project.id} value={project.id as string}>{project.name}</option>)}
      </select>
      <button type="button" className={styles.smallBtn} onClick={() => void move()} disabled={!target || busy} aria-label={`Move ${itemLabel}`}>
        {busy ? 'Moving…' : 'Move'}
      </button>
      {error && <span className={styles.error} role="alert">{error}</span>}
    </span>
  );
}
