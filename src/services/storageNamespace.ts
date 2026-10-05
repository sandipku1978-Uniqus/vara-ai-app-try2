let activeBrowserStorageScope: string | null = null;

export function buildStorageScope(userId: string | null, orgId: string | null): string {
  return userId ? `user:${userId}:org:${orgId || 'personal'}` : 'signed-out';
}

export function setActiveBrowserStorageScope(scope: string | null): void {
  if (typeof window !== 'undefined') activeBrowserStorageScope = scope;
}

export function scopedStorageKey(baseKey: string, scope = activeBrowserStorageScope): string | null {
  if (!scope) return null;
  return `urc.identity.${encodeURIComponent(scope)}.${baseKey}`;
}

/** The scope the AppProvider last set (null until identity has loaded). */
export function getActiveBrowserStorageScope(): string | null {
  return activeBrowserStorageScope;
}

/** True for a signed-in identity's scope; false for 'signed-out' and null. */
export function isAccountStorageScope(scope: string | null): scope is string {
  return Boolean(scope && scope.startsWith('user:'));
}
