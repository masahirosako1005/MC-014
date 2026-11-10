// 自治体の管理画面のテスト（担当の範囲、申請と承認、獲得コードとQRコード）
'use strict';
require('./helpers');
process.env.ORG_PORT = '0';
const test = require('node:test');
const assert = require('node:assert');
const content = require('../lib/content');
const store = require('../lib/store');
const cal = require('../lib/calendar');
const router = require('../lib/router').load(content.get());
const { createSimulator } = require('../lib/simulator');
const sim = createSimulator({ content, router, calendar: cal.create(content) });
const orgs = require('../lib/orgs').create();

let base, server, cookie = '';
async function call(path, opts = {}) {
  const res = await fetch(base + path, { method: opts.method || 'GET', headers: Object.assign({ cookie }, opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), type };
}
test.before(() => new Promise(r => { server = require('../admin/org-server').start({ content, store, sim, orgs }); server.on('listening', () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => server.close());

test('ログインしないと使えず、デモのアカウントでログインできる', async () => {
  assert.strictEqual((await call('/org/api/me')).status, 401);
  assert.strictEqual((await call('/org/api/login', { method: 'POST', body: { loginId: 'mihara-city', password: 'wrong-password' } })).status, 401);
  assert.strictEqual((await call('/org/api/login', { method: 'POST', body: { loginId: 'mihara-city', password: 'mihara-demo-2026' } })).status, 200);
  const me = await call('/org/api/me');
  assert.deepStrictEqual(me.body.areas, ['mihara']); assert.deepStrictEqual(me.body.characters, ['takakage']);
});

test('担当のキャラクターとエリアのものだけが見え、ほかは扱えない', async () => {
  const chars = await call('/org/api/characters');
  assert.deepStrictEqual(chars.body.characters.map(c => c.id), ['takakage']);
  const codes = await call('/org/api/codes');
  assert.ok(codes.body.every(c => (c.type === 'character' && c.id === 'takakage') || (c.type === 'area' && c.id === 'mihara')));
  assert.strictEqual((await call('/org/api/codes', { method: 'POST', body: { type: 'character', id: 'arisa' } })).status, 400);
  assert.strictEqual((await call('/org/api/codes/MINI-RUI-5P6L', { method: 'PUT', body: { enabled: false } })).status, 404);
  assert.strictEqual((await call('/org/api/characters/arisa/requests', { method: 'POST', body: { character: { tagline: 'x' } } })).status, 404);
  assert.strictEqual((await call('/org/api/events', { method: 'POST', body: { title: 'x', area: 'osaka', start: '2026-12-01', end: '2026-12-01' } })).status, 400);
  assert.strictEqual((await call('/org/api/places/utsubo-park', { method: 'PUT', body: { desc: 'x' } })).status, 404);
});

test('コードを発行し、QRコードの画像をダウンロードできる', async () => {
  const r = await call('/org/api/codes', { method: 'POST', body: { type: 'character', id: 'takakage', place: '三原駅 観光案内所' } });
  assert.strictEqual(r.status, 200); assert.ok(/^MINI-TAKAKAGE-[0-9A-F]{4}$/.test(r.body.code));
  const png = await call(`/org/api/codes/${r.body.code}/qr.png?download=1`);
  assert.strictEqual(png.status, 200); assert.ok(png.type.includes('image/png'));
  assert.strictEqual(png.body.slice(1, 4).toString(), 'PNG');
  assert.ok(content.get().CODES.some(c => c.code === r.body.code && c.place === '三原駅 観光案内所'));
});

test('キャラクターの変更は申請になり、事務局が承認するまで反映されない', async () => {
  const before = content.get().charById.get('takakage').tagline;
  assert.strictEqual((await call('/org/api/characters/takakage/requests', { method: 'POST', body: { character: { tagline: 'あ'.repeat(41) } } })).status, 400);
  const r = await call('/org/api/characters/takakage/requests', { method: 'POST', body: { character: { tagline: '海と城を守る知将', look: { color: '#334455' } }, canon: { likes: ['城跡', '潮の流れ', '三原のたこ'] }, note: 'テスト' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(content.get().charById.get('takakage').tagline, before, '承認前は変わらない');
  const done = orgs.review(r.body.request.id, 'approved', 'OK', content);
  assert.ok(!done.error, done.error);
  const c = content.get().charById.get('takakage');
  assert.strictEqual(c.tagline, '海と城を守る知将');
  assert.strictEqual(c.look.color, '#334455'); assert.ok(c.look.portrait, 'ほかの見た目は残る');
  assert.deepStrictEqual(content.get().CANON.takakage.likes, ['城跡', '潮の流れ', '三原のたこ']);
  assert.ok(content.get().CANON.takakage.routine, '申請していない公式設定は残る');
  assert.ok(orgs.review(r.body.request.id, 'approved', '', content).error, '二重に承認できない');
});

test('絵は画像の形式を確かめて受け取り、ほかの場所の画像は指定できない', async () => {
  const png = 'data:image/png;base64,' + (await require('../lib/assets').qrPng('X', 200)).toString('base64');
  const up = await call('/org/api/characters/takakage/image', { method: 'POST', body: { data: png } });
  assert.strictEqual(up.status, 200); assert.ok(/^assets\/uploads\/takakage-[0-9a-f]+\.png$/.test(up.body.path));
  assert.strictEqual((await call('/org/api/characters/takakage/image', { method: 'POST', body: { data: 'data:image/png;base64,' + Buffer.from('not an image').toString('base64') } })).status, 400);
  assert.strictEqual((await call('/org/api/characters/takakage/requests', { method: 'POST', body: { character: { look: { image: '../../server.js' } } } })).status, 400);
  assert.strictEqual((await call('/org/api/characters/takakage/requests', { method: 'POST', body: { character: { look: { image: up.body.path } } } })).status, 200);
});

test('事務局が利用停止にすると、自治体はログインできない', async () => {
  orgs.update('mihara', { disabled: true });
  assert.strictEqual((await call('/org/api/me')).status, 401);
  assert.strictEqual((await call('/org/api/login', { method: 'POST', body: { loginId: 'mihara-city', password: 'mihara-demo-2026' } })).status, 401);
  orgs.update('mihara', { disabled: false });
});

test('推しの説明の文章から、パラメータとNG行動が提案される（ダミーのAI）', async () => {
  await call('/org/api/login', { method: 'POST', body: { loginId: 'mihara-city', password: 'mihara-demo-2026' } });
  assert.strictEqual((await call('/org/api/characters/takakage/suggest', { method: 'POST', body: { text: 'abc' } })).status, 400);
  const r = await call('/org/api/characters/takakage/suggest', { method: 'POST', body: { text: 'のんびり屋で甘いものが大好き。お酒の店には絶対に入らない。夜は出歩かない。図書館には絶対に行かない。' } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.interests.sweets >= 0.8); assert.ok(r.body.speed < 60);
  assert.ok(r.body.ng.words.includes('居酒屋')); assert.strictEqual(r.body.ng.quietAfter, 18); assert.ok(r.body.ng.cats.includes('library'));
  assert.ok(r.body.reasons.length >= 3);
});

test('行動の数値とNG行動は、決まった範囲だけ申請できる', async () => {
  assert.strictEqual((await call('/org/api/characters/takakage/requests', { method: 'POST', body: { character: { speed: 300 } } })).status, 400);
  assert.strictEqual((await call('/org/api/characters/takakage/requests', { method: 'POST', body: { character: { ng: { cats: ['home'], words: [], quietAfter: null } } } })).status, 400);
  const ok = await call('/org/api/characters/takakage/requests', { method: 'POST', body: { character: { speed: 60, stride: 0.66, ng: { cats: ['cafe'], words: ['居酒屋'], quietAfter: 19 } } } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  orgs.review(ok.body.request.id, 'approved', '', content);
  const c = content.get().charById.get('takakage');
  assert.strictEqual(c.speed, 60); assert.deepStrictEqual(c.ng.cats, ['cafe']);
  // NG行動の場所には立ち寄らない
  const H = 3600000; const day = '2026-11-15';
  const r = sim.dayOf(c, { key: 'ng', log: [{ at: cal.dayStart(day) - 2 * H, areaId: 'mihara' }], areas: { mihara: 0 }, affinity: null }, day);
  assert.ok(r.visits.length > 0);
  assert.ok(!r.visits.some(v => content.get().placeById.get(v.placeId).cat === 'cafe'), 'カフェには行かない');
  assert.ok(!r.visits.some(v => v.kind === 'visit' && v.at >= cal.dayStart(day) + 19 * H), '19時より後は新しい場所に出かけない');
});

test('設定資料（RAG）を登録すると、AIにおまかせが資料を参照して特徴を作る', async () => {
  assert.deepStrictEqual((await call('/org/api/characters/takakage/docs')).body.docs, []);
  assert.strictEqual((await call('/org/api/characters/arisa/docs', { method: 'POST', body: { name: 'x', text: 'y' } })).status, 404);
  assert.strictEqual((await call('/org/api/characters/takakage/docs', { method: 'POST', body: { name: 'x', text: '  ' } })).status, 400);
  const add = await call('/org/api/characters/takakage/docs', { method: 'POST', body: { name: '公式設定書', text: '# 性格\n物静かでまじめな人。\n\n# 好きなもの\n好きなもの: 茶の湯・海の眺め\n\n# 苦手なもの\n苦手なもの: 人混み、坂\n\n夜は出歩かない。' } });
  assert.strictEqual(add.status, 200);
  assert.strictEqual((await call('/org/api/characters/takakage/docs')).body.docs.length, 1);
  const r = await call('/org/api/characters/takakage/suggest', { method: 'POST', body: { text: '' } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.sources.length > 0 && r.body.sources[0].doc === '公式設定書');
  assert.ok(r.body.features.likes.includes('茶の湯'));
  assert.ok(r.body.features.dislikes.includes('人混み'));
  assert.strictEqual(r.body.rag.docs, 1);
  assert.strictEqual((await call(`/org/api/characters/takakage/docs/${add.body.doc.id}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await call('/org/api/characters/takakage/suggest', { method: 'POST', body: { text: '' } })).status, 400);
});

test('セキュリティ: イベントや申請の形の正しくない値を受け付けない', async () => {
  const ev = { title: 'テスト', area: 'mihara', start: '2026-12-01', end: '2026-12-02' };
  assert.strictEqual((await call('/org/api/events', { method: 'POST', body: Object.assign({}, ev, { tags: {} }) })).status, 400);
  assert.strictEqual((await call('/org/api/events', { method: 'POST', body: Object.assign({}, ev, { desc: 'x'.repeat(600) }) })).status, 400);
  assert.strictEqual((await call('/org/api/events', { method: 'POST', body: Object.assign({}, ev, { end: '2026-11-01' }) })).status, 400);
  assert.strictEqual((await call('/org/api/events', { method: 'POST', body: Object.assign({}, ev, { hours: [null, null] }) })).status, 400);
  const req = body => call('/org/api/characters/takakage/requests', { method: 'POST', body });
  assert.strictEqual((await req({ character: { interests: { __proto__: 1, constructor: 1 } } })).status, 400);
  assert.strictEqual((await req({ character: { interests: JSON.parse('{"constructor":1}') } })).status, 400);
  assert.strictEqual((await req({ character: { look: null } })).status, 400);
  assert.strictEqual((await req({ character: { look: { image: 'assets/uploads/musashi-abc.png' } } })).status, 400);
  assert.strictEqual((await req({ character: { ng: { cats: ['toString'], words: [], quietAfter: null } } })).status, 400);
  assert.strictEqual((await call('/org/api/codes', { method: 'POST', body: { type: 'x', id: 'mihara' } })).status, 400);
});

test('セキュリティ: 壊れたJSONや別のページからの送信で、中身を漏らさない', async () => {
  const r = await fetch(base + '/org/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.strictEqual(r.status, 400);
  const text = await r.text(); assert.ok(!/at |\.js/.test(text), text);
  const r2 = await fetch(base + '/org/api/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.strictEqual(r2.status, 415);
  const r3 = await fetch(base + '/org/api/events', { method: 'POST', headers: { cookie, 'Sec-Fetch-Site': 'same-site', 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(r3.status, 403);
});
