const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { maybeSendAdminPage, sendAdminPage } = require('./admin-ui');
const { createIhgAdapter } = require('./providers/ihg/ihg.adapter');
const {
  buildProviderSessionMetadata,
  createProviderPlaywrightAuthorization,
  normalizeSyncDays,
  supportedPlaywrightProvider,
  testSavedProviderSession,
  validateStorageState,
} = require('./ihg-playwright-provider');

const PROVIDERS = ['IHG', 'Marriott', 'Hilton', 'Hyatt', 'Accor'];
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE =
  process.env.ADMIN_SYNC_STORE_FILE || path.join(DATA_DIR, 'admin-sync-store.json');
const DEFAULT_CRON = process.env.PRICE_SYNC_CRON || '0 0 * * *';
const ihgAdapter = createIhgAdapter({ decryptCredential });

function nowIso() {
  return new Date().toISOString();
}

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(
      STORE_FILE,
      JSON.stringify(
        {
          accounts: {},
          hotelSources: [],
          priceSnapshots: [],
          syncJobs: [],
          syncLogs: [],
        },
        null,
        2,
      ),
    );
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function stableId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function jsonResponse(data) {
  return { success: true, data };
}

function errorResponse(code, message) {
  return { success: false, data: null, error: { code, message } };
}

function maskUsername(username) {
  const [name, domain] = String(username || '').split('@');
  if (!domain) return `${String(username || '').slice(0, 2)}***`;
  return `${name.slice(0, Math.min(2, name.length))}***@${domain}`;
}

function encryptionKey() {
  const secret =
    process.env.CREDENTIAL_ENCRYPTION_KEY ||
    'local_development_credential_encryption_key_change_me';
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptCredential(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.from(
    JSON.stringify({
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    }),
  ).toString('base64url');
}

function decryptCredential(value) {
  const payload = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(payload.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  const expected = String(passwordHash).trim();
  let actual;
  if (expected.startsWith('sha256:')) {
    actual = `sha256:${hashPassword(password)}`;
  } else if (/^[a-f0-9]{64}$/i.test(expected)) {
    actual = hashPassword(password);
  } else {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function adminAuthConfigured() {
  return Boolean(
    process.env.ADMIN_USERNAME &&
      process.env.ADMIN_PASSWORD_HASH &&
      process.env.ADMIN_JWT_SECRET,
  );
}

function missingAdminConfigKeys() {
  return [
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD_HASH',
    'ADMIN_JWT_SECRET',
  ].filter((key) => !process.env[key]);
}

function signToken(username) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: username,
    role: 'admin',
    iat: now,
    exp: now + 12 * 60 * 60,
  };
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const secret =
    process.env.ADMIN_JWT_SECRET ||
    process.env.ADMIN_TOKEN ||
    'local_development_admin_jwt_secret_change_me';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return { token: `${header}.${body}.${signature}`, expiresAt: payload.exp };
}

function verifyToken(token) {
  if (!token) return false;
  if (process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) return true;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [header, body, signature] = parts;
  const secret =
    process.env.ADMIN_JWT_SECRET ||
    process.env.ADMIN_TOKEN ||
    'local_development_admin_jwt_secret_change_me';
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  if (signature.length !== expected.length) return false;
  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    )
  ) {
    return false;
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return Number(payload.exp) > Math.floor(Date.now() / 1000);
}

function requireAdmin(request, response, next) {
  const authorization = request.headers.authorization || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!verifyToken(token)) {
    response
      .status(401)
      .json(errorResponse('UNAUTHORIZED', 'Administrator token required'));
    return;
  }
  next();
}

function login(request, response) {
  const { username, password } = request.body || {};
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPasswordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!adminAuthConfigured()) {
    console.warn(
      `Admin auth configuration missing keys: ${missingAdminConfigKeys().join(', ')}`,
    );
    response
      .status(503)
      .json(errorResponse('ADMIN_NOT_CONFIGURED', 'Admin account is not configured'));
    return;
  }

  if (username !== expectedUser || !verifyPassword(password, expectedPasswordHash)) {
    response
      .status(401)
      .json(errorResponse('INVALID_CREDENTIALS', 'Invalid credentials'));
    return;
  }

  const { token, expiresAt } = signToken(username);
  response.status(200).json(
    jsonResponse({
      token,
      username,
      accessToken: token,
      tokenType: 'Bearer',
      expiresAt,
    }),
  );
}

