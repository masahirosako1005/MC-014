/**
 * server.js
 * ミニ推し！のサーバ本体とAPI（ユーザー向け、ポート3000）。運営の管理画面サーバ（admin/server.js、ポート3100）も起動する。
 *
 * - 大会規定により、実行時に外部へは接続しない。ブラウザの通信先もCSPで自サーバと国土地理院に制限する
 * - ログインは不要。初めて開いた端末には自動で利用者を作り、Cookieで覚える（lib/auth.js）
 * - 推しの足あとは保存せず、連れて行った履歴から毎回計算する（lib/simulator.js）
 */
'use strict';

const guard = require('./lib/guard');
const { own } = guard;

const path = require('path');
const express = require('express');

const content = require('./lib/content');
const store = require('./lib/store');
const auth = require('./lib/auth');
const cal = require('./lib/calendar');
const routerLib = require('./lib/router');
const { createSimulator } = require('./lib/simulator');
const { writeDiary } = require('./lib/diary');
const spotDbLib = require('./lib/spot-db');
const { DEMO_HISTORY } = require('./data/demo-history');
const { TRAVELERS, TRAVELER_CANON } = require('./data/travelers');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const HOUR = 3600000, DAY = 86400000;

const calendar = cal.create(content);
const router = routerLib.load(content.get());
const spotDb = spotDbLib.create(content);
const sim = createSimulator({ content, router, calendar });
// 管理画面で場所やエリアを変えたら、道への付け方を合わせ直し、足あとの控えを捨てる
content.onChange(() => { router.syncPlaces(content.get()); sim.clear(); });
spotDb.onUpdate(() => sim.clear());

// 観光ルート（lib/planner.js）と推しのおすすめ（lib/recommend.js）
const planner = require('./lib/planner').create({ content, router, calendar, sim, spotDb });
const recommend = require('./lib/recommend').create({ content, sim, spotDb, calendar });

const W = () => content.get();
const now = () => Date.now();
const today = () => cal.dayKey(now());

/* ---------------------------------------------------------------- 推しの履歴 */
/** 創作の旅の履歴（初期キャラのみ。利用者を作った日を基準にする） */
function demoLog(u, charId) {
  const list = DEMO_HISTORY[charId];
  const ch = u.characters[charId];
  if (!list || !ch || !ch.initial) return [];
  const base = cal.dayKey(u.createdAt);
  return list.map(e => ({ at: cal.dayStart(cal.addDays(base, -e.daysAgo)) + (e.hour === undefined ? 5 : e.hour) * HOUR, areaId: e.areaId, demo: true }))
    .filter(e => e.at < u.createdAt && (e.areaId === null || (u.areas[e.areaId] && u.areas[e.areaId].acquiredAt <= e.at)));
}
function travelLog(u, charId) {
  return [...demoLog(u, charId), ...((u.travelLogs || {})[charId] || [])].sort((a, b) => a.at - b.at);
}
function whoOf(u, charId) {
  return {
    key: u.id, log: travelLog(u, charId),
    areas: Object.fromEntries(Object.entries(u.areas).map(([k, v]) => [k, v.acquiredAt])),
    affinity: spotDb.affinityFor(charId),
  };
}
const placementNow = (u, charId) => cal.placementAt(travelLog(u, charId), now());

/* ---------------------------------------------------------------- 他の人の推し */
const TRAVELER_SINCE = Date.parse('2026-07-15T00:00:00+09:00');
const travelerChar = new Map(TRAVELERS.map(t => [t.id, Object.assign({}, t, { canon: TRAVELER_CANON[t.id] })]));
const travelerWho = t => ({ key: 'traveler', log: [{ at: TRAVELER_SINCE, areaId: t.area }], areas: { [t.area]: 0 }, affinity: null });

