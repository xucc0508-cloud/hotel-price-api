const DEFAULT_IHG_LOGIN_URL =
  process.env.IHG_LOGIN_URL ||
  'https://www.ihg.com/rewardsclub/us/en/account-mgmt/sign-in';
const DEFAULT_SYNC_DAYS = 90;
const MAX_SYNC_DAYS = 365;

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

function createIhgPlaywrightAuthorization({ account, days, nowIso, stableId }) {
  const syncDays = normalizeSyncDays(days);
  return {
    id: stableId('ihg_auth'),
    provider: 'IHG',
    status: 'manual_action_required',
    days: syncDays,
    loginUrl: DEFAULT_IHG_LOGIN_URL,
    createdAt: nowIso(),
    instructions: [
      'Open the IHG login URL in a Playwright-capable browser.',
      'Complete username/password, CAPTCHA and MFA manually.',
      'Export Playwright storageState JSON after login.',
      'Paste the storageState JSON back into the admin console to save the encrypted session.',
    ],
    accountPresent: Boolean(account),
  };
}

function buildSessionMetadata(storageState, days, nowIso) {
  return {
    provider: 'IHG',
    status: 'session_authorized',
    sourceType: 'playwright_session',
    syncWindowDays: normalizeSyncDays(days),
    cookieCount: countCookies(storageState),
    playwrightSessionSavedAt: nowIso(),
  };
}

function testSavedSession(account) {
  if (!account?.encryptedSession) {
    return {
      provider: 'IHG',
      success: false,
      status: 'manual_action_required',
      message: 'IHG Playwright session is not saved yet.',
    };
  }
  return {
    provider: 'IHG',
    success: true,
    status: 'session_authorized',
    sourceType: 'playwright_session',
    syncWindowDays: account.syncWindowDays || DEFAULT_SYNC_DAYS,
    message:
      'IHG Playwright session is saved. If CAPTCHA/MFA expires, re-authorize manually.',
  };
}

module.exports = {
  createIhgPlaywrightAuthorization,
  buildSessionMetadata,
  normalizeSyncDays,
  testSavedSession,
  validateStorageState,
};
