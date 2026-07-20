import type { Metadata } from 'next';
import Link from 'next/link';
import PrivacyControls from './PrivacyControls';
import styles from '../legal.module.css';

export const metadata: Metadata = {
  title: 'Privacy - Uniqus Research Center',
  description: 'Privacy and analytics choices for Uniqus Research Center.',
};

export default function PrivacyPage() {
  return (
    <article className={styles.legalPage}>
      <header className={styles.legalHeader}>
        <p className={styles.eyebrow}>Privacy</p>
        <h1>Privacy and data use</h1>
        <p className={styles.intro}>
          This page explains the categories of data the application can process and gives you
          control over optional product analytics.
        </p>
        <p className={styles.updated}>Last updated July 19, 2026</p>
      </header>

      <section className={styles.legalSection}>
        <h2>Data used to provide research features</h2>
        <ul>
          <li>Search terms, company identifiers, filing references, and other inputs you submit.</li>
          <li>Public-source documents retrieved from the SEC and other linked official sources.</li>
          <li>Saved application state, such as interface preferences, when a feature stores it in your browser.</li>
          <li>Account information handled by the configured authentication provider when sign-in is enabled.</li>
        </ul>
      </section>

      <section className={styles.legalSection}>
        <h2>AI-assisted features</h2>
        <p>
          When you use an AI-assisted action, the application sends the relevant prompt,
          conversation messages, and selected filing or comment-letter context to Anthropic&apos;s API
          to produce the requested response. Do not submit confidential or personal information
          unless your organization has approved that use. Anthropic&apos;s own processing and retention
          are governed by the API account and provider terms selected by the deployment operator;
          this application does not make a separate claim about Anthropic-side retention.
        </p>
      </section>

      <section className={styles.legalSection}>
        <h2>Application storage and retention</h2>
        <ul>
          <li>
            Generated chat outputs can be cached in Vercel KV under an identity-scoped, hashed key.
            Current time-to-live values are one hour for generated chat responses and 24 hours for
            filing comparisons.
          </li>
          <li>
            SEC comment-letter summaries are stored in Supabase so they can be reused for that public
            review thread. They currently have no automatic expiry and remain until replaced or deleted
            by the deployment operator.
          </li>
          <li>
            Rate controls store hashed account or network identifiers: request counters for roughly five
            minutes, concurrent-request leases for roughly one to three minutes (up to ten minutes for bounded
            multi-call comment-letter summaries), and daily AI budget counters for
            up to 26 hours.
          </li>
          <li>
            Watchlists, saved alerts, research sessions, filing annotations, and accounting checklists are
            stored in this browser under a user-and-organization namespace. Theme and sidebar preferences
            are device-wide. Clearing site data in your browser removes this browser-stored state.
          </li>
        </ul>
      </section>

      <PrivacyControls />

      <section className={styles.legalSection}>
        <h2>Analytics and deployment-specific disclosures</h2>
        <p>
          Optional PostHog analytics remains off until you consent. When enabled, the application
          sends a page-view event with the page path and title plus standard technical metadata added
          by the SDK. URL query strings and hashes are removed, and autocapture and session recording
          are disabled.
        </p>
        <p>
          Hosting and authentication infrastructure can still create operational or security logs.
          Before offering this application to end users, each deployment operator must document its
          actual Vercel, Clerk, Supabase, Anthropic, and optional PostHog account terms; log and backup
          retention; access controls; data-location choices; deletion process; and privacy contact.
        </p>
      </section>

      <Link href="/" className={styles.backLink}>Return to Uniqus Research Center</Link>
    </article>
  );
}
