import { proxySecRequest } from './_lib/secProxy.js';

export default async function handler(req, res) {
  try {
    await proxySecRequest(req, res, 'https://efts.sec.gov');
  } catch (error) {
    console.error('SEC efts proxy error:', error);
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'SEC efts proxy request failed' }));
  }
}
