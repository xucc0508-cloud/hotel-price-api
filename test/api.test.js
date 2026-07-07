const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

process.env.ADMIN_SYNC_STORE_FILE = path.join(
  os.tmpdir(),
  `hotel-price-api-admin-sync-test-${process.pid}.json`,
);

const app = require('../src/app');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

for (const path of ['/health', '/hotels', '/price', '/compare/rank']) {
  test(`GET ${path} returns JSON with HTTP 200`, async () => {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.notEqual(await response.json(), undefined);
  });
}

test('hotel list and detail match the miniapp contract', async () => {
  const listResponse = await fetch(`${baseUrl}/hotels`);
  const list = await listResponse.json();
  assert.ok(Array.isArray(list.items));
  assert.ok(list.items.length > 0);

  const hotelId = list.items[0].id;
  const detailResponse = await fetch(`${baseUrl}/hotel/${hotelId}`);
  const detail = await detailResponse.json();
  assert.equal(detail.id, hotelId);
  assert.ok(detail.redemptionDecision);
  assert.ok(Array.isArray(detail.sameCityRecommendations));

  const miniappPaths = [
    `/hotels/${hotelId}`,
    `/hotel/${hotelId}/analysis`,
    `/hotel/${hotelId}/decision`,
    `/hotel/${hotelId}/calendar`,
    '/rank?metric=pointsValue&limit=20',
    '/rank/today-best',
    '/rank/today-recommended',
    '/rank/cash-best',
    '/rank/rising',
    '/rank/falling',
    `/city/${encodeURIComponent(detail.city)}/recommendations?excludeHotelId=${hotelId}`,
  ];

  for (const path of miniappPaths) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, path);
    assert.notEqual(await response.json(), undefined, path);
  }
});

test('city search supports required cities and Chinese fuzzy matching', async () => {
  for (const city of ['北京', '上海', '广州', '深圳', '杭州', '成都']) {
    const response = await fetch(
      `${baseUrl}/hotels?keyword=${encodeURIComponent(city)}`,
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.ok(result.items.some((hotel) => hotel.city === city), city);
  }

  const fuzzyResponse = await fetch(
    `${baseUrl}/hotels?keyword=${encodeURIComponent('深')}`,
  );
  const fuzzyResult = await fuzzyResponse.json();
  assert.ok(
    fuzzyResult.items.some((hotel) => hotel.city === '深圳'),
    'Chinese partial city name',
  );
});

test('hotel and rank APIs filter by city', async () => {
  const hotelResponse = await fetch(
    `${baseUrl}/hotels?city=${encodeURIComponent('北京')}`,
  );
  const hotelResult = await hotelResponse.json();
  assert.equal(hotelResponse.status, 200);
  assert.ok(hotelResult.items.length > 0);
  assert.ok(hotelResult.items.every((hotel) => hotel.city === '北京'));

  const rankResponse = await fetch(
    `${baseUrl}/rank?city=${encodeURIComponent('北京')}`,
  );
  const rankResult = await rankResponse.json();
  assert.equal(rankResponse.status, 200);
  assert.ok(rankResult.length > 0);
  assert.ok(rankResult.every((hotel) => hotel.city === '北京'));
  assert.ok(rankResult.every((hotel) => hotel.hotelId && hotel.pointValue));
});

test('admin browser pages and protected JSON APIs are available', async () => {
  const loginPageResponse = await fetch(`${baseUrl}/admin/login`, {
    headers: { Accept: 'text/html' },
  });
  assert.equal(loginPageResponse.status, 200);
  assert.match(loginPageResponse.headers.get('cache-control'), /no-store/);
  const loginPageHtml = await loginPageResponse.text();
  assert.match(loginPageHtml, /admin-login-stability-v1/);
  assert.match(loginPageHtml, /same-origin/);
  assert.match(loginPageHtml, /adminFetch/);

  const cachedLoginPageResponse = await fetch(`${baseUrl}/admin/login`, {
    headers: {
      Accept: 'text/html',
      'If-None-Match': '*',
      'If-Modified-Since': new Date().toUTCString(),
    },
  });
  assert.equal(cachedLoginPageResponse.status, 200);
  assert.match(cachedLoginPageResponse.headers.get('cache-control'), /no-store/);

  const protectedResponse = await fetch(`${baseUrl}/admin/providers`);
  assert.equal(protectedResponse.status, 401);
  const protectedJson = await protectedResponse.json();
  assert.equal(protectedJson.error.code, 'UNAUTHORIZED');
});

test('admin login uses configured password hash and token unlocks providers', async () => {
  process.env.ADMIN_USERNAME = 'admin-test';
  process.env.ADMIN_PASSWORD_HASH = `sha256:${crypto
    .createHash('sha256')
    .update('secret-test-password')
    .digest('hex')}`;
  process.env.ADMIN_JWT_SECRET = 'test_jwt_secret_minimum_32_characters_long';

  const loginResponse = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin-test',
      password: 'secret-test-password',
    }),
  });
  assert.equal(loginResponse.status, 200);
  const loginJson = await loginResponse.json();
  assert.equal(loginJson.success, true);
  assert.equal(loginJson.data.username, 'admin-test');
  assert.ok(loginJson.data.token);
  assert.ok(loginJson.data.accessToken);
  assert.equal(loginJson.data.token, loginJson.data.accessToken);

  const providersResponse = await fetch(`${baseUrl}/admin/providers`, {
    headers: { Authorization: `Bearer ${loginJson.data.token}` },
  });
  assert.equal(providersResponse.status, 200);
  const providersJson = await providersResponse.json();
  assert.deepEqual(
    providersJson.data.map((item) => item.provider),
    ['IHG', 'Marriott', 'Hilton', 'Hyatt', 'Accor'],
  );
});

