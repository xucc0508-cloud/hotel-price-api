const { fetchIhgRealData } = require('../../ihg-real-provider');
const { requireAuthorizedStorageState } = require('./ihg.session');
const { scrapeIhgAvailability } = require('./ihg.scraper');

function hasConfiguredSource() {
  return Boolean(process.env.IHG_SYNC_SOURCE_URL || process.env.IHG_SYNC_SOURCE_FILE);
}

function createIhgAdapter({ decryptCredential }) {
  return {
    provider: 'IHG',

    async login() {
      return {
        provider: 'IHG',
        status: 'manual_action_required',
        message:
          'Open the official IHG login page and complete username, password, CAPTCHA or MFA manually.',
      };
    },

    async saveSession(storageState) {
      if (!storageState || !Array.isArray(storageState.cookies)) {
        throw Object.assign(new Error('Invalid Playwright storageState.'), {
          code: 'INVALID_PLAYWRIGHT_STORAGE_STATE',
        });
      }
      return {
        provider: 'IHG',
        status: 'session_authorized',
        cookieCount: storageState.cookies.length,
      };
    },

    async testConnection(account) {
      const storageState = requireAuthorizedStorageState(account, decryptCredential);
      return {
        provider: 'IHG',
        connected: true,
        status: 'session_authorized',
        cookieCount: storageState.cookies.length,
        mode: hasConfiguredSource() ? 'configured_source' : 'playwright_session',
      };
    },

    async fetchHotels(account, options = {}) {
      const result = await this.fetchAvailability(account, options);
      return result.hotels;
    },

    async fetchAvailability(account, options = {}) {
      if (hasConfiguredSource()) {
        return fetchIhgRealData(options);
      }
      const storageState = requireAuthorizedStorageState(account, decryptCredential);
      return scrapeIhgAvailability({
        storageState,
        days: options.days,
        startDate: options.startDate,
        cities: options.cities,
      });
    },

    async fetchPrices(account, options = {}) {
      const result = await this.fetchAvailability(account, options);
      return result.prices;
    },
  };
}

module.exports = {
  createIhgAdapter,
};
