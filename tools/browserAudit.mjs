import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT_URL = process.env.AUDIT_ROOT_URL || 'https://vara-ai-app.vercel.app';
const OUTPUT_DIR = path.resolve(process.cwd(), 'audit-output');
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'screenshots');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROUTES = [
  '/',
  '/dashboard',
  '/search',
  '/compare',
  '/accounting',
  '/accounting-analytics',
  '/boards',
  '/comment-letters',
  '/enforcement',
  '/esg',
  '/exhibits',
  '/exempt-offerings',
  '/adv-registrations',
  '/earnings',
  '/ipo',
  '/insiders',
  '/mna',
  '/no-action-letters',
  '/regulation',
  '/api-portal',
  '/support',
];

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function filenameForRoute(route, mode = 'desktop') {
  const normalized = route === '/' ? 'home' : route.replace(/[\\/]+/g, '_').replace(/^_/, '');
  return `${normalized}-${mode}.png`;
}

class CDPConnection {
  constructor(browserWsUrl) {
    this.nextId = 0;
    this.pending = new Map();
    this.browserWs = new WebSocket(browserWsUrl);
    this.browserWs.addEventListener('message', event => {
      const payload = JSON.parse(String(event.data));
      if (payload.id) {
        const deferred = this.pending.get(payload.id);
        if (!deferred) return;
        this.pending.delete(payload.id);
        if (payload.error) {
          deferred.reject(new Error(payload.error.message || 'CDP request failed'));
        } else {
          deferred.resolve(payload.result);
        }
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
    const message = { id, method, params };
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.browserWs.send(JSON.stringify(message));
    return promise;
  }

  async createSession() {
    const { targetId } = await this.command('Target.createTarget', {
      url: 'about:blank',
    });
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
    const message = { id, sessionId: this.sessionId, method, params };
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.connection.browserWs.send(JSON.stringify(message));
    return promise;
  }

  on(method, callback) {
    const list = this.listeners.get(method) || [];
    list.push(callback);
    this.listeners.set(method, list);
  }

  once(method) {
    return new Promise(resolve => {
      const callback = params => {
        const list = this.listeners.get(method) || [];
        this.listeners.set(method, list.filter(item => item !== callback));
        resolve(params);
      };
      this.on(method, callback);
    });
  }

  async close() {
    this.connection.browserWs.removeEventListener('message', this.handleMessage);
    try {
      await this.connection.command('Target.closeTarget', { targetId: this.targetId });
    } catch {
      // Swallow close errors so the rest of the audit can finish.
    }
  }
}

async function launchChrome() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vara-audit-'));
  const proc = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-pre-commit-input',
      '--remote-debugging-port=9222',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9222/json/version');
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

async function setupSession(session, viewport) {
  await session.command('Page.enable');
  await session.command('Runtime.enable');
  await session.command('Network.enable');
  await session.command('Log.enable');
  await session.command('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
  await session.command('Emulation.setVisibleSize', {
    width: viewport.width,
    height: viewport.height,
  });
  await session.command('Emulation.setUserAgentOverride', {
    userAgent: viewport.mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/146.0.0.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
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

async function capturePage(route, viewport) {
  const session = await connection.createSession();
  const consoleEntries = [];
  const exceptions = [];
  const requestFailures = [];
  const httpErrors = [];

  session.on('Runtime.consoleAPICalled', params => {
    const text = (params.args || [])
      .map(arg => arg.value ?? arg.description ?? '')
      .join(' ')
      .trim();
    consoleEntries.push({
      type: params.type,
      text,
    });
  });

  session.on('Runtime.exceptionThrown', params => {
    exceptions.push(params.exceptionDetails?.text || 'Unknown exception');
  });

  session.on('Network.loadingFailed', params => {
    if (!params.canceled) {
      requestFailures.push({
        url: params.requestId,
        errorText: params.errorText,
      });
    }
  });

  session.on('Log.entryAdded', params => {
    const entry = params.entry || {};
    if (entry.level === 'error' || entry.source === 'network') {
      consoleEntries.push({
        type: `${entry.source}:${entry.level}`,
        text: entry.text || '',
      });
    }
  });

  session.on('Network.responseReceived', params => {
    if (params.response?.status >= 400) {
      httpErrors.push({
        url: params.response.url,
        status: params.response.status,
      });
    }
  });

  await setupSession(session, viewport);

  const url = new URL(route, ROOT_URL).toString();
  const loadFired = session.once('Page.loadEventFired');
  await session.command('Page.navigate', { url });
  await Promise.race([loadFired, delay(12000)]);
  await delay(3500);

  const summary = await evaluate(
    session,
    `(() => {
      const text = selector => Array.from(document.querySelectorAll(selector)).map(node => node.textContent?.trim()).filter(Boolean);
      const visibleText = text('h1, h2, h3');
      const buttons = text('button').slice(0, 20);
      const links = Array.from(document.querySelectorAll('a')).map(node => ({
        text: node.textContent?.trim() || '',
        href: node.getAttribute('href') || ''
      })).filter(item => item.text || item.href).slice(0, 25);
      const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(node => ({
        tag: node.tagName.toLowerCase(),
        type: node.getAttribute('type') || '',
        placeholder: node.getAttribute('placeholder') || '',
        aria: node.getAttribute('aria-label') || ''
      }));
      const el = document.documentElement;
      const body = document.body;
      return {
        title: document.title,
        path: location.pathname + location.search,
        headings: visibleText,
        buttons,
        links,
        inputs,
        bodyTextPreview: (body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
        hasSidebar: !!document.querySelector('.sidebar'),
        hasMobileMenuButton: !!document.querySelector('.mobile-menu-btn'),
        hasCopilotEntry: !!document.querySelector('.copilot-entry-btn'),
        hasCopilotPanel: !!document.querySelector('.ai-panel'),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    })()`
  );

  const screenshot = await session.command('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, filenameForRoute(route, viewport.mobile ? 'mobile' : 'desktop')),
    Buffer.from(screenshot.data, 'base64')
  );

  await session.close();

  return {
    route,
    viewport: viewport.mobile ? 'mobile' : 'desktop',
    url,
    summary,
    consoleEntries,
    exceptions,
    requestFailures,
    httpErrors,
  };
}

async function runScenarioTests() {
  const findings = [];
  let discoveredFilingRoute = '';
  const desktop = await connection.createSession();
  await setupSession(desktop, { width: 1440, height: 900, mobile: false });

  async function goto(url) {
    const loadFired = desktop.once('Page.loadEventFired');
    await desktop.command('Page.navigate', { url });
    await Promise.race([loadFired, delay(12000)]);
    await delay(3000);
  }

  async function clickSelector(selector) {
    return evaluate(
      desktop,
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, reason: 'not-found' };
        el.click();
        return { ok: true };
      })()`
    );
  }

  async function textContent(selector) {
    return evaluate(
      desktop,
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? (el.textContent || '').trim() : '';
      })()`
    );
  }

  async function exists(selector) {
    return evaluate(sessionForExists(), `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  }

  function sessionForExists() {
    return desktop;
  }

  async function fillInput(selector, value) {
    return evaluate(
      desktop,
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, reason: 'not-found' };
        el.focus();
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      })()`
    );
  }

  await goto(new URL('/search', ROOT_URL).toString());
  findings.push({
    scenario: 'Copilot panel opens from search page',
    result: await clickSelector('.copilot-entry-btn'),
    panelVisible: await evaluate(desktop, `Boolean(document.querySelector('.ai-panel'))`),
  });
  await clickSelector('.icon-btn-small[title="Close copilot"]');

  findings.push({
    scenario: 'Boolean mode toggle on search page',
    result: await clickSelector('button.toggle-btn:nth-of-type(2)'),
    helpVisible: await evaluate(desktop, `document.body.innerText.includes('Boolean / Proximity Guide')`),
  });

  await fillInput('.search-bar-container input', 'Apple revenue recognition');
  findings.push({
    scenario: 'Search input can be edited',
    value: await evaluate(desktop, `document.querySelector('.search-bar-container input')?.value || ''`),
  });

  await clickSelector('.sample-pill');
  await delay(4000);
  discoveredFilingRoute = await evaluate(
    desktop,
    `(() => {
      const viewButton = Array.from(document.querySelectorAll('button')).find(button => (button.textContent || '').trim() === 'View');
      if (!viewButton) return '';
      const row = viewButton.closest('tr');
      if (!row) return '';
      viewButton.click();
      return location.pathname + location.search;
    })()`
  );
  if (!discoveredFilingRoute || discoveredFilingRoute === '/search') {
    discoveredFilingRoute = await evaluate(
      desktop,
      `(() => {
        const href = Array.from(document.querySelectorAll('a'))
          .map(link => link.getAttribute('href') || '')
          .find(value => value.startsWith('/filing/'));
        return href || '';
      })()`
    );
  }
  findings.push({
    scenario: 'Sample search triggers result state',
    hasResultsTable: await evaluate(desktop, `Boolean(document.querySelector('table')) || document.body.innerText.includes('Matched Filings')`),
    errorText: await evaluate(desktop, `Array.from(document.querySelectorAll('.glass-card')).map(el => el.textContent || '').find(text => text.includes('Research search failed') || text.includes('No filings matched')) || ''`),
  });

  if (discoveredFilingRoute && discoveredFilingRoute.startsWith('/filing/')) {
    await goto(new URL(discoveredFilingRoute, ROOT_URL).toString());
    findings.push({
      scenario: 'Filing detail route renders after search',
      path: await evaluate(desktop, 'location.pathname + location.search'),
      heading: await evaluate(
        desktop,
        `(() => document.querySelector('h1')?.textContent?.trim() || document.querySelector('h2')?.textContent?.trim() || '')()`
      ),
      hasSectionNav: await evaluate(
        desktop,
        `document.body.innerText.includes('Risk Factors') || document.body.innerText.includes('MD&A') || document.body.innerText.includes('Table of contents')`
      ),
    });
  } else {
    findings.push({
      scenario: 'Filing detail route renders after search',
      path: '',
      heading: '',
      hasSectionNav: false,
      note: 'No filing route was discoverable from the sample search result set.',
    });
  }

  await goto(new URL('/dashboard', ROOT_URL).toString());
  await fillInput('input[placeholder=\"Enter ticker...\"]', 'ZZZZ');
  await clickSelector('.watchlist-add-btn');
  findings.push({
    scenario: 'Dashboard invalid ticker validation',
    message: await evaluate(desktop, `Array.from(document.querySelectorAll('div')).map(el => (el.textContent || '').trim()).find(text => text.includes('not found in SEC EDGAR') || text.includes('Already in watchlist')) || ''`),
  });

  await clickSelector('.trending-item');
  await delay(2500);
  findings.push({
    scenario: 'Dashboard trending topic navigates to search',
    path: await evaluate(desktop, 'location.pathname + location.search'),
  });

  await goto(new URL('/dashboard', ROOT_URL).toString());
  findings.push({
    scenario: 'Mobile menu visible check done separately',
    note: 'Desktop scenario pass complete',
  });

  await desktop.close();

  const mobile = await connection.createSession();
  await setupSession(mobile, { width: 390, height: 844, mobile: true });
  const mobileUrl = new URL('/search', ROOT_URL).toString();
  const mobileLoaded = mobile.once('Page.loadEventFired');
  await mobile.command('Page.navigate', { url: mobileUrl });
  await Promise.race([mobileLoaded, delay(12000)]);
  await delay(3000);
  findings.push({
    scenario: 'Mobile menu button presence',
    menuPresent: await evaluate(mobile, `Boolean(document.querySelector('.mobile-menu-btn'))`),
    sidebarVisible: await evaluate(mobile, `Boolean(document.querySelector('.sidebar') && getComputedStyle(document.querySelector('.sidebar')).display !== 'none')`),
    menuOpensSidebar: await (async () => {
      await evaluate(mobile, `(() => { const btn = document.querySelector('.mobile-menu-btn'); if (btn) btn.click(); return true; })()`);
      await delay(500);
      return evaluate(mobile, `Boolean(document.querySelector('.sidebar') && getComputedStyle(document.querySelector('.sidebar')).display !== 'none')`);
    })(),
  });
  await mobile.close();

  return findings;
}

const launch = await launchChrome();
const connection = new CDPConnection(launch.wsUrl);

try {
  const routeReports = [];
  for (const route of ROUTES) {
    routeReports.push(await capturePage(route, { width: 1440, height: 900, mobile: false }));
  }

  for (const route of ['/', '/search', '/dashboard']) {
    routeReports.push(await capturePage(route, { width: 390, height: 844, mobile: true }));
  }

  const scenarioTests = await runScenarioTests();
  const report = {
    rootUrl: ROOT_URL,
    generatedAt: new Date().toISOString(),
    routes: routeReports,
    scenarios: scenarioTests,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'browser-audit.json'), JSON.stringify(report, null, 2));
  console.log(`Audit written to ${path.join(OUTPUT_DIR, 'browser-audit.json')}`);
} finally {
  await connection.close();
  launch.process.kill();
}
