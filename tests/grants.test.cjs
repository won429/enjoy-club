const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../grants.js'), 'utf8');
const load = () => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const at = Date.parse('2026-10-27T03:15:00Z');
const gift = { campaignId: 'member-two-token-gift-v1', status: 'pending', quantityPerMember: 2, price: 123,
  quoteRevision: 12, serverTime: at, recipientKey: 'a'.repeat(64), totalQuantity: 4,
  recipients: [{ uid: 'a', name: '성원제', quantity: 2 }, { uid: 'b', name: '<img src=x>', quantity: 2 }] };
async function setup({ confirm = () => true, fetcher, token } = {}) {
  const elements = new Map(), calls = []; let clock = at;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, textContent: '', children: [], listeners: {},
      classList: { toggle() {} }, append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; }, addEventListener(event, fn) { this.listeners[event] = fn; } });
    return elements.get(id);
  };
  const { mountGrants } = await load();
  const ui = mountGrants({ auth: { idToken: token || (async () => 'test-token') }, apiBase: 'https://api.test',
    document: { getElementById: element, createElement: () => element(Symbol()) }, confirm, now: () => clock,
    fetcher: async (url, options) => { calls.push({ url, options }); return fetcher ? fetcher(url, options) : {
      ok: true, json: async () => options.method === 'GET' ? structuredClone(gift) : { ...structuredClone(gift), status: 'completed', executedAt: at }
    }; } });
  return { ...ui, calls, element, advance: ms => { clock += ms; }, click: id => element('grant-' + id).listeners.click() };
}
test('login and mounting never issue tokens or fetch; signed-out controls cannot call the API', async () => {
  const ui = await setup(); await ui.click('preview'); await ui.click('execute'); assert.equal(ui.calls.length, 0);
  ui.setUser({ uid: 'separate-operator', email: 'operator@example.test' }); assert.equal(ui.calls.length, 0);
  assert.equal(ui.element('member-grants').hidden, false); assert.equal(ui.element('grant-execute').hidden, true);
});
test('preview is read-only and names are text; cancelling confirmation does not write', async () => {
  const ui = await setup({ confirm: () => false }); ui.setUser({ uid: 'a' }); await ui.click('preview');
  assert.equal(ui.calls[0].options.method, 'GET'); assert.equal(ui.element('grant-price').textContent, '123 P');
  assert.equal(ui.element('grant-recipients').children[1].children[0].textContent, '<img src=x>');
  await ui.click('execute'); assert.equal(ui.calls.length, 1); assert.equal(ui.element('grant-execute').disabled, false);
});
test('only explicit confirmation sends the fixed campaign and confirmed quote; completion prevents reissue', async () => {
  const ui = await setup(); ui.setUser({ uid: 'operator' }); await ui.click('preview'); await ui.click('execute');
  assert.equal(ui.calls[1].options.method, 'POST'); assert.equal(ui.calls[1].options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(ui.calls[1].options.body), { campaignId: gift.campaignId, expectedPrice: 123,
    expectedRevision: 12, recipientKey: gift.recipientKey, expiresAt: at + 120000 });
  assert.match(ui.element('grant-status').textContent, /지급 완료/); await ui.click('execute'); assert.equal(ui.calls.length, 2);
});
test('lost write response requires a read before retry; completed result does not issue again', async () => {
  let done = false;
  const ui = await setup({ fetcher: async (_, options) => {
    if (options.method === 'POST') { done = true; throw Error('Response lost'); }
    return { ok: true, json: async () => done ? { ...gift, status: 'completed', executedAt: at } : gift };
  } });
  ui.setUser({ uid: 'a' }); await ui.click('preview'); await ui.click('execute'); await ui.click('execute');
  assert.match(ui.element('grant-status').textContent, /다시 확인/);
  await ui.click('preview'); await ui.click('execute'); assert.equal(ui.calls.filter(c => c.options.method === 'POST').length, 1);
});
test('signout during token loading, response or confirmation discards old work and cannot post for the next user', async () => {
  let resolveToken;
  const first = await setup({ token: () => new Promise(r => { resolveToken = r; }) }); first.setUser({ uid: 'a' });
  const pending = first.click('preview'); first.setUser(null); resolveToken('old-token'); await pending;
  assert.equal(first.calls.length, 0); assert.equal(first.element('member-grants').hidden, true);
  let resolveResponse;
  const second = await setup({ fetcher: () => new Promise(r => { resolveResponse = r; }) }); second.setUser({ uid: 'a' });
  const response = second.click('preview'); await new Promise(setImmediate); second.setUser({ uid: 'b' });
  resolveResponse({ ok: true, json: async () => gift }); await response;
  assert.equal(second.element('grant-details').hidden, true);
  let resolveConfirm;
  const third = await setup({ confirm: () => new Promise(r => { resolveConfirm = r; }) }); third.setUser({ uid: 'a' });
  await third.click('preview'); const confirmed = third.click('execute'); third.setUser({ uid: 'b' });
  resolveConfirm(true); await confirmed; assert.equal(third.calls.length, 1);
});
test('expired or invalid previews never issue and require fresh confirmation', async () => {
  const ui = await setup(); ui.setUser({ uid: 'a' }); await ui.click('preview'); ui.advance(61000); await ui.click('execute');
  assert.equal(ui.calls.length, 1); assert.equal(ui.element('grant-execute').hidden, true);
  const invalid = await setup({ fetcher: async () => ({ ok: true, json: async () => ({ ...gift, quantityPerMember: 3 }) }) });
  invalid.setUser({ uid: 'a' }); await invalid.click('preview'); await invalid.click('execute');
  assert.equal(invalid.calls.length, 1); assert.equal(invalid.element('grant-details').hidden, true);
});
