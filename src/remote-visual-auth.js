const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', 'data', 'remote-auth');
const DEFAULT_DISPLAY = process.env.REMOTE_AUTH_DISPLAY || ':99';
const DEFAULT_VNC_PORT = Number(process.env.REMOTE_AUTH_VNC_PORT || 5901);
const DEFAULT_NOVNC_PORT = Number(process.env.REMOTE_AUTH_NOVNC_PORT || 6080);
const DEFAULT_TTL_MS = Number(process.env.REMOTE_AUTH_TTL_MS || 15 * 60 * 1000);
const MIN_FREE_MEMORY_MB = Number(process.env.REMOTE_AUTH_MIN_FREE_MEMORY_MB || 700);
const NOVNC_WEB_ROOT = process.env.REMOTE_AUTH_NOVNC_WEB || '/usr/share/novnc';
const VNC_PASSWORD_LENGTH = 8;
const PROVIDER_DOMAINS = {
  IHG: ['ihg.com'],
  Marriott: ['marriott.com'],
};

const activeTasks = new Map();

function nowIso() {
  return new Date().toISOString();
}

function makeTaskId(provider) {
  return `${String(provider).toLowerCase()}_remote_${Date.now()}_${crypto
    .randomBytes(4)
    .toString('hex')}`;
}

function createVncPassword() {
  return crypto.randomBytes(16).toString('base64url').slice(0, VNC_PASSWORD_LENGTH);
}

function noVncUrl() {
  return '/novnc/vnc.html?autoconnect=0&resize=scale&path=novnc/websockify';
}

function availableMemoryMb() {
  try {
    if (process.platform === 'linux' && fs.existsSync('/proc/meminfo')) {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/im);
      if (match) return Math.floor(Number(match[1]) / 1024);
    }
  } catch (_error) {
    // Fall back to os.freemem below.
  }
  return Math.floor(os.freemem() / 1024 / 1024);
}

function assertEnoughMemoryForRemoteAuth() {
  const freeMb = availableMemoryMb();
  if (freeMb < MIN_FREE_MEMORY_MB) {
    throw Object.assign(
      new Error(
        `Remote visual authorization requires at least ${MIN_FREE_MEMORY_MB}MB available memory; current available memory is ${freeMb}MB.`,
      ),
      {
        code: 'REMOTE_AUTH_INSUFFICIENT_MEMORY',
        freeMemoryMb: freeMb,
        minFreeMemoryMb: MIN_FREE_MEMORY_MB,
      },
    );
  }
}

function publicTask(task) {
  return {
    id: task.id,
    provider: task.provider,
    status: task.status,
    days: task.days,
    loginUrl: task.loginUrl,
    noVncUrl: task.noVncUrl,
    vncPassword: task.vncPassword,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    expiresAt: task.expiresAt,
    sessionSaved: Boolean(task.sessionSaved),
    browserStarted: Boolean(task.browserStarted),
    vncReady: Boolean(task.vncReady),
    novncReady: Boolean(task.novncReady),
    message: task.message,
  };
}

function createTestTask(provider, options) {
  const task = {
    id: makeTaskId(provider),
    provider,
    status: 'remote_authorization_running',
    days: options.days,
    loginUrl: options.loginUrl,
    noVncUrl: noVncUrl(),
    vncPassword: 'testpass',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    sessionSaved: false,
    browserStarted: true,
    vncReady: true,
    novncReady: true,
    message:
      'Remote visual authorization is running in test mode. No real browser was started.',
    testMode: true,
  };
  activeTasks.set(provider, task);
  return task;
}

function spawnManaged(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'ignore',
    windowsHide: true,
    ...options,
  });
  child.processName = command;
  child.on('error', (error) => {
    child.spawnError = error;
  });
  child.on('exit', (code, signal) => {
    child.exitCodeValue = code;
    child.exitSignalValue = signal;
  });
  child.unref();
  return child;
}

function childFailure(child) {
  if (!child) return null;
  if (child.spawnError) return child.spawnError;
  if (child.exitCodeValue !== undefined || child.exitSignalValue !== undefined) {
    return new Error(
      `${child.processName || 'remote auth process'} exited early with code ${child.exitCodeValue ?? 'null'} and signal ${child.exitSignalValue ?? 'null'}`,
    );
  }
  return null;
}