test('admin can mark a provider as manually authorized without faking official connectivity', async () => {
  process.env.ADMIN_USERNAME = 'manual-admin';
  process.env.ADMIN_PASSWORD_HASH = `sha256:${crypto
    .createHash('sha256')
    .update('manual-secret-password')
    .digest('hex')}`;
  process.env.ADMIN_JWT_SECRET = 'manual_test_jwt_secret_minimum_32_chars';

  const loginResponse = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'manual-admin',
      password: 'manual-secret-password',
    }),
  });
  const loginJson = await loginResponse.json();
  const auth = { Authorization: `Bearer ${loginJson.data.token}` };

  const saveResponse = await fetch(`${baseUrl}/admin/providers/IHG/login`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '32000000', password: 'provider-secret' }),
  });
  assert.equal(saveResponse.status, 200);

  const authorizeResponse = await fetch(
    `${baseUrl}/admin/providers/IHG/manual-authorize`,
    {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Admin confirmed account ownership.' }),
    },
  );
  assert.equal(authorizeResponse.status, 200);
  const authorizeJson = await authorizeResponse.json();
  assert.equal(authorizeJson.success, true);
  assert.equal(authorizeJson.data.status, 'manual_authorized');
  assert.equal(authorizeJson.data.sourceType, 'manual');

  const providersResponse = await fetch(`${baseUrl}/admin/providers`, {
    headers: auth,
  });
  const providersJson = await providersResponse.json();
  const ihg = providersJson.data.find((item) => item.provider === 'IHG');
  assert.equal(ihg.connectionStatus, 'manual_authorized');
  assert.equal(ihg.sourceType, 'manual');
  assert.ok(ihg.manualAuthorizedAt);

  const testResponse = await fetch(`${baseUrl}/admin/providers/IHG/test`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const testJson = await testResponse.json();
  assert.equal(testResponse.status, 200);
  assert.equal(testJson.data.status, 'manual_authorized');
  assert.match(testJson.data.message, /无法自动测试官方连接/);

  const syncResponse = await fetch(`${baseUrl}/admin/providers/IHG/sync`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const syncJson = await syncResponse.json();
  assert.equal(syncResponse.status, 200);
  assert.equal(syncJson.data.status, 'failed');
  assert.match(syncJson.data.errorMessage, /请导入价格文件或接入官方 API/);
});

