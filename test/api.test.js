// APIのテスト（サーバを一時的に起動する）
'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const { app } = require('../server');

let base, server, cookie = '';
async function call(path, opts = {}, retry = 1) {
  // 全獲得のあとは、サーバが足あとを先に計算していて答えが遅れることがある。つながりが切れたら一度だけやり直す
  let res;
  try { res = await fetch(base + path, { method: opts.method || 'GET', headers: Object.assign({ cookie }, opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }); } catch (e) { if (retry > 0) { await new Promise(r => setTimeout(r, 500)); return call(path, opts, retry - 1); } throw e; }
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}
test.before(() => new Promise(r => { server = app.listen(0, '127.0.0.1', () => { server.keepAliveTimeout = 60000; base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => server.close());

test('初めて開くと自動で利用者ができ、ありさと武蔵が一緒にいる', async () => {
  const r = await call('/api/state');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.characters.map(c => c.id).sort(), ['arisa', 'musashi']);
  assert.ok(r.body.homeCharacterIds.includes('arisa') && r.body.homeCharacterIds.includes('musashi'));
  assert.ok(/connect-src 'self'/.test(r.headers.get('content-security-policy')));
});

test('足あとは一か月分あり、今日のタイムラインと過去の日の日記が返る', async () => {
  const r = await call('/api/characters/arisa/journey');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.activeDays.length >= 28, String(r.body.activeDays.length));
  assert.ok(Array.isArray(r.body.items) && r.body.hourlyWeather.length === 24);
  const past = await call('/api/characters/arisa/journey/' + r.body.activeDays[3]);
  assert.ok(past.body.diary && past.body.rings);
});

test('コードで獲得できる。正しくないコードは404、獲得済みは409', async () => {
  assert.strictEqual((await call('/api/redeem', { method: 'POST', body: { code: 'NOPE-0000' } })).status, 404);
  const ok = await call('/api/redeem', { method: 'POST', body: { code: '  mini-nagi-7k2f ' } });
  assert.strictEqual(ok.status, 200); assert.strictEqual(ok.body.character.id, 'nagi');
  assert.strictEqual((await call('/api/redeem', { method: 'POST', body: { code: 'MINI-NAGI-7K2F' } })).status, 409);
  const st = await call('/api/state');
  assert.ok(!st.body.homeCharacterIds.includes('nagi'), '新しく獲得した推しは自動ではホームに並ばない');
});

test('エリアは1つだけ選べ、獲得していないエリアには連れて行けない', async () => {
  assert.strictEqual((await call('/api/characters/nagi/travel', { method: 'PUT', body: { areaId: 'mihara' } })).status, 400);
  const r = await call('/api/characters/nagi/travel', { method: 'PUT', body: { areaId: 'onomichi' } });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.placement, 'onomichi');
  const back = await call('/api/characters/nagi/travel', { method: 'PUT', body: { areaId: null } });
  assert.strictEqual(back.body.placement, null);
});

test('ホームには1人以上が必要で、設定は許可した値だけ受け付ける', async () => {
  assert.strictEqual((await call('/api/home-characters', { method: 'PUT', body: { ids: [] } })).status, 400);
  assert.strictEqual((await call('/api/settings', { method: 'PUT', body: { mapStyle: 'evil' } })).status, 400);
  assert.strictEqual((await call('/api/settings', { method: 'PUT', body: { mapStyle: 'pale' } })).status, 200);
});

test('解釈違いの報告は5〜1000文字で、決まった種類だけ', async () => {
  assert.strictEqual((await call('/api/reports', { method: 'POST', body: { characterId: 'arisa', kind: '性格・人柄', text: 'abc' } })).status, 400);
  assert.strictEqual((await call('/api/reports', { method: 'POST', body: { characterId: 'arisa', kind: 'ちがう', text: 'もう少し静かな子だと思う' } })).status, 400);
  assert.strictEqual((await call('/api/reports', { method: 'POST', body: { characterId: 'arisa', kind: '性格・人柄', text: 'もう少し静かな子だと思う' } })).status, 200);
});

test('プロフィールは決まった項目だけ保存し、メールアドレスは受け付けない', async () => {
  assert.strictEqual((await call('/api/profile', { method: 'PUT', body: { nickname: 'a@b.jp' } })).status, 400);
  const r = await call('/api/profile', { method: 'PUT', body: { nickname: 'たびびと', likes: ['猫', '住所'], walk: 'lots', age: 20 } });
  assert.deepStrictEqual(r.body.profile, { nickname: 'たびびと', likes: ['猫'], walk: 'lots' });
});

test('デモの全獲得と、観光ルートの作成・保存・削除、おすすめ', async () => {
  await call('/api/demo/unlock-all', { method: 'POST', body: {} });
  const st = await call('/api/state');
  assert.strictEqual(st.body.characters.length, 6); assert.strictEqual(st.body.areas.length, 3);
  const r = await call('/api/routes', { method: 'POST', body: { characterId: 'takakage', partner: 'self', areaId: 'mihara', length: 'short' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const list = await call('/api/routes');
  assert.ok(list.body.routes.some(x => x.id === r.body.id));
  assert.strictEqual((await call('/api/routes/' + r.body.id, { method: 'DELETE' })).status, 200);
  const rec = await call('/api/characters/nagi/recommendations');
  assert.strictEqual(rec.status, 200); assert.ok(rec.body.items.length <= 40);
});

test('正しくない入力でも500にならない', async () => {
  const cases = [['GET', '/api/characters/zzz/journey'], ['GET', '/api/characters/arisa/journey/2099-01-01'], ['GET', '/api/places/none'], ['PUT', '/api/characters/arisa/travel', { areaId: 123 }], ['POST', '/api/routes', { characterId: 'x' }], ['GET', '/api/areas/zzz']];
  for (const [m, p, b] of cases) {
    const r = await call(p, { method: m, body: b });
    assert.ok(r.status >= 400 && r.status < 500, `${p} → ${r.status}`);
  }
});

test('ホームの推しの並び順は、送った順のまま保存される', async () => {
  const r = await call('/api/home-characters', { method: 'PUT', body: { ids: ['musashi', 'arisa'] } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual((await call('/api/state')).body.homeCharacterIds, ['musashi', 'arisa']);
  await call('/api/home-characters', { method: 'PUT', body: { ids: ['arisa', 'musashi'] } });
  assert.deepStrictEqual((await call('/api/state')).body.homeCharacterIds, ['arisa', 'musashi']);
});

test('セキュリティ: 正しくない日付で観光ルートを作ってもサーバが止まらない', async () => {
  const t0 = Date.now();
  const r = await call('/api/routes', { method: 'POST', body: { characterId: 'arisa', areaId: 'osaka', to: '9999-99-99', from: '2026-02-31', length: 'short' } });
  assert.ok(r.status < 500, String(r.status));
  assert.ok(Date.now() - t0 < 20000, '時間がかかりすぎる');
  if (r.body && r.body.id) await call('/api/routes/' + r.body.id, { method: 'DELETE' });
});

test('セキュリティ: 別のページからの書きこみと、JSON以外の本文を断る', async () => {
  const send = (headers, body) => fetch(base + '/api/settings', { method: 'PUT', headers: Object.assign({ cookie }, headers), body });
  assert.strictEqual((await send({ 'Sec-Fetch-Site': 'same-site', 'Content-Type': 'application/json' }, '{}')).status, 403);
  assert.strictEqual((await send({ Origin: 'http://localhost:9999', 'Content-Type': 'application/json' }, '{}')).status, 403);
  assert.strictEqual((await send({ 'Content-Type': 'text/plain' }, '{"mapStyle":"photo"}')).status, 415);
  assert.strictEqual((await send({ 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, '{}')).status, 200);
});

test('セキュリティ: __proto__ などの名前を推しとして扱わず、壊れた Cookie でも500にならない', async () => {
  assert.strictEqual((await call('/api/selected-character', { method: 'PUT', body: { id: '__proto__' } })).status, 404);
  assert.strictEqual((await call('/api/home-characters', { method: 'PUT', body: { ids: ['constructor', 'toString'] } })).status, 400);
  const r = await fetch(base + '/api/state', { headers: { cookie: 'mo_sid=%E0%A4%A' } });
  assert.ok(r.status < 500, String(r.status));
});

test('セキュリティ: Cookie のない送信では利用者を作らない（最初に開く /api/state だけで作る）', async () => {
  const r = await fetch(base + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(r.status, 401);
  assert.ok(!r.headers.get('set-cookie'));
});
