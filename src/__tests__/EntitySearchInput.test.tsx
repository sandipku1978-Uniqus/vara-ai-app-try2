import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import EntitySearchInput from '../components/filters/EntitySearchInput';

vi.mock('../services/secApi', () => ({
  getCompanyDirectory: vi.fn(async () => [
    { ticker: 'MSFT', title: 'Microsoft Corporation', cik: '0000789019' },
    { ticker: 'MSTR', title: 'Strategy Inc.', cik: '0001050446' },
  ]),
  computeCompanySuggestions: (directory: unknown[], value: string) => value.trim() ? directory : [],
}));

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <EntitySearchInput value={value} onChange={setValue} ariaLabel="Issuer lookup" />
      <button type="button">Next control</button>
    </>
  );
}

describe('EntitySearchInput keyboard interaction', () => {
  it('keeps options out of the tab order and visibly tracks the active descendant', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Issuer lookup' });

    await user.click(input);
    await user.type(input, 'micro');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute('tabindex', '-1');
    expect(options[1]).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{ArrowDown}');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[1].style.background).toBe('var(--interactive-hover)');

    await user.tab();
    const nextControl = screen.getByRole('button', { name: 'Next control' });
    expect(nextControl).toHaveFocus();
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 175));
    });
    expect(nextControl).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
