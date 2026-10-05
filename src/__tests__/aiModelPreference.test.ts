import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AI_MODEL_ID, findAiModel } from '../lib/ai-models';
import {
  currentAiModelSelection,
  defaultAiModelPreference,
  getAiModelPreference,
  groundedAiModelSelection,
  resetAiModelPreferenceCache,
  setAiModelPreference,
  subscribeAiModelPreference,
  validateAiModelPreference,
  withModel,
} from '../services/aiModelPreference';
import { buildStorageScope, scopedStorageKey, setActiveBrowserStorageScope } from '../services/storageNamespace';

const STORAGE_KEY = 'urc.ai.model-preference.v1';

describe('aiModelPreference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetAiModelPreferenceCache();
    setActiveBrowserStorageScope(buildStorageScope('user_a', null));
  });

  afterEach(() => {
    setActiveBrowserStorageScope(null);
    resetAiModelPreferenceCache();
  });

  it('defaults to the registry default model, its default effort, web search off', () => {
    const model = findAiModel(DEFAULT_AI_MODEL_ID)!;
    expect(defaultAiModelPreference()).toEqual({ modelId: DEFAULT_AI_MODEL_ID, effort: model.defaultEffort, webSearch: false });
    expect(getAiModelPreference()).toEqual(defaultAiModelPreference());
  });

  it('replaces an unknown model with the default model', () => {
    expect(validateAiModelPreference({ modelId: 'anthropic/claude-retired-1', effort: 'high', webSearch: true })).toEqual({
      modelId: DEFAULT_AI_MODEL_ID,
      effort: 'high',
      webSearch: true,
    });
  });

  it('replaces an effort the model does not offer with that model’s default', () => {
    // GPT-6.1 Sol offers low..max, not none.
    expect(validateAiModelPreference({ modelId: 'openai/gpt-6.1-sol', effort: 'none', webSearch: false }).effort).toBe('medium');
    expect(validateAiModelPreference({ modelId: 'openai/gpt-6.1-sol', effort: 'extreme', webSearch: false }).effort).toBe('medium');
    // Sonnet 5.5 is the registry model that offers "none" (Opus 5.5 still thinks with thinking off, so it does not).
    expect(validateAiModelPreference({ modelId: 'anthropic/claude-sonnet-5.5', effort: 'none', webSearch: false }).effort).toBe('none');
  });

  it('only a literal true turns web search on', () => {
    expect(validateAiModelPreference({ modelId: DEFAULT_AI_MODEL_ID, effort: 'low', webSearch: 'yes' }).webSearch).toBe(false);
    expect(validateAiModelPreference(null)).toEqual(defaultAiModelPreference());
    expect(validateAiModelPreference('anthropic/claude-opus-5.5')).toEqual(defaultAiModelPreference());
  });

  it('keeps the effort when switching to a model that offers it, otherwise uses the new default', () => {
    const opusOff = { modelId: 'anthropic/claude-opus-5.5', effort: 'none' as const, webSearch: true };
    expect(withModel(opusOff, 'openai/gpt-6.1-sol')).toEqual({ modelId: 'openai/gpt-6.1-sol', effort: 'medium', webSearch: true });
    expect(withModel({ ...opusOff, effort: 'high' }, 'openai/gpt-6.1-sol').effort).toBe('high');
  });

  it('validates what is read back from storage', () => {
    const key = scopedStorageKey(STORAGE_KEY)!;
    window.localStorage.setItem(key, JSON.stringify({ modelId: 'openai/gpt-6.1-sol', effort: 'none', webSearch: 1 }));
    expect(getAiModelPreference()).toEqual({ modelId: 'openai/gpt-6.1-sol', effort: 'medium', webSearch: false });

    resetAiModelPreferenceCache();
    window.localStorage.setItem(key, '{not json');
    expect(getAiModelPreference()).toEqual(defaultAiModelPreference());
  });

  it('persists per user through the storage namespace and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAiModelPreference(listener);
    setAiModelPreference({ modelId: 'zai/glm-5.3', effort: 'high', webSearch: true });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();

    const key = scopedStorageKey(STORAGE_KEY)!;
    expect(key).toContain('user%3Auser_a');
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ modelId: 'zai/glm-5.3', effort: 'high', webSearch: true });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    setActiveBrowserStorageScope(buildStorageScope('user_b', null));
    expect(getAiModelPreference()).toEqual(defaultAiModelPreference());

    setActiveBrowserStorageScope(buildStorageScope('user_a', null));
    expect(getAiModelPreference().modelId).toBe('zai/glm-5.3');
  });

  it('keeps a choice made before the identity scope arrived, in memory only', () => {
    setActiveBrowserStorageScope(null);
    resetAiModelPreferenceCache();
    setAiModelPreference({ modelId: 'google/gemini-3.8-flash', effort: 'low', webSearch: false });
    expect(window.localStorage.length).toBe(0);

    setActiveBrowserStorageScope(buildStorageScope('user_c', null));
    expect(getAiModelPreference().modelId).toBe('google/gemini-3.8-flash');
  });

  it('builds the request fields, with web search forced off for grounded calls', () => {
    setAiModelPreference({ modelId: 'moonshotai/kimi-k3', effort: 'low', webSearch: true });
    expect(currentAiModelSelection()).toEqual({ model: 'moonshotai/kimi-k3', reasoningEffort: 'low', webSearch: true });
    expect(groundedAiModelSelection()).toEqual({ model: 'moonshotai/kimi-k3', reasoningEffort: 'low', webSearch: false });
  });
});
