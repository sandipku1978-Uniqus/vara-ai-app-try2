'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ChevronDown, Globe } from 'lucide-react';

import { AI_MODELS, findAiModel, type AiModelDefinition, type ReasoningEffort } from '../../lib/ai-models';
import { withModel, type AiModelPreference } from '../../services/aiModelPreference';
import {
  effortLabel,
  effortPhrase,
  effortShort,
  formatContextWindow,
  formatPerMillion,
  groupModelsByProvider,
} from './modelFormat';
import { useAiModelPreference } from './useAiModelPreference';
import './ModelSelector.css';

export const UNAVAILABLE_MODEL_HINT = 'Not available on the gateway right now';

interface ModelSelectorProps {
  /** Ids the gateway reports as servable; null/undefined = unknown, offer all. */
  availableModelIds?: Set<string> | null;
  /** A short note when availability could not be checked (nothing is greyed out then). */
  availabilityNote?: string | null;
  /** Controlled use (tests, other surfaces); defaults to the stored preference. */
  preference?: AiModelPreference;
  onChange?: (next: AiModelPreference) => void;
}

function optionDomId(listboxId: string, modelId: string): string {
  return `${listboxId}-${modelId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function ModelSelector({ availableModelIds, availabilityNote, preference: controlledPreference, onChange }: ModelSelectorProps) {
  const [storedPreference, setStoredPreference] = useAiModelPreference();
  const preference = controlledPreference ?? storedPreference;
  const commit = onChange ?? setStoredPreference;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-models`;
  const popoverId = `${baseId}-popover`;

  const groups = useMemo(() => groupModelsByProvider(AI_MODELS), []);
  // Flat order matches the visual order, so arrow keys walk the list as read.
  const flatModels = useMemo(() => groups.flatMap(group => group.models), [groups]);
  const selectedModel = findAiModel(preference.modelId) ?? flatModels[0];
  const isAvailable = useCallback(
    (model: AiModelDefinition) => !availableModelIds || availableModelIds.has(model.id),
    [availableModelIds],
  );
  const selectedUnavailable = !isAvailable(selectedModel);
  const activeModel = flatModels[activeIndex] ?? selectedModel;
  const infoModel = open ? activeModel : selectedModel;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const openPopover = useCallback(() => {
    setActiveIndex(Math.max(0, flatModels.findIndex(model => model.id === preference.modelId)));
    setOpen(true);
  }, [flatModels, preference.modelId]);

  useEffect(() => {
    if (!open) return;
    listboxRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    const active = flatModels[activeIndex];
    if (!active) return;
    const element = document.getElementById(optionDomId(listboxId, active.id));
    element?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, flatModels, listboxId, open]);

  const selectModel = (model: AiModelDefinition) => {
    if (!isAvailable(model)) return;
    commit(withModel(preference, model.id));
  };

  const setEffort = (effort: ReasoningEffort) => {
    commit({ ...preference, effort });
  };

  const onListboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const last = flatModels.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex(index => Math.min(last, index + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex(index => Math.max(0, index - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(last);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (flatModels[activeIndex]) selectModel(flatModels[activeIndex]);
        break;
      default:
        break;
    }
  };

  const onPopoverKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openPopover();
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close(true);
    }
  };

  const effortLevels = selectedModel.effortLevels;
  const onEffortKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % effortLevels.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + effortLevels.length) % effortLevels.length;
    else return;
    event.preventDefault();
    setEffort(effortLevels[next]);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[next]?.focus();
  };

  const showEffort = selectedModel.supportsReasoning && effortLevels.length > 0;
  const triggerTitle = [
    `${selectedModel.label}${showEffort ? ` · ${effortPhrase(preference.effort)}` : ''}`,
    preference.webSearch ? 'web search on' : null,
    selectedUnavailable ? UNAVAILABLE_MODEL_HINT : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      ref={wrapperRef}
      className="model-selector"
      onBlur={event => {
        // Tabbing out of the selector closes it; clicks inside keep it open.
        const next = event.relatedTarget as Node | null;
        if (open && next && wrapperRef.current && !wrapperRef.current.contains(next)) close(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`model-selector-trigger${selectedUnavailable ? ' unavailable' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={`AI model: ${triggerTitle}. Change model`}
        title={triggerTitle}
        onClick={() => (open ? close(false) : openPopover())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="model-selector-trigger-label">{selectedModel.shortLabel}</span>
        {showEffort && (
          <span className="model-selector-trigger-effort" aria-hidden="true">· {effortShort(preference.effort)}</span>
        )}
        {preference.webSearch && <Globe size={12} aria-hidden="true" className="model-selector-trigger-web" />}
        <ChevronDown size={12} aria-hidden="true" className="model-selector-trigger-chevron" />
      </button>

      {open && (
        <div
          id={popoverId}
          className="model-selector-popover"
          role="dialog"
          aria-label="Model, reasoning effort and web search"
          onKeyDown={onPopoverKeyDown}
        >
          {availabilityNote && <p className="model-selector-note" role="note">{availabilityNote}</p>}
          <div
            ref={listboxRef}
            id={listboxId}
            className="model-selector-list"
            role="listbox"
            tabIndex={0}
            aria-label="AI model"
            aria-activedescendant={activeModel ? optionDomId(listboxId, activeModel.id) : undefined}
            onKeyDown={onListboxKeyDown}
          >
            {groups.map(group => {
              const headingId = `${listboxId}-group-${group.providerLabel.replace(/[^a-zA-Z0-9]/g, '')}`;
              return (
                <div key={group.providerLabel} role="group" aria-labelledby={headingId} className="model-selector-group">
                  <div id={headingId} className="model-selector-group-label" role="presentation">{group.providerLabel}</div>
                  {group.models.map(model => {
                    const index = flatModels.indexOf(model);
                    const available = isAvailable(model);
                    const selected = model.id === preference.modelId;
                    return (
                      <div
                        key={model.id}
                        id={optionDomId(listboxId, model.id)}
                        role="option"
                        aria-selected={selected}
                        aria-disabled={available ? undefined : true}
                        title={available ? model.label : UNAVAILABLE_MODEL_HINT}
                        className={[
                          'model-selector-option',
                          selected ? 'selected' : '',
                          index === activeIndex ? 'active' : '',
                          available ? '' : 'unavailable',
                        ].filter(Boolean).join(' ')}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          setActiveIndex(index);
                          selectModel(model);
                        }}
                      >
                        <span className="model-selector-option-label">{model.label}</span>
                        <span className="model-selector-caps">
                          <span
                            className={`model-selector-dot reasoning${model.supportsReasoning ? '' : ' off'}`}
                            title={model.supportsReasoning ? 'Configurable reasoning' : 'No reasoning control'}
                          />
                          <span
                            className={`model-selector-dot web${model.nativeWebSearch ? '' : ' off'}`}
                            title={model.nativeWebSearch ? 'Native web search' : 'Web search via Perplexity Sonar'}
                          />
                          <span className="sr-only">
                            {model.supportsReasoning ? 'Reasoning' : 'No reasoning control'}
                            {model.nativeWebSearch ? ', native web search' : ', web search via Perplexity Sonar'}
                            {available ? '' : `. ${UNAVAILABLE_MODEL_HINT}`}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="model-selector-controls">
            {showEffort ? (
              <div className="model-selector-effort" role="radiogroup" aria-label={`Reasoning effort for ${selectedModel.label}`}>
                {effortLevels.map((effort, index) => {
                  const checked = preference.effort === effort;
                  return (
                    <button
                      key={effort}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      tabIndex={checked ? 0 : -1}
                      className={checked ? 'checked' : ''}
                      onClick={() => setEffort(effort)}
                      onKeyDown={event => onEffortKeyDown(event, index)}
                    >
                      {effortLabel(effort)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="model-selector-effort-none">No reasoning control for this model</span>
            )}

            <button
              type="button"
              role="switch"
              aria-checked={preference.webSearch}
              className={`model-selector-web${preference.webSearch ? ' on' : ''}`}
              onClick={() => commit({ ...preference, webSearch: !preference.webSearch })}
            >
              <Globe size={13} aria-hidden="true" />
              <span>Web search</span>
              <span className="model-selector-web-mode">
                {selectedModel.nativeWebSearch ? 'Native' : 'via Perplexity Sonar'}
              </span>
              <span className="model-selector-switch" aria-hidden="true" />
            </button>
          </div>

          <div
            className="model-selector-footer"
            aria-live="polite"
            title={`${infoModel.label}: ${formatContextWindow(infoModel.contextWindow)}-token context window; ${formatPerMillion(infoModel.pricing.input)} input and ${formatPerMillion(infoModel.pricing.output)} output per 1M tokens`}
          >
            <span className="model-selector-footer-name">{infoModel.label}</span>
            {' · '}{formatContextWindow(infoModel.contextWindow)} context
            {' · '}{formatPerMillion(infoModel.pricing.input)} in / {formatPerMillion(infoModel.pricing.output)} out per 1M
            {!isAvailable(infoModel) && <> · {UNAVAILABLE_MODEL_HINT}</>}
          </div>
        </div>
      )}
    </div>
  );
}
