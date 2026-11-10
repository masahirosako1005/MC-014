/**
 * lib/map-admin.js
 * 管理画面の「マップ」のAPI。事務局の管理画面（admin/server.js）と、自治体の管理画面（admin/org-server.js）で共通に使う。
 *
 *   GET    {base}/map                 エリア、場所、乗り物の線（担当の範囲だけ）
 *   POST   {base}/areas               エリアを足す（事務局だけ）。範囲は地図の上で描いた多角形
 *   PUT    {base}/areas/:id           エリアの名前、範囲、最初の駅などを直す（事務局だけ）
 *   DELETE {base}/areas/:id           足したエリアを消す（事務局だけ）
 *   POST   {base}/places              場所（スポット）を足す。アニメの聖地などは、作品を選んで「聖地」にできる
 *   PUT    {base}/map/places/:id      場所を直す、動かす（同じエリアの中だけ）
 *   DELETE {base}/map/places/:id      足した場所を消す（最初からある場所は隠す）
 *   POST   {base}/areas/:id/collect   実在の場所を自動で集める（lib/place-collector.js）
 *   POST   {base}/areas/:id/roads     道のデータを作る（事務局だけ。tools/build-routes.js）
 *   GET    {base}/jobs/:id            集める・作る処理の進み具合
 * 足したエリアと場所は data/content.json に、道のデータは data/routes.json に保存する。
 * 取得するのは国土地理院のベクトルタイル（道路中心線、地図の注記）だけ（大会規定で認められた国土地理院の無料サービス）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { inPoly } = require('./router');
const { collectPlaces } = require('./place-collector');

const AREA_ID = /^[a-z][a-z0-9-]{1,29}$/;
const inJapan = ([lat, lng]) => lat > 20 && lat < 46 && lng > 122 && lng < 154;
const validPoly = p => Array.isArray(p) && p.length >= 3 && p.length <= 300 && p.every(q => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite) && inJapan(q));
const centroid = p => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length].map(v => Math.round(v * 1e6) / 1e6);
const pick = (o, keys) => { const out = {}; for (const k of keys) if (o && o[k] !== undefined) out[k] = o[k]; return out; };
const jobs = new Map();

/**
 * @param {object} app express のアプリ
 * @param {string} base APIの頭（'/admin/api' や '/org/api'）
 * @param {object} o { content, router, sim, scopeOf(req) → { areas: Set|null（null はすべて）, admin: bool }, byOf(req) → 記録に残す名前 }
 */
