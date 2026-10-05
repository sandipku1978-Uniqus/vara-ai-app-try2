'use client';

import { useEffect, useState } from 'react';

export const AI_MODELS_ENDPOINT = '/api/ai/models';

/**
 * Read the ids out of a `/api/ai/models` body. Accepts the registry list
 * directly or wrapped as `{ models }` / `{ data }`, with entries as ids or as
 * objects carrying `id`. Returns null when the body is not a model list, so an
 * unexpected shape never greys out the whole selector.
 */
export function parseAvailableModelIds(body: unknown): Set<string> | null {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const list = Array.isArray(body)
    ? body
    : Array.isArray(record?.models)
      ? record.models
      : Array.isArray(record?.data)
        ? record.data
        : null;
  if (!list) return null;
  const ids = new Set<string>();
  for (const entry of list) {
    if (typeof entry === 'string' && entry.trim()) {
      ids.add(entry.trim());
    } else if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
      ids.add((entry as { id: string }).id);
    }
  }
  return ids;
}

/**
 * The model ids the gateway can serve right now, or null when that is not
 * known (route missing, request failed, unreadable body) — null means "offer
 * the full registry", because the server still validates and falls back.
 */
export async function fetchAvailableModelIds(signal?: AbortSignal): Promise<Set<string> | null> {
  try {
    const response = await fetch(AI_MODELS_ENDPOINT, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    return parseAvailableModelIds(await response.json().catch(() => null));
  } catch {
    return null;
  }
}

/** Loads availability each time `enabled` turns true (the panel opening). */
export function useAiModelAvailability(enabled: boolean): Set<string> | null {
  const [available, setAvailable] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetchAvailableModelIds(controller.signal).then(ids => {
      if (!controller.signal.aborted) setAvailable(ids);
    });
    return () => controller.abort();
  }, [enabled]);

  return available;
}
