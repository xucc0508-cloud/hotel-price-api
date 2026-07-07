const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, test } = require('node:test');
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
