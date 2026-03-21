import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT_URL = process.env.SEARCH_TEST_ROOT_URL || 'http://127.0.0.1:4173';
const OUTPUT_DIR = path.resolve(process.cwd(), 'audit-output', 'search-regression');
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'screenshots');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

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
      return;
    }

    const callbacks = this.listeners.get(payload.method) || [];
    for (const callback of callbacks) {
      callback(payload.params || {});
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

  once(method) {
    return new Promise(resolve => {
      const callback = params => {
        const list = this.listeners.get(method) || [];
        this.listeners.set(method, list.filter(item => item !== callback));
        resolve(params);
      };
      const list = this.listeners.get(method) || [];
      list.push(callback);
      this.listeners.set(method, list);
    });
  }

  on(method, callback) {
    const list = this.listeners.get(method) || [];
    list.push(callback);
    this.listeners.set(method, list);
  }

  off(method, callback) {
    const list = this.listeners.get(method) || [];
    this.listeners.set(method, list.filter(item => item !== callback));
  }

  async close() {
    this.connection.browserWs.removeEventListener('message', this.handleMessage);
    try {
      await this.connection.command('Target.closeTarget', { targetId: this.targetId });
    } catch {
      // Ignore shutdown errors.
    }
  }
}

async function launchChrome() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vara-search-test-'));
  const proc = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-pre-commit-input',
      '--remote-debugging-port=9223',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9223/json/version');
      const version = await response.json();
      return {
        process: proc,
        userDataDir,
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
    width: 1440,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await session.command('Emulation.setVisibleSize', {
    width: 1440,
    height: 960,
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
  const loaded = session.once('Page.loadEventFired');
  await session.command('Page.navigate', { url });
  await Promise.race([loaded, delay(15000)]);
  await delay(2500);
}

async function click(session, selector) {
  return evaluate(
    session,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`
  );
}

async function fillInput(session, selector, value) {
  return evaluate(
    session,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      el.focus();
      nativeSetter?.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`
  );
}

async function waitForSearchIdle(session) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await evaluate(
      session,
      `(() => {
        const submit = document.querySelector('.research-query-form button[type="submit"]');
        const hitCards = document.querySelectorAll('.research-hit-card').length;
        const empty = document.querySelector('.research-empty-state')?.textContent?.trim() || '';
        return {
          disabled: Boolean(submit?.disabled),
          hitCards,
          empty,
        };
      })()`
    );

    if (!state?.disabled && (state.hitCards > 0 || state.empty)) {
      await delay(800);
      return state;
    }

    await delay(500);
  }

  return { timedOut: true };
}

async function captureScreenshot(session, filename) {
  const shot = await session.command('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, filename), Buffer.from(shot.data, 'base64'));
}

async function collectSearchState(session) {
  return evaluate(
    session,
    `(() => {
      const activeMode = Array.from(document.querySelectorAll('button.toggle-btn'))
        .find(button => button.classList.contains('active'))?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      const activeTab = Array.from(document.querySelectorAll('.research-tab'))
        .find(button => button.classList.contains('active'))?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      const hitCards = Array.from(document.querySelectorAll('.research-hit-card')).slice(0, 5).map(card => ({
        title: card.querySelector('.company')?.textContent?.trim() || '',
        reason: card.querySelector('.match-reason')?.textContent?.trim() || '',
        snippet: card.querySelector('.snippet')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      }));
      const emptyState = document.querySelector('.research-empty-state')?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      const query = document.querySelector('.research-query-form input')?.value || '';
      const interpretation = Array.from(document.querySelectorAll('.research-chip-row .research-chip')).map(node => node.textContent?.trim()).filter(Boolean);
      const advancedButton = Array.from(document.querySelectorAll('button')).find(button => (button.textContent || '').includes('Advanced Filters'));
      const advancedSummary = advancedButton?.parentElement?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      return {
        path: location.pathname + location.search,
        query,
        activeMode,
        activeTab,
        resultCount: document.querySelectorAll('.research-hit-card').length,
        paneTitle: document.querySelector('.research-hit-list h2')?.textContent?.trim() || '',
        emptyState,
        interpretation,
        advancedSummary,
        hitCards,
      };
    })()`
  );
}

async function clearResearchState(session) {
  await evaluate(
    session,
    `(() => {
      sessionStorage.clear();
      localStorage.removeItem('vara.pendingSearchIntent');
      return true;
    })()`
  );
}

async function runQuery(session, label, query, options = {}) {
  const consoleMessages = [];
  const exceptions = [];
  const handleConsole = params => {
    consoleMessages.push({
      type: params.type || 'log',
      text: (params.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ').trim(),
    });
  };
  const handleException = params => {
    exceptions.push({
      text: params.exceptionDetails?.text || '',
      url: params.exceptionDetails?.url || '',
      lineNumber: params.exceptionDetails?.lineNumber ?? null,
      columnNumber: params.exceptionDetails?.columnNumber ?? null,
      description: params.exceptionDetails?.exception?.description || '',
    });
  };
  session.on('Runtime.consoleAPICalled', handleConsole);
  session.on('Runtime.exceptionThrown', handleException);

  try {
    if (options.resetState) {
      await clearResearchState(session);
      await goto(session, new URL('/search', ROOT_URL).toString());
    }

    if (options.mode === 'boolean') {
      const activeMode = await evaluate(
        session,
        `Array.from(document.querySelectorAll('button.toggle-btn')).find(button => button.classList.contains('active'))?.textContent || ''`
      );
      if (!String(activeMode).includes('Boolean')) {
        await click(session, 'button.toggle-btn:nth-of-type(2)');
        await delay(300);
      }
    }

    await fillInput(session, '.research-query-form input', query);
    await click(session, '.research-query-form button[type="submit"]');
    const idleState = await waitForSearchIdle(session);
    const summary = await collectSearchState(session);
    await captureScreenshot(session, `${label}.png`);
    return {
      label,
      query,
      idleState,
      summary,
      consoleMessages,
      exceptions,
    };
  } finally {
    session.off('Runtime.consoleAPICalled', handleConsole);
    session.off('Runtime.exceptionThrown', handleException);
  }
}

const launch = await launchChrome();
const connection = new CDPConnection(launch.wsUrl);

try {
  const session = await connection.createSession();
  await setupSession(session);
  await goto(session, new URL('/search', ROOT_URL).toString());

  const results = [];
  results.push(await runQuery(session, '01-clean-car-parking', 'car parking w/10 installation', { resetState: true }));
  results.push(await runQuery(session, '02-structured-semantic', 'Temporary equity in last 3 years in 10-Q / 10-K audited by Deloitte', { resetState: true }));
  results.push(await runQuery(session, '03-after-structured-car-parking', 'car parking w/10 installation'));
  results.push(await runQuery(session, '04-clean-asr', 'ASR w/5 derivative', { resetState: true }));
  results.push(await runQuery(session, '05-repeat-clean-car-parking', 'car parking w/10 installation', { resetState: true }));

  const report = {
    rootUrl: ROOT_URL,
    generatedAt: new Date().toISOString(),
    results,
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'search-regression.json'), JSON.stringify(report, null, 2));
  console.log(`Search regression written to ${path.join(OUTPUT_DIR, 'search-regression.json')}`);
  await session.close();
} finally {
  await connection.close();
  launch.process.kill();
}
