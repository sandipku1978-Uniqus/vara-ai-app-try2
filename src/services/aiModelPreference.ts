/**
 * The user's AI model choice — which gateway model answers, at what reasoning
 * effort, and whether it may search the web.
 *
 * Browser-local for now, keyed per signed-in user through storageNamespace.
 * The surface is deliberately small (get / set / subscribe / to-selection) so
 * a server-backed store can replace the storage half without touching callers.
 */
import {
  AI_MODELS,
  DEFAULT_AI_MODEL_ID,
  findAiModel,
  isReasoningEffort,
  type AiModelDefinition,
  type AiModelSelection,
  type ReasoningEffort,
} from '../lib/ai-models';
import { scopedStorageKey } from './storageNamespace';

export interface AiModelPreference {
  modelId: string;
  effort: ReasoningEffort;
  webSearch: boolean;
}

const STORAGE_KEY = 'urc.ai.model-preference.v1';

function defaultModel(): AiModelDefinition {
  return findAiModel(DEFAULT_AI_MODEL_ID) ?? AI_MODELS[0];
}

/** The effort a model actually offers: the requested one if allowed, else its default. */
export function effortForModel(model: AiModelDefinition, requested: unknown): ReasoningEffort {
  if (isReasoningEffort(requested) && model.effortLevels.includes(requested)) return requested;
  if (model.effortLevels.includes(model.defaultEffort)) return model.defaultEffort;
  return model.effortLevels[0] ?? model.defaultEffort;
}

export function defaultAiModelPreference(): AiModelPreference {
  const model = defaultModel();
  return { modelId: model.id, effort: effortForModel(model, model.defaultEffort), webSearch: false };
}

/**
 * Coerce anything (a stored blob from an older registry, a hand-edited value)
 * into a preference the registry can honour: unknown model → default model,
 * effort the model does not offer → that model's default, non-boolean web
 * search → off.
 */
export function validateAiModelPreference(raw: unknown): AiModelPreference {
  if (!raw || typeof raw !== 'object') return defaultAiModelPreference();
  const record = raw as Record<string, unknown>;
  const model = findAiModel(typeof record.modelId === 'string' ? record.modelId : null) ?? defaultModel();
  return {
    modelId: model.id,
    effort: effortForModel(model, record.effort),
    webSearch: record.webSearch === true,
  };
}

/** Switching model keeps the effort when the new model offers it. */
export function withModel(preference: AiModelPreference, modelId: string): AiModelPreference {
  return validateAiModelPreference({ ...preference, modelId });
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: AiModelPreference | null = null;
let cacheKey: string | null | undefined;

function storageKey(): string | null {
  return scopedStorageKey(STORAGE_KEY);
}

export function getAiModelPreference(): AiModelPreference {
  if (typeof window === 'undefined') return cache ?? defaultAiModelPreference();
  const key = storageKey();
  if (cache && cacheKey === key) return cache;
  // Only a choice made before any identity scope arrived carries over into
  // the first scope; another user's choice never does.
  const carried = cacheKey === null || cacheKey === undefined ? cache : null;
  cacheKey = key;
  if (!key) {
    // Signed out, or the identity scope has not arrived yet: hold the choice
    // in memory for this session, never under an unscoped key.
    cache = carried ?? defaultAiModelPreference();
    return cache;
  }
  try {
    const stored = window.localStorage.getItem(key);
    cache = stored ? validateAiModelPreference(JSON.parse(stored)) : (carried ?? defaultAiModelPreference());
  } catch {
    cache = carried ?? defaultAiModelPreference();
  }
  return cache;
}

export function setAiModelPreference(next: AiModelPreference): AiModelPreference {
  const valid = validateAiModelPreference(next);
  cache = valid;
  const key = storageKey();
  cacheKey = key;
  if (key && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(key, JSON.stringify(valid));
    } catch {
      // Quota or private mode: the choice holds for this session only.
    }
  }
  listeners.forEach(listener => listener());
  return valid;
}

export function subscribeAiModelPreference(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toAiModelSelection(preference: AiModelPreference): Required<AiModelSelection> {
  return { model: preference.modelId, reasoningEffort: preference.effort, webSearch: preference.webSearch };
}

/** The request fields for the current preference, for any client AI call. */
export function currentAiModelSelection(): Required<AiModelSelection> {
  return toAiModelSelection(getAiModelPreference());
}

/**
 * The same selection with web search forced off, for calls that answer from
 * filing text they were handed and have no place to show web sources.
 */
export function groundedAiModelSelection(): Required<AiModelSelection> {
  return { ...currentAiModelSelection(), webSearch: false };
}

/** Test-only: forget the in-memory copy so the next read goes to storage. */
export function resetAiModelPreferenceCache(): void {
  cache = null;
  cacheKey = undefined;
}
