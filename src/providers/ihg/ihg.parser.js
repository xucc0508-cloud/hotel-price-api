const IHG_PROVIDER = 'IHG';

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeHotelKey(value) {
  return compactText(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

function parseCashPrice(text) {
  const normalized = compactText(text);
  const match = normalized.match(
    /(?:Only a few left from|From)\s+([\d,]+(?:\.\d+)?)\s+([A-Z]{3})\b/i,
  );
  if (!match) return { cashPrice: 0, currency: 'USD' };
  return {
    cashPrice: Number(match[1].replace(/,/g, '')) || 0,
    currency: match[2].toUpperCase(),
  };
}

function parsePointsPrice(text) {
  const normalized = compactText(text);
  const match = normalized.match(
    /(?:Only a few left from|From)?\s*([\d,]+)\s+PTS\b/i,
  );
  return match ? Number(match[1].replace(/,/g, '')) || 0 : 0;
}

function parseAvailability(text) {
  const normalized = compactText(text).toLowerCase();
  if (/not available|sold out|unavailable/.test(normalized)) return 'unavailable';
  if (/only a few left/.test(normalized)) return 'limited';
  if (/from\s+[\d,]+/.test(normalized)) return 'available';
  return 'unknown';
}

function inferBrand(hotelName, cardText) {
  const source = `${hotelName} ${cardText}`.toLowerCase();
  const brands = [
    ['Regent', 'regent'],
    ['InterContinental', 'intercontinental'],
    ['Kimpton', 'kimpton'],
    ['Hotel Indigo', 'hotel indigo'],
    ['voco', 'voco'],
    ['Crowne Plaza', 'crowne plaza'],
    ['Holiday Inn Express', 'holiday inn express'],
    ['Holiday Inn', 'holiday inn'],
    ['Staybridge Suites', 'staybridge'],
    ['Candlewood Suites', 'candlewood'],
    ['avid', 'avid'],
    ['Atwell Suites', 'atwell'],
    ['Garner', 'garner'],
    ['IHG', 'ihg'],
  ];
  return brands.find(([, needle]) => source.includes(needle))?.[0] || 'IHG';
}

function parseHotelCard(card, options = {}) {
  const cardText = compactText(card.text);
  const hotelName = compactText(card.hotelName);
  if (!hotelName) return null;
  const address = compactText(card.address);
  const providerHotelId =
    card.providerHotelId ||
    normalizeHotelKey(`${hotelName}-${address || options.city || 'unknown'}`);
  const cash = parseCashPrice(cardText);
  const pointsPrice = parsePointsPrice(cardText);
  return {
    provider: IHG_PROVIDER,
    providerHotelId,
    hotelName,
    brand: inferBrand(hotelName, cardText),
    city: options.city || compactText(card.city),
    address,
    country: options.country || 'CN',
    cashPrice: cash.cashPrice,
    pointsPrice,
    currency: cash.currency,
    availability: parseAvailability(cardText),
    rawPayload: {
      source: 'ihg_dom_card',
      text: cardText.slice(0, 1200),
      href: card.href || null,
    },
  };
}

function mergeCashAndPoints(cashCards, pointsCards) {
  const byKey = new Map();
  for (const card of cashCards) {
    const key = card.providerHotelId || normalizeHotelKey(card.hotelName);
    byKey.set(key, { ...card });
  }
  for (const card of pointsCards) {
    const key = card.providerHotelId || normalizeHotelKey(card.hotelName);
    const current = byKey.get(key) || { ...card, cashPrice: 0 };
    byKey.set(key, {
      ...current,
      pointsPrice: card.pointsPrice || current.pointsPrice || 0,
      availability:
        card.availability === 'available' || card.availability === 'limited'
          ? card.availability
          : current.availability,
      rawPayload: {
        ...(current.rawPayload || {}),
        rewardText: card.rawPayload?.text,
      },
    });
  }
  return Array.from(byKey.values()).filter(
    (card) => card.hotelName && (card.cashPrice > 0 || card.pointsPrice > 0),
  );
}

module.exports = {
  compactText,
  mergeCashAndPoints,
  normalizeHotelKey,
  parseCashPrice,
  parseHotelCard,
  parsePointsPrice,
};
