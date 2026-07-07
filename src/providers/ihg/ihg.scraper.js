const { mergeCashAndPoints, parseHotelCard } = require('./ihg.parser');

const DEFAULT_CITY_DESTINATIONS = {
  北京: 'Beijing, China',
  上海: 'Shanghai, China',
  广州: 'Guangzhou, China',
  深圳: 'Shenzhen, China',
  杭州: 'Hangzhou, China',
  成都: 'Chengdu, China',
};

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function ihgMonthYear(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return `${String(parsed.getUTCMonth()).padStart(2, '0')}${parsed.getUTCFullYear()}`;
}

function ihgDay(date) {
  return String(new Date(`${date}T00:00:00.000Z`).getUTCDate()).padStart(2, '0');
}

function buildSearchUrl({ destination, checkinDate, checkoutDate, reward }) {
  const params = new URLSearchParams({
    qDest: destination,
    qCiD: ihgDay(checkinDate),
    qCiMy: ihgMonthYear(checkinDate),
    qCoD: ihgDay(checkoutDate),
    qCoMy: ihgMonthYear(checkoutDate),
    qAdlt: '1',
    qChld: '0',
    qRms: '1',
    qRtP: reward ? 'IVANI' : '6CBARC',
    qAAR: reward ? 'IVANI' : '6CBARC',
    qSlH: '',
    qRad: '100',
    qRdU: 'km',
  });
  return `https://www.ihg.com/hotels/us/en/find-hotels/hotel/list?${params.toString()}`;
}

function parseSyncCities(value) {
  const raw = String(value || '北京')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return raw.map((city) => ({
    city,
    destination: DEFAULT_CITY_DESTINATIONS[city] || city,
  }));
}

function requirePlaywright() {
  try {
    return require('playwright');
  } catch (error) {
    throw Object.assign(
      new Error('Playwright is not installed. Run pnpm install and ensure playwright is available.'),
      { code: 'PLAYWRIGHT_NOT_INSTALLED' },
    );
  }
}

function assertStorageState(storageState) {
  if (!storageState || !Array.isArray(storageState.cookies) || storageState.cookies.length === 0) {
    throw Object.assign(new Error('IHG Playwright session is missing cookies.'), {
      code: 'IHG_SESSION_EMPTY',
    });
  }
}

async function autoScroll(page) {
  for (let index = 0; index < 6; index += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(600, window.innerHeight || 600)));
    await page.waitForTimeout(350);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function extractCardsFromPage(page, city) {
  const cards = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="hotel-card"]')).map((card) => {
      const nameElement =
        card.querySelector('[data-testid="brandHotelNameSID"]') ||
        card.querySelector('.hotel-name') ||
        card.querySelector('h2');
      const addressElement =
        card.querySelector('[data-testid="hotelAddress"]') ||
        card.querySelector('app-hotel-contact-info');
      const link = card.querySelector('a[href*="/hotels/"]');
      return {
        hotelName: nameElement?.textContent || '',
        address: addressElement?.textContent || '',
        href: link?.href || '',
        text: card.textContent || '',
      };
    }),
  );
  return cards.map((card) => parseHotelCard(card, { city })).filter(Boolean);
}

async function scrapeSearchPage(page, params) {
  const url = buildSearchUrl(params);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(Number(process.env.IHG_PAGE_WAIT_MS || 6000));
  const bodyText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
  if (/verify you are human|access denied|captcha|akamai|security check/i.test(bodyText)) {
    throw Object.assign(
      new Error('IHG security verification is required. Complete CAPTCHA/MFA manually and save a fresh session.'),
      { code: 'IHG_SECURITY_VERIFICATION_REQUIRED' },
    );
  }
  if (/sign in|log in/i.test(bodyText) && !/sign out/i.test(bodyText)) {
    throw Object.assign(
      new Error('IHG session is not authorized or has expired. Re-authorize manually.'),
      { code: 'IHG_SESSION_EXPIRED' },
    );
  }
  await autoScroll(page);
  const cards = await extractCardsFromPage(page, params.city);
  if (cards.length === 0) {
    throw Object.assign(new Error(`No IHG hotels were visible for ${params.city}.`), {
      code: 'IHG_NO_VISIBLE_HOTELS',
    });
  }
  return cards;
}

async function scrapeIhgAvailability({ storageState, days = 90, cities, startDate } = {}) {
  assertStorageState(storageState);
  const { chromium } = requirePlaywright();
  const browser = await chromium.launch({
    headless: process.env.IHG_PLAYWRIGHT_HEADLESS !== 'false',
  });
  const context = await browser.newContext({
    storageState,
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
  });
  const page = await context.newPage();
  const fetchedAt = new Date().toISOString();
  const hotelMap = new Map();
  const prices = [];
  const requestedCities = cities?.length ? cities : parseSyncCities(process.env.IHG_SYNC_CITIES);
  const syncStartDate = startDate || process.env.IHG_SYNC_START_DATE || todayInShanghai();
  const maxDays = Math.max(1, Math.min(365, Number(days) || 90));
  const delayMs = Math.max(0, Number(process.env.IHG_SYNC_DELAY_MS || 800));

  try {
    for (const cityEntry of requestedCities) {
      for (let offset = 0; offset < maxDays; offset += 1) {
        const checkinDate = addDays(syncStartDate, offset);
        const checkoutDate = addDays(checkinDate, 1);
        const baseParams = {
          city: cityEntry.city,
          destination: cityEntry.destination,
          checkinDate,
          checkoutDate,
        };
        const cashCards = await scrapeSearchPage(page, { ...baseParams, reward: false });
        const pointsCards = await scrapeSearchPage(page, { ...baseParams, reward: true }).catch((error) => {
          if (
            [
              'IHG_SECURITY_VERIFICATION_REQUIRED',
              'IHG_SESSION_EXPIRED',
              'IHG_NO_VISIBLE_HOTELS',
            ].includes(error.code)
          ) {
            throw error;
          }
          return [];
        });
        for (const item of mergeCashAndPoints(cashCards, pointsCards)) {
          hotelMap.set(item.providerHotelId, {
            provider: 'IHG',
            providerHotelId: item.providerHotelId,
            hotelName: item.hotelName,
            brand: item.brand,
            city: item.city,
            address: item.address,
            country: item.country,
            rawPayload: item.rawPayload,
            lastSeenAt: fetchedAt,
          });
          prices.push({
            provider: 'IHG',
            providerHotelId: item.providerHotelId,
            hotelName: item.hotelName,
            city: item.city,
            checkinDate,
            checkoutDate,
            cashPrice: item.cashPrice,
            pointsPrice: item.pointsPrice,
            currency: item.currency,
            availability: item.availability,
            fetchedAt,
            sourceType: item.pointsPrice > 0 ? 'session' : 'session_cash_only',
            rawPayload: item.rawPayload,
          });
        }
        if (delayMs) await page.waitForTimeout(delayMs);
      }
    }
  } finally {
    await browser.close();
  }

  if (hotelMap.size === 0 || prices.length === 0) {
    throw Object.assign(new Error('IHG scraper completed but returned no real hotel prices.'), {
      code: 'IHG_NO_REAL_PRICE_DATA',
    });
  }
  return {
    hotels: Array.from(hotelMap.values()),
    prices,
    warnings: prices.some((price) => price.pointsPrice <= 0)
      ? ['Some IHG reward-night point prices were unavailable and were not estimated.']
      : [],
  };
}

module.exports = {
  buildSearchUrl,
  parseSyncCities,
  scrapeIhgAvailability,
};
