function requireAuthorizedStorageState(account, decryptCredential) {
  if (!account) {
    throw Object.assign(new Error('IHG provider account is not configured.'), {
      code: 'IHG_ACCOUNT_NOT_CONFIGURED',
    });
  }
  if (!account.encryptedSession) {
    throw Object.assign(new Error('IHG Playwright session is not saved.'), {
      code: 'IHG_SESSION_NOT_SAVED',
    });
  }
  const payload = decryptCredential(account.encryptedSession);
  const storageState = payload?.storageState;
  if (!storageState || !Array.isArray(storageState.cookies) || storageState.cookies.length === 0) {
    throw Object.assign(new Error('IHG Playwright session is empty or invalid.'), {
      code: 'IHG_SESSION_INVALID',
    });
  }
  return storageState;
}

module.exports = {
  requireAuthorizedStorageState,
};
