'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import styles from '../components/layout/RouteState.module.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error:', error);

    // A deploy while this tab was open can orphan its JS chunks; that's not
    // a user problem — reload once to pick up the new build. The session
    // flag prevents a reload loop if the failure is real.
    const isStaleChunk = /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i
      .test(`${error.name} ${error.message}`);
    if (isStaleChunk && typeof window !== 'undefined') {
      const reloadFlag = 'urc.chunk-reload';
      const lastReload = Number(window.sessionStorage.getItem(reloadFlag) || 0);
      if (Date.now() - lastReload > 30_000) {
        window.sessionStorage.setItem(reloadFlag, String(Date.now()));
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <main className={styles.shell} role="alert">
      <h1>Something went wrong</h1>
      <p>The workspace could not finish loading. Try the request again, or use Support if the problem persists.</p>
      {error.digest ? <p className={styles.context}>Request reference: {error.digest}</p> : null}
      <div className={styles.actions}>
        <button type="button" onClick={reset} className={styles.primaryAction}>Try again</button>
        <Link href="/dashboard" className={styles.secondaryAction}>Dashboard</Link>
        <Link href="/support" className={styles.secondaryAction}>Support</Link>
      </div>
    </main>
  );
}
