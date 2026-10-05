import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectSwitcher from '../components/layout/ProjectSwitcher';
import { projectPaletteItems } from '../components/layout/CommandPalette';
import { buildStorageScope, setActiveBrowserStorageScope } from '../services/storageNamespace';
import { getActiveProjectId, getUserDataStatus, resetUserDataForTests, startUserDataSync } from '../services/userData';

const PERSONAL = { id: '11111111-1111-4111-8111-111111111111', clientKey: 'personal', name: 'Personal research', question: '', position: 0 };
const SEGMENTS = { id: '22222222-2222-4222-8222-222222222222', clientKey: 'project-a', name: 'Segments', question: 'Segment expenses under ASU 2023-07', position: 1 };
const SCOPE = buildStorageScope('user_alice', null);

function accountFetch(available = true) {
  const puts: Array<{ kind: string; items: Array<Record<string, unknown>> }> = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    if (!available) return Response.json({ ok: false, errorClass: 'unavailable', error: 'off' }, { status: 503 });
    const kind = input.replace('/api/user/', '');
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { items: Array<Record<string, unknown>> };
      puts.push({ kind, items: body.items });
      return Response.json({ ok: true, items: body.items.map(item => ({ clientKey: item.clientKey, id: item.id })) });
    }
    return Response.json({ ok: true, items: kind === 'projects' ? [PERSONAL, SEGMENTS] : [] });
  });
  return { fetch, puts };
}

beforeEach(() => {
  resetUserDataForTests();
  window.localStorage.clear();
});
afterEach(() => {
  resetUserDataForTests();
  setActiveBrowserStorageScope(null);
});

async function connect(available = true) {
  window.localStorage.setItem(`urc.identity.${encodeURIComponent(SCOPE)}.urc.userdata.migrated.v1`, 'earlier');
  const server = accountFetch(available);
  setActiveBrowserStorageScope(SCOPE);
  startUserDataSync(SCOPE, { fetch: server.fetch as never });
  await waitFor(() => expect(getUserDataStatus().mode).toBe(available ? 'server' : 'unavailable'));
  return server;
}

describe('header project switcher', () => {
  it('renders nothing until account storage has answered', async () => {
    await connect(false);
    const { container } = render(<ProjectSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it('switches the active project and links to its workspace', async () => {
    await connect();
    render(<ProjectSwitcher />);
    const select = await screen.findByLabelText('Active project');
    expect(select).toHaveValue(PERSONAL.id);
    expect(screen.getByRole('link', { name: 'Open project workspace' })).toHaveAttribute('href', `/projects/${PERSONAL.id}`);

    await userEvent.selectOptions(select, SEGMENTS.id);
    expect(getActiveProjectId()).toBe(SEGMENTS.id);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open project workspace' })).toHaveAttribute('href', `/projects/${SEGMENTS.id}`));
  });

  it('creates a project from the header, makes it active and saves it to the account', async () => {
    const server = await connect();
    render(<ProjectSwitcher />);
    const toggle = await screen.findByRole('button', { name: 'New project' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.type(screen.getByLabelText('Name'), 'Leases');
    await userEvent.type(screen.getByLabelText('Question'), 'How are variable lease payments described?');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));

    expect(screen.getByRole('option', { name: 'Leases' })).toBeInTheDocument();
    expect(screen.getByLabelText('Active project')).toHaveDisplayValue('Leases');
    expect(toggle).toHaveFocus();
    await waitFor(() => expect(server.puts.some(put => put.kind === 'projects'
      && put.items.some(item => item.name === 'Leases' && item.question === 'How are variable lease payments described?'))).toBe(true), { timeout: 3000 });
  });

  it('closes the new-project form on Escape and returns focus to its toggle', async () => {
    await connect();
    render(<ProjectSwitcher />);
    const toggle = await screen.findByRole('button', { name: 'New project' });
    await userEvent.click(toggle);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('form', { name: 'New project' })).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });
});

describe('command palette project entries', () => {
  const projects = [PERSONAL, SEGMENTS];

  it('offers only the active project when there is no query', () => {
    expect(projectPaletteItems('', projects, SEGMENTS.id)).toEqual([
      { kind: 'project', label: 'Project: Segments', hint: 'Active project workspace', href: `/projects/${SEGMENTS.id}` },
    ]);
  });

  it('lists the Projects page, every project and New project for "proj"', () => {
    expect(projectPaletteItems('proj', projects, PERSONAL.id).map(item => item.label)).toEqual([
      'Projects', 'Project: Personal research', 'Project: Segments', 'New project',
    ]);
    expect(projectPaletteItems('proj', projects, PERSONAL.id).at(-1)?.href).toBe('/projects?new=1');
  });

  it('matches a project by its name or question', () => {
    expect(projectPaletteItems('asu 2023', projects, PERSONAL.id).map(item => item.href)).toEqual([`/projects/${SEGMENTS.id}`]);
    expect(projectPaletteItems('segm', projects, PERSONAL.id).map(item => item.label)).toEqual(['Project: Segments']);
  });

  it('has no project entries signed out (no projects)', () => {
    expect(projectPaletteItems('segm', [], null)).toEqual([]);
  });
});
