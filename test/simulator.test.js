// 行動判断AIと日常のテスト
'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const content = require('../lib/content');
const cal = require('../lib/calendar');
const router = require('../lib/router').load(content.get());
const calendar = cal.create(content);
const { createSimulator } = require('../lib/simulator');
const sim = createSimulator({ content, router, calendar });
const W = content.get();
const H = 3600000;

// 月曜（学校のある日）と日曜を探す
function findDay(pred, from = '2026-10-01') { for (let d = from; ; d = cal.addDays(d, 1)) if (pred(d)) return d; }
const monday = findDay(d => cal.weekday(d) === 1 && calendar.isWorkday(d, 'school') && calendar.weatherOf(d, 'kansai') !== 'rain');
const sunday = findDay(d => cal.weekday(d) === 0 && calendar.weatherOf(d, 'kansai') === 'sun' && calendar.weatherOf(d, 'setouchi') !== 'rain');
const who = (log, key = 't') => ({ key, log, areas: { osaka: 0, onomichi: 0, mihara: 0 }, affinity: null });

test('同じ日は何度計算しても同じ足あとになる', () => {
  const c = W.charById.get('arisa');
  const log = [{ at: cal.dayStart(cal.addDays(monday, -3)), areaId: 'osaka' }];
  const a = sim.dayOf(c, who(log, 'a'), monday); sim.clear();
  const b = sim.dayOf(c, who(log, 'a'), monday);
  assert.deepStrictEqual(a.items.map(i => [i.at, i.text]), b.items.map(i => [i.at, i.text]));
  assert.ok(a.steps > 0);
});

test('平日のありさは学校にいて、家に帰る', () => {
  const c = W.charById.get('arisa');
  const r = sim.dayOf(c, who([{ at: cal.dayStart(cal.addDays(monday, -1)), areaId: 'osaka' }]), monday);
  const school = r.visits.find(v => v.placeId === 'nishi-hs');
  assert.ok(school, '学校に行く');
  assert.ok(cal.minuteOfDay(school.leave) / 60 >= 15.5, '放課後まで学校にいる');
  assert.strictEqual(r.items[r.items.length - 1].type, 'home');
});

test('連れて行く前には足あとがない', () => {
  const c = W.charById.get('nagi');
  const r = sim.dayOf(c, who([{ at: cal.dayStart(sunday) + 30 * H, areaId: 'osaka' }]), sunday);
  assert.strictEqual(r.items.length, 0);
});

test('神の手の移動はタイムラインに出て、移動先で過ごす', () => {
  const c = W.charById.get('arisa');
  const at = cal.dayStart(sunday) + 13 * H;
  const r = sim.dayOf(c, who([{ at: cal.dayStart(sunday) - H, areaId: 'osaka' }, { at, areaId: 'onomichi' }]), sunday);
  const god = r.items.find(i => i.type === 'god' && i.at === at);
  assert.ok(god && god.text === '神の手がありさを尾道市エリアに移動させた。');
  const after = r.visits.filter(v => v.at > at && v.kind === 'visit');
  assert.ok(after.length > 0);
  assert.ok(after.every(v => W.placeById.get(v.placeId).area === 'onomichi'));
});

test('家に帰すと「神の手が〇〇を家に帰した」と出て旅が終わる', () => {
  const c = W.charById.get('arisa');
  const at = cal.dayStart(sunday) + 11 * H;
  const r = sim.dayOf(c, who([{ at: cal.dayStart(sunday) - H, areaId: 'osaka' }, { at, areaId: null }]), sunday);
  assert.ok(r.items.some(i => i.type === 'god' && i.text === '神の手がありさを家に帰した。'));
  assert.ok(!r.visits.some(v => v.at > at + 60000), '家に帰した後は動かない');
});

test('夜遅くに遠くへ移され、次の日が学校なら、その夜のうちに家へ帰る', () => {
  const c = W.charById.get('arisa');
  const sun = findDay(d => cal.weekday(d) === 0 && calendar.isWorkday(cal.addDays(d, 1), 'school'));
  const r = sim.dayOf(c, who([{ at: cal.dayStart(sun) - H, areaId: 'osaka' }, { at: cal.dayStart(sun) + 20.5 * H, areaId: 'onomichi' }]), sun);
  const home = r.items.filter(i => i.type === 'home').pop();
  assert.ok(home && home.at > cal.dayStart(sun) + 20.5 * H, 'その夜に家へ帰る');
  assert.ok(/明日は学校がある/.test(home.sub || ''));
});

test('武蔵は道場とジムに通い、架空の道場は武蔵だけが訪れる', () => {
  const m = W.charById.get('musashi');
  const r = sim.dayOf(m, who([{ at: cal.dayStart(sunday) - 2 * H, areaId: 'onomichi' }]), sunday);
  assert.ok(r.visits.some(v => W.placeById.get(v.placeId).cat === 'dojo'));
  const a = W.charById.get('takakage');
  const r2 = sim.dayOf(a, who([{ at: cal.dayStart(sunday) - 2 * H, areaId: 'onomichi' }]), sunday);
  assert.ok(!r2.visits.some(v => W.placeById.get(v.placeId).cat === 'dojo'), '武蔵以外は道場へ行かない');
});

test('タイムラインは第三者の視点で、訪れた理由を書かない', () => {
  const c = W.charById.get('nagi');
  const r = sim.dayOf(c, who([{ at: cal.dayStart(sunday) - 2 * H, areaId: 'onomichi' }]), sunday);
  assert.ok(r.items.length > 0);
  for (const i of r.items) {
    assert.ok(!/[」』]と(言|話|つぶや)/.test(i.text + (i.sub || '')), '推しに喋らせない: ' + i.text);
    assert.ok(!/ために|だから|ので、/.test(i.text), '理由を書かない: ' + i.text);
  }
});

test('天気は同じ日なら同じで、時間ごとの天気は24時間分', () => {
  const a = calendar.hourlyOf(monday, 'setouchi'), b = calendar.hourlyOf(monday, 'setouchi');
  assert.strictEqual(a.length, 24); assert.deepStrictEqual(a, b);
  assert.strictEqual(calendar.weatherOf('2026-11-20', 'setouchi'), calendar.weatherOf('2026-11-20', 'setouchi'));
});

test('経路は道と乗り物をつなぐ（渡船で向島へ渡る）', () => {
  const r = router.route('onomichi-st', 'goto-kosen');
  assert.ok(r.legs.some(l => l.mode === 'ferry'));
  const w = router.route('awaza-st', 'nakanoshima-park', { walkOnly: true });
  assert.ok(w.legs.every(l => l.mode === 'walk'));
});

test('タイムラインはスタート地点（家や泊まった宿）を出発するところから始まる', () => {
  for (const id of ['arisa', 'musashi', 'moyashi']) {
    const c = W.charById.get(id);
    const area = c.homeAreas[0];
    for (let k = 0; k < 7; k++) {
      const day = cal.addDays(monday, k);
      const r = sim.dayOf(c, who([{ at: cal.dayStart(monday) - 2 * H, areaId: area }], 'start-' + id), day);
      if (!r.items.length) continue;
      const first = r.items.find(i => i.type !== 'god');
      assert.ok(first && first.type === 'start', `${id} ${day} の最初の行: ${first && first.type} ${first && first.text}`);
      assert.ok(/を出発した。$|に降り立った。$/.test(first.text), first.text);
    }
  }
});
