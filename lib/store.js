/**
 * lib/store.js
 * ユーザーごとの進行状況を data/state.json に保存する（localhost で動かす前提のためDBは使わない）。
 *
 * 保存するのは、獲得状況、ホームに出す推し、連れて行った履歴（travelLog）、設定、プロフィール、保存した観光ルート、
 * 出会いの記録の既読などだけ。旅の足あとは保存せず、毎回計算する（lib/simulator.js）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.STATE_FILE || path.join(__dirname, '..', 'data', 'state.json');
const DAY = 86400000;

let db = load();
let timer = null;

function load() {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); d.users = d.users || {}; d.accounts = d.accounts || {}; d.sessions = d.sessions || {}; d.reports = d.reports || []; return d; } catch { return { users: {}, accounts: {}, sessions: {}, reports: [] }; }
}
/** 少し待ってからまとめて書き出す */
function save() {
  if (timer) return;
  timer = setTimeout(flush, 300);
}
function flush() {
  clearTimeout(timer); timer = null;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

const DEFAULT_SETTINGS = { mapStyle: 'photo', timelineOrder: 'asc', fontSize: 'normal', meetOrder: 'desc' };
const ALLOWED_SETTINGS = {
  mapStyle: ['photo', 'pale', 'std'],
  timelineOrder: ['asc', 'desc'],
  fontSize: ['normal', 'large'],
  meetOrder: ['desc', 'asc'],
};

/**
 * 新しい利用者を作る。初期キャラ（京町ありさと宮本武蔵）は3か月ほど前から一緒にいる。
 * 創作の旅の履歴（data/demo-history.js）は、作った時刻を基準にして lib/simulator.js が足す。
 */
function createUser(world, now = Date.now()) {
  const id = crypto.randomBytes(12).toString('hex');
  const since = now - 95 * DAY;
  const characters = {}; const areas = {};
  for (const c of world.CHARACTERS.filter(c => c.initial)) {
    characters[c.id] = { acquiredAt: since, initial: true };
    for (const a of c.homeAreas) areas[a] = { acquiredAt: since };
  }
  const initialIds = Object.keys(characters);
  db.users[id] = {
    id, createdAt: now, characters, areas,
    homeCharacterIds: initialIds, selectedCharacterId: initialIds[0],
    travelLogs: {}, settings: { ...DEFAULT_SETTINGS },
    profile: { nickname: '', likes: [], walk: 'normal' },
    guideSeen: false, routes: [], seenEncounters: 0,
  };
  save();
  return db.users[id];
}

function user(id) { return id ? db.users[id] || null : null; }
function users() { return Object.values(db.users); }

/** 獲得状況とルートと設定を消す。アカウントとプロフィールは残し、初期キャラを渡し直す */
function resetUser(u, world, now = Date.now()) {
  const fresh = createUser(world, now);
  delete db.users[fresh.id];
  Object.assign(u, {
    createdAt: now, characters: fresh.characters, areas: fresh.areas, homeCharacterIds: fresh.homeCharacterIds,
    selectedCharacterId: fresh.selectedCharacterId, travelLogs: {}, settings: { ...DEFAULT_SETTINGS }, guideSeen: false, routes: [], seenEncounters: 0,
  });
  save();
}

module.exports = { db: () => db, save, flush, createUser, user, users, resetUser, DEFAULT_SETTINGS, ALLOWED_SETTINGS };
