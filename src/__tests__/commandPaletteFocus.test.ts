import { describe, expect, it, vi } from 'vitest';
import { trapCommandPaletteFocus } from '../components/layout/CommandPalette';

describe('Command Palette focus containment', () => {
  it('keeps Tab and Shift+Tab on the input when listbox options are roving-focus only', () => {
    const dialog = document.createElement('div');
    const input = document.createElement('input');
    const option = document.createElement('button');
    option.tabIndex = -1;
    dialog.append(input, option);
    document.body.append(dialog);
    input.focus();

    const forwardPrevent = vi.fn();
    trapCommandPaletteFocus({ key: 'Tab', shiftKey: false, preventDefault: forwardPrevent }, dialog);
    expect(forwardPrevent).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);

    const backwardPrevent = vi.fn();
    trapCommandPaletteFocus({ key: 'Tab', shiftKey: true, preventDefault: backwardPrevent }, dialog);
    expect(backwardPrevent).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);

    dialog.remove();
  });

  it('wraps between actual tab stops while excluding tabindex -1 options', () => {
    const dialog = document.createElement('div');
    const input = document.createElement('input');
    const option = document.createElement('button');
    option.tabIndex = -1;
    const close = document.createElement('button');
    dialog.append(input, option, close);
    document.body.append(dialog);

    close.focus();
    trapCommandPaletteFocus({ key: 'Tab', shiftKey: false, preventDefault: vi.fn() }, dialog);
    expect(document.activeElement).toBe(input);

    input.focus();
    trapCommandPaletteFocus({ key: 'Tab', shiftKey: true, preventDefault: vi.fn() }, dialog);
    expect(document.activeElement).toBe(close);

    dialog.remove();
  });
});
