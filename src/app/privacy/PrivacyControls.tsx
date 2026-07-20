'use client';

import { useEffect, useState } from 'react';
import {
  ANALYTICS_CONSENT_EVENT,
  ANALYTICS_CONSENT_STORAGE_KEY,
  type AnalyticsConsent,
  readAnalyticsConsent,
} from '../../config/analytics';
import styles from '../legal.module.css';

const analyticsConfigured = process.env.NEXT_PUBLIC_POSTHOG_ENABLED === 'true'
  && Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim());

export default function PrivacyControls() {
  const [consent, setConsent] = useState<AnalyticsConsent>('unset');

  useEffect(() => {
    setConsent(readAnalyticsConsent());
  }, []);

  const updateConsent = (nextConsent: Exclude<AnalyticsConsent, 'unset'>) => {
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, nextConsent);
    setConsent(nextConsent);
    window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
  };

  const status = !analyticsConfigured
    ? 'Analytics is disabled for this deployment.'
    : consent === 'granted'
      ? 'You have allowed optional product analytics on this browser.'
      : consent === 'denied'
        ? 'Optional product analytics is disabled on this browser.'
        : 'No analytics preference has been saved. Optional analytics remains off.';

  return (
    <section className={styles.consentPanel} aria-labelledby="analytics-preference-title">
      <h2 id="analytics-preference-title">Analytics preference</h2>
      <p>
        Optional PostHog analytics starts only when this deployment has analytics configured and
        you choose to allow it. You can change this browser&apos;s preference at any time.
      </p>
      <div className={styles.consentStatus} role="status" aria-live="polite">{status}</div>
      <div className={styles.consentActions}>
        <button type="button" className={styles.primaryButton} onClick={() => updateConsent('granted')}>
          Allow analytics
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => updateConsent('denied')}>
          Decline analytics
        </button>
      </div>
    </section>
  );
}
