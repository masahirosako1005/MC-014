// 管理画面の「マップ」のテスト（エリアと場所、担当の範囲、聖地、自動で集める場所の分け方、地方をまたぐ移動）
'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const content = require('../lib/content');
const router = require('../lib/router').load(content.get());
const { mountMapApi } = require('../lib/map-admin');
const { classify } = require('../lib/place-collector');
content.onChange(() => router.syncPlaces(content.get()));

// 事務局（すべて）と、三原市の担当（三原市だけ）の2つを立てる
function server(scope) {
  const app = express(); app.use(express.json());
  mountMapApi(app, '/api', { content, router, sim: null, scopeOf: () => scope, byOf: () => 'テスト' });
  return new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
}
let admin, org;
const call = (s, path, method = 'GET', body) => fetch(`http://127.0.0.1:${s.address().port}/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json() }));
test.before(async () => { admin = await server({ areas: null, admin: true }); org = await server({ areas: new Set(['mihara']), admin: false }); });
test.after(() => { admin.close(); org.close(); });

test('自治体には担当エリアだけが見え、エリアは足せない', async () => {
  const m = await call(org, '/map');
  assert.deepStrictEqual(m.body.areas.map(a => a.id), ['mihara']);
  assert.ok(m.body.places.every(p => p[5] === 'mihara'));
  assert.strictEqual((await call(org, '/areas', 'POST', { id: 'x', name: 'テスト市', polygon: [[34, 133], [34.1, 133], [34.1, 133.1]] })).status, 403);
});

test('自治体はエリアの中にスポット（聖地）を足せ、ほかのエリアには置けない', async () => {
  const bad = await call(org, '/places', 'POST', { name: '尾道の聖地', cat: 'view', lat: 34.409, lng: 133.2 });
  assert.strictEqual(bad.status, 400);
  const r = await call(org, '/places', 'POST', { name: '隆景ゆかりの石垣', cat: 'history', lat: 34.4015, lng: 133.0795, seichi: { workId: 'sengoku', note: '築城の場面' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const p = content.get().placeById.get(r.body.id);
  assert.strictEqual(p.area, 'mihara'); assert.strictEqual(p.seichi.workId, 'sengoku');
  assert.ok(router.snap.get(r.body.id), '足した場所は道につながる');
  assert.strictEqual((await call(org, `/map/places/${r.body.id}`, 'PUT', { lat: 34.409, lng: 133.2 })).status, 400, 'ほかのエリアには動かせない');
  assert.strictEqual((await call(org, '/map/places/senkoji', 'PUT', { desc: 'x' })).status, 404, '担当外の場所は直せない');
});

test('最初からある場所は消さずに隠し、乗り場や最初の駅は消せない', async () => {
  assert.strictEqual((await call(org, '/map/places/mihara-st', 'DELETE')).status, 400);
  assert.strictEqual((await call(org, '/map/places/sokoji', 'DELETE')).status, 200);
  assert.strictEqual(content.get().placeById.get('sokoji').hidden, true);
  await call(org, '/map/places/sokoji', 'PUT', { hidden: false });
  assert.strictEqual(content.get().placeById.get('sokoji').hidden, false);
});

test('事務局はエリアを描いて足し、最初の駅を決め、消せる', async () => {
  const poly = [[34.52, 133.33], [34.52, 133.42], [34.44, 133.42], [34.44, 133.33]];
  assert.strictEqual((await call(admin, '/areas', 'POST', { id: 'fukuyama', name: '広島県福山市', polygon: [[34.5, 133.3]] })).status, 400);
  const r = await call(admin, '/areas', 'POST', { id: 'fukuyama', name: '広島県福山市', region: 'setouchi', polygon: poly });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const a = content.get().areaById.get('fukuyama');
  assert.strictEqual(a.short, '福山市'); assert.strictEqual(a.pref, '広島県'); assert.ok(a.center);
  const st = await call(admin, '/places', 'POST', { name: '福山駅', cat: 'station', lat: 34.4893, lng: 133.3626, always: true });
  assert.strictEqual(st.status, 200);
  assert.strictEqual((await call(admin, '/areas/fukuyama', 'PUT', { arrival: 'onomichi-st' })).status, 400, 'ほかのエリアの駅は選べない');
  assert.strictEqual((await call(admin, '/areas/fukuyama', 'PUT', { arrival: st.body.id })).status, 200);
  // 道のデータのないエリアへも、目安の鉄道で行き来できる
  const route = router.route('onomichi-st', st.body.id);
  assert.ok(route && route.legs.some(l => l.lineId === 'intercity'), JSON.stringify(route && route.legs.map(l => l.mode)));
  assert.strictEqual((await call(admin, '/areas/osaka', 'DELETE')).status, 400, '最初からあるエリアは消せない');
  assert.strictEqual((await call(admin, '/areas/fukuyama', 'DELETE')).status, 200);
  assert.ok(!content.get().areaById.get('fukuyama') && !content.get().placeById.get(st.body.id));
});

test('自動で集める場所は、観光の場所だけを選ぶ', () => {
  assert.strictEqual(classify('建物（寺院）', '千光寺'), 'shrine');
  assert.strictEqual(classify('土地利用（公園）', '千光寺公園'), 'view');
  assert.strictEqual(classify('山地（山、岳、峰等）', '竜王山'), 'view');
  assert.strictEqual(classify('居住地名（町字名）', '長江'), null);
  assert.strictEqual(classify('建物（文教施設）', '公会堂'), null);
  assert.strictEqual(classify('建物（文教施設）', '尾道市立土堂小学校'), null);
});
