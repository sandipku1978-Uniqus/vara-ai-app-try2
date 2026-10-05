'use client';

import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { getDocumentCart, subscribeDocumentCart, type CartFiling } from '../../services/documentCart';
import { isAccountUserDataScope, subscribeUserDataStatus } from '../../services/userData';
import { isAccountStorageScope } from '../../services/storageNamespace';
import { useUserDataStatus } from '../../hooks/useUserDataStatus';
import { readSessionDisplayName } from '../../services/memoExport';
import type { UserDataKind } from '../../lib/user-data-kinds';
import { loadKind, loadSearchJobs, type JobsLoad, type KindLoad } from './projectData';

/**
 * True once the element has scrolled near the viewport (and stays true), so
 * a workspace section only reads its kind when someone can see it. Without
 * IntersectionObserver (tests, old browsers) every section loads at once.
 */
export function useLazyVisible(ref: RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px 0px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, visible]);
  return visible;
}

/** GET /api/user/{kind} once enabled; `reload` re-reads it. */
export function useKindLoad<K extends UserDataKind>(kind: K, enabled = true): { load: KindLoad<K>; reload: () => void } {
  const [load, setLoad] = useState<KindLoad<K>>({ status: 'loading' });
  const [token, setToken] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadKind(kind).then(result => { if (!cancelled) setLoad(result); });
    return () => { cancelled = true; };
  }, [enabled, kind, token]);
  const reload = useCallback(() => {
    setLoad({ status: 'loading' });
    setToken(value => value + 1);
  }, []);
  return { load, reload };
}

/** GET /api/search-jobs once enabled. */
export function useSearchJobsLoad(enabled = true): JobsLoad {
  const [load, setLoad] = useState<JobsLoad>({ status: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadSearchJobs().then(result => { if (!cancelled) setLoad(result); });
    return () => { cancelled = true; };
  }, [enabled]);
  return load;
}

const NO_CART: CartFiling[] = [];

/** The session's document cart (sessionStorage, this browser only). */
export function useDocumentCartItems(): CartFiling[] {
  return useSyncExternalStore(subscribeDocumentCart, getDocumentCart, () => NO_CART);
}

/**
 * isAccountUserDataScope() as a render-safe value: false during server
 * rendering and hydration, then the live answer, re-read on status changes.
 * It is consulted only once the status names an account scope: for a
 * signed-out scope the engine keeps no state, and each call would publish a
 * fresh status object, re-rendering every subscriber without end.
 */
export function useAccountScope(): boolean {
  const status = useUserDataStatus();
  return isAccountStorageScope(status.scope) && isAccountUserDataScope();
}

/** The signed-in display name (Clerk), re-read when the sync status changes; null on the server. */
export function useSessionDisplayName(): string | null {
  return useSyncExternalStore(subscribeUserDataStatus, readSessionDisplayName, () => null);
}
