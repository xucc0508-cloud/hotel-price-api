const DEFAULT_IHG_LOGIN_URL =
  process.env.IHG_LOGIN_URL ||
  'https://www.ihg.com/rewardsclub/us/en/account-mgmt/sign-in';
const DEFAULT_MARRIOTT_LOGIN_URL =
  process.env.MARRIOTT_LOGIN_URL || 'https://www.marriott.com/sign-in.mi';
const DEFAULT_SYNC_DAYS = 90;
const MAX_SYNC_DAYS = 365;
const PLAYWRIGHT_PROVIDER_CONFIGS = {
  IHG: {
    loginUrl: DEFAULT_IHG_LOGIN_URL,
    sessionMessage:
      'IHG Playwright session is saved. If CAPTCHA/MFA expires, re-authorize manually.',
  },
  Marriott: {
    loginUrl: DEFAULT_MARRIOTT_LOGIN_URL,
    sessionMessage:
      'Marriott Playwright session is saved. If CAPTCHA/MFA expires, re-authorize manually.',
  },
};

function normalizeSyncDays(value) {
  const days = Number(value || DEFAULT_SYNC_DAYS);
  if (!Number.isFinite(days)) return DEFAULT_SYNC_DAYS;
  return Math.min(Math.max(Math.trunc(days), 1), MAX_SYNC_DAYS);
}

function validateStorageState(storageState) {
  if (!storageState || typeof storageState !== 'object') {
    return { ok: false, code: 'INVALID_PLAYWRIGHT_STORAGE_STATE' };
  }
  if (!Array.isArray(storageState.cookies)) {
    return { ok: false, code: 'INVALID_PLAYWRIGHT_COOKIES' };
  }
  return { ok: true };
}

function countCookies(storageState) {
  return Array.isArray(storageState?.cookies) ? storageState.cookies.length : 0;
}

function supportedPlaywrightProvider(provider) {
  return Boolean(PLAYWRIGHT_PROVIDER_CONFIGS[provider]);
}

function createProviderPlaywrightAuthorization(provider, { account, days, nowIso, stableId }) {
  const config = PLAYWRIGHT_PROVIDER_CONFIGS[provider];
  if (!config) {
    throw Object.assign(new Error(`${provider} Playwright authorization is not supported.`), {
      code: 'UNSUPPORTED_PLAYWRIGHT_PROVIDER',
    });
  }
  const syncDays = normalizeSyncDays(days);
  return {
    id: stableId(`${String(provider).toLowerCase()}_auth`),
    provider,
    status: 'manual_action_required',
    days: syncDays,
    loginUrl: config.loginUrl,
    createdAt: nowIso(),
    instructions: [
      `Open the official ${provider} login URL in a Playwright-capable browser.`,
      'Complete username/password, CAPTCHA and MFA manually.',
      'Export Playwright storageState JSON after login.',
      'Paste the storageState JSON back into the admin console to save the encrypted session.',
    ],
    accountPresent: Boolean(account),
  };
}

function createIhgPlaywrightAuthorization(options) {
  return createProviderPlaywrightAuthorization('IHG', options);
}

function buildProviderSessionMetadata(provider, storageState, days, nowIso) {
  if (!supportedPlaywrightProvider(provider)) {
    throw Object.assign(new Error(`${provider} Playwright authorization is not supported.`), {
      code: 'UNSUPPORTED_PLAYWRIGHT_PROVIDER',
    });
  }
  return {
    provider,
    status: 'session_authorized',
    sourceType: 'playwright_session',
    syncWindowDays: normalizeSyncDays(days),
    cookieCount: countCookies(storageState),
    playwrightSessionSavedAt: nowIso(),
  };
}

function buildSessionMetadata(storageState, days, nowIso) {
  return buildProviderSessionMetadata('IHG', storageState, days, nowIso);
}

function testSavedProviderSession(provider, account) {
  if (!account?.encryptedSession) {
    return {
      provider,
      success: false,
      status: 'manual_action_required',
      message: `${provider} Playwright session is not saved yet.`,
    };
  }
  const config = PLAYWRIGHT_PROVIDER_CONFIGS[provider] || {};
  return {
    provider,
    success: true,
    status: 'session_authorized',
    sourceType: 'playwright_session',
    syncWindowDays: account.syncWindowDays || DEFAULT_SYNC_DAYS,
    message:
      config.sessionMessage ||
      `${provider} Playwright session is saved. If CAPTCHA/MFA expires, re-authorize manually.`,
  };
}

function testSavedSession(account) {
  return testSavedProviderSession('IHG', account);
}

module.exports = {
  createIhgPlaywrightAuthorization,
  createProviderPlaywrightAuthorization,
  buildSessionMetadata,
  buildProviderSessionMetadata,
  normalizeSyncDays,
  supportedPlaywrightProvider,
  testSavedSession,
  testSavedProviderSession,
  validateStorageState,
};