function tcpConnects(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(250);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForTcpPort({ port, code, label, children = [], timeoutMs = 10000 }) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = null;

  while (Date.now() < deadline) {
    for (const child of children) {
      const failure = childFailure(child);
      if (failure) {
        throw Object.assign(
          new Error(`${label} failed before it became reachable: ${failure.message}`),
          { code },
        );
      }
    }

    if (await tcpConnects(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  for (const child of children) {
    lastFailure = childFailure(child) || lastFailure;
  }
  throw Object.assign(
    new Error(
      lastFailure
        ? `${label} did not become reachable on port ${port}: ${lastFailure.message}`
        : `${label} did not become reachable on port ${port}.`,
    ),
    { code },
  );
}

function killChild(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch (_error) {
    // Best effort cleanup only.
  }
}

async function stopRemoteAuth(provider) {
  const task = activeTasks.get(provider);
  if (!task) {
    return {
      provider,
      status: 'not_started',
      sessionSaved: false,
      message: 'No remote authorization task is running.',
    };
  }

  if (task.ttlTimer) {
    clearTimeout(task.ttlTimer);
    task.ttlTimer = null;
  }
  if (task.browser) {
    await task.browser.close().catch(() => {});
  }
  for (const child of task.children || []) {
    killChild(child);
  }
  task.status = task.sessionSaved ? 'session_authorized' : 'remote_authorization_stopped';
  task.updatedAt = nowIso();
  activeTasks.delete(provider);
  return publicTask(task);
}

function cleanupAll() {
  for (const provider of Array.from(activeTasks.keys())) {
    stopRemoteAuth(provider).catch(() => {});
  }
}

process.once('exit', cleanupAll);
process.once('SIGINT', () => {
  cleanupAll();
  process.exit(130);
});
process.once('SIGTERM', () => {
  cleanupAll();
  process.exit(143);
});

async function startRemoteAuth(provider, options) {
  const existing = activeTasks.get(provider);
  if (existing && existing.status === 'remote_authorization_running') {
    return publicTask(existing);
  }

  if (process.env.REMOTE_AUTH_TEST_MODE === '1') {
    return publicTask(createTestTask(provider, options));
  }

  assertEnoughMemoryForRemoteAuth();
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const task = {
    id: makeTaskId(provider),
    provider,
    status: 'remote_authorization_starting',
    days: options.days,
    loginUrl: options.loginUrl,
    noVncUrl: noVncUrl(),
    vncPassword: createVncPassword(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    expiresAt: new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
    sessionSaved: false,
    browserStarted: false,
    vncReady: false,
    novncReady: false,
    message:
      'Starting server-side Playwright browser. Complete CAPTCHA/MFA manually in the remote view.',
    children: [],
  };
  task.ttlTimer = setTimeout(() => stopRemoteAuth(provider).catch(() => {}), DEFAULT_TTL_MS);
  if (task.ttlTimer.unref) task.ttlTimer.unref();
  activeTasks.set(provider, task);

  try {
    const env = { ...process.env, DISPLAY: DEFAULT_DISPLAY };
    const xvfb = spawnManaged(
      'Xvfb',
      [DEFAULT_DISPLAY, '-screen', '0', '1280x900x24', '-ac', '-nolisten', 'tcp'],
      {
        env,
      },
    );
    task.children.push(xvfb);
    await new Promise((resolve) => setTimeout(resolve, 700));

    const x11vnc = spawnManaged(
      'x11vnc',
      [
        '-display',
        DEFAULT_DISPLAY,
        '-localhost',
        '-forever',
        '-shared',
        '-noxdamage',
        '-rfbport',
        String(DEFAULT_VNC_PORT),
        '-passwd',
        task.vncPassword,
      ],
      { env },
    );
    task.children.push(x11vnc);
    await waitForTcpPort({
      port: DEFAULT_VNC_PORT,
      code: 'REMOTE_AUTH_VNC_NOT_READY',
      label: 'VNC server',
      children: [xvfb, x11vnc],
    });
    task.vncReady = true;

    const websockify = spawnManaged(
      'websockify',
      [
        `--web=${NOVNC_WEB_ROOT}`,
        `127.0.0.1:${DEFAULT_NOVNC_PORT}`,
        `127.0.0.1:${DEFAULT_VNC_PORT}`,
      ],
      { env },
    );
    task.children.push(websockify);
    await waitForTcpPort({
      port: DEFAULT_NOVNC_PORT,
      code: 'REMOTE_AUTH_NOVNC_NOT_READY',
      label: 'noVNC websockify server',
      children: [xvfb, x11vnc, websockify],
    });
    task.novncReady = true;

    const { chromium } = require('playwright');
    const userDataDir = path.join(DATA_DIR, task.id);
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      env,
    });
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(options.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    task.context = context;
    task.page = page;
    task.status = 'remote_authorization_running';
    task.browserStarted = true;
    task.updatedAt = nowIso();
    task.message =
      'Remote browser is ready. Enter the temporary VNC password, click Connect, then finish official login, CAPTCHA and MFA manually.';
    return publicTask(task);
  } catch (error) {
    task.status = 'remote_authorization_failed';
    task.updatedAt = nowIso();
    task.message = error.message || 'Remote visual authorization failed to start.';
    for (const child of task.children || []) killChild(child);
    activeTasks.delete(provider);
    throw Object.assign(new Error(task.message), {
      code: 'REMOTE_AUTH_START_FAILED',
    });
  }
}

function getRemoteAuthStatus(provider) {
  const task = activeTasks.get(provider);
  if (!task) {
    return {
      provider,
      status: 'not_started',
      sessionSaved: false,
      message: 'No remote authorization task is running.',
    };
  }
  return publicTask(task);
}

function providerCookies(provider, storageState) {
  const domains = PROVIDER_DOMAINS[provider] || [];
  return (storageState.cookies || []).filter((cookie) => {
    const domain = String(cookie.domain || '').toLowerCase();
    return domains.some((providerDomain) => domain.includes(providerDomain));
  });
}

async function readPageEvidence(page) {
  if (!page) return { url: '', bodyText: '' };
  const url = page.url();
  const bodyText = await page
    .locator('body')
    .innerText({ timeout: 5000 })
    .catch(() => '');
  return { url, bodyText };
}

function looksLoggedIn(provider, storageState, evidence) {
  const cookies = providerCookies(provider, storageState);
  const url = String(evidence.url || '').toLowerCase();
  const body = String(evidence.bodyText || '').toLowerCase();
  const hasProviderCookies = cookies.length > 0;

  if (!hasProviderCookies) return false;

  if (provider === 'IHG') {
    return (
      /ihg\.com\/.*account-mgmt\/(home|profile|activity|rewards)/.test(url) ||
      /\b(sign out|log out|account overview|my account|member number|points)\b/.test(body)
    );
  }

  if (provider === 'Marriott') {
    return (
      /marriott\.com\/.*(loyalty|account|profile)/.test(url) ||
      /\b(sign out|log out|my trips|account|bonvoy|points)\b/.test(body)
    );
  }

  return false;
}

async function captureRemoteSessionIfReady(provider) {
  const task = activeTasks.get(provider);
  if (!task) {
    return {
      ready: false,
      provider,
      status: 'not_started',
      reason: 'No remote authorization task is running.',
    };
  }
  if (task.testMode) {
    return {
      ready: false,
      provider,
      status: task.status,
      reason: 'Test mode does not capture a real session.',
    };
  }
  if (!task.context) {
    return {
      ready: false,
      provider,
      status: task.status,
      reason: 'Remote browser is not ready yet.',
    };
  }

  const storageState = await task.context.storageState();
  const evidence = await readPageEvidence(task.page);
  const cookieCount = providerCookies(provider, storageState).length;

  if (!looksLoggedIn(provider, storageState, evidence)) {
    task.status = 'remote_authorization_running';
    task.updatedAt = nowIso();
    task.message =
      'Login has not been detected yet. Finish username/password, CAPTCHA and MFA in the remote browser, then try again.';
    return {
      ready: false,
      provider,
      status: task.status,
      cookieCount,
      currentUrl: evidence.url,
      reason: 'LOGIN_NOT_DETECTED',
    };
  }

  task.status = 'session_ready_to_save';
  task.updatedAt = nowIso();
  return {
    ready: true,
    provider,
    status: task.status,
    storageState,
    cookieCount,
    currentUrl: evidence.url,
  };
}

function markSessionSaved(provider) {
  const task = activeTasks.get(provider);
  if (!task) return;
  task.sessionSaved = true;
  task.status = 'session_authorized';
  task.updatedAt = nowIso();
  task.message = 'Session saved and encrypted.';
}

module.exports = {
  captureRemoteSessionIfReady,
  getRemoteAuthStatus,
  markSessionSaved,
  startRemoteAuth,
  stopRemoteAuth,
};
