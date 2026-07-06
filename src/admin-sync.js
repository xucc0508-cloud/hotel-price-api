const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { maybeSendAdminPage, sendAdminPage } = require('./admin-ui');

const PROVIDERS = ['IHG', 'Marriott', 'Hilton', 'Hyatt', 'Accor'];
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'admin-sync-store.json');
const DEFAULT_CRON = process.env.PRICE_SYNC_CRON || '0 0 * * *';

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
    response
      .status(503)
      .json(errorResponse('ADMIN_NOT_CONFIGURED', '管理员账号未配置'));
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

function syncProvider(request, response) {
  const provider = request.params.provider;
  if (!PROVIDERS.includes(provider)) {
    response
      .status(400)
      .json(errorResponse('UNSUPPORTED_PROVIDER', 'Unsupported provider'));
    return;
  }
  const store = readStore();
  const job = createSyncJob(provider, 'manual');
  store.syncJobs.unshift(job);
  appendLog(store, job, 'warn', job.errorMessage);
  if (store.accounts[provider]) {
    store.accounts[provider].status = 'expired';
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

  app.post('/admin/providers/:provider/test', requireAdmin, (request, response) => {
    const provider = request.params.provider;
    if (!PROVIDERS.includes(provider)) {
      response
        .status(400)
        .json(errorResponse('UNSUPPORTED_PROVIDER', 'Unsupported provider'));
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

  app.post('/admin/providers/:provider/sync', requireAdmin, syncProvider);

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
  registerAdminRoutes,
};
