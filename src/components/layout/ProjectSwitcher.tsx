'use client';

/**
 * Header project switcher: choose the project new research is filed under,
 * start a new one, or open the active project's workspace. It complements
 * the Dashboard's selector (same userData.ts calls) and appears only once
 * account storage has answered, because before that there is no project
 * to file under.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { FolderOpen, Plus } from 'lucide-react';
import { useUserDataStatus } from '../../hooks/useUserDataStatus';
import { createUserProject, getActiveProjectId, listUserProjects, setActiveProject } from '../../services/userData';
import styles from './ProjectSwitcher.module.css';

export default function ProjectSwitcher() {
  const status = useUserDataStatus();
  const selectId = useId();
  const formId = useId();
  const nameId = useId();
  const questionId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [question, setQuestion] = useState('');
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || toggleRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (status.mode !== 'server') return null;
  const projects = listUserProjects().filter(project => project.id);
  const activeId = getActiveProjectId();
  if (projects.length === 0 || !activeId) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    createUserProject({ name, question });
    setName('');
    setQuestion('');
    setOpen(false);
    toggleRef.current?.focus();
  };

  return (
    <div className={styles.switcher}>
      <FolderOpen size={15} aria-hidden="true" className={styles.icon} />
      <label htmlFor={selectId} className="sr-only">Active project</label>
      <select
        id={selectId}
        className={styles.select}
        value={activeId}
        onChange={event => setActiveProject(event.target.value)}
        title="New research is filed under the active project"
      >
        {projects.map(project => (
          <option key={project.clientKey} value={project.id as string}>{project.name}</option>
        ))}
      </select>
      <Link className={styles.iconLink} href={`/projects/${encodeURIComponent(activeId)}`} aria-label="Open project workspace" title="Open the active project's workspace">
        Open
      </Link>
      <button
        ref={toggleRef}
        type="button"
        className={styles.iconBtn}
        aria-label="New project"
        aria-expanded={open}
        aria-controls={open ? formId : undefined}
        onClick={() => setOpen(value => !value)}
        title="New project"
      >
        <Plus size={15} aria-hidden="true" />
      </button>
      {open && (
        <form id={formId} ref={panelRef} className={styles.panel} onSubmit={submit} aria-label="New project">
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
          <p className={styles.hint}>The new project becomes active: research you save next is filed under it.</p>
          <div className={styles.actions}>
            <button type="submit" className="primary-btn sm" disabled={!name.trim()}>Create project</button>
            <button type="button" className="secondary-btn" onClick={() => { setOpen(false); toggleRef.current?.focus(); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
