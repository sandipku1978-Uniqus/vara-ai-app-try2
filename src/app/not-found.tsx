import Link from 'next/link';
import styles from '../components/layout/RouteState.module.css';

export default function NotFound() {
  return (
    <main className={styles.shell}>
      <p className={styles.context}>404</p>
      <h1>Page not found</h1>
      <p>The address may be incomplete or the requested research page may have moved.</p>
      <div className={styles.actions}>
        <Link href="/dashboard" className={styles.primaryAction}>Dashboard</Link>
        <Link href="/search" className={styles.secondaryAction}>Search filings</Link>
        <Link href="/support" className={styles.secondaryAction}>Support</Link>
      </div>
    </main>
  );
}
