const test = require('node:test');
const assert = require('node:assert/strict');

const { providerActionModel } = require('../src/admin-provider-actions');

function actionKeys(provider, connectionStatus) {
  return providerActionModel({ provider, connectionStatus }).actions.map(
    (action) => action.key,
  );
}

test('IHG without a saved session only offers authorization and logs', () => {
  assert.deepEqual(actionKeys('IHG', 'expired'), ['authorize', 'logs']);
  assert.deepEqual(actionKeys('IHG', 'disabled'), ['authorize', 'logs']);
  assert.deepEqual(actionKeys('IHG', 'manual_authorized'), [
    'authorize',
    'logs',
  ]);
});

test('IHG remote authorization only offers continue, stop and logs', () => {
  assert.deepEqual(actionKeys('IHG', 'remote_authorization_running'), [
    'continueAuthorization',
    'stopAuthorization',
    'logs',
  ]);
});

test('IHG saved session only offers connection test, real sync and logs', () => {
  const result = providerActionModel({
    provider: 'IHG',
    connectionStatus: 'session_authorized',
  });
  assert.deepEqual(
    result.actions.map((action) => action.key),
    ['test', 'sync', 'logs'],
  );
  assert.match(result.notice, /Session 已保存/);
  assert.equal(result.actions.find((action) => action.key === 'sync').label, '同步90天价格');
});

test('active IHG only offers connection test, resync and logs', () => {
  const result = providerActionModel({
    provider: 'IHG',
    connectionStatus: 'active',
  });
  assert.deepEqual(
    result.actions.map((action) => action.key),
    ['test', 'sync', 'logs'],
  );
  assert.equal(
    result.actions.find((action) => action.key === 'sync').label,
    '重新同步90天价格',
  );
});

test('providers without a real adapter expose logs without fake actions', () => {
  for (const provider of ['Marriott', 'Hilton', 'Hyatt', 'Accor']) {
    const result = providerActionModel({
      provider,
      connectionStatus: 'manual_authorized',
    });
    assert.deepEqual(result.actions.map((action) => action.key), ['logs']);
    assert.match(result.notice, /暂未接入真实同步/);
  }
});
