/**
 * After a move, archive or cart save the page reloads so the sync engine
 * re-hydrates every store (and its record of each object's project) from
 * the account. An object so tests can observe the call without navigating.
 */
export const pageReload = {
  reload(): void {
    if (typeof window !== 'undefined') window.location.reload();
  },
};
