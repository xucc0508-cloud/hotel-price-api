const {
  createIhgPlaywrightAuthorization,
  validateStorageState,
} = require('../../ihg-playwright-provider');

function createLoginTask(options) {
  return createIhgPlaywrightAuthorization(options);
}

function validateSessionPayload(storageState) {
  return validateStorageState(storageState);
}

module.exports = {
  createLoginTask,
  validateSessionPayload,
};
