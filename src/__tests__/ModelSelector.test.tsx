import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AI_MODELS } from '../lib/ai-models';
import { ModelSelector, UNAVAILABLE_MODEL_HINT } from '../components/ai/ModelSelector';
import { defaultAiModelPreference, type AiModelPreference } from '../services/aiModelPreference';

function Harness({
  initial = defaultAiModelPreference(),
  available,
  onChange,
}: {
  initial?: AiModelPreference;
  available?: Set<string> | null;
  onChange?: (next: AiModelPreference) => void;
}) {
  const [preference, setPreference] = useState(initial);
  return (
    <ModelSelector
      preference={preference}
      availableModelIds={available}
      onChange={next => {
        setPreference(next);
        onChange?.(next);
      }}
    />
  );
}

function openSelector() {
  const trigger = screen.getByRole('button', { name: /AI model:/ });
  fireEvent.click(trigger);
  return { trigger, listbox: screen.getByRole('listbox', { name: 'AI model' }) };
}

describe('ModelSelector', () => {
  it('shows the model short label and effort on a compact trigger', () => {
    render(<Harness initial={{ modelId: 'anthropic/claude-sonnet-5.5', effort: 'medium', webSearch: true }} />);
    const trigger = screen.getByRole('button', { name: /AI model:/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Sonnet 5.5');
    expect(trigger).toHaveTextContent('· med');
    expect(trigger.getAttribute('aria-label')).toContain('web search on');
  });

  it('renders all 13 registry models grouped by provider', () => {
    render(<Harness />);
    const { listbox } = openSelector();
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(13);
    expect(AI_MODELS).toHaveLength(13);

    const groups = within(listbox).getAllByRole('group');
    expect(groups.map(group => group.getAttribute('aria-labelledby') && document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent))
      .toEqual(['Anthropic', 'OpenAI', 'Moonshot AI', 'xAI', 'Google', 'DeepSeek', 'Z.ai']);
    expect(within(groups[3]).getAllByRole('option').map(option => option.textContent)).toEqual([
      expect.stringContaining('Grok 4.5'),
      expect.stringContaining('Grok 4.6'),
      expect.stringContaining('Grok 4.7'),
    ]);

    const selected = options.filter(option => option.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('Claude Sonnet 5.5');
  });

  it('moves with arrow keys, selects with Enter, closes with Escape and returns focus to the trigger', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const { trigger, listbox } = openSelector();
    expect(listbox).toHaveFocus();

    const activeText = () => document.getElementById(listbox.getAttribute('aria-activedescendant')!)?.textContent;
    expect(activeText()).toContain('Claude Sonnet 5.5');

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(activeText()).toContain('GPT-6.1 Sol');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(activeText()).toContain('Claude Opus 5.5');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(activeText()).toContain('Claude Opus 5.5');
    fireEvent.keyDown(listbox, { key: 'End' });
    expect(activeText()).toContain('GLM 5.3 Flash');

    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: 'zai/glm-5.3-flash' }));
    expect(screen.getByRole('option', { name: /GLM 5.3 Flash/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(listbox, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('GLM 5.3 Flash');
  });

  it('opens from the trigger with ArrowDown', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('button', { name: /AI model:/ }), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toHaveFocus();
  });

  it('offers only the chosen model’s effort levels', () => {
    render(<Harness initial={{ modelId: 'anthropic/claude-opus-5.5', effort: 'none', webSearch: false }} />);
    openSelector();
    let radios = within(screen.getByRole('radiogroup')).getAllByRole('radio');
    expect(radios.map(radio => radio.textContent)).toEqual(['Off', 'Low', 'Med', 'High', 'Max']);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('option', { name: /GPT-6.1 Sol/ }));
    radios = within(screen.getByRole('radiogroup', { name: /GPT-6.1 Sol/ })).getAllByRole('radio');
    expect(radios.map(radio => radio.textContent)).toEqual(['Low', 'Med', 'High', 'Max']);
    // "Off" is not offered by GPT-6.1 Sol, so the choice falls to its default.
    expect(screen.getByRole('radio', { name: 'Med' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Med' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'High' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'High' })).toHaveFocus();
  });

  it('labels web search as native or via Perplexity Sonar and toggles it', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openSelector();
    const toggle = screen.getByRole('switch', { name: /Web search/ });
    expect(toggle).toHaveTextContent('Native');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ webSearch: true }));

    fireEvent.click(screen.getByRole('option', { name: /Kimi K3/ }));
    expect(screen.getByRole('switch', { name: /Web search/ })).toHaveTextContent('via Perplexity Sonar');
  });

  it('shows context window and price per 1M tokens for the model in focus', () => {
    render(<Harness />);
    openSelector();
    expect(screen.getByText(/1M context/)).toHaveTextContent('Claude Sonnet 5.5 · 1M context · $2 in / $10 out per 1M');
  });

  it('greys out models the gateway does not list and will not select them', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} available={new Set(['anthropic/claude-sonnet-5.5', 'openai/gpt-6.1-sol'])} />);
    const { listbox } = openSelector();
    const grok = within(listbox).getByRole('option', { name: /Grok 4.5/ });
    expect(grok).toHaveAttribute('aria-disabled', 'true');
    expect(grok).toHaveAttribute('title', UNAVAILABLE_MODEL_HINT);
    fireEvent.click(grok);
    expect(onChange).not.toHaveBeenCalled();
    expect(within(listbox).getByRole('option', { name: /GPT-6.1 Sol/ })).not.toHaveAttribute('aria-disabled');
  });

  it('offers every model when availability is unknown', () => {
    render(<Harness available={null} />);
    const { listbox } = openSelector();
    expect(within(listbox).getAllByRole('option').filter(option => option.getAttribute('aria-disabled') === 'true')).toHaveLength(0);
  });

  it('closes on an outside pointer press without stealing focus', () => {
    render(
      <>
        <button type="button">elsewhere</button>
        <Harness />
      </>,
    );
    openSelector();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
