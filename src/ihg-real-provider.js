const fs = require('fs');

function nowIso() {
  return new Date().toISOString();
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function todayForSync() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.IHG_SYNC_TIME_ZONE || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shouldIncludePrice(price, options = {}) {
  const days = Number(options.days || 0);
  if (!days || !price.checkinDate) return true;
  const startDate =
    options.startDate ||
    process.env.IHG_SYNC_START_DATE ||
    todayForSync();
  const endDate = addDays(startDate, days);
  return price.checkinDate >= startDate && price.checkinDate < endDate;
}

function normalizePayload(payload, options = {}) {
  const hotels = Array.isArray(payload?.hotels) ? payload.hotels : [];
  const prices = Array.isArray(payload?.prices) ? payload.prices : [];
  return {
    hotels: hotels.map((hotel) => ({
      provider: 'IHG',
      providerHotelId: String(hotel.providerHotelId || hotel.hotelId || ''),
      hotelName: String(hotel.hotelName || hotel.name || ''),
      brand: String(hotel.brand || 'IHG'),
      city: String(hotel.city || ''),
      address: String(hotel.address || ''),
      country: String(hotel.country || 'CN'),
      rawPayload: hotel,
      lastSeenAt: nowIso(),
    })).filter((hotel) => hotel.providerHotelId && hotel.hotelName),
    prices: prices.map((price) => ({
      provider: 'IHG',
      providerHotelId: String(price.providerHotelId || price.hotelId || ''),
      hotelName: String(price.hotelName || price.name || ''),
      city: String(price.city || ''),
      checkinDate: String(price.checkinDate || ''),
      checkoutDate: String(price.checkoutDate || ''),
      cashPrice: Number(price.cashPrice) || 0,
      pointsPrice: Number(price.pointsPrice) || 0,
      currency: String(price.currency || 'CNY'),
      availability: String(price.availability || 'unknown'),
      fetchedAt: nowIso(),
      sourceType: String(price.sourceType || 'official'),
      rawPayload: price,
    })).filter(
      (price) =>
        price.providerHotelId &&
        price.checkinDate &&
        shouldIncludePrice(price, options),
    ),
  };
}

async function fetchJsonFromUrl(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(process.env.IHG_SYNC_API_KEY
        ? { Authorization: `Bearer ${process.env.IHG_SYNC_API_KEY}` }
        : {}),
    },
  });
  if (!response.ok) {
    throw Object.assign(new Error(`IHG source HTTP ${response.status}`), {
      code: 'IHG_SOURCE_HTTP_ERROR',
    });
  }
  return response.json();
}

async function fetchIhgRealData(options = {}) {
  if (process.env.IHG_SYNC_SOURCE_URL) {
    return normalizePayload(await fetchJsonFromUrl(process.env.IHG_SYNC_SOURCE_URL), options);
  }
  if (process.env.IHG_SYNC_SOURCE_FILE) {
    const payload = JSON.parse(fs.readFileSync(process.env.IHG_SYNC_SOURCE_FILE, 'utf8'));
    return normalizePayload(payload, options);
  }
  throw Object.assign(
    new Error('IHG real sync source is not configured'),
    { code: 'IHG_REAL_SOURCE_NOT_CONFIGURED' },
  );
}

module.exports = {
  fetchIhgRealData,
};
