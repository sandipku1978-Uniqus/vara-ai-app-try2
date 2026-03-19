import { proxySecRequest } from './_lib/secProxy.js';

export default {
  fetch(request) {
    return proxySecRequest(request, 'https://data.sec.gov');
  },
};