function mountMapApi(app, base, o) {
  const { content, router, sim } = o;
  const W = () => content.get();
  const world = require('../data/world');
  const baseAreas = new Set(world.AREAS.map(a => a.id));
  const basePlaces = new Set(world.PLACES.map(p => p.id));
  const bad = (res, s, e) => res.status(s).json({ error: e });
  const inScope = (req, areaId) => { const sc = o.scopeOf(req); return !sc.areas || sc.areas.has(areaId); };
  const adminOnly = (req, res) => { if (!o.scopeOf(req).admin) { bad(res, 403, 'エリアの追加と変更は事務局が行います'); return false; } return true; };
  const areaOfPoint = (pt, req) => (W().AREAS.find(a => inPoly(pt, a.polygon) && (!req || inScope(req, a.id))) || {}).id || null;

  app.get(base + '/map', (req, res) => {
    const w = W(); const sc = o.scopeOf(req);
    const areas = w.AREAS.filter(a => inScope(req, a.id));
    const ids = new Set(areas.map(a => a.id));
    res.json({
      admin: !!sc.admin,
      areas: areas.map(a => Object.assign({}, a, { added: !baseAreas.has(a.id), hasRoads: router.hasArea(a.id), roadBounds: ((router.data.areas || {})[a.id] || {}).bounds || null,
        placeCount: w.PLACES.filter(p => p.area === a.id && !p.hidden).length, collectedCount: w.PLACES.filter(p => p.area === a.id && p.collected && !p.hidden).length })),
      // [id, 名前, 種類, 緯度, 経度, エリア, 印（1: 架空の生成, 2: 架空, 4: 足した, 8: 隠した, 16: 休止, 32: 自動で集めた, 64: 聖地）]
      places: w.PLACES.filter(p => p.cat !== 'home' && ids.has(p.area)).map(p => [p.id, p.name, p.cat, p.lat, p.lng, p.area,
        (p.generated ? 1 : 0) | (p.fictional ? 2 : 0) | (basePlaces.has(p.id) ? 0 : 4) | (p.hidden ? 8 : 0) | (p.closed ? 16 : 0) | (p.collected ? 32 : 0) | (p.seichi ? 64 : 0)]),
      lines: w.TRANSIT.map(l => ({ id: l.id, name: l.name, mode: l.mode, stops: l.stops.map(id => { const p = w.placeById.get(id) || (l.extraStops || []).find(s => s.id === id); return p ? [p.lat, p.lng, p.name] : null; }).filter(Boolean) })),
      categories: Object.fromEntries(Object.entries(w.CATEGORIES).filter(([k]) => k !== 'home')),
      works: w.WORKS.map(x => ({ id: x.id, title: x.title })),
      regions: [{ id: 'kansai', name: '関西' }, { id: 'setouchi', name: '瀬戸内' }],
    });
  });
  app.get(base + '/map/places/:id', (req, res) => {
    const p = W().placeById.get(req.params.id); if (!p || !inScope(req, p.area)) return bad(res, 404, '見つかりません');
    res.json(Object.assign({}, p, { added: !basePlaces.has(p.id), doing: undefined }));
  });

  /* ---- エリア（事務局だけ） ---- */
  function areaFields(b, isNew) {
    const p = pick(b, ['id', 'name', 'short', 'pref', 'region', 'polygon', 'intro', 'url', 'urban', 'arrival']);
    if (isNew && !AREA_ID.test(p.id || '')) return { error: 'エリアのIDは半角英小文字で始まる、英小文字・数字・ハイフン（2〜30文字）にしてください' };
    if (isNew && W().areaById.get(p.id)) return { error: '同じIDのエリアがあります' };
    if (p.name !== undefined && !(typeof p.name === 'string' && p.name.trim().length >= 2 && p.name.length <= 30)) return { error: 'エリアの名前は2〜30文字（例: 広島県福山市）' };
    if (p.short !== undefined && !(typeof p.short === 'string' && p.short.trim() && p.short.length <= 12)) return { error: '短い名前は12文字まで（例: 福山市）' };
    if (p.region !== undefined && !['kansai', 'setouchi'].includes(p.region)) return { error: '天気の地方を選んでください' };
    if (p.polygon !== undefined) { if (!validPoly(p.polygon)) return { error: '範囲は3点以上で描いてください' }; p.polygon = p.polygon.map(q => q.map(v => Math.round(v * 1e5) / 1e5)); p.center = centroid(p.polygon); }
    if (p.url && !/^https?:\/\//.test(p.url)) return { error: 'URLは http(s):// から' };
    if (p.intro !== undefined && !(typeof p.intro === 'string' && p.intro.length <= 300)) return { error: '紹介は300文字まで' };
    if (p.arrival !== undefined && p.arrival !== null && !W().placeById.get(p.arrival)) return { error: '最初の駅が見つかりません' };
    if (p.urban !== undefined) p.urban = !!p.urban;
    return { p };
  }
  app.post(base + '/areas', (req, res) => {
    if (!adminOnly(req, res)) return;
    const { p, error } = areaFields(req.body || {}, true); if (error) return bad(res, 400, error);
    if (!p.polygon || !p.name) return bad(res, 400, '名前と範囲を入れてください');
    const pref = (p.name.match(/^.+?[都道府県]/) || [''])[0];
    content.add('AREAS', Object.assign({ short: p.name.slice(pref.length) || p.name, pref, region: 'setouchi', intro: '', url: '', urban: false, arrival: null }, p), o.byOf(req));
    res.json({ ok: true, id: p.id });
  });
  app.put(base + '/areas/:id', (req, res) => {
    if (!adminOnly(req, res)) return;
    if (!W().areaById.get(req.params.id)) return bad(res, 404, '見つかりません');
    const { p, error } = areaFields(Object.assign({}, req.body || {}, { id: undefined }), false); if (error) return bad(res, 400, error);
    delete p.id;
    if (p.arrival && W().placeById.get(p.arrival).area !== req.params.id) return bad(res, 400, '最初の駅は、そのエリアの場所を選んでください');
    content.update('AREAS', req.params.id, p, o.byOf(req));
    res.json({ ok: true });
  });
  app.delete(base + '/areas/:id', (req, res) => {
    if (!adminOnly(req, res)) return;
    const a = W().areaById.get(req.params.id); if (!a) return bad(res, 404, '見つかりません');
    if (baseAreas.has(a.id)) return bad(res, 400, '最初からあるエリアは消せません（範囲や名前の変更はできます）');
    if (W().CHARACTERS.some(c => c.homeAreas.includes(a.id))) return bad(res, 400, '地元にしているキャラクターがいるため消せません');
    for (const p of W().PLACES.filter(p => p.area === a.id && !basePlaces.has(p.id))) content.remove('PLACES', p.id, o.byOf(req));
    content.remove('AREAS', a.id, o.byOf(req));
    res.json({ ok: true });
  });

  /* ---- 場所（スポット） ---- */
  function placeFields(b, w) {
    const p = pick(b, ['name', 'cat', 'lat', 'lng', 'hours', 'always', 'outdoor', 'desc', 'url', 'address', 'stay', 'closed', 'hidden', 'seichi', 'genre']);
    if (p.name !== undefined && !(typeof p.name === 'string' && p.name.trim() && p.name.length <= 40)) return { error: '名前は40文字まで' };
    if (p.cat !== undefined && (!Object.prototype.hasOwnProperty.call(w.CATEGORIES, String(p.cat)) || ['home', 'school'].includes(p.cat))) return { error: '場所の種類を選んでください' };
    if ((p.lat !== undefined || p.lng !== undefined) && !(Number.isFinite(p.lat) && Number.isFinite(p.lng) && inJapan([p.lat, p.lng]))) return { error: '位置が正しくありません' };
    if (p.hours !== undefined && p.hours !== null && !(Array.isArray(p.hours) && p.hours.length === 2 && p.hours.every(x => Number.isFinite(x) && x >= 0 && x <= 24) && p.hours[0] < p.hours[1])) return { error: '営業時間は [開く時, 閉じる時]（開く時のほうが早く）' };
    if (p.url && !/^https?:\/\//.test(p.url)) return { error: 'URLは http(s):// から' };
    if (p.desc !== undefined && !(typeof p.desc === 'string' && p.desc.length <= 300)) return { error: '説明は300文字まで' };
    if (p.address !== undefined && !(typeof p.address === 'string' && p.address.length <= 80)) return { error: '住所は80文字まで' };
    if (p.genre !== undefined && !(typeof p.genre === 'string' && p.genre.length <= 20)) return { error: 'ジャンルは20文字まで' };
    if (p.stay !== undefined) { if (!(Number(p.stay) >= 5 && Number(p.stay) <= 600)) return { error: '滞在の目安は5〜600分' }; p.stay = Number(p.stay); }
    if (p.seichi !== undefined && p.seichi !== null) {
      // アニメの聖地など: どの作品の、どんな場面の場所か。その作品の推しは、この場所に立ち寄りやすくなる
      const s = p.seichi;
      if (!(s && typeof s === 'object' && w.workById.get(s.workId))) return { error: '聖地の作品を選んでください' };
      if (s.note !== undefined && !(typeof s.note === 'string' && s.note.length <= 120)) return { error: '聖地の説明は120文字まで' };
      p.seichi = { workId: s.workId, note: String(s.note || '') };
    }
    if (p.lat !== undefined) { p.lat = Math.round(p.lat * 1e6) / 1e6; p.lng = Math.round(p.lng * 1e6) / 1e6; }
    for (const k of ['always', 'outdoor', 'closed', 'hidden']) if (p[k] !== undefined) p[k] = !!p[k];
    if (p.always) p.hours = null;
    return { p };
  }
  app.post(base + '/places', (req, res) => {
    const { p, error } = placeFields(req.body || {}, W()); if (error) return bad(res, 400, error);
    if (!p.name || !p.cat || p.lat === undefined) return bad(res, 400, '名前、種類、位置を入れてください');
    const area = areaOfPoint([p.lat, p.lng], req);
    if (!area) return bad(res, 400, '担当のエリアの範囲の中に置いてください');
    const id = 'p-' + crypto.randomBytes(4).toString('hex');
    content.add('PLACES', Object.assign({ id, area, hours: p.always ? null : [9, 18], always: false, outdoor: false, stay: 40, desc: '', address: '', url: '', addedBy: o.byOf(req) }, p), o.byOf(req));
    res.json({ ok: true, id, area });
  });
  app.put(base + '/map/places/:id', (req, res) => {
    const cur = W().placeById.get(req.params.id); if (!cur || !inScope(req, cur.area)) return bad(res, 404, '担当のエリアの場所ではありません');
    if (cur.cat === 'home') return bad(res, 400, '推しの家は動かせません');
    const { p, error } = placeFields(req.body || {}, W()); if (error) return bad(res, 400, error);
    if (p.lat !== undefined && areaOfPoint([p.lat, p.lng]) !== cur.area) return bad(res, 400, 'ほかのエリアには動かせません（エリアの範囲の中で動かしてください）');
    if ((p.lat !== undefined || p.cat !== undefined) && W().TRANSIT.some(l => l.stops.includes(cur.id))) return bad(res, 400, '乗り物の乗り場は、動かしたり種類を変えたりできません');
    content.update('PLACES', cur.id, p, o.byOf(req));
    res.json({ ok: true });
  });
  app.delete(base + '/map/places/:id', (req, res) => {
    const cur = W().placeById.get(req.params.id); if (!cur || !inScope(req, cur.area)) return bad(res, 404, '担当のエリアの場所ではありません');
    if (W().AREAS.some(a => a.arrival === cur.id)) return bad(res, 400, 'エリアの最初の駅になっているので消せません');
    if (W().TRANSIT.some(l => l.stops.includes(cur.id))) return bad(res, 400, '乗り物の乗り場になっているので消せません');
    if (W().CHARACTERS.some(c => c.home === cur.id) || W().EVENTS.some(e => e.placeId === cur.id)) return bad(res, 400, '推しの家やイベントの会場になっているので消せません');
    if (basePlaces.has(cur.id)) content.update('PLACES', cur.id, { hidden: true }, o.byOf(req)); // 最初からある場所は消さずに隠す
    else content.remove('PLACES', cur.id, o.byOf(req));
    res.json({ ok: true });
  });

  /* ---- 実在の場所を自動で集める ---- */
  const running = () => [...jobs.values()].some(j => j.state === 'running');
  app.post(base + '/areas/:id/collect', (req, res) => {
    const a = W().areaById.get(req.params.id); if (!a || !inScope(req, a.id)) return bad(res, 404, '担当のエリアではありません');
    if (running()) return bad(res, 409, 'ほかの処理をしています。終わってからお試しください');
    const bounds = ((router.data.areas || {})[a.id] || {}).bounds || null; // 道のデータがあるときはその範囲（推しが歩ける範囲）で集める
    const job = { id: crypto.randomBytes(5).toString('hex'), kind: 'collect', areaId: a.id, state: 'running', done: 0, total: 0, startedAt: Date.now(), message: '国土地理院の地図から、実在の場所を集めています' };
    jobs.set(job.id, job);
    (async () => {
      try {
        const existing = W().PLACES.filter(p => p.area === a.id);
        const found = await collectPlaces(a, existing, bounds, (d, t) => { job.done = d; job.total = t; });
        for (const p of found) content.add('PLACES', Object.assign({ id: 'c-' + crypto.randomBytes(4).toString('hex') }, p), o.byOf(req));
        Object.assign(job, { state: 'done', added: found.length, message: found.length ? `実在の場所を${found.length}か所足しました（説明は書き足せます）` : '新しく足す場所はありませんでした' });
        content.logOnly('collect', `${a.name} の実在の場所を自動で集めた（${found.length}か所）`, o.byOf(req));
      } catch (e) { Object.assign(job, { state: 'error', message: e.message }); }
    })();
    res.json({ ok: true, job });
  });

  /* ---- 道のデータを作る（事務局だけ） ---- */
  function roadBounds(a) {
    const pts = W().PLACES.filter(p => p.area === a.id && !p.hidden && !p.generated).map(p => [p.lat, p.lng]);
    const src = pts.length >= 3 ? pts : a.polygon;
    const s = Math.min(...src.map(q => q[0])), n = Math.max(...src.map(q => q[0])), w = Math.min(...src.map(q => q[1])), e = Math.max(...src.map(q => q[1]));
    const m = 0.006; // 約600mの余白
    return [s - m, w - m, n + m, e + m].map(v => Math.round(v * 1e4) / 1e4);
  }
  app.post(base + '/areas/:id/roads', (req, res) => {
    if (!adminOnly(req, res)) return;
    const a = W().areaById.get(req.params.id); if (!a) return bad(res, 404, '見つかりません');
    if (running()) return bad(res, 409, 'ほかの処理をしています。終わってからお試しください');
    const { buildAreaGraph, tileCount } = require('../tools/build-routes');
    const b = roadBounds(a);
    const tiles = tileCount(b);
    if (tiles > 400) return bad(res, 400, `範囲が広すぎます（タイル${tiles}枚）。推しが歩く町の中心に場所を置いてから作ってください（400枚まで）`);
    const job = { id: crypto.randomBytes(5).toString('hex'), kind: 'roads', areaId: a.id, state: 'running', done: 0, total: tiles, startedAt: Date.now(), bounds: b, message: '国土地理院から道路のデータを取得しています' };
    jobs.set(job.id, job);
    content.logOnly('roads', `${a.name} の道のデータを作りはじめた（タイル${tiles}枚）`, o.byOf(req));
    (async () => {
      try {
        const g = await buildAreaGraph(b, (d, t) => { job.done = d; job.total = t; });
        if (!g.nodes.length) throw new Error('この範囲には道路のデータがありませんでした');
        job.message = '道のデータを組み立てています';
        const file = path.join(__dirname, '..', 'data', 'routes.json');
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        data.areas[a.id] = g; data.version = Date.now();
        fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file);
        router.reload(W(), data); if (sim) sim.clear();
        Object.assign(job, { state: 'done', message: `道のデータを作りました（交差点 ${g.nodes.length}、道 ${g.edges.length}）` });
        content.logOnly('roads', `${a.name} の道のデータを作った（交差点 ${g.nodes.length}）`, o.byOf(req));
      } catch (e) { Object.assign(job, { state: 'error', message: e.message }); }
    })();
    res.json({ ok: true, job });
  });
  app.get(base + '/jobs/:id', (req, res) => { const j = jobs.get(req.params.id); if (!j || !inScope(req, j.areaId)) return bad(res, 404, '見つかりません'); res.json(j); });
}

module.exports = { mountMapApi, jobs };
