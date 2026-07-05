const assert = require('node:assert/strict');
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

test('city search supports all required cities and Chinese fuzzy matching', async () => {
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
