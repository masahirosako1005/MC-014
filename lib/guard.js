/**
 * lib/guard.js
 * 3つのサーバ（利用者 3000、事務局 3100、自治体 3200）で共通の守り。2026-11-10 のセキュリティ点検で足した。
 *
 * - sameOrigin: 別のサイトや、同じPCの別のポート（localhost:3000 から :3100 など）からの書きこみを断る。
 *   Cookie はポートで分かれないため、SameSite=Strict だけでは localhost の別ポートからの送信を止められない。
 *   ブラウザが付ける Sec-Fetch-Site と Origin を確かめ、本文のある書きこみは JSON だけを受け付ける
 *   （text/plain などはブラウザの事前確認なしで送れるため）。
 * - limiter: 回数の制限（キーごとに、決まった時間の中で何回まで）。覚えるキーの数にも上限を付ける。
 * - errorHandler: 例外を利用者に見せない（スタックトレースやファイルの場所を返さない）。
 * - parseCookies: 形の正しくない Cookie で例外にしない。
 * - own: 継承したプロパティ（__proto__、constructor、toString など）を「ある」と扱わない。
 */
'use strict';

const crypto = require('crypto');

const own = (o, k) => o !== null && o !== undefined && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

function parseCookies(header) {
  const out = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* 形の正しくない値は読まない */ }
  }
  return out;
}

function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: '別のページからの操作は受け付けません' });
  const origin = req.headers.origin;
  if (origin && origin !== `${req.protocol}://${req.headers.host}`) return res.status(403).json({ error: '別のページからの操作は受け付けません' });
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding'];
  if (hasBody && !req.is('application/json')) return res.status(415).json({ error: 'JSONで送ってください' });
  next();
}

/** 回数の制限。hit(key) が false を返したら制限を超えた */
function limiter({ windowMs, max, maxKeys = 5000 }) {
  const m = new Map();
  return function hit(key) {
    const t = Date.now();
    let e = m.get(key);
    if (!e || e.reset <= t) {
      e = { n: 0, reset: t + windowMs };
      m.delete(key); m.set(key, e);
      if (m.size > maxKeys) m.delete(m.keys().next().value);
    }
    e.n++;
    return e.n <= max;
  };
}

/** ログインの失敗回数。IDと接続元の組で数え、時間がたてば忘れる（他人のIDをわざと止めにくくする） */
function loginGuard({ max = 5, lockMs = 5 * 60000, maxKeys = 5000 } = {}) {
  const m = new Map();
  const keyOf = (req, id) => `${String(id || '').toLowerCase().slice(0, 64)}|${req.socket.remoteAddress || ''}`;
  return {
    locked(req, id) { const e = m.get(keyOf(req, id)); return !!(e && e.until > Date.now()); },
    fail(req, id) {
      const k = keyOf(req, id); const t = Date.now();
      let e = m.get(k); if (!e || (e.until && e.until <= t) || e.last < t - lockMs) e = { n: 0, until: 0, last: t };
      e.n++; e.last = t; if (e.n >= max) { e.until = t + lockMs; e.n = 0; }
      m.delete(k); m.set(k, e); if (m.size > maxKeys) m.delete(m.keys().next().value);
    },
    ok(req, id) { m.delete(keyOf(req, id)); },
  };
}

/** 存在しないIDでも同じくらい時間をかける（応答時間の差でIDの有無が分からないように） */
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
function dummyScrypt(pw) { crypto.scryptSync(String(pw || ''), DUMMY_SALT, 64); }

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const s = err && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (s === 500) console.error(err);
  res.status(s).json({ error: s === 413 ? '送る内容が大きすぎます' : s < 500 ? '入力が正しくありません' : 'サーバでエラーが起きました' });
}

const ipOf = req => req.socket.remoteAddress || '';

/**
 * イベントの項目の形と長さを確かめ、整える（事務局と自治体で共通）。
 * 以前は tags に文字列以外（{} など）が入ると、推しの行動の計算が例外で止まり、全員の画面に影響した。
 * @returns {string|null} 問題があればその説明
 */
function eventProblem(p, validDay) {
  if (p.tags !== undefined) {
    if (typeof p.tags === 'string') p.tags = p.tags.split(/[,\s、]+/).filter(Boolean);
    if (!(Array.isArray(p.tags) && p.tags.length <= 20 && p.tags.every(t => typeof t === 'string' && t.length <= 20))) return 'タグは20個まで、1つ20文字以内にしてください';
  }
  if (p.title !== undefined && !(typeof p.title === 'string' && p.title.trim() && p.title.length <= 60)) return '題は60文字以内にしてください';
  if (p.desc !== undefined && !(typeof p.desc === 'string' && p.desc.length <= 500)) return '説明は500文字以内にしてください';
  if (p.url !== undefined && p.url !== null && p.url !== '' && !(typeof p.url === 'string' && p.url.length <= 300 && /^https?:\/\//.test(p.url))) return 'URLは http(s):// から（300文字まで）';
  for (const k of ['tentative', 'hidden']) if (p[k] !== undefined) p[k] = !!p[k];
  for (const k of ['start', 'end']) if (p[k] !== undefined && !validDay(p[k])) return '日付が正しくありません';
  if (p.start && p.end && p.start > p.end) return '終わりの日は始まりの日より後にしてください';
  if (p.hours !== undefined && !(Array.isArray(p.hours) && p.hours.length === 2 && p.hours.every(h => Number.isFinite(h) && h >= 0 && h <= 24) && p.hours[0] < p.hours[1])) return '時間は [始まり, 終わり]（0〜24時）にしてください';
  if (p.placeId !== undefined && p.placeId !== null && typeof p.placeId !== 'string') return '会場が正しくありません';
  if (p.area !== undefined && typeof p.area !== 'string') return 'エリアが正しくありません';
  return null;
}

module.exports = { own, parseCookies, sameOrigin, limiter, loginGuard, dummyScrypt, errorHandler, ipOf, eventProblem };
