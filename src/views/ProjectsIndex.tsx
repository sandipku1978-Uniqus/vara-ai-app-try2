'use client';

/**
 * /projects — every research project in the account: name, question, how
 * many objects of each kind are filed under it, when it last changed, and
 * archive / restore. Counts and activity come from the account
 * (GET /api/user/{kind}); a kind that could not be read shows no count
 * rather than a zero.
 */

import { useEffect, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderOpen, Plus } from 'lucide-react';
import { useUserDataStatus } from '../hooks/useUserDataStatus';
import { createUserProject, getActiveProjectId, listUserProjects } from '../services/userData';
import {
  WORKSPACE_KINDS,
  WORKSPACE_KIND_LABELS,
  describeLoadFailure,
  formatTimestamp,
  isPersonalProject,
  loadKind,
  setProjectArchived,
  summarizeProjects,
  type KindLoad,
  type Listed,
  type WorkspaceKind,
} from '../components/projects/projectData';
import { Loading, storageLabel } from '../components/projects/ProjectShared';
import { pageReload } from '../components/projects/pageReload';
import { useAccountScope, useKindLoad } from '../components/projects/useProjectData';
import styles from '../components/projects/Projects.module.css';

type KindLoads = { [K in WorkspaceKind]: KindLoad<K> };

function useAllKinds(enabled: boolean): KindLoads | null {
  const [loads, setLoads] = useState<KindLoads | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void Promise.all(WORKSPACE_KINDS.map(kind => loadKind(kind))).then(results => {
      if (cancelled) return;
      setLoads(Object.fromEntries(WORKSPACE_KINDS.map((kind, index) => [kind, results[index]])) as KindLoads);
    });
    return () => { cancelled = true; };
  }, [enabled]);
  return loads;
}

function NewProjectForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const nameId = useId();
  const questionId = useId();
  const [name, setName] = useState('');
  const [question, setQuestion] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const project = createUserProject({ name, question });
    if (project?.id) router.push(`/projects/${encodeURIComponent(project.id)}`);
  };
  return (
    <form className={styles.form} onSubmit={submit} aria-label="New project">
      <label htmlFor={nameId} className={styles.label}>Name</label>
      <input id={nameId} className={styles.input} value={name} maxLength={120} required autoFocus onChange={event => setName(event.target.value)} />
      <label htmlFor={questionId} className={styles.label}>Question</label>
      <textarea
        id={questionId}
        className={styles.input}
        value={question}
        maxLength={2000}
        rows={2}
        placeholder="What is this research trying to answer?"
        onChange={event => setQuestion(event.target.value)}
      />
      <div className={styles.toolbar}>
        <button type="submit" className="primary-btn sm" disabled={!name.trim()}>Create project</button>
        <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function wantsNewProject(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('new') === '1';
}

export default function ProjectsIndex() {
  const status = useUserDataStatus();
  const accountScope = useAccountScope();
  const { load: projectsLoad } = useKindLoad('projects', accountScope);
  const kindLoads = useAllKinds(accountScope);
  const [creating, setCreating] = useState(wantsNewProject);
  const [archiveError, setArchiveError] = useState('');
  const storage = storageLabel('account', status, accountScope);

  const archive = async (project: Listed<'projects'>, archived: boolean) => {
    setArchiveError('');
    const outcome = await setProjectArchived(project, archived);
    if (outcome.ok) pageReload.reload();
    else setArchiveError(`${project.name}: ${outcome.error}`);
  };

  const header = (
    <header className={styles.header}>
      <div className={styles.toolbar}>
        <FolderOpen size={18} aria-hidden="true" />
        <h1>Projects</h1>
        <span className={`${styles.badge} ${storage.synced ? styles.badgeSynced : ''}`}>{storage.text}</span>
      </div>
      <p className={styles.meta}>
        A project holds the saved searches, alerts, peer sets, memo, annotations and research tabs of one research question.
        New work is filed under the active project.
      </p>
    </header>
  );

  if (status.scope === null) {
    return (
      <div className={styles.page}>
        {header}
        <section className={styles.card}><Loading label="Checking your account…" /></section>
      </div>
    );
  }
  if (!accountScope) {
    return (
      <div className={styles.page}>
        {header}
        <section className={styles.card}>
          <p className={styles.muted}>Projects belong to a signed-in account. Sign in to file research under projects; until then your research is kept in this browser.</p>
        </section>
      </div>
    );
  }

  const serverProjects = projectsLoad.status === 'ready' ? projectsLoad.items : [];
  const queued = (status.mode === 'server' ? listUserProjects() : [])
    .filter(project => project.id && !serverProjects.some(candidate => candidate.id === project.id)) as Array<Listed<'projects'>>;
  const itemsByKind = Object.fromEntries(WORKSPACE_KINDS.map(kind => {
    const load = kindLoads?.[kind];
    return [kind, load?.status === 'ready' ? load.items : []];
  })) as { [K in WorkspaceKind]: Listed<K>[] };
  const summaries = summarizeProjects([...serverProjects, ...queued], itemsByKind);
  const live = summaries.filter(summary => !summary.project.archivedAt);
  const archived = summaries.filter(summary => summary.project.archivedAt);
  const failedKinds = WORKSPACE_KINDS.filter(kind => kindLoads?.[kind]?.status === 'failed');
  const activeId = status.mode === 'server' ? getActiveProjectId() : null;

  const countCell = (kind: WorkspaceKind, value: number) => {
    if (!kindLoads) return '…';
    return kindLoads[kind].status === 'ready' ? value.toLocaleString() : '—';
  };

  const table = (rows: typeof summaries, caption: string, isArchived: boolean) => (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Project</th>
            {WORKSPACE_KINDS.map(kind => <th key={kind} scope="col" className={styles.numeric}>{WORKSPACE_KIND_LABELS[kind]}</th>)}
            <th scope="col">Last activity</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ project, counts, lastActivity }) => (
            <tr key={project.clientKey}>
              <th scope="row">
                {project.id
                  ? <Link className={styles.link} href={`/projects/${encodeURIComponent(project.id)}`}>{project.name}</Link>
                  : project.name}
                {project.id === activeId && <> <span className={`${styles.badge} ${styles.badgeSynced}`}>Active</span></>}
                {queued.includes(project) && <> <span className={styles.badge}>Saving…</span></>}
                {project.question?.trim() && <div className={styles.rowDetail}>{project.question}</div>}
              </th>
              {WORKSPACE_KINDS.map(kind => <td key={kind} className={styles.numeric}>{countCell(kind, counts[kind])}</td>)}
              <td>{formatTimestamp(lastActivity)}</td>
              <td>
                {isPersonalProject(project)
                  ? <span className={styles.muted}>Default</span>
                  : (
                    <button
                      type="button"
                      className={styles.smallBtn}
                      disabled={status.mode !== 'server' || queued.includes(project)}
                      onClick={() => void archive(project, !isArchived)}
                      aria-label={`${isArchived ? 'Restore' : 'Archive'} ${project.name}`}
                    >
                      {isArchived ? 'Restore' : 'Archive'}
                    </button>
                  )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className={styles.page}>
      {header}
      <section className={styles.card} aria-label="Your projects">
        <div className={styles.toolbar}>
          {!creating && status.mode === 'server' && (
            <button type="button" className="secondary-btn" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" /> New project
            </button>
          )}
          <span className={styles.provenance}>Source: GET /api/user/projects and the six object kinds below</span>
        </div>
        {creating && status.mode === 'server' && <NewProjectForm onCancel={() => setCreating(false)} />}
        {status.mode === 'connecting' && <Loading label="Connecting to your saved research…" />}
        {projectsLoad.status === 'loading' && <Loading label="Loading projects…" />}
        {projectsLoad.status === 'failed' && <p className={styles.error} role="alert">{describeLoadFailure(projectsLoad)}</p>}
        {failedKinds.length > 0 && (
          <p className={styles.error} role="alert">
            Could not read {failedKinds.map(kind => WORKSPACE_KIND_LABELS[kind].toLowerCase()).join(', ')}; their counts show “—”, not zero.
          </p>
        )}
        {archiveError && <p className={styles.error} role="alert">{archiveError}</p>}
        {projectsLoad.status === 'ready' && live.length === 0 && <p className={styles.muted}>No projects yet.</p>}
        {live.length > 0 && table(live, 'Projects, with the number of saved objects of each kind filed under each', false)}
      </section>
      {archived.length > 0 && (
        <section className={styles.card} aria-label="Archived projects">
          <details>
            <summary className={styles.rowTitle}>Archived projects ({archived.length})</summary>
            {table(archived, 'Archived projects; their objects stay filed under them', true)}
          </details>
        </section>
      )}
    </div>
  );
}
