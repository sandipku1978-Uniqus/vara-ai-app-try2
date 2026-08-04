import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import SicLookupField from '../components/filters/SicLookupField';

vi.mock('../services/referenceData', () => ({
  loadSicDirectory: vi.fn(async () => [
    { code: '2834', office: 'Office of Life Sciences', title: 'Pharmaceutical Preparations' },
    { code: '3571', office: 'Office of Technology', title: 'Electronic Computers' },
    { code: '7372', office: 'Office of Technology', title: 'Prepackaged Software' },
  ]),
}));

describe('SicLookupField controlled value changes', () => {
  it('resets a stale active option and never selects an out-of-range match on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<SicLookupField value="" onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Industry or SIC code' });

    await user.click(input);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');

    rerender(<SicLookupField value="no matching industry" onChange={onChange} />);
    await waitFor(() => expect(input).not.toHaveAttribute('aria-activedescendant'));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();

    rerender(<SicLookupField value="pharmaceutical" onChange={onChange} />);
    await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', expect.stringMatching(/option-0$/)));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('2834');
  });
});
