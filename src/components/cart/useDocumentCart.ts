'use client';

import { useSyncExternalStore } from 'react';
import { getDocumentCart, subscribeDocumentCart, type CartFiling } from '../../services/documentCart';

const EMPTY: CartFiling[] = [];

function getServerSnapshot(): CartFiling[] {
  return EMPTY;
}

/** The document cart, re-rendering on every change from any surface. */
export function useDocumentCart(): CartFiling[] {
  return useSyncExternalStore(subscribeDocumentCart, getDocumentCart, getServerSnapshot);
}
