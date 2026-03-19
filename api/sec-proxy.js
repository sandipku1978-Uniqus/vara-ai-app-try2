import { proxySecRequest } from './_lib/secProxy.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  return proxySecRequest(request, 'https://www.sec.gov');
}
