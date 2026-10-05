'use client';

/**
 * /projects/[id] — one project as a unit a reviewer can reopen: its name,
 * question, creation date and owner, then every kind of saved research
 * filed under it, each section read lazily from the account and labelled
 * with its source and where it is kept. The header carries a project
 * switcher and the project's evidence package download.
 */

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, FolderOpen } from 'lucide-react';
import { useUserDataStatus } from '../hooks/useUserDataStatus';
import { getActiveProjectId, listUserProjects, setActiveProject } from '../services/userData';
import {
  describeLoadFailure,
  formatTimestamp,
  isPersonalProject,
  personalProjectId,
  setProjectArchived,
  type Listed,
} from '../components/projects/projectData';
import {
  collectProjectEvidence,
  describeAppVersion,
  downloadProjectEvidence,
  projectEvidenceFileStem,
} from '../components/projects/projectEvidence';
import { Loading } from '../components/projects/ProjectShared';
import { pageReload } from '../components/projects/pageReload';
import { useAccountScope, useKindLoad, useSessionDisplayName } from '../components/projects/useProjectData';
import {
  AlertsSection,
  AnnotationsSection,
  CartSection,
  JobsSection,
  MemoSection,
  PeerSetsSection,
  ResearchTabsSection,
  SavedSearchesSection,
  type WorkspaceContext,
} from '../components/projects/WorkspaceSections';
import styles from '../components/projects/Projects.module.css';

function NotAvailable({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Project</h1>
      </header>
      <section className={styles.card}>{children}</section>
    </div>
  );
}

