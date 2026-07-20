import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../legal.module.css';

export const metadata: Metadata = {
  title: 'Terms - Uniqus Research Center',
  description: 'Terms of use for Uniqus Research Center.',
};

export default function TermsPage() {
  return (
    <article className={styles.legalPage}>
      <header className={styles.legalHeader}>
        <p className={styles.eyebrow}>Terms</p>
        <h1>Terms of use</h1>
        <p className={styles.intro}>
          These baseline terms describe appropriate use of this research application. A deployment
          operator should replace or supplement them with organization-specific legal terms before production use.
        </p>
        <p className={styles.updated}>Last updated July 19, 2026</p>
      </header>

      <section className={styles.legalSection}>
        <h2>Research tool, not professional advice</h2>
        <p>
          The application helps locate and analyze public information. Its output is not legal,
          accounting, investment, tax, or other professional advice and should not replace review
          of the underlying source documents or advice from qualified professionals.
        </p>
      </section>

      <section className={styles.legalSection}>
        <h2>Source verification</h2>
        <p>
          Filing metadata, extracted text, generated summaries, comparisons, and citations may be
          incomplete or incorrect. Verify material conclusions against the official filing or other
          primary source before relying on them.
        </p>
      </section>

      <section className={styles.legalSection}>
        <h2>Acceptable use</h2>
        <ul>
          <li>Use the service only for lawful, authorized research.</li>
          <li>Do not attempt to bypass access controls, usage limits, or source-system restrictions.</li>
          <li>Do not submit data you are not authorized to process through configured third-party services.</li>
          <li>Respect applicable SEC, provider, and data-source terms and rate limits.</li>
        </ul>
      </section>

      <section className={styles.legalSection}>
        <h2>Availability</h2>
        <p>
          Features can depend on external services and public data sources. Availability, coverage,
          and output quality are not guaranteed. Preserve independent copies of work that must be retained.
        </p>
      </section>

      <Link href="/" className={styles.backLink}>Return to Uniqus Research Center</Link>
    </article>
  );
}
