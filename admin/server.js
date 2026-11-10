/**
 * admin/server.js
 * 運営の管理画面（ポート3100）。ユーザー向けのアプリから完全に独立させた。
 *
 * - HOST の指定にかかわらず、常に 127.0.0.1 のみで受け付ける（このPCからだけ開ける）
 * - 画面は admin/public/ にあり、ユーザー向けの public/ からは配信せず、リンクも張らない
 * - ログインはユーザーとは別。環境変数 ADMIN_ID と ADMIN_PASSWORD で指定する（未指定なら README のデモ用の値）
 * - 編集内容は data/content.json に保存する（lib/content.js）。ユーザーの進行状況 data/state.json とは分けている
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cal = require('../lib/calendar');
const { createSimulator } = require('../lib/simulator');
const guard = require('../lib/guard');
const { parseCookies } = guard;
const { qrPng } = require('../lib/assets');

const ADMIN_PORT = Number(process.env.ADMIN_PORT || 3100);
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mini-oshi-admin';
const COOKIE = 'mo_admin';

function start(ctx) {
  const { content, store, spotDb, sim, calendar, whoOf, orgs, router } = ctx;
  const W = () => content.get();
  const sessions = new Map(); // トークンのハッシュ → 期限
  const hash = t => crypto.createHash('sha256').update(t).digest('hex');
  const fails = guard.loginGuard(); // 接続元ごとに数える（以前はサーバ全体で1つで、だれかが5回失敗すると全員が締め出された）
  if (!process.env.ADMIN_PASSWORD) console.warn('【注意】管理画面のパスワードがデモ用の値のままです。公開する前に環境変数 ADMIN_PASSWORD を設定してください');

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cyberjapandata.gsi.go.jp; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(guard.sameOrigin); // 別のポート（利用者のアプリなど）からの書きこみを断る
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(require('../lib/assets').UPLOAD_DIR)); // 自治体から申請された絵を確かめる
  app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets')));
  app.use('/vendor', express.static(path.join(__dirname, '..', 'public', 'vendor'))); // マップの画面で使う Leaflet
  app.use('/shared', express.static(path.join(__dirname, 'shared')));

  const authed = req => { const t = parseCookies(req.headers.cookie)[COOKIE]; const exp = t && sessions.get(hash(t)); return exp && exp > Date.now(); };
  const bad = (res, s, e) => res.status(s).json({ error: e });
  const by = 'admin';

  app.post('/admin/api/login', (req, res) => {
    if (fails.locked(req, 'admin')) return bad(res, 429, 'しばらく待ってからお試しください');
    const { id, password } = req.body || {};
    const ok = typeof id === 'string' && typeof password === 'string' && id === ADMIN_ID &&
      crypto.timingSafeEqual(crypto.createHash('sha256').update(password).digest(), crypto.createHash('sha256').update(ADMIN_PASSWORD).digest());
    if (!ok) { fails.fail(req, 'admin'); return bad(res, 401, 'IDかパスワードが違います'); }
    fails.ok(req, 'admin');
    for (const [k, exp] of sessions) if (exp <= Date.now()) sessions.delete(k); // 期限切れのログインを片づける
    const t = crypto.randomBytes(24).toString('hex');
    sessions.set(hash(t), Date.now() + 8 * 3600000);
    res.setHeader('Set-Cookie', `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${8 * 3600}`);
    content.logOnly('login', '管理画面にログイン', by);
    res.json({ ok: true });
  });
  app.post('/admin/api/logout', (req, res) => { const t = parseCookies(req.headers.cookie)[COOKIE]; if (t) sessions.delete(hash(t)); res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`); res.json({ ok: true }); });
  app.use('/admin/api', (req, res, next) => (authed(req) ? next() : bad(res, 401, 'ログインしてください')));
  app.get('/admin/api/me', (req, res) => res.json({ ok: true, id: ADMIN_ID }));

  /* ---- ダッシュボード ---- */
  app.get('/admin/api/dashboard', (req, res) => {
    const users = store.users(); const today = cal.dayKey(Date.now());
    const charCount = {}, areaCount = {}, placeCount = {};
    let routes = 0, withEvent = 0, future = 0;
    for (const u of users) {
      for (const id of Object.keys(u.characters || {})) charCount[id] = (charCount[id] || 0) + 1;
      for (const id of Object.keys(u.areas || {})) areaCount[id] = (areaCount[id] || 0) + 1;
      for (const r of u.routes || []) { routes++; if (r.event) withEvent++; if (r.day > today) future++; for (const s of r.stops || []) placeCount[s.placeId] = (placeCount[s.placeId] || 0) + 1; }
    }
    const top = (o, map) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ id, name: map(id), n }));
    res.json({
      users: users.length, loggedIn: users.filter(u => u.loginId).length,
      acquisitions: Object.values(charCount).reduce((a, b) => a + b, 0), routes, withEvent, future,
      unreadReports: store.db().reports.filter(r => r.status === 'unread').length,
      popularChars: top(charCount, id => (W().charById.get(id) || {}).name || id),
      areas: top(areaCount, id => (W().areaById.get(id) || {}).name || id),
      places: top(placeCount, id => (W().placeById.get(id) || {}).name || id),
      spotDb: spotDb.info(),
    });
  });

  /* ---- 作品 ---- */
  app.get('/admin/api/works', (req, res) => res.json(W().WORKS));
  app.put('/admin/api/works/:id', (req, res) => { if (!W().workById.get(req.params.id)) return bad(res, 404, 'not found'); const p = pick(req.body, ['title', 'kind', 'kindLabel', 'theme', 'synopsis', 'rights']); if (p.theme && !['teal', 'mint', 'yellow'].includes(p.theme)) return bad(res, 400, '世界の色は teal / mint / yellow'); content.update('WORKS', req.params.id, p, by); res.json({ ok: true }); });
  app.post('/admin/api/works', (req, res) => { const p = pick(req.body, ['id', 'title', 'kind', 'kindLabel', 'theme', 'synopsis', 'rights']); if (!/^[a-z0-9-]{2,30}$/.test(p.id || '')) return bad(res, 400, 'IDは半角英小文字と数字'); if (W().workById.get(p.id)) return bad(res, 409, '同じIDがあります'); content.add('WORKS', Object.assign({ theme: 'mint' }, p), by); res.json({ ok: true }); });
  app.delete('/admin/api/works/:id', (req, res) => { if (W().CHARACTERS.some(c => c.workId === req.params.id)) return bad(res, 409, 'この作品のキャラがいるため消せません'); content.remove('WORKS', req.params.id, by); res.json({ ok: true }); });

  /* ---- キャラ設定 ---- */
  app.get('/admin/api/characters', (req, res) => res.json(W().CHARACTERS.map(c => ({ ...c, canon: W().CANON[c.id] || {} }))));
  app.put('/admin/api/characters/:id', (req, res) => {
    const c = W().charById.get(req.params.id); if (!c) return bad(res, 404, 'not found');
    const p = pick(req.body, ['tagline', 'stride', 'speed', 'active', 'vehicle', 'curiosity', 'range', 'interests']);
    for (const k of ['stride', 'speed', 'vehicle', 'curiosity', 'range']) if (p[k] !== undefined && !(Number(p[k]) >= 0)) return bad(res, 400, k + ' の値が正しくありません'); else if (p[k] !== undefined) p[k] = Number(p[k]);
    content.update('CHARACTERS', c.id, p, by); res.json({ ok: true });
  });
  app.put('/admin/api/characters/:id/canon', (req, res) => {
    if (!W().charById.get(req.params.id)) return bad(res, 404, 'not found');
    const canon = req.body && req.body.canon;
    if (!canon || typeof canon !== 'object') return bad(res, 400, 'JSONが正しくありません');
    content.setCanon(req.params.id, canon, by); res.json({ ok: true });
  });
  // 指定の日と天気で行動を試す（保存しない）
  app.post('/admin/api/characters/:id/try', (req, res) => {
    const c = W().charById.get(req.params.id); if (!c) return bad(res, 404, 'not found');
    const day = cal.validDay((req.body || {}).day) ? req.body.day : cal.dayKey(Date.now());
    const weather = ['sun', 'cloud', 'rain'].includes((req.body || {}).weather) ? req.body.weather : null;
    const areaId = W().areaById.get((req.body || {}).areaId) ? req.body.areaId : c.homeAreas[0];
    const tryCal = Object.assign({}, calendar, {
      weatherOf: (d, region) => (weather && d === day ? weather : calendar.weatherOf(d, region)),
      hourlyOf: (d, region) => (weather && d === day ? calendar.hourlyWeather(weather, d, region) : calendar.hourlyOf(d, region)),
      rainingAt: (ms, region) => { const d = cal.dayKey(ms); const h = (weather && d === day ? calendar.hourlyWeather(weather, d, region) : calendar.hourlyOf(d, region)); return h[Math.floor(cal.minuteOfDay(ms) / 60)] === 'rain'; },
    });
    const s2 = createSimulator({ content, router: require('../lib/router').load(W()), calendar: tryCal });
    const r = s2.dayOf(c, { key: 'admin-try', log: [{ at: cal.dayStart(day) - 3600000, areaId }], areas: Object.fromEntries(W().AREAS.map(a => [a.id, 0])), affinity: spotDb.affinityFor(c.id) }, day);
    res.json({ day, weather: tryCal.weatherOf(day, (W().areaById.get(areaId) || {}).region), steps: r.steps, walkM: r.walkM, items: r.items.map(i => ({ at: i.at, text: i.text, sub: i.sub || '' })) });
  });

  /* ---- 場所 ---- */
  app.get('/admin/api/places', (req, res) => {
    const q = String(req.query.q || ''); const area = String(req.query.area || '');
    let list = W().PLACES.filter(p => (!area || p.area === area) && (!q || p.name.includes(q) || p.id.includes(q)));
    const total = list.length;
    if (req.query.real === '1') list = list.filter(p => !p.generated);
    res.json({ total, places: list.slice(0, 200).map(p => pick(p, ['id', 'area', 'name', 'cat', 'genre', 'desc', 'url', 'hours', 'always', 'closed', 'noRoute', 'outdoor', 'fictional', 'generated', 'model'])) });
  });
  app.put('/admin/api/places/:id', (req, res) => {
    if (!W().placeById.get(req.params.id)) return bad(res, 404, 'not found');
    const p = pick(req.body, ['name', 'desc', 'url', 'hours', 'closed', 'noRoute', 'outdoor']);
    if (p.url && !/^https?:\/\//.test(p.url)) return bad(res, 400, 'URLは http(s):// から');
    if (p.hours && !(Array.isArray(p.hours) && p.hours.length === 2 && p.hours.every(x => x >= 0 && x <= 24))) return bad(res, 400, '営業時間は [開く時, 閉じる時]');
    content.update('PLACES', req.params.id, p, by); res.json({ ok: true });
  });

  /* ---- イベント ---- */
  app.get('/admin/api/events', (req, res) => res.json(W().EVENTS.map(e => ({ ...e, reactions: W().CHARACTERS.map(c => ({ id: c.id, short: c.short, interest: Math.round(sim.eventInterest(c.id, e) * 100) / 100 })) }))));
  const evFields = b => pick(b, ['area', 'title', 'start', 'end', 'hours', 'placeId', 'tags', 'desc', 'url', 'tentative', 'hidden']);
  // 形と長さは lib/guard.js の eventProblem で確かめる（tags に文字列以外が入ると、推しの行動の計算が止まっていた）
  const evValid = p => !guard.eventProblem(p, cal.validDay) && (!p.area || W().areaById.get(p.area)) && (!p.placeId || W().placeById.get(p.placeId));
  app.post('/admin/api/events', (req, res) => { const p = evFields(req.body || {}); if (!p.title || !p.start || !p.end || !evValid(p)) return bad(res, 400, '題、エリア、日程を入れてください'); p.id = 'ev-' + crypto.randomBytes(4).toString('hex'); p.hours = p.hours || [10, 17]; p.tags = p.tags || []; content.add('EVENTS', p, by); res.json({ ok: true, id: p.id }); });
  app.put('/admin/api/events/:id', (req, res) => { const e = W().EVENTS.find(x => x.id === req.params.id); if (!e) return bad(res, 404, 'not found'); const p = evFields(req.body || {}); if (!evValid(p)) return bad(res, 400, '日程が正しくありません'); content.update('EVENTS', req.params.id, p, by); res.json({ ok: true }); });
  app.delete('/admin/api/events/:id', (req, res) => { content.remove('EVENTS', req.params.id, by); res.json({ ok: true }); });

  /* ---- 天気 ---- */
  app.get('/admin/api/weather', (req, res) => {
    const from = cal.validDay(req.query.from) ? req.query.from : cal.addDays(cal.dayKey(Date.now()), -7);
    const out = [];
    for (let i = 0; i < 28; i++) {
      const d = cal.addDays(from, i);
      for (const region of ['kansai', 'setouchi']) out.push({ day: d, region, weather: calendar.weatherOf(d, region), pseudo: calendar.pseudoWeather(d, region), override: (W().WEATHER_OVERRIDES || {})[region + '|' + d] || null, hourly: calendar.hourlyOf(d, region) });
    }
    res.json(out);
  });
  app.put('/admin/api/weather', (req, res) => {
    const { region, day, weather } = req.body || {};
    if (!['kansai', 'setouchi'].includes(region) || !cal.validDay(day) || !(weather === null || ['sun', 'cloud', 'rain'].includes(weather))) return bad(res, 400, '値が正しくありません');
    content.setWeather(region, day, weather, by); res.json({ ok: true });
  });

  /* ---- 獲得コード ---- */
  app.get('/admin/api/codes', (req, res) => { const uses = content.codeUses(); res.json(W().CODES.map(c => ({ ...c, enabled: c.enabled !== false, uses: uses[c.code] || 0 }))); });
  app.post('/admin/api/codes', (req, res) => {
    const p = pick(req.body, ['code', 'type', 'id']); p.code = String(p.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{6,40}$/.test(p.code)) return bad(res, 400, 'コードは英大文字、数字、ハイフン');
    if (!(p.type === 'character' ? W().charById.get(p.id) : p.type === 'area' ? W().areaById.get(p.id) : null)) return bad(res, 400, '獲得対象が正しくありません');
    if (W().CODES.some(c => c.code === p.code)) return bad(res, 409, '同じコードがあります');
    content.add('CODES', p, by); res.json({ ok: true });
  });
  app.put('/admin/api/codes/:code', (req, res) => { if (!W().CODES.some(c => c.code === req.params.code)) return bad(res, 404, 'not found'); content.update('CODES', req.params.code, { enabled: !!(req.body || {}).enabled }, by); res.json({ ok: true }); });

  /* ---- 解釈違いの報告 ---- */
  app.get('/admin/api/reports', (req, res) => res.json(store.db().reports.map(r => ({ ...r, uid: undefined, characterName: (W().charById.get(r.characterId) || {}).name || r.characterId }))));
  app.put('/admin/api/reports/:id', (req, res) => {
    const r = store.db().reports.find(x => x.id === req.params.id); if (!r) return bad(res, 404, 'not found');
    const status = (req.body || {}).status;
    if (!['unread', 'checked', 'shared'].includes(status)) return bad(res, 400, '状態が正しくありません');
    r.status = status; store.save(); content.logOnly('report', `報告 ${r.id} を ${status} に`, by); res.json({ ok: true });
  });

  /* ---- ユーザー（パスワードは見られない） ---- */
  app.get('/admin/api/users', (req, res) => res.json(store.users().sort((a, b) => b.createdAt - a.createdAt).slice(0, 500).map(u => ({ id: u.id.slice(0, 8), fullId: u.id, createdAt: u.createdAt, loginId: u.loginId || null, nickname: (u.profile || {}).nickname || '', characters: Object.keys(u.characters || {}).length, areas: Object.keys(u.areas || {}).length, routes: (u.routes || []).length, disabled: !!u.disabled }))));
  app.put('/admin/api/users/:id', (req, res) => { const u = store.user(req.params.id); if (!u) return bad(res, 404, 'not found'); u.disabled = !!(req.body || {}).disabled; store.save(); content.logOnly('user', `利用者 ${u.id.slice(0, 8)} を${u.disabled ? '停止' : '再開'}`, by); res.json({ ok: true }); });

  /* ---- 操作履歴 ---- */
  app.get('/admin/api/log', (req, res) => res.json(content.log()));

  /* ---- スポットDB ---- */
  app.get('/admin/api/spots', (req, res) => {
    const db = spotDb.all(); const q = String(req.query.q || '');
    const list = Object.values(db.spots || {}).filter(s => !q || s.name.includes(q)).slice(0, 150).map(s => {
      const best = Object.keys(db.scores || {}).map(cid => ({ id: cid, short: (W().charById.get(cid) || {}).short, score: ((db.scores[cid] || {})[s.id] || {}).score || 0 })).sort((a, b) => b.score - a.score).slice(0, 3);
      return { id: s.id, name: s.name, genre: s.genre, hours: s.hours, budget: s.budget, rating: s.rating, reviewCount: s.reviewCount, review: (s.reviews || [])[0], fictional: s.fictional, best };
    });
    res.json({ info: spotDb.info(), spots: list });
  });
  app.post('/admin/api/spots/run', (req, res) => { const r = spotDb.runBatch('admin'); content.logOnly('spots', `スポットDBを更新（${r.count}件）`, by); res.json(r); });

  /* ---- 自治体のアカウント（事務局が発行し、担当のエリアとキャラクターを決める） ---- */
  const scopeOk = b => (!b.areas || (Array.isArray(b.areas) && b.areas.every(a => W().areaById.get(a)))) && (!b.characters || (Array.isArray(b.characters) && b.characters.every(c => W().charById.get(c))));
  app.get('/admin/api/orgs', (req, res) => res.json({ orgs: orgs.list(), areas: W().AREAS.map(a => ({ id: a.id, name: a.name })), characters: W().CHARACTERS.map(c => ({ id: c.id, name: c.name })) }));
  app.post('/admin/api/orgs', (req, res) => {
    const b = pick(req.body, ['id', 'name', 'loginId', 'password', 'areas', 'characters']);
    if (!scopeOk(b)) return bad(res, 400, '担当のエリアかキャラクターが正しくありません');
    const r = orgs.add(b); if (r.error) return bad(res, 400, r.error);
    content.logOnly('org', `自治体のアカウント ${b.name} を作成`, by); res.json(r);
  });
  app.put('/admin/api/orgs/:id', (req, res) => {
    const b = pick(req.body, ['name', 'loginId', 'password', 'areas', 'characters', 'disabled']);
    if (!b.password) delete b.password;
    if (!scopeOk(b)) return bad(res, 400, '担当のエリアかキャラクターが正しくありません');
    const r = orgs.update(req.params.id, b); if (r.error) return bad(res, 400, r.error);
    content.logOnly('org', `自治体のアカウント ${r.org.name} を変更${b.password ? '（パスワードを再発行）' : ''}`, by); res.json(r);
  });
  app.delete('/admin/api/orgs/:id', (req, res) => { const o = orgs.get(req.params.id); if (!o) return bad(res, 404, 'not found'); orgs.remove(o.id); content.logOnly('org', `自治体のアカウント ${o.name} を削除`, by); res.json({ ok: true }); });

  /* ---- 自治体からのキャラクターの変更の申請（承認すると反映） ---- */
  app.get('/admin/api/requests', (req, res) => res.json(orgs.requests({ status: req.query.status || undefined }).map(r => {
    const c = W().charById.get(r.characterId); const canon = W().CANON[r.characterId] || {};
    return Object.assign({}, r, { characterName: c ? c.name : r.characterId, current: { character: c ? { tagline: c.tagline, interests: c.interests, look: c.look, stride: c.stride, speed: c.speed, vehicle: c.vehicle, curiosity: c.curiosity, range: c.range, ng: c.ng || null } : {}, canon: Object.fromEntries(Object.keys(r.canon).map(k => [k, canon[k] === undefined ? null : canon[k]])) } });
  })));
  app.put('/admin/api/requests/:id', (req, res) => {
    const r = orgs.review(req.params.id, (req.body || {}).decision, (req.body || {}).comment, content);
    if (r.error) return bad(res, 400, r.error);
    content.logOnly('request', `${r.request.orgName} の申請を${r.request.status === 'approved' ? '承認' : '差し戻し'}`, by); res.json(r);
  });

  /* ---- 獲得コードのQRコード ---- */
  app.get('/admin/api/codes/:code/qr.png', async (req, res) => {
    const c = W().CODES.find(x => x.code === req.params.code); if (!c) return bad(res, 404, 'not found');
    const png = await qrPng(c.code, Math.max(200, Math.min(1200, Number(req.query.size) || 480)));
    res.setHeader('Content-Type', 'image/png');
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${c.code.toLowerCase()}.png"`);
    res.send(png);
  });

  /* ---- マップ（エリアと場所を地図の上で作る・直す。実在の場所を集める。道のデータを作る。lib/map-admin.js） ---- */
  require('../lib/map-admin').mountMapApi(app, '/admin/api', { content, router, sim, scopeOf: () => ({ areas: null, admin: true }), byOf: () => by });

  app.use('/admin/api', (req, res) => bad(res, 404, 'not found'));
  app.use(guard.errorHandler); // 例外の中身を返さない
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  // 常に 127.0.0.1 のみで受け付ける
  const server = app.listen(ADMIN_PORT, '127.0.0.1', () => console.log(`管理画面 http://localhost:${ADMIN_PORT}（このPCのみ）`));
  return server;
}

function pick(o, keys) { const out = {}; for (const k of keys) if (o && o[k] !== undefined) out[k] = o[k]; return out; }

module.exports = { start };