export default function ProjectsWorkspace({ projectId }: { projectId: string }) {
  const status = useUserDataStatus();
  const accountScope = useAccountScope();
  const owner = useSessionDisplayName();
  const router = useRouter();
  const switcherId = useId();
  const { load: projectsLoad } = useKindLoad('projects', accountScope);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceMessage, setEvidenceMessage] = useState('');
  const [evidenceError, setEvidenceError] = useState('');
  const [archiveError, setArchiveError] = useState('');

  if (status.scope === null) return <NotAvailable><Loading label="Checking your account…" /></NotAvailable>;
  if (!accountScope) {
    return (
      <NotAvailable>
        <p className={styles.muted}>Projects belong to a signed-in account. Sign in to file research under projects and reopen it here.</p>
      </NotAvailable>
    );
  }
  if (projectsLoad.status === 'loading') return <NotAvailable><Loading label="Loading project…" /></NotAvailable>;

  // Server list first; a project created moments ago may still be queued
  // in this browser's outbox, so the local list is the fallback.
  const serverProjects = projectsLoad.status === 'ready' ? projectsLoad.items : [];
  const localProjects = listUserProjects() as Array<Listed<'projects'>>;
  const project = serverProjects.find(candidate => candidate.id === projectId)
    || localProjects.find(candidate => candidate.id === projectId)
    || null;
  const pendingUpload = Boolean(project && !serverProjects.some(candidate => candidate.id === projectId));

  if (!project) {
    return (
      <NotAvailable>
        {projectsLoad.status === 'failed'
          ? <p className={styles.error} role="alert">{describeLoadFailure(projectsLoad)}</p>
          : <p className={styles.muted}>No project with this address is in your account.</p>}
        <Link className={styles.link} href="/projects">All projects</Link>
      </NotAvailable>
    );
  }

  const allProjects: Array<Listed<'projects'>> = serverProjects.length > 0 ? serverProjects : localProjects;
  const liveProjects = allProjects.filter(candidate => !candidate.archivedAt);
  const ctx: WorkspaceContext = {
    project,
    projectId,
    projects: liveProjects,
    personalId: personalProjectId(allProjects),
    status,
    accountScope,
  };
  const isActive = status.mode === 'server' && getActiveProjectId() === projectId;

  const downloadEvidence = async () => {
    setEvidenceBusy(true);
    setEvidenceMessage('');
    setEvidenceError('');
    try {
      const outcome = await collectProjectEvidence(project, allProjects, { owner });
      if (!outcome.ok) {
        setEvidenceError(outcome.error);
        return;
      }
      await downloadProjectEvidence(outcome.pkg);
      setEvidenceMessage(
        `Downloaded ${projectEvidenceFileStem(outcome.pkg)} (.json and .docx): ${outcome.pkg.contents.memoItems} memo items, `
        + `${outcome.pkg.searches.length} searches; generated ${outcome.pkg.generatedAt}; app version ${describeAppVersion(outcome.pkg.appVersion)}.`,
      );
    } catch (error) {
      console.error('Project evidence package failed:', error);
      setEvidenceError('The evidence package could not be built. Nothing was changed; retry when ready.');
    } finally {
      setEvidenceBusy(false);
    }
  };

  const toggleArchive = async (archived: boolean) => {
    setArchiveError('');
    const outcome = await setProjectArchived(project, archived);
    if (outcome.ok) pageReload.reload();
    else setArchiveError(outcome.error);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.toolbar}>
          <FolderOpen size={18} aria-hidden="true" />
          <h1>{project.name}</h1>
          {isPersonalProject(project) && <span className={styles.badge}>Default project</span>}
          {isActive && <span className={`${styles.badge} ${styles.badgeSynced}`}>Active project</span>}
          {project.archivedAt && <span className={styles.badge}>Archived {formatTimestamp(project.archivedAt)}</span>}
        </div>
        <p className={styles.question}>{project.question?.trim() || 'No research question recorded for this project.'}</p>
        <p className={styles.meta}>
          <span>Created {formatTimestamp(project.createdAt)}</span>
          <span>Owner: {owner || 'your account (no display name on this session)'}</span>
          {pendingUpload && <span role="status">Saving this project to your account…</span>}
        </p>
        <div className={styles.toolbar}>
          <label htmlFor={switcherId} className={styles.label}>Switch project</label>
          <select
            id={switcherId}
            className={styles.select}
            value={projectId}
            onChange={event => router.push(`/projects/${encodeURIComponent(event.target.value)}`)}
          >
            {liveProjects.filter(candidate => candidate.id).map(candidate => (
              <option key={candidate.clientKey} value={candidate.id as string}>{candidate.name}</option>
            ))}
            {project.archivedAt && <option value={projectId}>{project.name} (archived)</option>}
          </select>
          {!isActive && !project.archivedAt && status.mode === 'server' && (
            <button type="button" className={styles.smallBtn} onClick={() => setActiveProject(projectId)}>
              Make active
            </button>
          )}
          <Link className={styles.link} href="/projects">All projects</Link>
        </div>
        <div className={styles.toolbar}>
          <button type="button" className="primary-btn sm" onClick={() => void downloadEvidence()} disabled={evidenceBusy || status.mode !== 'server'}>
            <Download size={14} aria-hidden="true" /> {evidenceBusy ? 'Building evidence package…' : 'Download evidence package'}
          </button>
          <span className={styles.muted}>
            One JSON record and one Word appendix for every memo item and search in this project, labelled with the time and app version.
          </span>
          {!isPersonalProject(project) && status.mode === 'server' && (
            <button type="button" className={styles.smallBtn} onClick={() => void toggleArchive(!project.archivedAt)}>
              {project.archivedAt ? 'Restore project' : 'Archive project'}
            </button>
          )}
        </div>
        {evidenceMessage && <p className={styles.muted} role="status">{evidenceMessage}</p>}
        {evidenceError && <p className={styles.error} role="alert">{evidenceError}</p>}
        {archiveError && <p className={styles.error} role="alert">{archiveError}</p>}
        {status.mode !== 'server' && (
          <p className={styles.muted} role="status">
            {status.mode === 'connecting'
              ? 'Connecting to your saved research…'
              : 'Account storage is unavailable right now; new work is kept in this browser and the sections below may not load.'}
          </p>
        )}
      </header>

      <SavedSearchesSection ctx={ctx} />
      <AlertsSection ctx={ctx} />
      <PeerSetsSection ctx={ctx} />
      <MemoSection ctx={ctx} />
      <AnnotationsSection ctx={ctx} />
      <ResearchTabsSection ctx={ctx} />
      <JobsSection ctx={ctx} />
      <CartSection ctx={ctx} />
    </div>
  );
}
