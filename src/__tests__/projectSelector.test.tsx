import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectSelector from '../components/projects/ProjectSelector';
import { buildStorageScope, setActiveBrowserStorageScope } from '../services/storageNamespace';
import { getActiveProjectId, resetUserDataForTests, startUserDataSync } from '../services/userData';

const PERSONAL = { id: '11111111-1111-4111-8111-111111111111', clientKey: 'personal', name: 'Personal research', question: '', position: 0 };

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
    return Response.json({ ok: true, items: kind === 'projects' ? [PERSONAL] : [] });
  });
  return { fetch, puts };
}

beforeEach(() => resetUserDataForTests());
afterEach(() => {
  resetUserDataForTests();
  setActiveBrowserStorageScope(null);
});

describe('Dashboard project selector', () => {
  it('renders nothing when signed out', () => {
    setActiveBrowserStorageScope('signed-out');
    startUserDataSync('signed-out');
    const { container } = render(<ProjectSelector />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says the work stays in this browser when account storage is unavailable', async () => {
    const scope = buildStorageScope('user_alice', null);
    setActiveBrowserStorageScope(scope);
    startUserDataSync(scope, { fetch: accountFetch(false).fetch as never });
    render(<ProjectSelector />);
    expect(await screen.findByText(/kept in this browser only/)).toBeInTheDocument();
  });

  it('defaults to the personal project and creates a project with a name and question', async () => {
    const scope = buildStorageScope('user_alice', null);
    window.localStorage.setItem(`urc.identity.${encodeURIComponent(scope)}.urc.userdata.migrated.v1`, 'earlier');
    const server = accountFetch();
    setActiveBrowserStorageScope(scope);
    startUserDataSync(scope, { fetch: server.fetch as never });
    render(<ProjectSelector />);

    const select = await screen.findByLabelText('Project');
    expect((select as HTMLSelectElement).value).toBe(PERSONAL.id);

    await userEvent.click(screen.getByRole('button', { name: 'New project' }));
    await userEvent.type(screen.getByLabelText('Name'), 'ASU 2023-07 segments');
    await userEvent.type(screen.getByLabelText('Question'), 'How do peers disclose significant segment expenses?');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('How do peers disclose significant segment expenses?')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ASU 2023-07 segments' })).toBeInTheDocument();
    expect(getActiveProjectId()).not.toBe(PERSONAL.id);
    await waitFor(() => expect(server.puts.some(put => put.kind === 'projects'
      && put.items.some(item => item.name === 'ASU 2023-07 segments'))).toBe(true), { timeout: 3000 });
  });
});
