import { useSyncExternalStore } from 'react';
import { getUserDataStatus, subscribeUserDataStatus, type UserDataStatus } from '../services/userData';

const SERVER_SNAPSHOT: UserDataStatus = {
  mode: 'local', scope: null, pendingWrites: 0, lastError: null, lastSyncedAt: null, migratedAt: null,
};

/** Live durable-storage status (mode, pending writes, last error). */
export function useUserDataStatus(): UserDataStatus {
  return useSyncExternalStore(subscribeUserDataStatus, getUserDataStatus, () => SERVER_SNAPSHOT);
}
