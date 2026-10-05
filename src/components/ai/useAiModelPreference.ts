'use client';

import { useCallback, useSyncExternalStore } from 'react';

import {
  defaultAiModelPreference,
  getAiModelPreference,
  setAiModelPreference,
  subscribeAiModelPreference,
  type AiModelPreference,
} from '../../services/aiModelPreference';

const SERVER_SNAPSHOT = defaultAiModelPreference();

function getServerSnapshot(): AiModelPreference {
  return SERVER_SNAPSHOT;
}

export function useAiModelPreference(): [AiModelPreference, (next: AiModelPreference) => void] {
  const preference = useSyncExternalStore(subscribeAiModelPreference, getAiModelPreference, getServerSnapshot);
  const update = useCallback((next: AiModelPreference) => {
    setAiModelPreference(next);
  }, []);
  return [preference, update];
}
