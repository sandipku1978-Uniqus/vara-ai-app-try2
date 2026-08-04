import { kv } from '@vercel/kv';
import { isProductionDeployment } from './clerk-config';

/** SEC asks automated clients to remain below ten requests per second. */
export const SEC_REQUEST_START_INTERVAL_MS = 125;
const SEC_REQUEST_START_KEY = 'sec-fair-access:request-start:v1';

export class SecRequestPacerUnavailableError extends Error {}

let localNextStartAt = 0;
let localQueue = Promise.resolve();
let warnedDistributedFallback = false;

function hasDistributedPacer(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('SEC request pacing cancelled.', 'AbortError');
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError(signal);
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function paceLocally(signal: AbortSignal): Promise<void> {
  let releaseTurn: () => void = () => undefined;
  const previous = localQueue;
  localQueue = new Promise<void>(resolve => { releaseTurn = resolve; });
  await previous;
  try {
    await wait(Math.max(0, localNextStartAt - Date.now()), signal);
    localNextStartAt = Date.now() + SEC_REQUEST_START_INTERVAL_MS;
  } finally {
    releaseTurn();
  }
}

async function paceDistributed(signal: AbortSignal): Promise<void> {
  while (true) {
    if (signal.aborted) throw abortError(signal);
    const acquired = await kv.set(
      SEC_REQUEST_START_KEY,
      `${Date.now()}:${Math.random()}`,
      { nx: true, px: SEC_REQUEST_START_INTERVAL_MS },
    );
    if (acquired === 'OK') return;
    // A fixed interval is deliberately conservative. It avoids a separate TTL
    // read and can only reduce throughput; it cannot admit starts too quickly.
    await wait(SEC_REQUEST_START_INTERVAL_MS, signal);
  }
}

/** Reserve one globally paced SEC request start immediately before fetch(). */
export async function paceSecRequestStart(signal: AbortSignal): Promise<void> {
  // High-volume route tests inject an explicit bypass; deterministic pacer
  // tests opt back in. This branch is unreachable outside NODE_ENV=test.
  if (
    process.env.NODE_ENV === 'test'
    && process.env.URC_TEST_SEC_REQUEST_PACING !== '1'
  ) return;

  if (!hasDistributedPacer()) {
    if (isProductionDeployment()) {
      throw new SecRequestPacerUnavailableError(
        'Distributed SEC request pacing is not configured.',
      );
    }
    return paceLocally(signal);
  }

  try {
    await paceDistributed(signal);
  } catch {
    if (signal.aborted) throw abortError(signal);
    if (isProductionDeployment()) {
      throw new SecRequestPacerUnavailableError(
        'Distributed SEC request pacing is unavailable.',
      );
    }
    if (!warnedDistributedFallback) {
      warnedDistributedFallback = true;
      console.warn('[sec-fair-access] distributed request pacer unavailable; using the local development pacer.');
    }
    await paceLocally(signal);
  }
}
