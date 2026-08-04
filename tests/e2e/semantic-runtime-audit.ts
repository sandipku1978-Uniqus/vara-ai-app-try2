export interface RequestIdentity {
  method: string;
  url: string;
}

export interface FailedRequest extends RequestIdentity {
  errorText: string;
}

function requestIdentity({ method, url }: RequestIdentity): string {
  return `${method.toUpperCase()} ${url}`;
}

/**
 * Chromium may cancel an iframe's first document request while hydration
 * immediately replaces it with the same request. That cancellation is not a
 * failed user-visible load when an exact method-and-URL twin succeeds.
 *
 * Keep the exception deliberately narrow: a unique abort, a differently
 * scoped request, or any non-abort network failure remains reportable.
 */
export function reconcileFailedRequests(
  failures: readonly FailedRequest[],
  successfulRequests: readonly RequestIdentity[],
): FailedRequest[] {
  const successfulIdentities = new Set(successfulRequests.map(requestIdentity));
  return failures.filter(failure => (
    failure.errorText !== 'net::ERR_ABORTED'
    || !successfulIdentities.has(requestIdentity(failure))
  ));
}