/** その日の出会い（同じ場所に同じ時間にいたとき。同じ相手とは1日1回まで） */
function encountersOn(c, r, day) {
  const out = [];
  for (const t of travelerChar.values()) {
    const tr = sim.dayOf(t, travelerWho(t), day);
    let met = null;
    for (const v of r.visits) {
      if (v.kind !== 'visit') continue;
      for (const w of tr.visits) {
        if (w.placeId !== v.placeId || w.kind !== 'visit') continue;
        const s = Math.max(v.at, w.at), e = Math.min(v.leave, w.leave);
        if (e > s) { met = { v, at: s }; break; }
      }
      if (met) break;
    }
    if (met) {
      const p = W().placeById.get(met.v.placeId);
      out.push({ type: 'meet', at: met.at + 60000, placeId: p.id, lat: p.lat, lng: p.lng, travelerId: t.id, day,
        text: `${c.short}が${p.name}で、${t.fromShort}から旅してきた${t.short}に出会った。`, sub: `${t.short}は、${t.owner}の推し。` });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- 足あとの返し方 */
function hourlyWeatherFor(log, day, homeArea) {
  const ds = cal.dayStart(day);
  return new Array(24).fill(0).map((_, h) => {
    const a = cal.placementAt(log, ds + h * HOUR + 30 * 60000) || homeArea;
    const region = (W().areaById.get(a) || {}).region || 'kansai';
    return calendar.hourlyOf(day, region)[h];
  });
}
function legOut(l) { return { mode: l.mode, line: l.line, from: l.from, to: l.to, coords: l.coords, startAt: l.startAt, endAt: l.endAt, meters: l.meters }; }

function journeyPayload(u, c, day) {
  const who = whoOf(u, c.id);
  const r = sim.dayOf(c, who, day);
  const isToday = day === today();
  const t = now();
  let items = [...r.items, ...encountersOn(c, r, day)].sort((a, b) => a.at - b.at);
  let legs = r.legs;
  if (isToday) { items = items.filter(i => i.at <= t); legs = legs.filter(l => l.startAt <= t); }
  // 今日の歩数と距離（今の時刻まで）
  let walkM = 0;
  for (const l of legs) if (l.mode === 'walk') walkM += l.meters * (isToday && l.endAt > t ? Math.max(0, (t - l.startAt) / Math.max(1, l.endAt - l.startAt)) : 1);
  const hourly = new Array(24).fill(0);
  const ds = cal.dayStart(day);
  for (const l of legs) {
    if (l.mode !== 'walk' || !(l.endAt > l.startAt)) continue;
    const end = isToday ? Math.min(l.endAt, t) : l.endAt;
    const steps = l.meters / c.stride, span = l.endAt - l.startAt;
    for (let x = l.startAt; x < end;) { const hr = Math.floor((x - ds) / HOUR); const nx = Math.min(end, ds + (hr + 1) * HOUR); if (hr >= 0 && hr < 24) hourly[hr] += steps * (nx - x) / span; x = nx; }
  }
  // 地図の立ち寄った場所の印。orders は立ち寄った順番（同じ場所に2回寄ったときは2つ。ats はそれぞれの時刻）
  const pins = [];
  const pinOf = new Map();
  let order = 0;
  for (const i of items) {
    if (!i.placeId || !['visit', 'stay', 'meet', 'arrive'].includes(i.type)) continue;
    const p = W().placeById.get(i.placeId); if (!p) continue;
    if (p.cat === 'home') continue;
    const prev = pinOf.get(i.placeId);
    if (prev && prev.ats[prev.ats.length - 1] === i.at) continue;
    if (prev && i.type !== 'visit' && i.type !== 'arrive') continue; // 同じ立ち寄りの中の出会いなどは数えない
    order++;
    if (prev) { prev.orders.push(order); prev.ats.push(i.at); continue; }
    const pin = { placeId: p.id, name: p.name, cat: p.cat, lat: p.lat, lng: p.lng, at: i.at, fictional: !!p.fictional, orders: [order], ats: [i.at] };
    pinOf.set(i.placeId, pin); pins.push(pin);
  }
  const log = who.log;
  const placement = cal.placementAt(log, isToday ? t : ds + DAY - 1);
  const area = placement ? W().areaById.get(placement) : null;
  const status = isToday ? (placement || items.length ? sim.statusAt(c, { items: r.items.filter(i => i.at <= t), legs: r.legs }, t) : { kind: 'waiting', text: '家で待っている' }) : null;
  return {
    characterId: c.id, day, isToday, now: t, dayStart: ds,
    placement, areaName: area ? area.short : null,
    status, items: items.map(itemOut), legs: legs.map(legOut), pins,
    steps: Math.round(walkM / c.stride), walkM: Math.round(walkM),
    hourlySteps: hourly.map(Math.round), hourlyWeather: hourlyWeatherFor(log, day, c.homeAreas[0] || 'osaka'),
    holiday: calendar.holidayName(day), weekday: cal.weekday(day),
    eventCount: placement ? sim.eventsOn(placement, day).length : 0,
    wake: (W().CANON[c.id] || {}).routine ? W().CANON[c.id].routine.wake : c.active[0],
    raw: r,
  };
}
function itemOut(i) {
  const pl = i.placeId ? W().placeById.get(i.placeId) : null;
  return { type: i.type, at: i.at, text: i.text, sub: i.sub || '', placeId: i.placeId || null, placeName: i.type === 'start' ? i.placeLabel : pl ? (pl.cat === 'home' ? null : pl.name) : null, cat: pl ? pl.cat : null, lat: i.lat, lng: i.lng, walkM: i.walkM || 0, meters: i.type === 'ride' ? i.meters : 0, mode: i.mode, line: i.line, travelerId: i.travelerId, eventId: i.eventId, fictional: i.fictional };
}

/* ---------------------------------------------------------------- 状態の返し方 */
function charOut(u, c) {
  const own = u.characters[c.id];
  return {
    id: c.id, name: c.name, short: c.short, workId: c.workId, tagline: c.tagline, homeAreas: c.homeAreas, look: c.look, historical: !!c.historical,
    acquiredAt: own ? own.acquiredAt : null, placement: own ? placementNow(u, c.id) : null,
    stride: c.stride, speed: c.speed, active: c.active,
  };
}
function transitStops(u) {
  const owned = new Set(Object.keys(u.areas));
  const byId = new Map();
  for (const s of router.stops) {
    if (!owned.has(s.area)) continue;
    let e = byId.get(s.id);
    if (!e) {
      e = { id: s.id, name: s.name, lat: s.lat, lng: s.lng, area: s.area, mode: s.mode, lines: [], placeId: null };
      const near = W().PLACES.find(p => p.cat === 'station' && routerLib.dist([p.lat, p.lng], [s.lat, s.lng]) < 250);
      if (near) e.placeId = near.id;
      byId.set(s.id, e);
    }
    if (!e.lines.includes(s.lineName)) e.lines.push(s.lineName);
  }
  return [...byId.values()];
}
const REPORT_KINDS = ['性格・人柄', '行動・行き先', '日記やタイムラインの文章', '観光ルート', '見た目', 'その他'];
const LIKE_OPTIONS = ['甘いもの', 'ラーメン', '珈琲', 'パン', '景色', '写真', '寺社', '歴史', '本', '猫', '雑貨', '海', '山', '夜景', '和菓子'];
const WALK_OPTIONS = [{ id: 'little', label: '少し', meters: 3000 }, { id: 'normal', label: 'ふつう', meters: 6000 }, { id: 'lots', label: 'たくさん', meters: 10000 }];

function statePayload(u) {
  const w = W();
  const chars = w.CHARACTERS.filter(c => u.characters[c.id]).map(c => charOut(u, c));
  const workIds = new Set(chars.map(c => c.workId));
  return {
    user: { loggedIn: !!u.loginId, loginId: u.loginId || null },
    characters: chars,
    works: w.WORKS.filter(x => workIds.has(x.id)),
    areas: w.AREAS.filter(a => u.areas[a.id]).map(a => ({ id: a.id, name: a.name, short: a.short, pref: a.pref, polygon: a.polygon, center: a.center, acquiredAt: u.areas[a.id].acquiredAt, arrival: a.arrival })),
    homeCharacterIds: u.homeCharacterIds.filter(id => u.characters[id]),
    selectedCharacterId: u.characters[u.selectedCharacterId] ? u.selectedCharacterId : (u.homeCharacterIds[0] || chars[0] && chars[0].id),
    settings: u.settings, profile: u.profile, guideSeen: !!u.guideSeen,
    stops: transitStops(u),
    categories: w.CATEGORIES,
    options: { reportKinds: REPORT_KINDS, likes: LIKE_OPTIONS, walk: WALK_OPTIONS, moods: planner.MOODS, lengths: planner.LENGTHS },
    today: today(), now: now(),
  };
}

/** 足あとを先に計算しておく（推しごとに間をあけて、ほかの操作を止めないようにする） */
function warmUp(u) {
  const ids = Object.keys(u.characters);
  const step = () => {
    const id = ids.shift(); if (!id) return;
    const c = W().charById.get(id);
    if (c) { try { sim.activeDays(c, whoOf(u, id), today()); } catch (e) { console.error(e); } }
    setImmediate(step);
  };
  setImmediate(step);
}

/* ---------------------------------------------------------------- アプリ */
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  // 大会規定: ブラウザの通信先を自サーバと国土地理院に限る
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob: https://cyberjapandata.gsi.go.jp",
    "connect-src 'self'", "font-src 'self'", "media-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(self)');
  next();
});
app.use(guard.sameOrigin); // 別のサイトや別のポートからの書きこみを断る（lib/guard.js）
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0, setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));

