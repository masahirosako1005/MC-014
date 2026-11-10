/**
 * admin/org-server.js
 * 自治体など（アカウントユーザー）の管理画面（ポート3200）。
 *
 * 事務局が発行したアカウントでログインし、担当のエリアとキャラクターに関わるものだけを扱う。
 *   - キャラクターのカスタマイズ（紹介、性格、好きなもの、日常、作中の出来事、関心、絵）… 申請して、事務局の承認後に反映
 *   - キャラクターとエリアの獲得コードの管理と、QRコードのダウンロード、掲示用の一覧の印刷 … すぐに反映
 *   - 担当エリアのイベントの登録と編集、場所の情報の編集 … すぐに反映
 *   - 担当キャラクターの解釈違いの報告の確認、獲得や観光ルートの集計
 * ユーザー向けの画面（public/）とも、事務局の管理画面（admin/public/）とも別に配信する。
 * デモでは 127.0.0.1 のみで受け付ける（本番では HTTPS で外部から接続できるようにする）。
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cal = require('../lib/calendar');
const guard = require('../lib/guard');
const { parseCookies, own } = guard;
const { qrPng, saveCharacterImage, UPLOAD_DIR } = require('../lib/assets');
const rag = require('../lib/rag');

const ORG_PORT = Number(process.env.ORG_PORT || 3200);
const COOKIE = 'mo_org';
const CODE_RE = /^[A-Z0-9-]{6,40}$/;

function start(ctx) {
  const { content, store, sim, orgs, router } = ctx;
  const W = () => content.get();
  const sessions = new Map(); // トークンのハッシュ → { orgId, exp }
  const fails = guard.loginGuard(); // IDと接続元の組で数え、時間がたてば忘れる
  const hash = t => crypto.createHash('sha256').update(t).digest('hex');

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://cyberjapandata.gsi.go.jp; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(guard.sameOrigin); // 別のポート（利用者のアプリなど）からの書きこみを断る
  app.use(express.json({ limit: '3mb' })); // 絵の受け取りのため（中身は lib/assets.js で 1.5MB までに制限）
  app.use(express.static(path.join(__dirname, 'org-public')));
  app.use('/uploads', express.static(UPLOAD_DIR));
  app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets')));
  app.use('/vendor', express.static(path.join(__dirname, '..', 'public', 'vendor'))); // 場所の地図で使う Leaflet
  app.use('/shared', express.static(path.join(__dirname, 'shared')));

  const bad = (res, s, e) => res.status(s).json({ error: e });

  /* ---- ログイン ---- */
  app.post('/org/api/login', (req, res) => {
    const key = String((req.body || {}).loginId || '').toLowerCase();
    if (fails.locked(req, key)) return bad(res, 429, 'しばらく待ってからお試しください');
    const o = orgs.login((req.body || {}).loginId, (req.body || {}).password);
    if (!o) { fails.fail(req, key); return bad(res, 401, 'IDかパスワードが違います'); }
    fails.ok(req, key);
    for (const [k, s] of sessions) if (s.exp <= Date.now()) sessions.delete(k); // 期限切れのログインを片づける
    const t = crypto.randomBytes(24).toString('hex');
    sessions.set(hash(t), { orgId: o.id, exp: Date.now() + 8 * 3600000 });
    res.setHeader('Set-Cookie', `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${8 * 3600}`);
    content.logOnly('org-login', `${o.name} がログイン`, o.name);
    res.json({ ok: true });
  });
  app.post('/org/api/logout', (req, res) => { const t = parseCookies(req.headers.cookie)[COOKIE]; if (t) sessions.delete(hash(t)); res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`); res.json({ ok: true }); });
  app.use('/org/api', (req, res, next) => {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    const s = t && sessions.get(hash(t));
    const o = s && s.exp > Date.now() && orgs.get(s.orgId);
    if (!o || o.disabled) return bad(res, 401, 'ログインしてください');
    req.org = o;
    req.scope = { areas: new Set(o.areas), chars: new Set(o.characters) };
    next();
  });

  /* ---- 担当の範囲 ---- */
  const charIn = (req, id) => req.scope.chars.has(id) && W().charById.get(id);
  const codeIn = (req, c) => (c.type === 'character' ? req.scope.chars.has(c.id) : req.scope.areas.has(c.id));
  const by = req => req.org.name;
  const targetName = c => (c.type === 'character' ? (W().charById.get(c.id) || {}).name : (W().areaById.get(c.id) || {}).name) || c.id;

  app.get('/org/api/me', (req, res) => {
    const o = orgs.pub(req.org);
    res.json(Object.assign(o, {
      areaList: o.areas.map(id => ({ id, name: (W().areaById.get(id) || {}).name || id })),
      characterList: o.characters.map(id => W().charById.get(id)).filter(Boolean).map(c => ({ id: c.id, name: c.name, look: c.look })),
    }));
  });
  app.put('/org/api/account/password', (req, res) => {
    const err = orgs.changePassword(req.org.id, (req.body || {}).current, (req.body || {}).next);
    if (err) return bad(res, 400, err);
    // パスワードを変えたら、この自治体のほかのログイン（別の端末）は使えなくする
    const mine = hash(parseCookies(req.headers.cookie)[COOKIE] || '');
    for (const [k, s] of sessions) if (s.orgId === req.org.id && k !== mine) sessions.delete(k);
    content.logOnly('org-password', `${req.org.name} がパスワードを変更`, by(req));
    res.json({ ok: true });
  });

  /* ---- ダッシュボード（担当の範囲の集計） ---- */
  app.get('/org/api/dashboard', (req, res) => {
    const today = cal.dayKey(Date.now());
    const chars = {}, areas = {};
    let routes = 0, future = 0, withEvent = 0;
    for (const u of store.users()) {
      for (const id of Object.keys(u.characters || {})) if (req.scope.chars.has(id)) chars[id] = (chars[id] || 0) + 1;
      for (const id of Object.keys(u.areas || {})) if (req.scope.areas.has(id)) areas[id] = (areas[id] || 0) + 1;
      for (const r of u.routes || []) if (req.scope.areas.has(r.areaId)) { routes++; if (r.day > today) future++; if (r.event) withEvent++; }
    }
    const uses = content.codeUses();
    const codes = W().CODES.filter(c => codeIn(req, c));
    res.json({
      characters: [...req.scope.chars].map(id => ({ id, name: (W().charById.get(id) || {}).name || id, users: chars[id] || 0 })),
      areas: [...req.scope.areas].map(id => ({ id, name: (W().areaById.get(id) || {}).name || id, users: areas[id] || 0 })),
      codes: codes.length, codeUses: codes.reduce((s, c) => s + (uses[c.code] || 0), 0),
      routes, future, withEvent,
      pending: orgs.requests({ orgId: req.org.id, status: 'pending' }).length,
      unreadReports: store.db().reports.filter(r => req.scope.chars.has(r.characterId) && r.status === 'unread').length,
      upcomingEvents: W().EVENTS.filter(e => req.scope.areas.has(e.area) && e.end >= today && !e.hidden).length,
    });
  });

  /* ---- キャラクターのカスタマイズ（申請） ---- */
  app.get('/org/api/characters', (req, res) => {
    const list = [...req.scope.chars].map(id => W().charById.get(id)).filter(Boolean).map(c => {
      const canon = W().CANON[c.id] || {};
      return {
        id: c.id, name: c.name, short: c.short, tagline: c.tagline, look: c.look, interests: c.interests, workId: c.workId,
        stride: c.stride, speed: c.speed, vehicle: c.vehicle, curiosity: c.curiosity, range: c.range, ng: c.ng || { cats: [], words: [], quietAfter: null },
        work: (W().workById.get(c.workId) || {}).title || '',
        canon: Object.fromEntries(orgs.CANON_FIELDS.map(k => [k, canon[k] === undefined ? null : canon[k]])),
        pending: orgs.requests({ orgId: req.org.id, status: 'pending' }).filter(r => r.characterId === c.id).length,
      };
    });
    res.json({ characters: list, categories: W().CATEGORIES });
  });
  // 推しの説明の文章から、パラメータとNG行動を提案する（【AI差し替え箇所 8】本アプリではダミー。保存はしない）
  app.post('/org/api/characters/:id/suggest', (req, res) => {
    const c = charIn(req, req.params.id); if (!c) return bad(res, 404, '担当のキャラクターではありません');
    const text = String((req.body || {}).text || '');
    if (text.length > 2000) return bad(res, 400, '推しの説明は2000文字までにしてください');
    if (text.trim().length < 5 && !rag.list(c.id).length) return bad(res, 400, '推しの説明を5文字以上書くか、設定資料を登録してください');
    // 登録した設定資料（RAG）から関係のある部分を探して参照し、パラメータと特徴を作る（【AI差し替え箇所 9】本アプリではダミー）
    res.json(rag.generate(c.id, text, { interests: c.interests, stride: c.stride, speed: c.speed, vehicle: c.vehicle, curiosity: c.curiosity, range: c.range }));
  });
  /* ---- 設定資料（RAG） ---- */
  app.get('/org/api/characters/:id/docs', (req, res) => { if (!charIn(req, req.params.id)) return bad(res, 404, '担当のキャラクターではありません'); res.json({ docs: rag.list(req.params.id) }); });
  app.post('/org/api/characters/:id/docs', (req, res) => {
    const c = charIn(req, req.params.id); if (!c) return bad(res, 404, '担当のキャラクターではありません');
    const r = rag.addDoc(c.id, req.org.id, (req.body || {}).name, (req.body || {}).text);
    if (r.error) return bad(res, 400, r.error);
    content.logOnly('rag', `${req.org.name} が ${c.name} の設定資料「${r.doc.name}」を登録`, by(req));
    res.json(r);
  });
  app.delete('/org/api/characters/:id/docs/:docId', (req, res) => {
    if (!charIn(req, req.params.id)) return bad(res, 404, '担当のキャラクターではありません');
    if (!rag.remove(req.params.id, req.params.docId)) return bad(res, 404, '資料が見つかりません');
    res.json({ ok: true });
  });
  app.post('/org/api/characters/:id/image', (req, res) => {
    if (!charIn(req, req.params.id)) return bad(res, 404, '担当のキャラクターではありません');
    // 今の絵と、確認待ちの申請で使っている絵は消さない（それ以外の古い絵は10枚を超えたら消す）
    const c = W().charById.get(req.params.id);
    const keep = [(c.look || {}).image].concat(orgs.requests({ status: 'pending' }).filter(r => r.characterId === c.id).map(r => ((r.character || {}).look || {}).image));
    const r = saveCharacterImage(req.params.id, (req.body || {}).data, keep.filter(Boolean));
    if (r.error) return bad(res, 400, r.error);
    res.json(r);
  });
  app.post('/org/api/characters/:id/requests', (req, res) => {
    const c = charIn(req, req.params.id); if (!c) return bad(res, 404, '担当のキャラクターではありません');
    const b = req.body || {};
    const err = checkChanges(b, c.id);
    if (err) return bad(res, 400, err);
    const r = orgs.submit(req.org, c.id, { character: b.character || {}, canon: b.canon || {} }, b.note);
    if (r.error) return bad(res, 400, r.error);
    content.logOnly('org-request', `${req.org.name} が ${c.name} の変更を申請`, by(req));
    res.json(r);
  });
  app.get('/org/api/requests', (req, res) => res.json(orgs.requests({ orgId: req.org.id }).map(r => Object.assign({}, r, { characterName: (W().charById.get(r.characterId) || {}).name || r.characterId }))));

  /** 申請の中身を確かめる（形の正しくないものや、長すぎる文は受け付けない） */
  function checkChanges(b, charId) {
    for (const k of ['character', 'canon']) if (b[k] !== undefined && (!b[k] || typeof b[k] !== 'object' || Array.isArray(b[k]))) return '申請の形が正しくありません';
    const ch = b.character || {}, cn = b.canon || {};
    // 場所の種類は、本当にある種類だけ（__proto__ や constructor などの名前を通さない）
    const isCat = k => own(W().CATEGORIES, k);
    const str = (v, max) => typeof v === 'string' && v.length <= max;
    const strList = (v, n, max) => Array.isArray(v) && v.length <= n && v.every(x => str(x, max));
    if (ch.tagline !== undefined && !str(ch.tagline, 40)) return '紹介は40文字以内にしてください';
    if (ch.interests !== undefined) {
      if (!ch.interests || typeof ch.interests !== 'object' || Array.isArray(ch.interests)) return '関心の形が正しくありません';
      for (const [k, v] of Object.entries(ch.interests)) if (!isCat(k) || !(typeof v === 'number' && v >= 0 && v <= 2)) return '関心は場所の種類ごとに0〜2の数にしてください';
    }
    const num = (k, lo, hi, label) => (ch[k] !== undefined && !(typeof ch[k] === 'number' && ch[k] >= lo && ch[k] <= hi) ? `${label}は${lo}〜${hi}にしてください` : null);
    for (const e of [num('stride', 0.4, 1.0, '歩幅（m）'), num('speed', 40, 110, '分速（m）'), num('vehicle', 0, 1, '乗り物好き'), num('curiosity', 0, 1, '好奇心'), num('range', 500, 5000, '距離の許容（m）')]) if (e) return e;
    if (ch.ng !== undefined) {
      const g = ch.ng;
      if (!g || typeof g !== 'object' || Array.isArray(g)) return 'NG行動の形が正しくありません';
      if (!(Array.isArray(g.cats) && g.cats.length <= 20 && g.cats.every(k => isCat(k) && !['home', 'station', 'stay', 'school'].includes(k)))) return 'NG行動の場所の種類が正しくありません';
      if (!(Array.isArray(g.words) && g.words.length <= 20 && g.words.every(w => typeof w === 'string' && w.trim() && w.length <= 15))) return 'NG行動の言葉は20個まで、1つ15文字以内にしてください';
      if (!(g.quietAfter === null || g.quietAfter === undefined || (typeof g.quietAfter === 'number' && g.quietAfter >= 10 && g.quietAfter <= 24))) return '出歩かない時刻は10〜24時にしてください';
      // 決まった項目だけで作り直す（ほかの項目や重複を保存しない）
      ch.ng = { cats: [...new Set(g.cats)], words: [...new Set(g.words.map(w => w.trim()))], quietAfter: g.quietAfter === undefined ? null : g.quietAfter };
    }
    if (ch.look !== undefined) {
      const l = ch.look; if (!l || typeof l !== 'object' || Array.isArray(l)) return '見た目の形が正しくありません';
      for (const k of ['hair', 'color', 'bg']) if (l[k] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(l[k])) return '色は #RRGGBB の形にしてください';
      // 絵は、このキャラクターのために受け取ったものだけ（ほかのキャラクターの絵は選べない）
      if (l.image !== undefined && l.image !== null && !(typeof l.image === 'string' && l.image.startsWith(`assets/uploads/${charId}-`) && /^assets\/uploads\/[a-z0-9-]+\.(png|jpg|webp)$/.test(l.image))) return '絵は、この画面から受け取ったものだけ使えます';
      for (const k of Object.keys(l)) if (!['hair', 'color', 'bg', 'image', 'crop'].includes(k)) return '見た目の項目が正しくありません';
      if (l.crop !== undefined && l.crop !== null) return '切り抜きは指定できません';
    }
    if (cn.personality !== undefined && !strList(cn.personality, 8, 80)) return '性格は8項目まで、1つ80文字以内にしてください';
    if (cn.likes !== undefined && !strList(cn.likes, 12, 30)) return '好きなものは12項目まで、1つ30文字以内にしてください';
    if (cn.dislikes !== undefined && !strList(cn.dislikes, 12, 30)) return '苦手なものは12項目まで、1つ30文字以内にしてください';
    if (cn.commute !== undefined && !str(cn.commute, 300)) return 'いつもの道は300文字以内にしてください';
    for (const k of ['profile', 'relations']) if (cn[k] !== undefined && !(Array.isArray(cn[k]) && cn[k].length <= 10 && cn[k].every(p => Array.isArray(p) && p.length === 2 && str(p[0], 20) && str(p[1], 100)))) return 'プロフィールと関係は10項目まで（項目名20文字、内容100文字以内）にしてください';
    if (cn.episodes !== undefined && !(Array.isArray(cn.episodes) && cn.episodes.length <= 10 && cn.episodes.every(e => e && str(e.title, 40) && str(e.text, 300)))) return '作中の出来事は10件まで（題40文字、内容300文字以内）にしてください';
    if (cn.episodes !== undefined) cn.episodes = cn.episodes.map(e => ({ title: e.title, text: e.text })); // 決まった項目だけ残す
    if (b.note !== undefined && !str(b.note, 500)) return '事務局へのメモは500文字以内にしてください';
    return null;
  }

  /* ---- 獲得コードとQRコード ---- */
  app.get('/org/api/codes', (req, res) => {
    const uses = content.codeUses();
    res.json(W().CODES.filter(c => codeIn(req, c)).map(c => ({ code: c.code, type: c.type, id: c.id, target: targetName(c), enabled: c.enabled !== false, uses: uses[c.code] || 0, place: c.place || '' })));
  });
  app.post('/org/api/codes', (req, res) => {
    const b = req.body || {};
    if (!['character', 'area'].includes(b.type) || typeof b.id !== 'string') return bad(res, 400, '担当のキャラクターかエリアを選んでください');
    const c = { type: b.type, id: b.id, place: String(b.place || '').slice(0, 60) };
    if (!codeIn(req, c)) return bad(res, 400, '担当のキャラクターかエリアを選んでください');
    // コードを入れなければ、決まった形で作る（例: MINI-RUI-7Q2K、AREA-ONOMICHI-3F8D）
    let code = String(b.code || '').trim().toUpperCase();
    if (!code) {
      const base = c.type === 'character' ? `MINI-${c.id.toUpperCase()}` : `AREA-${c.id.toUpperCase()}`;
      do { code = `${base}-${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4)}`; } while (W().CODES.some(x => x.code === code));
    }
    if (!CODE_RE.test(code)) return bad(res, 400, 'コードは英大文字、数字、ハイフン（6〜40文字）にしてください');
    if (W().CODES.some(x => x.code === code)) return bad(res, 409, '同じコードがあります');
    content.add('CODES', Object.assign({ code }, c, { org: req.org.id }), by(req));
    res.json({ ok: true, code });
  });
  app.put('/org/api/codes/:code', (req, res) => {
    const c = W().CODES.find(x => x.code === req.params.code);
    if (!c || !codeIn(req, c)) return bad(res, 404, '担当のコードではありません');
    const patch = {};
    if ((req.body || {}).enabled !== undefined) patch.enabled = !!req.body.enabled;
    if ((req.body || {}).place !== undefined) patch.place = String(req.body.place).slice(0, 60);
    content.update('CODES', c.code, patch, by(req));
    res.json({ ok: true });
  });
  app.get('/org/api/codes/:code/qr.png', async (req, res) => {
    const c = W().CODES.find(x => x.code === req.params.code);
    if (!c || !codeIn(req, c)) return bad(res, 404, '担当のコードではありません');
    const size = Math.max(200, Math.min(1200, Number(req.query.size) || 480));
    const png = await qrPng(c.code, size);
    res.setHeader('Content-Type', 'image/png');
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${c.code.toLowerCase()}.png"`);
    res.send(png);
  });

  /* ---- イベント（担当エリア） ---- */
  const evFields = b => {
    const p = {};
    for (const k of ['area', 'title', 'start', 'end', 'hours', 'placeId', 'tags', 'desc', 'url', 'tentative', 'hidden']) if (b[k] !== undefined) p[k] = b[k];
    if (p.placeId === '') p.placeId = null;
    return p;
  };
  const evCheck = (req, p, cur = {}) => {
    // 形と長さは事務局と共通（lib/guard.js）。以前は tags に文字列以外が入ると、推しの行動の計算が止まっていた
    const e = guard.eventProblem(p, cal.validDay); if (e) return e;
    if (p.area !== undefined && !req.scope.areas.has(p.area)) return '担当のエリアを選んでください';
    const start = p.start || cur.start, end = p.end || cur.end;
    if (start && end && start > end) return '終わりの日は始まりの日より後にしてください';
    if (p.placeId) { const pl = W().placeById.get(p.placeId); if (!pl || !req.scope.areas.has(pl.area)) return '会場は担当エリアの場所にしてください'; }
    return null;
  };
  app.get('/org/api/events', (req, res) => res.json(W().EVENTS.filter(e => req.scope.areas.has(e.area)).map(e => Object.assign({}, e, {
    reactions: [...req.scope.chars].map(id => ({ id, name: (W().charById.get(id) || {}).short, interest: Math.round(sim.eventInterest(id, e) * 100) / 100 })),
  }))));
  app.post('/org/api/events', (req, res) => {
    const p = evFields(req.body || {});
    if (!p.title || !p.start || !p.end || !p.area) return bad(res, 400, '題、エリア、日程を入れてください');
    const err = evCheck(req, p); if (err) return bad(res, 400, err);
    p.id = 'ev-' + crypto.randomBytes(4).toString('hex'); p.hours = p.hours || [10, 17]; p.tags = p.tags || []; p.org = req.org.id;
    content.add('EVENTS', p, by(req)); res.json({ ok: true, id: p.id });
  });
  app.put('/org/api/events/:id', (req, res) => {
    const e = W().EVENTS.find(x => x.id === req.params.id);
    if (!e || !req.scope.areas.has(e.area)) return bad(res, 404, '担当エリアのイベントではありません');
    const p = evFields(req.body || {}); const err = evCheck(req, p, e); if (err) return bad(res, 400, err);
    content.update('EVENTS', e.id, p, by(req)); res.json({ ok: true });
  });
  app.delete('/org/api/events/:id', (req, res) => {
    const e = W().EVENTS.find(x => x.id === req.params.id);
    if (!e || !req.scope.areas.has(e.area)) return bad(res, 404, '担当エリアのイベントではありません');
    content.remove('EVENTS', e.id, by(req)); res.json({ ok: true });
  });

  /* ---- 場所（担当エリア。情報の編集のみ） ---- */
  app.get('/org/api/places', (req, res) => {
    const q = String(req.query.q || '');
    const list = W().PLACES.filter(p => req.scope.areas.has(p.area) && !p.generated && p.cat !== 'home' && (!q || p.name.includes(q)));
    res.json(list.slice(0, 200).map(p => ({ id: p.id, area: p.area, name: p.name, cat: p.cat, desc: p.desc, url: p.url, hours: p.hours, closed: !!p.closed, fictional: !!p.fictional })));
  });
  app.put('/org/api/places/:id', (req, res) => {
    const p = W().placeById.get(req.params.id);
    if (!p || !req.scope.areas.has(p.area) || p.generated || p.cat === 'home') return bad(res, 404, '担当エリアの場所ではありません');
    const b = req.body || {}; const patch = {};
    if (b.desc !== undefined) { if (!(typeof b.desc === 'string' && b.desc.length <= 300)) return bad(res, 400, '説明は300文字以内にしてください'); patch.desc = b.desc; }
    if (b.url !== undefined) { if (!(b.url === null || b.url === '' || (typeof b.url === 'string' && b.url.length <= 300 && /^https?:\/\//.test(b.url)))) return bad(res, 400, 'URLは http(s):// から（300文字まで）'); patch.url = b.url || ''; }
    if (b.hours !== undefined) { if (!(b.hours === null || (Array.isArray(b.hours) && b.hours.length === 2 && b.hours.every(x => Number.isFinite(x) && x >= 0 && x <= 24) && b.hours[0] < b.hours[1]))) return bad(res, 400, '営業時間は [開く時, 閉じる時]'); patch.hours = b.hours; }
    if (b.closed !== undefined) patch.closed = !!b.closed;
    content.update('PLACES', p.id, patch, by(req)); res.json({ ok: true });
  });

  /* ---- 解釈違いの報告（担当キャラクター） ---- */
  app.get('/org/api/reports', (req, res) => res.json(store.db().reports.filter(r => req.scope.chars.has(r.characterId)).map(r => ({ id: r.id, at: r.at, characterId: r.characterId, characterName: (W().charById.get(r.characterId) || {}).name, kind: r.kind, where: r.where, text: r.text, status: r.status }))));
  app.put('/org/api/reports/:id', (req, res) => {
    const r = store.db().reports.find(x => x.id === req.params.id);
    if (!r || !req.scope.chars.has(r.characterId)) return bad(res, 404, '担当キャラクターの報告ではありません');
    if (!['unread', 'checked', 'shared'].includes((req.body || {}).status)) return bad(res, 400, '状態が正しくありません');
    r.status = req.body.status; store.save();
    content.logOnly('org-report', `${req.org.name} が報告 ${r.id} を ${r.status} に`, by(req));
    res.json({ ok: true });
  });

  /* ---- 場所の地図（担当エリアの中だけ。エリアの追加と道のデータは事務局。lib/map-admin.js） ---- */
  if (router) require('../lib/map-admin').mountMapApi(app, '/org/api', { content, router, sim, scopeOf: req => ({ areas: req.scope.areas, admin: false }), byOf: req => req.org.name });

  app.use('/org/api', (req, res) => bad(res, 404, 'not found'));
  app.use(guard.errorHandler); // 例外の中身を返さない
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'org-public', 'index.html')));
  const server = app.listen(ORG_PORT, '127.0.0.1', () => console.log(`自治体の管理画面 http://localhost:${ORG_PORT}（このPCのみ）`));
  return server;
}

module.exports = { start };
