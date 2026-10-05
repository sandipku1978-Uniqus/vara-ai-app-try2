'use client';

import { useEffect, useState } from 'react';

export const AI_MODELS_ENDPOINT = '/api/ai/models';

/** Shown in the model selector when the gateway's listing could not be read. */
export const MODEL_AVAILABILITY_UNKNOWN_NOTE = 'Model availability could not be checked just now, so every model is listed.';

/**
 * What the selector needs: the servable ids (null = unknown, grey nothing
 * out) and a short note to show when that is because the listing failed.
 */
export interface ModelAvailability {
  ids: Set<string> | null;
  note: string | null;
}

const UNKNOWN: ModelAvailability = { ids: null, note: null };

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
 * Read a `/api/ai/models` body. When the route says the gateway listing was
 * unavailable (`gateway.listing: 'unavailable'`), the models it lists are a
 * stale copy or the whole registry, not a current answer: nothing is greyed
 * out, and the note says availability could not be checked.
 */
export function parseModelAvailability(body: unknown): ModelAvailability {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const gateway = record?.gateway && typeof record.gateway === 'object' ? record.gateway as Record<string, unknown> : null;
  if (gateway?.listing === 'unavailable') return { ids: null, note: MODEL_AVAILABILITY_UNKNOWN_NOTE };
  return { ids: parseAvailableModelIds(body), note: null };
}

/**
 * Model availability right now. Unknown (route missing, request failed,
 * unreadable body) is `{ ids: null }` — "offer the full registry", because
 * the server still validates and falls back.
 */
export async function fetchModelAvailability(signal?: AbortSignal): Promise<ModelAvailability> {
  try {
    const response = await fetch(AI_MODELS_ENDPOINT, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return UNKNOWN;
    return parseModelAvailability(await response.json().catch(() => null));
  } catch {
    return UNKNOWN;
  }
}

/** The model ids the gateway can serve right now, or null when that is not known. */
export async function fetchAvailableModelIds(signal?: AbortSignal): Promise<Set<string> | null> {
  return (await fetchModelAvailability(signal)).ids;
}

/** Loads availability each time `enabled` turns true (the panel opening). */
export function useAiModelAvailability(enabled: boolean): ModelAvailability {
  const [availability, setAvailability] = useState<ModelAvailability>(UNKNOWN);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetchModelAvailability(controller.signal).then(next => {
      if (!controller.signal.aborted) setAvailability(next);
    });
    return () => controller.abort();
  }, [enabled]);

  return availability;
}
