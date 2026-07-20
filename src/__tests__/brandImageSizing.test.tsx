import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { URCBrandLockup, URCBrandMark } from '../components/brand/URCBrand';

vi.mock('../assets/brand/uniqus-logo-white.png', () => ({
  default: { src: '/uniqus-logo-white.png', width: 5000, height: 1737 },
}));

vi.mock('../assets/brand/uniqus-logo-color.png', () => ({
  default: { src: '/uniqus-logo-color.png', width: 900, height: 825 },
}));

describe('URC brand image sizing', () => {
  it('keeps lockup CSS dimensions aligned with the image attributes', () => {
    render(<URCBrandLockup size={26} tone="light" showParent />);

    const image = screen.getByRole('img', { name: 'Uniqus' });
    expect(image.style.width).toBe(`${image.getAttribute('width')}px`);
    expect(image.style.height).toBe(`${image.getAttribute('height')}px`);
  });

  it('keeps the compact mark square on both axes', () => {
    render(<URCBrandMark size={34} tone="light" />);

    const image = screen.getByRole('img', { name: 'Uniqus' });
    expect(image).toHaveAttribute('width', '34');
    expect(image).toHaveAttribute('height', '34');
    expect(image.style.width).toBe('34px');
    expect(image.style.height).toBe('34px');
  });
});
