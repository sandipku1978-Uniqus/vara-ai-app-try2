import styles from './RouteState.module.css';

export default function RouteLoading({ label = 'Loading workspace' }: { label?: string }) {
  return (
    <div className={styles.shell} role="status" aria-live="polite" aria-busy="true">
      <span className={styles.spinner} aria-hidden="true" />
      <p>{label}…</p>
    </div>
  );
}