test('IHG real sync source updates public hotel and price APIs', async () => {
  process.env.ADMIN_USERNAME = 'ihg-sync-admin';
  process.env.ADMIN_PASSWORD_HASH = `sha256:${crypto
    .createHash('sha256')
    .update('ihg-sync-password')
    .digest('hex')}`;
  process.env.ADMIN_JWT_SECRET = 'ihg_sync_jwt_secret_minimum_32_chars';

  const ihgSourceFile = path.join(
    os.tmpdir(),
    `hotel-price-api-ihg-source-${process.pid}.json`,
  );
  process.env.IHG_SYNC_SOURCE_FILE = ihgSourceFile;
  require('node:fs').writeFileSync(
    ihgSourceFile,
    JSON.stringify({
      hotels: [
        {
          providerHotelId: 'PEKHB',
          hotelName: 'IHG 北京真实测试酒店',
          brand: 'Holiday Inn Express',
          city: '北京',
          address: '北京市测试路 1 号',
          country: 'CN',
        },
      ],
      prices: [
        {
          providerHotelId: 'PEKHB',
          hotelName: 'IHG 北京真实测试酒店',
          city: '北京',
          checkinDate: '2026-07-08',
          checkoutDate: '2026-07-09',
          cashPrice: 688,
          pointsPrice: 20000,
          currency: 'CNY',
          availability: 'available',
          sourceType: 'official',
        },
      ],
    }),
  );

  const loginResponse = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'ihg-sync-admin',
      password: 'ihg-sync-password',
    }),
  });
  const loginJson = await loginResponse.json();
  const auth = { Authorization: `Bearer ${loginJson.data.token}` };

  await fetch(`${baseUrl}/admin/providers/IHG/login`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '32000000', password: 'provider-secret' }),
  });
  await fetch(`${baseUrl}/admin/providers/IHG/manual-authorize`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'Confirmed account ownership.' }),
  });

  const syncResponse = await fetch(`${baseUrl}/admin/providers/IHG/sync`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const syncJson = await syncResponse.json();
  assert.equal(syncResponse.status, 200);
  assert.equal(syncJson.data.status, 'success');
  assert.equal(syncJson.data.totalHotels, 1);
  assert.equal(syncJson.data.totalPrices, 1);

  const hotelsResponse = await fetch(
    `${baseUrl}/hotels?provider=IHG&city=${encodeURIComponent('北京')}`,
  );
  const hotelsJson = await hotelsResponse.json();
  assert.ok(
    hotelsJson.items.some((hotel) => hotel.name === 'IHG 北京真实测试酒店'),
  );
  const syncedHotel = hotelsJson.items.find(
    (hotel) => hotel.name === 'IHG 北京真实测试酒店',
  );

  const priceResponse = await fetch(
    `${baseUrl}/price?hotelId=${encodeURIComponent(syncedHotel.id)}&date=2026-07-08`,
  );
  const priceJson = await priceResponse.json();
  assert.equal(priceJson.cashPrice, 688);
  assert.equal(priceJson.pointsPrice, 20000);
  assert.equal(priceJson.sourceType, 'official');

  const rankResponse = await fetch(
    `${baseUrl}/rank?provider=IHG&city=${encodeURIComponent('北京')}&date=2026-07-08`,
  );
  const rankJson = await rankResponse.json();
  assert.ok(rankJson.some((hotel) => hotel.hotelName === 'IHG 北京真实测试酒店'));

  const compareResponse = await fetch(
    `${baseUrl}/compare/rank?provider=IHG&city=${encodeURIComponent('北京')}&date=2026-07-08`,
  );
  const compareJson = await compareResponse.json();
  assert.ok(
    compareJson.some(
      (hotel) => hotel.hotelId === syncedHotel.id && hotel.cashPrice === 688,
    ),
  );
});
