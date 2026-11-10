// カップリングルート作成のテスト
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
const spotDb = require('../lib/spot-db').create(content);
spotDb.runBatch('test');
const planner = require('../lib/planner').create({ content, router, calendar, sim, spotDb });
const W = content.get();

const now = Date.parse('2026-11-09T12:00:00+09:00');
const today = cal.dayKey(now);
const user = { id: 'u1', characters: { arisa: { acquiredAt: 0 }, musashi: { acquiredAt: 0 }, nagi: { acquiredAt: 0 } }, areas: { osaka: { acquiredAt: 0 }, onomichi: { acquiredAt: 0 } }, profile: { nickname: '', likes: ['景色'], walk: 'normal' } };
const whoOf = id => ({ key: 'p', log: [{ at: now - 20 * 86400000, areaId: W.charById.get(id).homeAreas[0] }], areas: { osaka: 0, onomichi: 0 }, affinity: spotDb.affinityFor(id) });
const ctx = { whoOf, today, now };

test('推し×自分のルートは、時刻が順に進み、場所に行き方がある', () => {
  const r = planner.plan(user, { characterId: 'arisa', partner: 'self', areaId: 'osaka', length: 'half', mood: 'view' }, ctx);
  assert.ok(!r.error, r.error);
  assert.ok(r.stops.length >= 2);
  let t = r.startAt;
  for (const s of r.stops) {
    assert.ok(s.arriveAt >= t, '時刻が戻らない'); assert.ok(s.leaveAt > s.arriveAt);
    assert.ok(s.access.length);
    assert.ok(Math.abs(s.access[s.access.length - 1].endAt - s.arriveAt) < 1000, '最後の行き方の終わりが到着時刻');
    t = s.leaveAt;
  }
  assert.ok(r.stops.every(s => W.placeById.get(s.placeId).cat !== 'school'), '学校は行き先に入れない');
});

test('選んでいない移動手段は使わない', () => {
  for (const [useTransit, useTaxi] of [[false, false], [true, false], [false, true]]) {
    const r = planner.plan(user, { characterId: 'arisa', partner: 'self', areaId: 'onomichi', length: 'full', useTransit, useTaxi }, ctx);
    if (r.error) continue;
    const modes = new Set(r.stops.flatMap(s => s.access.map(a => a.mode)));
    if (!useTaxi) assert.ok(!modes.has('taxi'), 'taxi');
    if (!useTransit) for (const m of ['train', 'bus', 'ferry', 'ropeway']) assert.ok(!modes.has(m), m);
  }
});

test('推し×推しでは気分を使わず、公式の関係ではないと書く', () => {
  const r = planner.plan(user, { characterId: 'arisa', partner: 'nagi', areaId: 'osaka', length: 'short', mood: 'eat', moodText: 'ラーメン' }, ctx);
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.mood, null); assert.strictEqual(r.moodText, '');
  assert.ok(/公式の関係ではありません/.test(r.note));
});

test('武蔵に道場を頼むと架空の道場が入り、他の推しには知らないと伝える', () => {
  const m = planner.plan(user, { characterId: 'musashi', partner: 'self', areaId: 'osaka', length: 'half', moodText: '道場で決闘したい' }, ctx);
  assert.ok(m.stops.some(s => W.placeById.get(s.placeId).cat === 'dojo' && s.fictional));
  const a = planner.plan(user, { characterId: 'arisa', partner: 'self', areaId: 'osaka', length: 'half', moodText: '道場で決闘したい' }, ctx);
  assert.ok(!a.stops.some(s => W.placeById.get(s.placeId).cat === 'dojo'));
  assert.ok(/よくわからなかった/.test(a.moodNote));
});

test('辞書にない言葉は、読み取れなかったと伝える', () => {
  const r = planner.plan(user, { characterId: 'arisa', partner: 'self', areaId: 'osaka', length: 'short', moodText: 'ふわふわ' }, ctx);
  assert.ok(/読み取れなかった/.test(r.moodNote));
});

test('同じジャンルばかりのルートにしない', () => {
  const r = planner.plan(user, { characterId: 'arisa', partner: 'self', areaId: 'onomichi', length: 'full' }, ctx);
  const g = r.stops.map(s => W.placeById.get(s.placeId).trait || s.cat);
  const max = Math.max(...Object.values(g.reduce((o, x) => ((o[x] = (o[x] || 0) + 1), o), {})));
  assert.ok(max <= 3);
});
