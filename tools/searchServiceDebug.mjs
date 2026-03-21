import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT_URL = process.env.SEARCH_TEST_ROOT_URL || 'http://127.0.0.1:4173';
const OUTPUT_FILE = path.resolve(process.cwd(), 'audit-output', 'search-regression', 'search-service-debug.json');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_QUERY = process.env.SEARCH_DEBUG_QUERY || 'car parking w/10 installation';
const DEBUG_MODE = process.env.SEARCH_DEBUG_MODE || 'boolean';
const DEBUG_FORMS = process.env.SEARCH_DEBUG_FORMS || '10-K,10-Q,8-K,8-K/A,DEF 14A,20-F,6-K,S-1';
const DEBUG_DATE_FROM = process.env.SEARCH_DEBUG_DATE_FROM || '2020-01-01';
const DEBUG_DATE_TO = process.env.SEARCH_DEBUG_DATE_TO || '2026-03-20';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CDPConnection {
  constructor(browserWsUrl) {
    this.nextId = 0;
    this.pending = new Map();
    this.browserWs = new WebSocket(browserWsUrl);
    this.browserWs.addEventListener('message', event => {
      const payload = JSON.parse(String(event.data));
      if (!payload.id) return;
      const deferred = this.pending.get(payload.id);
      if (!deferred) return;
      this.pending.delete(payload.id);
      if (payload.error) {
        deferred.reject(new Error(payload.error.message || 'CDP request failed'));
      } else {
        deferred.resolve(payload.result);
      }
    });
  }

  async ready() {
    if (this.browserWs.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        this.browserWs.removeEventListener('open', handleOpen);
        this.browserWs.removeEventListener('error', handleError);
      };
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = error => {
        cleanup();
        reject(error);
      };
      this.browserWs.addEventListener('open', handleOpen);
      this.browserWs.addEventListener('error', handleError);
    });
  }

  async command(method, params = {}) {
    await this.ready();
    const id = ++this.nextId;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.browserWs.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async createSession() {
    const { targetId } = await this.command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.command('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    return new CDPSession(this, sessionId, targetId);
  }

  async close() {
    if (this.browserWs.readyState === WebSocket.OPEN) {
      this.browserWs.close();
    }
  }
}

class CDPSession {
  constructor(connection, sessionId, targetId) {
    this.connection = connection;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.handleMessage = this.handleMessage.bind(this);
    connection.browserWs.addEventListener('message', this.handleMessage);
  }

  handleMessage(event) {
    const payload = JSON.parse(String(event.data));
    if (payload.sessionId !== this.sessionId) return;

    if (payload.id) {
      const deferred = this.pending.get(payload.id);
      if (!deferred) return;
      this.pending.delete(payload.id);
      if (payload.error) {
        deferred.reject(new Error(payload.error.message || 'CDP session request failed'));
      } else {
        deferred.resolve(payload.result);
      }
    }
  }

  async command(method, params = {}) {
    await this.connection.ready();
    const id = ++this.nextId;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.connection.browserWs.send(JSON.stringify({ id, sessionId: this.sessionId, method, params }));
    return promise;
  }

  async close() {
    this.connection.browserWs.removeEventListener('message', this.handleMessage);
    try {
      await this.connection.command('Target.closeTarget', { targetId: this.targetId });
    } catch {
      // Ignore close errors.
    }
  }
}

async function launchChrome() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vara-search-debug-'));
  const proc = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--remote-debugging-port=9224',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9224/json/version');
      const version = await response.json();
      return {
        process: proc,
        wsUrl: version.webSocketDebuggerUrl,
      };
    } catch {
      await delay(300);
    }
  }

  proc.kill();
  throw new Error('Chrome DevTools endpoint did not become ready.');
}

