/**
 * lib/orgs.js
 * 自治体など（アカウントユーザー）の管理画面のアカウントと、キャラクターの変更の申請。
 *
 * - 事務局（admin/server.js）がアカウントを作り、担当するエリアとキャラクターを決める
 * - 自治体は、担当のエリアとキャラクターに関わるものだけを扱える（ほかの自治体のものは見えない）
 * - キャラクターは作品の公式のものなので、自治体の変更は「申請」として保存し、事務局が承認すると反映する
 *   （獲得コード、イベント、場所の情報は、担当の範囲ですぐに反映する）
 * - 保存先は data/orgs.json（利用者の進行状況、運営の内容とは別のファイル）。パスワードは scrypt でハッシュ化する
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('./auth');

const FILE = process.env.ORGS_FILE || path.join(__dirname, '..', 'data', 'orgs.json');
const ID_RE = /^[a-z0-9-]{3,30}$/;

// 初めて起動したときに作るデモ用のアカウント（README に記載。本番では事務局が作り直す）
const DEMO_ORGS = [
  { id: 'osaka', name: '大阪市 観光課（デモ）', loginId: 'osaka-city', password: 'osaka-demo-2026', areas: ['osaka'], characters: ['arisa', 'nagi', 'gumi', 'moyashi'] },
  { id: 'onomichi', name: '尾道市 観光課（デモ）', loginId: 'onomichi-city', password: 'onomichi-demo-2026', areas: ['onomichi'], characters: ['musashi'] },
  { id: 'mihara', name: '三原市 観光課（デモ）', loginId: 'mihara-city', password: 'mihara-demo-2026', areas: ['mihara'], characters: ['takakage'] },
];

// 自治体が申請できるキャラクターの項目
const CHAR_FIELDS = ['tagline', 'interests', 'look', 'stride', 'speed', 'vehicle', 'curiosity', 'range', 'ng'];
const CANON_FIELDS = ['profile', 'personality', 'likes', 'dislikes', 'commute', 'episodes', 'relations'];

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; }
}

function create() {
  let db = load();
  if (!db) {
    db = { orgs: [], requests: [] };
    for (const o of DEMO_ORGS) db.orgs.push(makeOrg(o));
    persist();
  }
  function persist() { const tmp = FILE + '.tmp'; fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(tmp, JSON.stringify(db, null, 1)); fs.renameSync(tmp, FILE); }
  function makeOrg({ id, name, loginId, password, areas, characters }) {
    return Object.assign({ id, name, loginId, areas: areas || [], characters: characters || [], disabled: false, createdAt: Date.now() }, hashPassword(password));
  }
  const pub = o => o && ({ id: o.id, name: o.name, loginId: o.loginId, areas: o.areas, characters: o.characters, disabled: !!o.disabled, createdAt: o.createdAt, lastLoginAt: o.lastLoginAt || null });

  /* ---- アカウント ---- */
  function list() { return db.orgs.map(pub); }
  function get(id) { return db.orgs.find(o => o.id === id) || null; }
  function validate(b, isNew) {
    if (isNew && !ID_RE.test(b.id || '')) return '組織のIDは半角英小文字、数字、ハイフン（3〜30文字）にしてください';
    if (isNew && get(b.id)) return '同じ組織のIDがあります';
    if (b.name !== undefined && !(typeof b.name === 'string' && b.name.trim().length >= 2 && b.name.length <= 40)) return '名前は2〜40文字にしてください';
    if (b.loginId !== undefined) {
      if (!/^[A-Za-z0-9-]{4,30}$/.test(b.loginId)) return 'ログインIDは半角英数字とハイフン（4〜30文字）にしてください';
      if (db.orgs.some(o => o.loginId.toLowerCase() === b.loginId.toLowerCase() && o.id !== b.id)) return '同じログインIDがあります';
    }
    if (b.password !== undefined && !(typeof b.password === 'string' && b.password.length >= 10 && b.password.length <= 64)) return 'パスワードは10〜64文字にしてください';
    return null;
  }
  function add(b) {
    const err = validate(b, true); if (err) return { error: err };
    const o = makeOrg(b); db.orgs.push(o); persist(); return { org: pub(o) };
  }
  function update(id, b) {
    const o = get(id); if (!o) return { error: '見つかりません' };
    const err = validate(Object.assign({ id }, b), false); if (err) return { error: err };
    for (const k of ['name', 'loginId', 'areas', 'characters']) if (b[k] !== undefined) o[k] = b[k];
    if (b.disabled !== undefined) o.disabled = !!b.disabled;
    if (b.password) Object.assign(o, hashPassword(b.password));
    persist(); return { org: pub(o) };
  }
  function remove(id) { db.orgs = db.orgs.filter(o => o.id !== id); persist(); }
  function login(loginId, password) {
    const o = db.orgs.find(x => x.loginId.toLowerCase() === String(loginId || '').toLowerCase());
    if (!o) require('./guard').dummyScrypt(password); // 存在しないIDでも同じくらい時間をかける（IDの有無を応答時間で知られないように）
    if (!o || o.disabled || typeof password !== 'string' || !verifyPassword(password, o.salt, o.hash)) return null;
    o.lastLoginAt = Date.now(); persist();
    return pub(o);
  }
  function changePassword(id, current, next) {
    const o = get(id); if (!o) return '見つかりません';
    if (!verifyPassword(String(current || ''), o.salt, o.hash)) return '今のパスワードが違います';
    const err = validate({ id, password: next }, false); if (err) return err;
    if (verifyPassword(String(next || ''), o.salt, o.hash)) return '今と違うパスワードにしてください';
    Object.assign(o, hashPassword(next)); persist(); return null;
  }

  /* ---- キャラクターの変更の申請 ---- */
  /** 申請を作る。changes は { character: {tagline, interests, look}, canon: {...} } のうち、送られた項目だけ */
  function submit(org, charId, changes, note) {
    const character = {}, canon = {};
    for (const k of CHAR_FIELDS) if ((changes.character || {})[k] !== undefined) character[k] = changes.character[k];
    for (const k of CANON_FIELDS) if ((changes.canon || {})[k] !== undefined) canon[k] = changes.canon[k];
    if (!Object.keys(character).length && !Object.keys(canon).length) return { error: '変更がありません' };
    // 確認待ちの申請は、1つの自治体で20件まで（大量の申請で、ほかの自治体の申請を押し出せないように）
    if (db.requests.filter(r => r.orgId === org.id && r.status === 'pending').length >= 20) return { error: '確認待ちの申請が20件あります。事務局の確認を待ってから申請してください' };
    const r = { id: crypto.randomBytes(6).toString('hex'), orgId: org.id, orgName: org.name, characterId: charId, character, canon, note: String(note || '').slice(0, 500), status: 'pending', createdAt: Date.now(), reviewedAt: null, comment: '' };
    db.requests.unshift(r);
    // 全体で1000件を超えたら、確認済みの古いものから消す（確認待ちは消さない）
    if (db.requests.length > 1000) { const pending = db.requests.filter(x => x.status === 'pending'); const done = db.requests.filter(x => x.status !== 'pending').slice(0, Math.max(0, 1000 - pending.length)); db.requests = pending.concat(done).sort((a, b) => b.createdAt - a.createdAt); }
    persist();
    return { request: r };
  }
  function requests(filter = {}) { return db.requests.filter(r => (!filter.orgId || r.orgId === filter.orgId) && (!filter.status || r.status === filter.status)); }
  function request(id) { return db.requests.find(r => r.id === id) || null; }
  /** 承認または差し戻し。承認したときは content に反映する */
  function review(id, decision, comment, content) {
    const r = request(id); if (!r) return { error: '見つかりません' };
    if (r.status !== 'pending') return { error: 'すでに確認済みの申請です' };
    if (!['approved', 'rejected'].includes(decision)) return { error: '承認か差し戻しを選んでください' };
    r.status = decision; r.reviewedAt = Date.now(); r.comment = String(comment || '').slice(0, 500);
    if (decision === 'approved') {
      const W = content.get();
      const c = W.charById.get(r.characterId);
      if (!c) return { error: 'キャラクターが見つかりません' };
      if (Object.keys(r.character).length) {
        const patch = Object.assign({}, r.character);
        if (patch.look) {
          patch.look = Object.assign({}, c.look, patch.look);
          if (r.character.look.image !== undefined) patch.look.crop = null; // 新しい絵は切り抜かずに使う
          if (patch.look.image === null) delete patch.look.image;
        }
        content.update('CHARACTERS', c.id, patch, `${r.orgName}（事務局が承認）`);
      }
      if (Object.keys(r.canon).length) content.setCanon(c.id, Object.assign({}, W.CANON[c.id] || {}, r.canon), `${r.orgName}（事務局が承認）`);
    }
    persist();
    return { request: r };
  }

  return { list, get, add, update, remove, login, changePassword, submit, requests, request, review, pub, CHAR_FIELDS, CANON_FIELDS };
}

module.exports = { create, DEMO_ORGS };
