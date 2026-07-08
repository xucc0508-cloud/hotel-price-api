const crypto = require('crypto');
const fs = require('fs');
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

function noVncUrl() {
  return '/novnc/vnc.html?autoconnect=1&resize=scale&path=novnc/websockify';
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
    vncPassword: 'test-mode-password',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    sessionSaved: false,
    browserStarted: true,
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
  child.on('error', (error) => {
    child.spawnError = error;
  });
  child.unref();
  return child;
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
    vncPassword: crypto.randomBytes(9).toString('base64url'),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    expiresAt: new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
    sessionSaved: false,
    browserStarted: false,
    message:
      'Starting server-side Playwright browser. Complete CAPTCHA/MFA manually in the remote view.',
    children: [],
  };
  task.ttlTimer = setTimeout(() => stopRemoteAuth(provider).catch(() => {}), DEFAULT_TTL_MS);
  if (task.ttlTimer.unref) task.ttlTimer.unref();
  activeTasks.set(provider, task);

  try {
    const env = { ...process.env, DISPLAY: DEFAULT_DISPLAY };
    task.children.push(
      spawnManaged('Xvfb', [DEFAULT_DISPLAY, '-screen', '0', '1280x900x24', '-ac', '-nolisten', 'tcp'], {
        env,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 700));

    task.children.push(
      spawnManaged(
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
      ),
    );

    task.children.push(
      spawnManaged(
        'websockify',
        [
          `--web=${NOVNC_WEB_ROOT}`,
          `127.0.0.1:${DEFAULT_NOVNC_PORT}`,
          `127.0.0.1:${DEFAULT_VNC_PORT}`,
        ],
        { env },
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 900));
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
      'Remote browser is ready. Finish official login, CAPTCHA and MFA manually; the server will save the session after login is detected.';
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