async function setupSession(session) {
  await session.command('Page.enable');
  await session.command('Runtime.enable');
  await session.command('Network.enable');
  await session.command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function evaluate(session, expression) {
  const result = await session.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result?.value;
}

async function goto(session, url) {
  await session.command('Page.navigate', { url });
  await delay(2500);
}

const launch = await launchChrome();
const connection = new CDPConnection(launch.wsUrl);

try {
  const session = await connection.createSession();
  await setupSession(session);
  await goto(session, new URL('/search', ROOT_URL).toString());

  const report = await evaluate(
    session,
    `(
      async () => {
        const query = ${JSON.stringify(DEBUG_QUERY)};
        const mode = ${JSON.stringify(DEBUG_MODE)};
        const formScope = ${JSON.stringify(DEBUG_FORMS)};
        const dateFrom = ${JSON.stringify(DEBUG_DATE_FROM)};
        const dateTo = ${JSON.stringify(DEBUG_DATE_TO)};
        const baseFilters = {
          keyword: '',
          dateFrom,
          dateTo,
          entityName: '',
          formTypes: [],
          sectionKeywords: '',
          sicCode: '',
          stateOfInc: '',
          headquarters: '',
          exchange: [],
          acceleratedStatus: [],
          accountant: '',
          accessionNumber: '',
          fileNumber: '',
          fiscalYearEnd: '',
        };

        const filingResearch = await import('/src/services/filingResearch.ts');
        const secApi = await import('/src/services/secApi.ts');
        const booleanTools = await import('/src/utils/booleanSearch.ts');
        const edgarSearch = await import('/src/hooks/useEdgarSearch.ts');

        const candidateQueries = mode === 'boolean'
          ? booleanTools.buildBooleanCandidateQueries(query).slice(0, 5)
          : [query];
        const hitMap = new Map();
        const candidateInfo = [];
        for (const candidateQuery of candidateQueries) {
          const hits = await secApi.searchEdgarFilings(candidateQuery, formScope, dateFrom, dateTo);
          hits.forEach(hit => {
            if (!hitMap.has(hit._id)) {
              hitMap.set(hit._id, hit);
            }
          });
          candidateInfo.push({
            candidateQuery,
            count: hits.length,
            first: hits[0]?._source?.display_names?.[0] || '',
            firstId: hits[0]?._id || '',
          });
        }

        const mappedResults = Array.from(hitMap.values()).slice(0, 20).map(hit => {
          const parsed = edgarSearch.parseSearchHit(hit);
          return {
            id: hit._id,
            entityName: parsed.entityName,
            formType: parsed.formType,
            cik: parsed.cik,
            accessionNumber: parsed.accessionNumber,
            primaryDocument: parsed.primaryDocument,
          };
        });

        const gibraltarResult = Array.from(hitMap.values())
          .map(hit => ({
            hit,
            parsed: edgarSearch.parseSearchHit(hit),
          }))
          .find(entry => entry.hit._id === '0000912562-21-000044:investordaypresentations.htm');

        const firstMapped = mappedResults[0];
        const firstMappedText = firstMapped
          ? await secApi.fetchFilingText(firstMapped.cik, firstMapped.accessionNumber, firstMapped.primaryDocument)
          : '';
        const firstMappedMatch = mode === 'boolean'
          ? booleanTools.booleanQueryMatches(query, firstMappedText)
          : firstMappedText.toLowerCase().includes(query.toLowerCase().replace(/"/g, ''));
        const firstMappedSnippet = mode === 'boolean'
          ? booleanTools.extractBooleanMatchSnippet(query, firstMappedText)
          : null;

        const firstTenSignalChecks = [];
        for (const mapped of mappedResults.slice(0, 10)) {
          const text = await secApi.fetchFilingText(mapped.cik, mapped.accessionNumber, mapped.primaryDocument);
          firstTenSignalChecks.push({
            id: mapped.id,
            entityName: mapped.entityName,
            formType: mapped.formType,
            textLength: text.length,
            match: mode === 'boolean'
              ? booleanTools.booleanQueryMatches(query, text)
              : text.toLowerCase().includes(query.toLowerCase().replace(/"/g, '')),
            snippet: mode === 'boolean'
              ? booleanTools.extractBooleanMatchSnippet(query, text)?.excerpt || ''
              : '',
          });
        }

        const serviceResults = await filingResearch.executeFilingResearchSearch({
          query,
          filters: baseFilters,
          mode,
          defaultForms: formScope,
          limit: 50,
          hydrateTextSignals: true,
        });

        return JSON.stringify({
          query,
          candidateQueries: candidateInfo,
          uniqueCandidateCount: hitMap.size,
          mappedResults,
          gibraltarMapped: gibraltarResult
            ? {
                id: gibraltarResult.hit._id,
                ...gibraltarResult.parsed,
              }
            : null,
          firstMappedResult: {
            id: firstMapped?.id || '',
            entityName: firstMapped?.entityName || '',
            formType: firstMapped?.formType || '',
            textLength: firstMappedText.length,
            match: firstMappedMatch,
            snippet: firstMappedSnippet,
          },
          firstTenSignalChecks,
          serviceResults: {
            count: serviceResults.length,
            top: serviceResults.slice(0, 5).map(item => ({
              company: item.entityName,
              form: item.formType,
              reason: item.matchReason,
              snippet: item.matchSnippet,
            })),
          },
        });
      }
    )()`
  );

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(JSON.parse(report), null, 2));
  console.log(`Search service debug written to ${OUTPUT_FILE}`);
  await session.close();
} finally {
  await connection.close();
  launch.process.kill();
}
