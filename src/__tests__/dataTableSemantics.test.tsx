import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';

interface TestRow {
  id: string;
  company: string;
}

describe('DataTable semantics', () => {
  it('preserves native row and cell semantics while exposing actions as buttons', () => {
    const open = vi.fn();
    const columns: ColumnDef<TestRow>[] = [
      { key: 'company', header: 'Company' },
      {
        key: 'action',
        header: 'Action',
        sortable: false,
        render: row => <button type="button" onClick={() => open(row.id)}>Open {row.company}</button>,
      },
    ];

    const { container } = render(
      <DataTable columns={columns} data={[{ id: '1', company: 'Alpha' }]} rowKey={row => row.id} />
    );

    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Alpha' })).toBeInTheDocument();
    expect(container.querySelector('tbody tr[role="button"]')).toBeNull();
    expect(container.querySelector('tbody tr[tabindex]')).toBeNull();
  });
});
