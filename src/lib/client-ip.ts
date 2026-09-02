import { isProductionDeployment } from './clerk-config';

/**
 * The client address a limiter may trust. Vercel overwrites these headers at
 * the trusted edge; a raw caller-supplied x-forwarded-for is only honoured
 * outside production. Lives apart from rate-limit.ts so the public routes'
 * per-instance limiter can use it without importing the KV-backed module.
 */
export function clientIpFrom(request: Request): string {
  const trusted = request.headers.get('x-real-ip')
    || request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  if (trusted) return trusted;

  if (!isProductionDeployment()) {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  }
  return 'unknown';
}