function providersStatus() {
  const store = readStore();
  return PROVIDERS.map((provider) => {
    const account = store.accounts[provider];
    const syncedHotelCount = store.hotelSources.filter(
      (item) => item.provider === provider,
    ).length;
    const syncedPriceCount = store.priceSnapshots.filter(
      (item) => item.provider === provider,
    ).length;
    return {
      provider,
      connectionStatus: account?.status || 'expired',
      usernameMasked: account?.usernameMasked || null,
      lastSyncAt: account?.lastSyncAt || null,
      syncedHotelCount,
      syncedPriceCount,
      recentError: account?.lastError || null,
      manualAuthorizedAt: account?.manualAuthorizedAt || null,
      playwrightSessionSavedAt: account?.playwrightSessionSavedAt || null,
      syncWindowDays: account?.syncWindowDays || null,
      sourceType: account?.sourceType || null,
      message: account
        ? '待人工授权：未接入官方 API/OAuth，不会绕过验证码、MFA 或风控。'
        : '未登录，暂无真实价格数据。',
      actions: ['登录账号', '测试连接', '立即同步', '查看日志', '禁用账号'],
    };
  });
}

function saveProviderLogin(request, response) {
  const provider = request.params.provider;
  if (!PROVIDERS.includes(provider)) {
    response
      .status(400)
      .json(errorResponse('UNSUPPORTED_PROVIDER', 'Unsupported provider'));
    return;
  }
  const { username, password } = request.body || {};
  if (!username || !password) {
    response
      .status(400)
      .json(errorResponse('INVALID_PROVIDER_LOGIN', 'Username and password required'));
    return;
  }

  const store = readStore();
  store.accounts[provider] = {
    provider,
    usernameMasked: maskUsername(username),
    encryptedCredential: encryptCredential({ username, password }),
    encryptedSession: null,
    status: 'expired',
    lastLoginAt: null,
    lastSyncAt: null,
    lastError:
      '待人工授权：当前未接入官方 API/OAuth；如遇验证码或 MFA，必须由管理员人工完成。',
    createdAt: store.accounts[provider]?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  writeStore(store);

  response.status(200).json(
    jsonResponse({
      provider,
      usernameMasked: store.accounts[provider].usernameMasked,
      status: store.accounts[provider].status,
      message: store.accounts[provider].lastError,
    }),
  );
}

function manualAuthorizeProvider(request, response) {
  const provider = request.params.provider;
  if (!PROVIDERS.includes(provider)) {
    response
      .status(400)
      .json(errorResponse('UNSUPPORTED_PROVIDER', 'Unsupported provider'));
    return;
  }

  const store = readStore();
  const account = store.accounts[provider];
  if (!account) {
    response
      .status(400)
      .json(
        errorResponse(
          'PROVIDER_ACCOUNT_REQUIRED',
          'Provider account must be saved before manual authorization',
        ),
      );
    return;
  }

  const authorizedAt = nowIso();
  const note = String(request.body?.note || '').slice(0, 500);
  store.accounts[provider] = {
    ...account,
    status: 'manual_authorized',
    sourceType: 'manual',
    manualAuthorizedAt: authorizedAt,
    manualAuthorizationNote: note,
    lastError:
      '已人工授权：当前为人工确认模式，未接入官方 API/OAuth，不能自动测试官方连接。',
    updatedAt: authorizedAt,
  };
  store.syncLogs.push({
    id: stableId('log'),
    jobId: null,
    provider,
    level: 'info',
    message: '管理员已人工授权该集团账号；真实价格同步仍需官方 API/OAuth 或手工导入。',
    createdAt: authorizedAt,
  });
  writeStore(store);

  response.status(200).json(
    jsonResponse({
      provider,
      usernameMasked: store.accounts[provider].usernameMasked,
      status: store.accounts[provider].status,
      sourceType: store.accounts[provider].sourceType,
      manualAuthorizedAt: authorizedAt,
      message: store.accounts[provider].lastError,
    }),
  );
}

function startPlaywrightAuthorization(request, response) {
  const provider = request.params.provider;
  if (!supportedPlaywrightProvider(provider)) {
    response
      .status(400)
      .json(errorResponse('UNSUPPORTED_PLAYWRIGHT_PROVIDER', `${provider} Playwright authorization is not supported`));
    return;
  }

  const store = readStore();
  const account = store.accounts[provider];
  const authorization = createProviderPlaywrightAuthorization(provider, {
    account,
    days: request.body?.days,
    nowIso,
    stableId,
  });

  store.accounts[provider] = {
    ...(account || {
      provider,
      usernameMasked: null,
      createdAt: nowIso(),
    }),
    status: 'playwright_authorization_required',
    sourceType: 'playwright_session',
    syncWindowDays: authorization.days,
    playwrightAuthTask: {
      id: authorization.id,
      status: authorization.status,
      loginUrl: authorization.loginUrl,
      createdAt: authorization.createdAt,
    },
    lastError:
      `${provider} Playwright authorization started. Complete login, CAPTCHA and MFA manually, then save storageState.`,
    updatedAt: nowIso(),
  };
  store.syncLogs.push({
    id: stableId('log'),
    jobId: null,
    provider,
    level: 'info',
    message:
      `${provider} Playwright authorization started for a ${authorization.days}-day price sync window.`,
    createdAt: nowIso(),
  });
  writeStore(store);

  response.status(200).json(jsonResponse(authorization));
}

function savePlaywrightSession(request, response) {
  const provider = request.params.provider;
  if (!supportedPlaywrightProvider(provider)) {
    response
      .status(400)
      .json(errorResponse('UNSUPPORTED_PLAYWRIGHT_PROVIDER', `${provider} Playwright authorization is not supported`));
    return;
  }

  const storageState = request.body?.storageState;
  const validation = validateStorageState(storageState);
  if (!validation.ok) {
    response
      .status(400)
      .json(errorResponse(validation.code, 'Invalid Playwright storageState'));
    return;
  }

  const store = readStore();
  const account = store.accounts[provider] || {
    provider,
    usernameMasked: null,
    createdAt: nowIso(),
  };
  const metadata = buildProviderSessionMetadata(provider, storageState, request.body?.days, nowIso);
  store.accounts[provider] = {
    ...account,
    encryptedSession: encryptCredential({
      type: 'playwright_storage_state',
      storageState,
      savedAt: metadata.playwrightSessionSavedAt,
    }),
    status: metadata.status,
    sourceType: metadata.sourceType,
    syncWindowDays: metadata.syncWindowDays,
    playwrightSessionSavedAt: metadata.playwrightSessionSavedAt,
    lastLoginAt: metadata.playwrightSessionSavedAt,
    lastError: null,
    updatedAt: metadata.playwrightSessionSavedAt,
  };
  store.syncLogs.push({
    id: stableId('log'),
    jobId: null,
    provider,
    level: 'info',
    message: `${provider} Playwright session saved; sync window ${metadata.syncWindowDays} days.`,
    createdAt: metadata.playwrightSessionSavedAt,
  });
  writeStore(store);

  response.status(200).json(
    jsonResponse({
      provider,
      status: metadata.status,
      sourceType: metadata.sourceType,
      days: metadata.syncWindowDays,
      cookieCount: metadata.cookieCount,
      sessionSaved: true,
      savedAt: metadata.playwrightSessionSavedAt,
      message:
        `${provider} Playwright session saved. Cookies are encrypted and never returned by API.`,
    }),
  );
}

function createSyncJob(provider, type) {
  const store = readStore();
  const account = provider ? store.accounts[provider] : null;
  return {
    id: stableId('job'),
    provider: provider || null,
    type,
    status: 'failed',
    startedAt: nowIso(),
    finishedAt: nowIso(),
    totalHotels: 0,
    totalPrices: 0,
    requestedDays: null,
    errorMessage: account
      ? '待人工授权：未接入官方 API/OAuth。'
      : '未登录，暂无真实价格数据。',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function appendLog(store, job, level, message) {
  store.syncLogs.push({
    id: stableId('log'),
    jobId: job.id,
    provider: job.provider,
    level,
    message,
    createdAt: nowIso(),
  });
}

function upsertByProviderHotelId(items, incoming) {
  const map = new Map(
    items.map((item) => [`${item.provider}:${item.providerHotelId}`, item]),
  );
  for (const item of incoming) {
    map.set(`${item.provider}:${item.providerHotelId}`, {
      ...(map.get(`${item.provider}:${item.providerHotelId}`) || {}),
      ...item,
    });
  }
  return Array.from(map.values());
}

function upsertPriceSnapshots(items, incoming) {
  const map = new Map(
    items.map((item) => [
      `${item.provider}:${item.providerHotelId}:${item.checkinDate}`,
      item,
    ]),
  );
  for (const item of incoming) {
    map.set(`${item.provider}:${item.providerHotelId}:${item.checkinDate}`, {
      ...(map.get(`${item.provider}:${item.providerHotelId}:${item.checkinDate}`) || {}),
      ...item,
    });
  }
  return Array.from(map.values());
}

async function fetchIhgAuthorizedData(account, options = {}) {
  return ihgAdapter.fetchAvailability(account, options);
}

async function syncProvider(request, response) {
  const provider = request.params.provider;
  if (!PROVIDERS.includes(provider)) {
    response
      .status(400)
      .json(errorResponse('UNSUPPORTED_PROVIDER', 'Unsupported provider'));
    return;
  }
  const store = readStore();
  const job = createSyncJob(provider, 'manual');
  if (provider === 'IHG' && store.accounts[provider]?.status === 'manual_authorized') {
    try {
      const ihgData = await fetchIhgAuthorizedData(store.accounts[provider], {});
      store.hotelSources = upsertByProviderHotelId(
        store.hotelSources,
        ihgData.hotels,
      );
      store.priceSnapshots = upsertPriceSnapshots(
        store.priceSnapshots,
        ihgData.prices,
      );
      job.status = 'success';
      job.totalHotels = ihgData.hotels.length;
      job.totalPrices = ihgData.prices.length;
      job.errorMessage = null;
      if (store.accounts[provider]) {
        store.accounts[provider].status = 'active';
        store.accounts[provider].lastSyncAt = nowIso();
        store.accounts[provider].lastError = null;
        store.accounts[provider].updatedAt = nowIso();
      }
      store.syncJobs.unshift(job);
      appendLog(
        store,
        job,
        'info',
        `IHG真实数据同步完成：酒店 ${job.totalHotels}，价格 ${job.totalPrices}。`,
      );
      writeStore(store);
      response.status(200).json(jsonResponse(job));
      return;
    } catch (error) {
      job.errorMessage =
        error.code === 'IHG_REAL_SOURCE_NOT_CONFIGURED'
          ? 'IHG真实同步源未配置：请配置官方/伙伴 API 或真实导入源后再同步。'
          : `IHG真实同步失败：${error.message || error}`;
    }
  }
  if (store.accounts[provider]?.status === 'manual_authorized') {
    job.errorMessage =
      '已人工授权：请导入价格文件或接入官方 API/OAuth 后再同步真实价格。';
  }
  store.syncJobs.unshift(job);
  appendLog(store, job, 'warn', job.errorMessage);
  if (store.accounts[provider]) {
    if (store.accounts[provider].status !== 'manual_authorized') {
      store.accounts[provider].status = 'expired';
    }
    store.accounts[provider].lastError = job.errorMessage;
    store.accounts[provider].updatedAt = nowIso();
  }
  writeStore(store);
  response.status(200).json(jsonResponse(job));
}

async function syncProviderWithPlaywright(request, response) {
  const provider = request.params.provider;
  if (!PROVIDERS.includes(provider)) {
    response
      .status(400)
      .json(errorResponse('UNSUPPORTED_PROVIDER', 'Unsupported provider'));
    return;
  }

  const store = readStore();
  const account = store.accounts[provider];
  const requestedDays = normalizeSyncDays(request.body?.days || account?.syncWindowDays);
  const job = createSyncJob(provider, 'manual');
  job.requestedDays = requestedDays;
  let attemptedLiveSync = false;

  const canAttemptIhgLiveSync =
    provider === 'IHG' &&
    account &&
    (['session_authorized', 'active'].includes(account.status) ||
      Boolean(process.env.IHG_SYNC_SOURCE_URL || process.env.IHG_SYNC_SOURCE_FILE));

  if (canAttemptIhgLiveSync) {
    attemptedLiveSync = true;
    try {
      const ihgData = await fetchIhgAuthorizedData(account, {
        days: requestedDays,
        sourceType: account?.sourceType,
      });
      store.hotelSources = upsertByProviderHotelId(
        store.hotelSources,
        ihgData.hotels,
      );
      store.priceSnapshots = upsertPriceSnapshots(
        store.priceSnapshots,
        ihgData.prices,
      );
      job.status = 'success';
      job.totalHotels = ihgData.hotels.length;
      job.totalPrices = ihgData.prices.length;
      job.errorMessage = null;
      job.finishedAt = nowIso();
      if (store.accounts[provider]) {
        store.accounts[provider].status = 'active';
        store.accounts[provider].lastSyncAt = job.finishedAt;
        store.accounts[provider].syncWindowDays = requestedDays;
        store.accounts[provider].lastError = null;
        store.accounts[provider].updatedAt = job.finishedAt;
      }
      store.syncJobs.unshift(job);
      appendLog(
        store,
        job,
        'info',
        `IHG real data sync completed: hotels ${job.totalHotels}, prices ${job.totalPrices}, days ${requestedDays}.`,
      );
      writeStore(store);
      response.status(200).json(jsonResponse(job));
      return;
    } catch (error) {
      const errorCode = error.code || 'UNKNOWN';
      job.errorMessage =
        error.code === 'IHG_REAL_SOURCE_NOT_CONFIGURED'
          ? 'IHG sync source is not configured and live Playwright scraping is unavailable. Saved sessions are kept encrypted, and no fake price data was written.'
          : `IHG real sync failed (${errorCode}): ${error.message || error}`;
    }
  }

  if (!attemptedLiveSync && account?.status === 'session_authorized') {
    job.errorMessage =
      provider === 'IHG'
        ? 'IHG Playwright session is saved, but the live price scraper/source is not configured. No fake price data was written.'
        : `${provider} Playwright session is saved, but live price scraping is not configured. No fake price data was written.`;
  } else if (!attemptedLiveSync && account?.status === 'manual_authorized') {
    job.errorMessage =
      'Manual authorization is recorded. 请导入价格文件或接入官方 API before syncing real prices.';
  }

  store.syncJobs.unshift(job);
  appendLog(store, job, 'warn', job.errorMessage);
  if (store.accounts[provider]) {
    if (!['manual_authorized', 'session_authorized'].includes(store.accounts[provider].status)) {
      store.accounts[provider].status = 'expired';
    }
    store.accounts[provider].lastError = job.errorMessage;
    store.accounts[provider].updatedAt = nowIso();
  }
  writeStore(store);
  response.status(200).json(jsonResponse(job));
}

function syncAll(_request, response) {
  const store = readStore();
  const jobs = PROVIDERS.map((provider) => createSyncJob(provider, 'manual'));
  for (const job of jobs) {
    store.syncJobs.unshift(job);
    appendLog(store, job, 'warn', job.errorMessage);
  }
  writeStore(store);
  response.status(200).json(jsonResponse(jobs));
}

function registerAdminRoutes(app) {
  app.get('/admin', sendAdminPage);
  app.get('/admin/login', sendAdminPage);
  app.post('/admin/login', login);

  app.get('/admin/dashboard', maybeSendAdminPage, requireAdmin, (_request, response) => {
    const store = readStore();
    response.status(200).json(
      jsonResponse({
        cron: {
          name: 'daily-real-provider-price-sync',
          schedule: DEFAULT_CRON,
          status: 'configured',
        },
        providers: providersStatus(),
        summary: {
          providerAccounts: Object.keys(store.accounts).length,
          hotelSources: store.hotelSources.length,
          priceSnapshots: store.priceSnapshots.length,
          syncJobs: store.syncJobs.length,
        },
      }),
    );
  });

  app.get('/admin/providers', maybeSendAdminPage, requireAdmin, (_request, response) => {
    response.status(200).json(jsonResponse(providersStatus()));
  });

  app.post('/admin/providers/:provider/login', requireAdmin, saveProviderLogin);

  app.post(
    '/admin/providers/:provider/manual-authorize',
    requireAdmin,
    manualAuthorizeProvider,
  );

  app.post(
    '/admin/providers/:provider/playwright/start',
    requireAdmin,
    startPlaywrightAuthorization,
  );

  app.post(
    '/admin/providers/:provider/playwright/session',
    requireAdmin,
    savePlaywrightSession,
  );

  app.post('/admin/providers/:provider/test', requireAdmin, async (request, response) => {
    const provider = request.params.provider;
    if (!PROVIDERS.includes(provider)) {
      response
        .status(400)
        .json(errorResponse('UNSUPPORTED_PROVIDER', 'Unsupported provider'));
      return;
    }
    const account = readStore().accounts[provider];
    if (provider === 'IHG' && account?.status === 'session_authorized') {
      try {
        response
          .status(200)
          .json(jsonResponse({ ...testSavedProviderSession(provider, account), ...(await ihgAdapter.testConnection(account)) }));
      } catch (error) {
        response.status(200).json(
          jsonResponse({
            provider,
            success: false,
            status: 'session_invalid',
            message: error.message || 'IHG session test failed.',
            code: error.code || 'IHG_SESSION_TEST_FAILED',
          }),
        );
      }
      return;
    }
    if (supportedPlaywrightProvider(provider) && account?.status === 'session_authorized') {
      response.status(200).json(jsonResponse(testSavedProviderSession(provider, account)));
      return;
    }
    if (account?.status === 'manual_authorized') {
      response.status(200).json(
        jsonResponse({
          provider,
          success: false,
          status: 'manual_authorized',
          message:
            '已人工授权：当前为人工确认模式，无法自动测试官方连接；请导入价格文件或接入官方 API/OAuth。',
        }),
      );
      return;
    }
    response.status(200).json(
      jsonResponse({
        provider,
        success: false,
        status: 'manual_authorization_required',
        message: '待人工授权，暂不能自动测试连接。',
      }),
    );
  });

  app.post('/admin/providers/:provider/sync', requireAdmin, syncProviderWithPlaywright);

  app.post('/admin/providers/:provider/disable', requireAdmin, (request, response) => {
    const provider = request.params.provider;
    const store = readStore();
    const current = store.accounts[provider] || {
      provider,
      usernameMasked: null,
      createdAt: nowIso(),
    };
    store.accounts[provider] = {
      ...current,
      status: 'disabled',
      updatedAt: nowIso(),
    };
    writeStore(store);
    response.status(200).json(jsonResponse(store.accounts[provider]));
  });

  app.post('/admin/sync/all', requireAdmin, syncAll);

  app.get('/admin/sync-jobs', sendAdminPage);
  app.get('/admin/sync-logs', sendAdminPage);

  app.get('/admin/sync/jobs', requireAdmin, (_request, response) => {
    response.status(200).json(jsonResponse(readStore().syncJobs.slice(0, 50)));
  });

  app.get('/admin/sync/logs', requireAdmin, (_request, response) => {
    response.status(200).json(jsonResponse(readStore().syncLogs.slice(0, 200)));
  });
}

module.exports = {
  errorResponse,
  jsonResponse,
  readStore,
  registerAdminRoutes,
};
