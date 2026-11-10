/**
 * lib/content.js
 * 運営が管理する内容（作品、キャラ、場所、イベント、天気の上書き、獲得コード）。
 *
 * data/world.js、data/canon.js、data/events.js を初期値とし、管理画面で編集した差分を data/content.json に保存して重ねる。
 * ユーザーの進行状況（data/state.json）とは別のファイルにしている。
 * get() は重ねた結果を返す。編集のたびに version が上がり、足あとの計算の控え（lib/simulator.js）が作り直される。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const world = require('../data/world');
const { CANON, COMMON_DOING } = require('../data/canon');
const { EVENTS, HOLIDAYS, SCHOOL_BREAKS } = require('../data/events');

const FILE = process.env.CONTENT_FILE || path.join(__dirname, '..', 'data', 'content.json');
// 編集できる集まり（id で差分を持つ）
const COLLECTIONS = ['WORKS', 'CHARACTERS', 'PLACES', 'EVENTS', 'CODES', 'AREAS'];

let saved = load();
let cache = null;

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { version: 1, patches: {}, added: {}, removed: {}, weather: {}, canon: {}, codeUses: {}, log: [] }; }
}
function persist() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(saved, null, 1));
  fs.renameSync(tmp, FILE);
}
const keyOf = (col, item) => col === 'CODES' ? item.code : item.id;

/** 初期値に差分を重ねた内容 */
function get() {
  if (cache) return cache;
  const base = { WORKS: world.WORKS, CHARACTERS: world.CHARACTERS, PLACES: world.PLACES, EVENTS, CODES: world.CODES, AREAS: world.AREAS };
  const out = { CATEGORIES: world.CATEGORIES, TRANSIT: world.TRANSIT, SLOPES: world.SLOPES, HOLIDAYS, SCHOOL_BREAKS, COMMON_DOING };
  for (const col of COLLECTIONS) {
    const patches = (saved.patches || {})[col] || {};
    const removed = new Set((saved.removed || {})[col] || []);
    const list = base[col].filter(x => !removed.has(keyOf(col, x))).map(x => patches[keyOf(col, x)] ? Object.assign({}, x, patches[keyOf(col, x)]) : x);
    for (const a of ((saved.added || {})[col] || [])) if (!removed.has(keyOf(col, a))) list.push(Object.assign({}, a, patches[keyOf(col, a)] || {}));
    out[col] = list;
  }
  // 公式設定はキャラごとに丸ごと上書きできる（管理画面のJSON編集）
  out.CANON = Object.assign({}, CANON, saved.canon || {});
  out.WEATHER_OVERRIDES = saved.weather || {};
  out.version = saved.version || 1;
  out.placeById = new Map(out.PLACES.map(p => [p.id, p]));
  out.charById = new Map(out.CHARACTERS.map(c => [c.id, c]));
  out.areaById = new Map(out.AREAS.map(a => [a.id, a]));
  out.workById = new Map(out.WORKS.map(w => [w.id, w]));
  cache = out;
  return out;
}

function bump(action, detail, by) {
  saved.version = (saved.version || 1) + 1;
  saved.log = saved.log || [];
  saved.log.unshift({ at: Date.now(), by: by || 'admin', action, detail });
  saved.log = saved.log.slice(0, 500);
  cache = null;
  persist();
  listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });
}
const listeners = [];
function onChange(f) { listeners.push(f); }

/** 1件の更新（patch は変える項目だけ） */
function update(col, id, patch, by) {
  if (!COLLECTIONS.includes(col)) throw new Error('unknown collection');
  saved.patches = saved.patches || {}; saved.patches[col] = saved.patches[col] || {};
  saved.patches[col][id] = Object.assign({}, saved.patches[col][id] || {}, patch);
  bump('update', `${col} ${id}`, by);
}
function add(col, item, by) {
  saved.added = saved.added || {}; saved.added[col] = saved.added[col] || [];
  saved.added[col].push(item);
  bump('add', `${col} ${keyOf(col, item)}`, by);
}
function remove(col, id, by) {
  saved.removed = saved.removed || {}; saved.removed[col] = saved.removed[col] || [];
  if (!saved.removed[col].includes(id)) saved.removed[col].push(id);
  bump('remove', `${col} ${id}`, by);
}
function setCanon(charId, canon, by) { saved.canon = saved.canon || {}; saved.canon[charId] = canon; bump('canon', charId, by); }
function setWeather(region, day, w, by) {
  saved.weather = saved.weather || {};
  if (w) saved.weather[region + '|' + day] = w; else delete saved.weather[region + '|' + day];
  bump('weather', `${region} ${day} ${w || '創作に戻す'}`, by);
}
function countCodeUse(code) { saved.codeUses = saved.codeUses || {}; saved.codeUses[code] = (saved.codeUses[code] || 0) + 1; persist(); }
function codeUses() { return saved.codeUses || {}; }
function log() { return saved.log || []; }
function logOnly(action, detail, by) { saved.log = saved.log || []; saved.log.unshift({ at: Date.now(), by: by || 'admin', action, detail }); saved.log = saved.log.slice(0, 500); persist(); }

module.exports = { get, update, add, remove, setCanon, setWeather, countCodeUse, codeUses, log, logOnly, onChange, COLLECTIONS };
