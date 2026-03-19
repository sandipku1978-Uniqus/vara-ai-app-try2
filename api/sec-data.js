import { proxySecRequest } from './_lib/secProxy.js';

export default async function handler(req, res) {
  try {
    await proxySecRequest(req, res, 'https://data.sec.gov');
  } catch (error) {
    console.error('SEC data proxy error:', error);
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'SEC data proxy request failed' }));
  }
}
