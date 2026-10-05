'use client';

import { useEffect } from 'react';
import { useApp } from '../../context/AppState';
import { startUserDataSync } from '../../services/userData';

/**
 * Starts durable research sync for the signed-in identity (migration 026):
 * probe, one-time localStorage migration, hydration, outbox flushing.
 * Signed out it does nothing and every store stays browser-local.
 */
export function UserDataSync() {
  const { storageScope } = useApp();
  useEffect(() => {
    startUserDataSync(storageScope);
  }, [storageScope]);
  return null;
}
