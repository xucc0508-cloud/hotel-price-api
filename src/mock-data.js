const GROUPS = ['IHG', 'Marriott', 'Hilton', 'Hyatt', 'Accor'];
const BRANDS = [
  '洲际酒店',
  '万豪酒店',
  '希尔顿酒店',
  '凯悦酒店',
  '雅高酒店',
];
const CITIES = ['上海', '北京', '广州', '杭州', '成都'];

function round(value) {
  return Number(value.toFixed(2));
}

function dateString(value = new Date()) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

function addDays(value, days) {
  const result = new Date(`${dateString(value)}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

const hotels = Array.from({ length: 20 }, (_, index) => {
  const groupIndex = index % GROUPS.length;
  const number = String(index + 1).padStart(3, '0');
  return {
    id: `hotel-${number}`,
    name: `${CITIES[groupIndex]}${BRANDS[groupIndex]} ${number}`,
    group: GROUPS[groupIndex],
    brand: BRANDS[groupIndex],
    city: CITIES[groupIndex],
    address: `${CITIES[groupIndex]}市中心示例路 ${index + 1} 号`,
    starRating: index % 3 === 0 ? 5 : 4,
    score: round(4.9 - (index % 5) * 0.1),
    imageUrl: '',
  };
});

function findHotel(id) {
  return hotels.find((hotel) => hotel.id === id);
}

function priceFor(hotel, date = dateString()) {
  const index = hotels.findIndex((item) => item.id === hotel.id);
  const day = Number(date.replaceAll('-', '')) || 0;
  const cashPrice = 468 + index * 19 + (day % 17) * 6;
  const pointsPrice = 12000 + (index % 8) * 1500;
  const pointValue = round((cashPrice / pointsPrice) * 10000);
  return {
    hotelId: hotel.id,
    date,
    cashPrice,
    pointsPrice,
    pointValue,
    available: true,
    source: 'daily_price',
  };
}

function discoveryItem(hotel, date = dateString()) {
  const price = priceFor(hotel, date);
  const yesterday = priceFor(hotel, dateString(addDays(date, -1)));
  const changeValue = round(price.pointValue - yesterday.pointValue);
  const changeRate = round((changeValue / yesterday.pointValue) * 100);
  return {
    hotelId: hotel.id,
    hotelName: hotel.name,
    group: hotel.group,
    brand: hotel.brand,
    city: hotel.city,
    cashPrice: price.cashPrice,
    pointsPrice: price.pointsPrice,
    pointValue: price.pointValue,
    exchangeScore: Math.max(0, Math.min(100, round(price.pointValue / 5))),
    recommendationText:
      price.pointValue >= 350
        ? '当前积分价值较高，建议优先考虑积分兑换。'
        : '当前价格处于正常区间，建议结合行程灵活选择。',
    changeValue,
    changeRate,
  };
}

function rankedHotel(hotel, date = dateString()) {
  const item = discoveryItem(hotel, date);
  return {
    ...hotel,
    lowestPrice: item.cashPrice,
    pointsPrice: item.pointsPrice,
    valuePer10k: item.pointValue,
    valueChangeRate: item.changeRate,
  };
}

function calendarFor(hotel, startDate = dateString(), days = 30) {
  return Array.from({ length: days }, (_, offset) => {
    const date = dateString(addDays(startDate, offset));
    const price = priceFor(hotel, date);
    const previous = priceFor(hotel, dateString(addDays(date, -1)));
    return {
      date,
      price: price.cashPrice,
      pointsPrice: price.pointsPrice,
      valuePer10k: price.pointValue,
      valueChangeRate: round(
        ((price.pointValue - previous.pointValue) / previous.pointValue) * 100,
      ),
      available: true,
    };
  });
}

function analysisFor(hotel, startDate = dateString(), days = 30) {
  const prices = calendarFor(hotel, startDate, days);
  const values = prices.map((price) => price.valuePer10k);
  const best = prices.reduce((current, item) =>
    item.valuePer10k > current.valuePer10k ? item : current,
  );
  const worst = prices.reduce((current, item) =>
    item.valuePer10k < current.valuePer10k ? item : current,
  );
  const today = prices[0];
  const average = round(
    values.reduce((total, value) => total + value, 0) / values.length,
  );
  return {
    todayPrice: today.price,
    todayPointValue: today.valuePer10k,
    bestDate: best.date,
    bestPointValue: best.valuePer10k,
    worstDate: worst.date,
    worstPointValue: worst.valuePer10k,
    averagePointValue: average,
    improvementRate: round(
      ((best.valuePer10k - today.valuePer10k) / today.valuePer10k) * 100,
    ),
    historyHigh: Math.max(...values),
    historyLow: Math.min(...values),
    historyPosition: round(
      ((today.valuePer10k - Math.min(...values)) /
        Math.max(1, Math.max(...values) - Math.min(...values))) *
        100,
    ),
    exchangeScore: Math.max(
      0,
      Math.min(100, round(today.valuePer10k / 5)),
    ),
    recommendationText:
      today.valuePer10k >= 350
        ? '今日积分价值表现优秀，适合使用积分兑换。'
        : '今日价值处于正常区间，可比较未来日期后再决定。',
  };
}

module.exports = {
  addDays,
  analysisFor,
  calendarFor,
  dateString,
  discoveryItem,
  findHotel,
  hotels,
  priceFor,
  rankedHotel,
  round,
};
