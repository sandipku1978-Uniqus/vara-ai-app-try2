'use client';

import { useId, useState, type FormEvent } from 'react';
import { FolderOpen } from 'lucide-react';
import { useUserDataStatus } from '../../hooks/useUserDataStatus';
import {
  createUserProject,
  getActiveProjectId,
  listUserProjects,
  setActiveProject,
} from '../../services/userData';
import styles from './ProjectSelector.module.css';

/**
 * The minimal "project" control on the Dashboard (migration 026): choose the
 * project new saved objects are filed under, or start one with a name and
 * the question it answers. Defaults to the personal project. Signed out it
 * renders nothing; when account storage is unreachable it says so instead
 * of implying the work is saved to the account.
 */
export default function ProjectSelector() {
  const status = useUserDataStatus();
  const selectId = useId();
  const nameId = useId();
  const questionId = useId();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [question, setQuestion] = useState('');

  if (status.mode === 'local') return null;

  if (status.mode !== 'server') {
    return (
      <section className={styles.card} aria-label="Research project">
        <p className={styles.muted} role="status">
          {status.mode === 'connecting'
            ? 'Connecting to your saved research…'
            : 'Saved research is unavailable right now, so your work is kept in this browser only.'}
        </p>
      </section>
    );
  }

  const projects = listUserProjects();
  const activeId = getActiveProjectId();
  const active = projects.find(project => project.id === activeId) || null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    createUserProject({ name, question });
    setName('');
    setQuestion('');
    setCreating(false);
  };

  return (
    <section className={styles.card} aria-label="Research project">
      <div className={styles.row}>
        <FolderOpen size={16} aria-hidden="true" className={styles.icon} />
        <label htmlFor={selectId} className={styles.label}>Project</label>
        <select
          id={selectId}
          className={styles.select}
          value={activeId ?? ''}
          onChange={event => setActiveProject(event.target.value)}
        >
          {projects.map(project => (
            <option key={project.clientKey} value={project.id ?? ''}>{project.name}</option>
          ))}
        </select>
        {!creating && (
          <button type="button" className="secondary-btn" onClick={() => setCreating(true)}>
            New project
          </button>
        )}
        <span className={styles.muted} role="status" aria-live="polite">
          {status.lastError
            ? `Not all changes reached your account: ${status.lastError}`
            : status.pendingWrites > 0 ? 'Saving to your account…' : 'Saved to your account'}
        </span>
      </div>
      {active?.question && <p className={styles.question}>{active.question}</p>}
      <p className={styles.muted}>New alerts, peer sets, citations, notes and tabs are filed under this project.</p>
      {creating && (
        <form className={styles.form} onSubmit={submit}>
          <label htmlFor={nameId} className={styles.label}>Name</label>
          <input
            id={nameId}
            className={styles.input}
            value={name}
            maxLength={120}
            required
            autoFocus
            onChange={event => setName(event.target.value)}
          />
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
          <div className={styles.actions}>
            <button type="submit" className="primary-btn sm" disabled={!name.trim()}>Create project</button>
            <button type="button" className="secondary-btn" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
