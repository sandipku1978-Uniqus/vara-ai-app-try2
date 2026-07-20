const INTERNAL_NAVIGATION_ORIGIN = 'https://internal.uniqus.invalid';

/**
 * Allow a filing's Back control to restore only the first-party search route.
 * Query strings and fragments are preserved so result/session state can be restored.
 */
export function sanitizeSearchReturnTo(value: string | null | undefined): string {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return '';

  const suffix = value.slice('/search'.length);
  if (!value.startsWith('/search') || (suffix && suffix[0] !== '?' && suffix[0] !== '#')) {
    return '';
  }

  try {
    const parsed = new URL(value, INTERNAL_NAVIGATION_ORIGIN);
    if (parsed.origin !== INTERNAL_NAVIGATION_ORIGIN || parsed.pathname !== '/search') return '';
  } catch {
    return '';
  }

  return value;
}
