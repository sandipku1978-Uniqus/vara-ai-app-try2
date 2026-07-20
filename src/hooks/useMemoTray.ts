'use client';

import { useSyncExternalStore } from 'react';
import { getMemoCitations, subscribeMemoTray, type MemoCitation } from '../services/memoTray';

const EMPTY: MemoCitation[] = [];

function getServerSnapshot(): MemoCitation[] {
  return EMPTY;
}

export function useMemoTray(): MemoCitation[] {
  return useSyncExternalStore(subscribeMemoTray, getMemoCitations, getServerSnapshot);
}
