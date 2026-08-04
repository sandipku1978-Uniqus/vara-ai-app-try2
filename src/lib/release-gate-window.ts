/** Nonsecret, per-build lifetime for the temporary staged-release bridge. */
export const MAX_RELEASE_GATE_WINDOW_SECONDS = 6 * 60 * 60;
export const INITIAL_RELEASE_GATE_MIN_REMAINING_SECONDS = 2 * 60 * 60;
export const FINAL_RELEASE_GATE_MIN_REMAINING_SECONDS = 5 * 60;

/** Accept epoch seconds, epoch milliseconds, or an unambiguous ISO timestamp. */
export function parseReleaseGateNotAfter(value: string | null | undefined): number | null {
  const raw = value?.trim();
  if (!raw) return null;

  let epochSeconds: number;
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    epochSeconds = raw.length >= 13 ? Math.floor(numeric / 1_000) : numeric;
  } else {
    const parsed = Date.parse(raw);
    epochSeconds = Math.floor(parsed / 1_000);
  }

  return Number.isSafeInteger(epochSeconds) && epochSeconds > 0
    ? epochSeconds
    : null;
}

export function configuredReleaseGateNotAfter(): number | null {
  return parseReleaseGateNotAfter(process.env.URC_RELEASE_GATE_NOT_AFTER);
}

export function configuredReleaseGateNotAfterIso(): string | null {
  const epochSeconds = configuredReleaseGateNotAfter();
  return epochSeconds ? new Date(epochSeconds * 1_000).toISOString() : null;
}

/** Runtime acceptance window. A far-future value is as invalid as no value. */
export function isReleaseGateWindowActive(nowEpochSeconds = Math.floor(Date.now() / 1_000)): boolean {
  const notAfter = configuredReleaseGateNotAfter();
  return Boolean(
    notAfter
    && notAfter >= nowEpochSeconds
    && notAfter <= nowEpochSeconds + MAX_RELEASE_GATE_WINDOW_SECONDS
  );
}
