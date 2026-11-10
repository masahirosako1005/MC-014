/**
 * lib/auth.js
 * パスワードとログイン。ログインは必須ではなく、別の環境で同じ利用者として使うためだけのもの。
 * （クラウド保存は未実装で、内容はこのアプリのサーバ内に保存する）
 *
 * - パスワードは Node.js 標準の scrypt でハッシュ化し、ユーザーごとのソルトと一緒に保存する
 * - ログイン状態はランダムなトークンで判定し、サーバにはトークンのハッシュだけを保存する
 * - Cookie は HttpOnly と SameSite=Strict
 * - 同じIDで失敗が続くと一時的に止める
 * - ログインIDは半角英数字のみ（メールアドレスは受け付けない）
 */
'use strict';

const crypto = require('crypto');
const guard = require('./guard');

const COOKIE = 'mo_sid';
const ID_RE = /^[A-Za-z0-9]{4,20}$/;
const fails = guard.loginGuard(); // IDと接続元の組で、失敗が続くと5分止める（覚える数に上限あり）
const created = guard.limiter({ windowMs: 3600000, max: 200 }); // 接続元ごとの、新しい利用者を作る回数

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(pw, salt, hash) {
  const h = crypto.scryptSync(pw, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(b, h);
}
const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');

const parseCookies = guard.parseCookies; // 形の正しくない Cookie で例外にしない
function setCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 365}`);
}

/**
 * 端末の利用者を決める。Cookieがなければ新しく作る。
 * 新しく作るのは、最初に開く /api/state とログインまわりだけにし、接続元ごとの回数も制限する
 * （以前は Cookie のない /api への送信のたびに利用者が増え、保存ファイルが際限なく大きくなった）
 */
function sessionUser(req, res, store, world, canCreate = true) {
  const db = store.db();
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const uid = db.sessions[tokenHash(token)];
    const u = store.user(uid);
    if (u && !u.disabled) return u;
  }
  if (!canCreate) return null;
  if (!created(guard.ipOf(req))) return null;
  const u = store.createUser(world);
  issue(res, store, u.id);
  return u;
}
function issue(res, store, uid) {
  const token = crypto.randomBytes(24).toString('hex');
  store.db().sessions[tokenHash(token)] = uid;
  store.save();
  setCookie(res, token);
}

function validId(id) { return typeof id === 'string' && ID_RE.test(id); }
function validPassword(pw) { return typeof pw === 'string' && pw.length >= 8 && pw.length <= 64; }

/** 今の端末の内容にIDとパスワードを付ける */
function signup(store, u, loginId, pw) {
  if (!validId(loginId)) return { status: 400, error: 'IDは半角英数字4〜20文字にしてください（メールアドレスは使えません）' };
  if (!validPassword(pw)) return { status: 400, error: 'パスワードは8〜64文字にしてください' };
  const db = store.db();
  if (guard.own(db.accounts, loginId.toLowerCase())) return { status: 409, error: 'そのIDはすでに使われています' };
  if (u.loginId) return { status: 409, error: 'すでにIDを登録しています' };
  db.accounts[loginId.toLowerCase()] = Object.assign({ uid: u.id, createdAt: Date.now() }, hashPassword(pw));
  u.loginId = loginId;
  store.save();
  return { status: 200 };
}

function login(store, req, res, loginId, pw) {
  const key = String(loginId || '').toLowerCase();
  if (fails.locked(req, key)) return { status: 429, error: 'しばらく待ってからもう一度お試しください' };
  // 継承したプロパティ（constructor など）をアカウントと取り違えない
  const acc = guard.own(store.db().accounts, key) ? store.db().accounts[key] : null;
  if (!acc) guard.dummyScrypt(pw); // 存在しないIDでも同じくらい時間をかける
  if (!acc || typeof pw !== 'string' || !verifyPassword(pw, acc.salt, acc.hash)) {
    fails.fail(req, key);
    return { status: 401, error: 'IDかパスワードが違います' };
  }
  const u = store.user(acc.uid);
  if (!u || u.disabled) return { status: 403, error: 'このIDは利用できません' };
  fails.ok(req, key);
  issue(res, store, u.id);
  return { status: 200 };
}

/** ログアウト。この端末は新しい状態から始まる */
function logout(store, req, res, world) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) { delete store.db().sessions[tokenHash(token)]; store.save(); }
  const u = store.createUser(world);
  issue(res, store, u.id);
  return u;
}

module.exports = { sessionUser, signup, login, logout, hashPassword, verifyPassword, parseCookies, validId, COOKIE };
