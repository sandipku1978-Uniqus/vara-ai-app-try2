export const ANALYTICS_CONSENT_STORAGE_KEY = 'urc.analytics-consent.v1';
export const ANALYTICS_CONSENT_EVENT = 'urc:analytics-consent-change';

export type AnalyticsConsent = 'granted' | 'denied' | 'unset';

export function readAnalyticsConsent(): AnalyticsConsent {
  if (typeof window === 'undefined') return 'unset';
  const value = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
  return value === 'granted' || value === 'denied' ? value : 'unset';
}