// 利用者（Cookie）。なければ作る（作るのは /api/state とログインまわりだけ）
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  const canCreate = req.path === '/state' || req.path.startsWith('/auth/');
  req.user = auth.sessionUser(req, res, store, W(), canCreate);
  if (!req.user) return res.status(canCreate ? 429 : 401).json({ error: canCreate ? 'しばらく待ってから開き直してください' : 'ページを開き直してください' });
  next();
});
const bad = (res, status, error) => res.status(status).json({ error });
const ownChar = (req, res) => {
  const c = W().charById.get(req.params.id);
  if (!c || !own(req.user.characters, c.id)) { bad(res, 404, 'その推しはいません'); return null; }
  return c;
};

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/api/state', (req, res) => res.json(statePayload(req.user)));

/* ---- ログイン（任意） ---- */
app.post('/api/auth/signup', (req, res) => {
  const r = auth.signup(store, req.user, String((req.body || {}).loginId || ''), (req.body || {}).password);
  if (r.status !== 200) return bad(res, r.status, r.error);
  res.json({ ok: true, loginId: req.user.loginId });
});
app.post('/api/auth/login', (req, res) => {
  const r = auth.login(store, req, res, (req.body || {}).loginId, (req.body || {}).password);
  if (r.status !== 200) return bad(res, r.status, r.error);
  res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => { auth.logout(store, req, res, W()); res.json({ ok: true }); });

/* ---- プロフィール（個人を特定する項目は持たない） ---- */
app.put('/api/profile', (req, res) => {
  const b = req.body || {};
  const nickname = String(b.nickname || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
  if (/@/.test(nickname)) return bad(res, 400, '呼び名にメールアドレスは使えません');
  const likes = Array.isArray(b.likes) ? [...new Set(b.likes.filter(x => LIKE_OPTIONS.includes(x)))].slice(0, 8) : [];
  const walk = WALK_OPTIONS.some(x => x.id === b.walk) ? b.walk : 'normal';
  req.user.profile = { nickname, likes, walk };
  store.save();
  res.json({ ok: true, profile: req.user.profile });
});

/* ---- ホームに出す推し ---- */
app.put('/api/selected-character', (req, res) => {
  const id = (req.body || {}).id;
  if (!own(req.user.characters, id) || !W().charById.has(id)) return bad(res, 404, 'その推しはいません');
  req.user.selectedCharacterId = id;
  if (!req.user.homeCharacterIds.includes(id)) req.user.homeCharacterIds.push(id);
  store.save();
  res.json({ ok: true, homeCharacterIds: req.user.homeCharacterIds });
});
app.put('/api/home-characters', (req, res) => {
  const ids = Array.isArray((req.body || {}).ids) ? [...new Set(req.body.ids.filter(id => own(req.user.characters, id) && W().charById.has(id)).slice(0, 50))] : [];
  if (!ids.length) return bad(res, 400, 'ホームには1人以上の推しが必要です');
  req.user.homeCharacterIds = ids;
  if (!ids.includes(req.user.selectedCharacterId)) req.user.selectedCharacterId = ids[0];
  store.save();
  res.json({ ok: true, homeCharacterIds: ids, selectedCharacterId: req.user.selectedCharacterId });
});

/* ---- 足あと ---- */
app.get('/api/characters/:id/journey', (req, res) => {
  const c = ownChar(req, res); if (!c) return;
  const p = journeyPayload(req.user, c, today());
  const who = whoOf(req.user, c.id);
  delete p.raw;
  p.activeDays = sim.activeDays(c, who, today());
  res.json(p);
});
app.get('/api/characters/:id/journey/:day', (req, res) => {
  const c = ownChar(req, res); if (!c) return;
  const day = req.params.day;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today()) return bad(res, 400, '日付が正しくありません');
  const p = journeyPayload(req.user, c, day);
  const raw = p.raw; delete p.raw;
  const who = whoOf(req.user, c.id);
  const area = W().areaById.get(raw.area || c.homeAreas[0]);
  p.diary = writeDiary(c, { ...raw, items: [...raw.items, ...encountersOn(c, raw, day)].sort((a, b) => a.at - b.at) }, id => W().placeById.get(id), p.hourlyWeather, area ? area.short : '');
  const sum = sim.summarizeVisits(c, who, today(), now());
  p.rings = { steps: raw.steps, outsideMin: raw.outsideMin, stops: raw.visits.filter(v => v.kind === 'visit').length, km: Math.round(raw.walkM / 100) / 10, average: sum.average };
  p.activeDays = sum.days;
  res.json(p);
});

/* ---- エリアへ連れて行く（1つだけ。null で家へ帰す） ---- */
app.put('/api/characters/:id/travel', (req, res) => {
  const c = ownChar(req, res); if (!c) return;
  const areaId = (req.body || {}).areaId === null ? null : String((req.body || {}).areaId || '');
  const u = req.user;
  if (areaId !== null && !(u.areas[areaId] && u.areas[areaId].acquiredAt <= now())) return bad(res, 400, 'まだ獲得していないエリアです');
  if (areaId !== null && !(W().areaById.get(areaId) || {}).arrival) return bad(res, 400, 'このエリアはまだ準備中です（最初の駅が決まっていません）');
  const cur = placementNow(u, c.id);
  if (cur === areaId) return res.json({ ok: true, changed: false, placement: cur });
  if (cur === null && areaId === null) return res.json({ ok: true, changed: false, placement: null });
  u.travelLogs = u.travelLogs || {};
  const list = u.travelLogs[c.id] = u.travelLogs[c.id] || [];
  list.push({ at: now(), areaId });
  if (list.length > 500) list.splice(0, list.length - 500);
  store.save();
  res.json({ ok: true, changed: true, placement: areaId });
});

/* ---- 場所、出会い、エリア、イベント ---- */
app.get('/api/places/:id', (req, res) => {
  const p = W().placeById.get(req.params.id);
  if (!p || p.hidden) return bad(res, 404, '場所が見つかりません');
  const u = req.user; const d = today(); const t = now();
  const visitors = [];
  for (const id of Object.keys(u.characters)) {
    const c = W().charById.get(id); if (!c) continue;
    const r = sim.dayOf(c, whoOf(u, id), d);
    const v = r.visits.find(v => v.placeId === p.id && v.at <= t && v.kind !== 'pass');
    if (v) visitors.push({ id: c.id, short: c.short, at: v.at, kind: 'own' });
  }
  for (const tc of travelerChar.values()) {
    const r = sim.dayOf(tc, travelerWho(tc), d);
    const v = r.visits.find(v => v.placeId === p.id && v.at <= t && v.kind === 'visit');
    if (v) visitors.push({ id: tc.id, short: tc.short, at: v.at, kind: 'traveler', from: tc.fromShort });
  }
  const spot = spotDb.spot(p.id);
  res.json({
    id: p.id, name: p.name, cat: p.cat, catLabel: (W().CATEGORIES[p.cat] || {}).label, area: p.area, areaName: (W().areaById.get(p.area) || {}).short,
    lat: p.lat, lng: p.lng, desc: p.desc, address: p.address, url: p.url, model: p.model || null, fictional: !!p.fictional, genre: p.genre || (spot && spot.genre) || '',
    noRoute: !!p.noRoute, school: p.cat === 'school',
    seichi: p.seichi ? { work: (W().workById.get(p.seichi.workId) || {}).title || '', note: p.seichi.note || '' } : null,
    collected: p.collected ? p.collected.source : null,
    visitors: visitors.sort((a, b) => a.at - b.at),
    spot: spot && p.cat !== 'station' && p.cat !== 'home' ? { exterior: spot.exterior, budget: spot.budget, menu: spot.menu, rating: spot.rating, reviews: spot.reviews, hours: spot.hours, dummy: spot.source.kind === 'dummy' } : null,
  });
});

/** 出会いの記録（1回ごと、新しい順） */
function allEncounters(u) {
  const out = [];
  const d0 = today(), t = now();
  for (const id of Object.keys(u.characters)) {
    const c = W().charById.get(id); if (!c) continue;
    const who = whoOf(u, id);
    for (const day of sim.activeDays(c, who, d0)) {
      const r = sim.dayOf(c, who, day);
      for (const e of encountersOn(c, r, day)) if (e.at <= t) out.push({ ...e, characterId: id });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}
app.get('/api/encounters', (req, res) => {
  const list = allEncounters(req.user).map(e => {
    const t = travelerChar.get(e.travelerId); const p = W().placeById.get(e.placeId);
    return { at: e.at, day: e.day, characterId: e.characterId, travelerId: e.travelerId, placeId: e.placeId, placeName: p.name, areaName: (W().areaById.get(p.area) || {}).short, text: e.text };
  });
  const travelers = {};
  for (const t of travelerChar.values()) travelers[t.id] = { id: t.id, name: t.name, short: t.short, owner: t.owner, from: t.from, fromShort: t.fromShort, acquiredAt: t.acquiredAt, work: t.work, intro: t.intro, url: t.url, urlLabel: t.urlLabel, look: t.look, historical: !!t.historical };
  // こちらの推しの紹介が、相手にも届いていることを示す（デモ。実際の送信は本番で実装する）
  const mine = Object.keys(req.user.characters).map(id => { const c = W().charById.get(id); return { id, short: c.short, homeArea: (W().areaById.get(c.homeAreas[0]) || {}).name || '' }; });
  res.json({ encounters: list, travelers, shared: mine });
});

app.get('/api/areas/:id', (req, res) => {
  const a = W().areaById.get(req.params.id);
  if (!a || !req.user.areas[a.id]) return bad(res, 404, 'まだ獲得していないエリアです');
  const u = req.user;
  const places = W().PLACES.filter(p => p.area === a.id && !p.hidden);
  const main = places.filter(p => !p.fictional && !['home', 'school'].includes(p.cat) && p.cat !== 'station');
  const history = [];
  for (const id of Object.keys(u.characters)) {
    const c = W().charById.get(id); if (!c) continue;
    const who = whoOf(u, id);
    for (const day of sim.activeDays(c, who, today())) {
      const r = sim.dayOf(c, who, day);
      const vs = r.visits.filter(v => v.kind === 'visit' && (W().placeById.get(v.placeId) || {}).area === a.id && v.at <= now());
      if (vs.length) history.push({ day, characterId: id, count: vs.length, places: [...new Set(vs.map(v => W().placeById.get(v.placeId).name))].slice(0, 4) });
    }
  }
  history.sort((x, y) => (x.day < y.day ? 1 : -1));
  res.json({
    id: a.id, name: a.name, short: a.short, intro: a.intro, url: a.url, acquiredAt: u.areas[a.id].acquiredAt,
    mainPlaces: main.map(p => ({ id: p.id, name: p.name, cat: p.cat, model: p.model || null })),
    fictionalCount: places.filter(p => p.generated).length,
    history: history.slice(0, 60),
    events: W().EVENTS.filter(e => e.area === a.id && !e.hidden && e.end >= cal.addDays(today(), -30)).map(eventOut(u)),
  });
});

const eventOut = u => e => {
  const reactions = Object.keys(u.characters).map(id => {
    const iv = sim.eventInterest(id, e);
    return { characterId: id, interest: Math.round(iv * 100) / 100, level: iv >= 0.7 ? 'go' : iv >= 0.35 ? 'poster' : 'pass' };
  });
  const p = e.placeId ? W().placeById.get(e.placeId) : null;
  return { id: e.id, area: e.area, areaName: (W().areaById.get(e.area) || {}).short, title: e.title, start: e.start, end: e.end, hours: e.hours, placeId: e.placeId, placeName: p ? p.name : null, desc: e.desc, url: e.url, tentative: !!e.tentative, long: cal.daysBetween(e.start, e.end) > 90, reactions };
};
app.get('/api/events', (req, res) => {
  const owned = new Set(Object.keys(req.user.areas));
  const area = req.query.area && owned.has(String(req.query.area)) ? String(req.query.area) : null;
  const list = W().EVENTS.filter(e => !e.hidden && owned.has(e.area) && (!area || e.area === area)).sort((a, b) => (a.start < b.start ? -1 : 1));
  res.json({ events: list.map(eventOut(req.user)), today: today() });
});

/* ---- 獲得 ---- */
// コードの総当たりを防ぐ: 接続元ごとに、見つからなかった回数を10分で30回までにする
const redeemMiss = guard.limiter({ windowMs: 10 * 60000, max: 30 });
const redeemLocked = new Map();
app.post('/api/redeem', (req, res) => {
  const ip = guard.ipOf(req);
  if ((redeemLocked.get(ip) || 0) > Date.now()) return bad(res, 429, 'しばらく待ってからもう一度お試しください');
  const code = String((req.body || {}).code || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 60);
  if (!code) return bad(res, 400, 'コードを入力してください');
  const hit = W().CODES.find(x => x.code.toUpperCase() === code && x.enabled !== false);
  if (!hit) { if (!redeemMiss(ip)) { redeemLocked.set(ip, Date.now() + 10 * 60000); if (redeemLocked.size > 5000) redeemLocked.delete(redeemLocked.keys().next().value); } return bad(res, 404, 'このコードは見つかりませんでした'); }
  const u = req.user; const t = now();
  if (hit.type === 'character') {
    const c = W().charById.get(hit.id);
    if (!c) return bad(res, 404, 'このコードは見つかりませんでした');
    if (own(u.characters, c.id)) return bad(res, 409, `${c.short}とは、もう一緒にいます`);
    u.characters[c.id] = { acquiredAt: t };
    const unlocked = [];
    for (const a of c.homeAreas) if (!u.areas[a]) { u.areas[a] = { acquiredAt: t }; unlocked.push(a); }
    content.countCodeUse(hit.code); store.save();
    return res.json({ ok: true, type: 'character', character: charOut(u, c), work: W().workById.get(c.workId), areasUnlocked: unlocked.map(id => W().areaById.get(id).name) });
  }
  const a = W().areaById.get(hit.id);
  if (!a) return bad(res, 404, 'このコードは見つかりませんでした');
  if (own(u.areas, a.id)) return bad(res, 409, `${a.name}は、もう獲得しています`);
  u.areas[a.id] = { acquiredAt: t };
  content.countCodeUse(hit.code); store.save();
  res.json({ ok: true, type: 'area', area: { id: a.id, name: a.name, short: a.short, intro: a.intro } });
});

/* ---- 設定 ---- */
app.put('/api/settings', (req, res) => {
  const b = req.body || {};
  for (const [k, allowed] of Object.entries(store.ALLOWED_SETTINGS)) if (b[k] !== undefined) { if (!allowed.includes(b[k])) return bad(res, 400, '設定の値が正しくありません'); req.user.settings[k] = b[k]; }
  store.save();
  res.json({ ok: true, settings: req.user.settings });
});
app.post('/api/guide-seen', (req, res) => { req.user.guideSeen = true; store.save(); res.json({ ok: true }); });

/* ---- 解釈違いの報告（外部へは送らず、サーバに保存して管理画面で読む） ---- */
app.get('/api/report-kinds', (req, res) => res.json({ kinds: REPORT_KINDS }));
// 報告は接続元ごとにも1日50件まで（Cookie を捨てて送り続け、本物の報告を押し流すのを防ぐ）
const reportHit = guard.limiter({ windowMs: DAY, max: 50 });
app.post('/api/reports', (req, res) => {
  const b = req.body || {}; const u = req.user;
  if (!own(u.characters, b.characterId) || !W().charById.has(b.characterId)) return bad(res, 400, '推しを選んでください');
  if (!reportHit(guard.ipOf(req))) return bad(res, 429, '今日はこれ以上送れません。明日またお願いします');
  if (!REPORT_KINDS.includes(b.kind)) return bad(res, 400, '種類を選んでください');
  const text = String(b.text || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim();
  if (text.length < 5 || text.length > 1000) return bad(res, 400, '内容は5〜1000文字で書いてください');
  const where = String(b.where || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100);
  const db = store.db();
  const d = today();
  const mine = db.reports.filter(r => r.uid === u.id && cal.dayKey(r.at) === d).length;
  if (mine >= 20) return bad(res, 429, '今日はこれ以上送れません。明日またお願いします');
  db.reports.unshift({ id: require('crypto').randomBytes(6).toString('hex'), at: now(), uid: u.id, characterId: b.characterId, kind: b.kind, where, text, nickname: u.profile.nickname || '', status: 'unread' });
  // 全体の上限を超えたら、確認済みの古いものから消す（未読の報告は残す）
  if (db.reports.length > 1000) { const keep = db.reports.filter(r => r.status === 'unread').slice(0, 1000); const rest = db.reports.filter(r => r.status !== 'unread'); db.reports = keep.concat(rest).sort((a, b) => b.at - a.at).slice(0, Math.max(1000, keep.length)); }
  store.save();
  res.json({ ok: true });
});

/* ---- デモ ---- */
app.post('/api/demo/unlock-all', (req, res) => {
  // デモ用の「全部獲得」。本番で公開するときは DEMO_UNLOCK=off で止める（止めないと獲得コードの意味がなくなる）
  if (process.env.DEMO_UNLOCK === 'off') return bad(res, 404, 'not found');
  const u = req.user; const since = now() - 90 * DAY;
  for (const a of W().AREAS) if (!u.areas[a.id] || u.areas[a.id].acquiredAt > since) u.areas[a.id] = { acquiredAt: since };
  for (const c of W().CHARACTERS) {
    if (!u.characters[c.id]) u.characters[c.id] = { acquiredAt: since };
    // まだ旅に出ていない推しは、地元のエリアに90日前から連れて行った扱いにする（足あとが見えるように）
    if (!travelLog(u, c.id).length) { u.travelLogs[c.id] = [{ at: since, areaId: c.homeAreas[0] || 'osaka', demo: 'unlock' }]; }
  }
  store.save();
  res.json({ ok: true });
  warmUp(u);
});
app.post('/api/reset', (req, res) => { store.resetUser(req.user, W()); res.json({ ok: true }); });

/* ---- 推しのおすすめ ---- */
app.get('/api/characters/:id/recommendations', (req, res) => {
  const c = ownChar(req, res); if (!c) return;
  res.json(recommend.list(c, whoOf(req.user, c.id), today(), now()));
});

/* ---- 観光ルート（カップリングルート） ---- */
app.post('/api/routes', (req, res) => {
  const u = req.user;
  const r = planner.plan(u, req.body || {}, { whoOf: id => whoOf(u, id), today: today(), now: now() });
  if (r.error) return bad(res, r.status || 400, r.error);
  u.routes = [r, ...(u.routes || [])].slice(0, 100);
  store.save();
  res.json(r);
});
app.get('/api/routes', (req, res) => res.json({ routes: (req.user.routes || []).map(planner.summary) }));
app.get('/api/routes/:id', (req, res) => {
  const r = (req.user.routes || []).find(x => x.id === req.params.id);
  if (!r) return bad(res, 404, 'ルートが見つかりません');
  res.json(r);
});
app.delete('/api/routes/:id', (req, res) => {
  const before = (req.user.routes || []).length;
  req.user.routes = (req.user.routes || []).filter(x => x.id !== req.params.id);
  if (req.user.routes.length === before) return bad(res, 404, 'ルートが見つかりません');
  store.save();
  res.json({ ok: true });
});

/* ---- 推しのページ ---- */
app.get('/api/characters/:id', (req, res) => {
  const c = ownChar(req, res); if (!c) return;
  const canon = W().CANON[c.id] || {};
  const who = whoOf(req.user, c.id);
  const sum = sim.summarizeVisits(c, who, today(), now());
  const top = sum.places.filter(x => { const p = W().placeById.get(x.placeId); return p && !['home', 'station', 'school', 'stay'].includes(p.cat); }).slice(0, 6)
    .map(x => { const p = W().placeById.get(x.placeId); return { placeId: p.id, name: p.name, cat: p.cat, count: x.count, minutes: Math.round(x.minutes), fictional: !!p.fictional }; });
  const totals = { days: sum.days.length, steps: 0, km: 0 };
  for (const d of sum.days) { const r = sim.dayOf(c, who, d); totals.steps += r.steps; totals.km += r.walkM / 1000; }
  totals.km = Math.round(totals.km * 10) / 10;
  res.json({
    character: charOut(req.user, c), work: W().workById.get(c.workId),
    canon: { profile: canon.profile, personality: canon.personality, likes: canon.likes, dislikes: canon.dislikes, commute: canon.commute, episodes: canon.episodes, relations: canon.relations },
    regulars: (canon.regulars || []).map(id => W().placeById.get(id)).filter(Boolean).map(p => ({ id: p.id, name: p.name, cat: p.cat, model: p.model || null })),
    principle: { stride: c.stride, speed: c.speed, active: c.active, vehicle: c.vehicle, interests: c.interests },
    top, totals, inHome: req.user.homeCharacterIds.includes(c.id),
  });
});

app.use('/api', (req, res) => bad(res, 404, 'not found'));
app.use(guard.errorHandler); // 例外の中身を返さない（lib/guard.js）

/* ---------------------------------------------------------------- 起動 */
/** 以前の利用者の移しかえ: 初期キャラと地元のエリアを、約3か月前から一緒にいた扱いにそろえる（履歴を3か月分に増やしたため） */
function migrateUsers() {
  let n = 0;
  // 削除したキャラクターを、利用者の獲得、ホーム、移した記録、観光ルートから外す
  for (const u of store.users()) {
    const gone = id => !W().charById.has(id);
    const ids = Object.keys(u.characters || {}).filter(gone);
    for (const id of ids) { delete u.characters[id]; if (u.travelLogs) delete u.travelLogs[id]; n++; }
    u.homeCharacterIds = (u.homeCharacterIds || []).filter(id => !gone(id));
    if (!u.homeCharacterIds.length) u.homeCharacterIds = Object.keys(u.characters).slice(0, 1);
    if (u.selectedCharacterId && gone(u.selectedCharacterId)) { u.selectedCharacterId = u.homeCharacterIds[0] || null; n++; }
    if (Array.isArray(u.routes)) { const before = u.routes.length; u.routes = u.routes.filter(r => !gone(r.characterId)); n += before - u.routes.length; }
  }
  for (const u of store.users()) {
    const since = u.createdAt - 95 * DAY;
    for (const c of W().CHARACTERS.filter(c => c.initial)) {
      const own = u.characters[c.id];
      if (!own || !own.initial || own.acquiredAt <= since) continue;
      own.acquiredAt = since; n++;
      for (const a of c.homeAreas) if (u.areas[a] && u.areas[a].acquiredAt > since) u.areas[a].acquiredAt = since;
    }
  }
  if (n) { store.save(); console.log(`利用者の履歴を3か月分にそろえました（${n}件）`); }
}

function start() {
  migrateUsers();
  spotDb.startScheduler();
  const server = app.listen(PORT, HOST, () => console.log(`ミニ推し！ http://localhost:${PORT}`));
  // 他の人の推しの足取りを先に計算しておく
  setTimeout(() => { for (const t of travelerChar.values()) sim.dayOf(t, travelerWho(t), today()); }, 50);
  try {
    const orgs = require('./lib/orgs').create();
    require('./admin/server').start({ content, store, spotDb, sim, calendar, planner, whoOf, charOut, travelerChar, travelerWho, encountersOn, orgs, router });
    require('./admin/org-server').start({ content, store, sim, orgs, router }); // 自治体などの管理画面（ポート3200）
  } catch (e) { console.error('管理画面を起動できませんでした', e.message); }
  const stop = () => { store.flush(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  return server;
}

if (require.main === module) start();

module.exports = { app, start, journeyPayload, whoOf, sim, store, content, statePayload, encountersOn, travelerChar, travelerWho, spotDb, planner };
