'use client';

import { useSyncExternalStore } from 'react';
import {
  getMemoCitations,
  getMemoDraft,
  subscribeMemoDraft,
  subscribeMemoTray,
  type MemoCitation,
  type MemoDraftRecord,
} from '../services/memoTray';

const EMPTY: MemoCitation[] = [];

function getServerSnapshot(): MemoCitation[] {
  return EMPTY;
}

export function useMemoTray(): MemoCitation[] {
  return useSyncExternalStore(subscribeMemoTray, getMemoCitations, getServerSnapshot);
}

function getServerDraftSnapshot(): MemoDraftRecord | null {
  return null;
}

export function useMemoDraft(): MemoDraftRecord | null {
  return useSyncExternalStore(subscribeMemoDraft, getMemoDraft, getServerDraftSnapshot);
}
