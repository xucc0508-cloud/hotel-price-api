const express = require('express');
const {
  analysisFor,
  calendarFor,
  dateString,
  discoveryItem,
  findHotel,
  hotels,
  priceFor,
  rankedHotel,
  round,
} = require('./mock-data');

const app = express();

app.disable('x-powered-by');
app.use(express.json());

function requestedDate(request) {
  return request.query.date || request.query.checkinDate || dateString();
}

function resolveHotel(request, response) {
  const hotel = findHotel(request.params.id);
  if (!hotel) {
    response.status(404).json({ error: 'Hotel not found' });
    return null;
  }
  return hotel;
}

function discoveryRanking(request) {
  return hotels.map((hotel) => discoveryItem(hotel, requestedDate(request)));
}

app.get('/', (_request, response) => {
  response.json({ service: 'hotel-price-api', status: 'running' });
});

app.get('/health', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    backend: 'ok',
    api: 'ok',
    db: 'ok',
    latency: '0ms',
    timestamp: new Date().toISOString(),
  });
});

app.get('/hotels', (request, response) => {
  const page = Math.max(1, Number(request.query.page) || 1);
  const pageSize = Math.max(
    1,
    Math.min(100, Number(request.query.pageSize) || 20),
  );
  const keyword = String(request.query.keyword || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
  const filtered = keyword
    ? hotels.filter((hotel) =>
        [
          hotel.name,
          hotel.group,
          hotel.brand,
          hotel.city,
        ].some((value) =>
          value.normalize('NFKC').toLowerCase().includes(keyword),
        ),
      )
    : hotels;
  const start = (page - 1) * pageSize;
  response.status(200).json({
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
  });
});

function sendHotelDetail(request, response) {
  const hotel = resolveHotel(request, response);
  if (!hotel) return;
  const analysis = analysisFor(hotel);
  const sameCityRecommendations = hotels
    .filter((item) => item.city === hotel.city && item.id !== hotel.id)
    .map((item) => rankedHotel(item))
    .slice(0, 5);
  response.status(200).json({
    ...hotel,
    redemptionDecision: {
      todayValuePer10k: analysis.todayPointValue,
      next30DaysMaxValuePer10k: analysis.bestPointValue,
      bestRedemptionDate: analysis.bestDate,
      averageValuePer10k: analysis.averagePointValue,
      upsidePercent: analysis.improvementRate,
      recommendationReason: analysis.recommendationText,
    },
    sameCityRecommendations,
  });
}

app.get('/hotels/:id', sendHotelDetail);
app.get('/hotel/:id', sendHotelDetail);

app.get('/price', (request, response) => {
  const hotel = findHotel(String(request.query.hotelId || '')) || hotels[0];
  response.status(200).json(priceFor(hotel, requestedDate(request)));
});

app.get('/hotel/:id/analysis', (request, response) => {
  const hotel = resolveHotel(request, response);
  if (!hotel) return;
  const days = Math.max(1, Math.min(365, Number(request.query.days) || 30));
  response
    .status(200)
    .json(analysisFor(hotel, requestedDate(request), days));
});

app.get('/hotel/:id/decision', (request, response) => {
  const hotel = resolveHotel(request, response);
  if (!hotel) return;
  const date = requestedDate(request);
  const analysis = analysisFor(hotel, date);
  const usePoints = analysis.todayPointValue >= 350;
  response.status(200).json({
    hotelId: hotel.id,
    date,
    decision: {
      action: usePoints ? 'use points' : 'book now',
      confidence: usePoints ? 86 : 72,
      reason: usePoints
        ? '当前积分价值较高，积分兑换更具优势。'
        : '当前现金价格平稳，可结合行程及时预订。',
    },
    riskWarning: '价格为安全演示数据，实际预订请以酒店渠道为准。',
    currentPrice: analysis.todayPrice,
    predictedPrice: round(analysis.todayPrice * 1.03),
    predictedChangeRate: 3,
  });
});

app.get('/hotel/:id/calendar', (request, response) => {
  const hotel = resolveHotel(request, response);
  if (!hotel) return;
  const startDate = request.query.startDate || requestedDate(request);
  const endDate = request.query.endDate;
  const days = endDate
    ? Math.max(
        1,
        Math.min(
          365,
          Math.round(
            (new Date(`${endDate}T00:00:00Z`) -
              new Date(`${startDate}T00:00:00Z`)) /
              86400000,
          ) + 1,
        ),
      )
    : 30;
  response.status(200).json({
    hotelId: hotel.id,
    prices: calendarFor(hotel, startDate, days),
  });
});

app.get('/rank', (request, response) => {
  const metric = String(request.query.metric || 'pointsValue');
  const limit = Math.max(1, Math.min(100, Number(request.query.limit) || 20));
  const ranked = hotels.map((hotel) =>
    rankedHotel(hotel, requestedDate(request)),
  );
  ranked.sort((left, right) =>
    metric === 'cashLowest'
      ? left.lowestPrice - right.lowestPrice
      : right.valuePer10k - left.valuePer10k,
  );
  response.status(200).json(ranked.slice(0, limit));
});

app.get(
  [
    '/rank/today-best',
    '/rank/today-recommended',
    '/rank/cash-best',
    '/rank/rising',
    '/rank/falling',
  ],
  (request, response) => {
    const ranked = discoveryRanking(request);
    if (request.path === '/rank/cash-best') {
      ranked.sort((left, right) => left.cashPrice - right.cashPrice);
    } else if (request.path === '/rank/falling') {
      ranked.sort((left, right) => left.changeRate - right.changeRate);
    } else if (request.path === '/rank/rising') {
      ranked.sort((left, right) => right.changeRate - left.changeRate);
    } else {
      ranked.sort((left, right) => right.pointValue - left.pointValue);
    }
    const limit = request.path.includes('today') ? 10 : 20;
    response.status(200).json(ranked.slice(0, limit));
  },
);

app.get('/city/:city/recommendations', (request, response) => {
  const excludeHotelId = request.query.excludeHotelId;
  const ranked = hotels
    .filter(
      (hotel) =>
        hotel.city === request.params.city && hotel.id !== excludeHotelId,
    )
    .map((hotel) => discoveryItem(hotel, requestedDate(request)))
    .sort((left, right) => right.pointValue - left.pointValue)
    .slice(0, 5);
  response.status(200).json(ranked);
});

app.get('/compare/rank', (request, response) => {
  const hotelIds = String(request.query.hotelIds || '')
    .split(',')
    .filter(Boolean);
  const selected = hotelIds.length
    ? hotels.filter((hotel) => hotelIds.includes(hotel.id))
    : hotels;
  const ranked = selected
    .map((hotel) => {
      const price = priceFor(hotel, requestedDate(request));
      return {
        hotelId: hotel.id,
        group: hotel.group,
        cashPrice: price.cashPrice,
        pointsPrice: price.pointsPrice,
        valueScore: Math.max(
          0,
          Math.min(100, round(price.pointValue / 5)),
        ),
        rank: 0,
        recommendation:
          price.pointValue >= 350
            ? '积分兑换价值较高。'
            : '建议比较现金与积分成本。',
      };
    })
    .sort((left, right) => right.valueScore - left.valueScore)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const limit = Math.max(1, Math.min(200, Number(request.query.limit) || 20));
  response.status(200).json(ranked.slice(0, limit));
});

app.use((_request, response) => {
  response.status(404).json({ error: 'Not Found' });
});

module.exports = app;
