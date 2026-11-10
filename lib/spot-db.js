/**
 * lib/spot-db.js
 * スポットDB（data/spot-db.json）と、定期更新のバッチ。
 *
 * 収集（lib/spot-collector.js）→ 相性（lib/spot-scorer.js）→ 保存、の順に動かす。利用者のデータとは別のファイル。
 * サーバの起動時と1時間ごとに古さを確かめ、前の更新から24時間（SPOT_UPDATE_HOURS）たっていれば集め直す。
 * 手で動かすとき: npm run spots:update   管理画面の「スポットDB」からも動かせる。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { collectSpots } = require('./spot-collector');
const { scoreSpot } = require('./spot-scorer');

const FILE = process.env.SPOT_DB_FILE || path.join(__dirname, '..', 'data', 'spot-db.json');
const HOURS = Number(process.env.SPOT_UPDATE_HOURS || 24);

function create(content) {
  let db = load();
  const listeners = [];

  function load() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { version: 0, updatedAt: null, runs: [], spots: {}, scores: {} }; }
  }
  function save() { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, FILE); }

  /** 集め直して相性を付け直す（同期処理。AIに切り替えるときは async にする） */
  function runBatch(trigger = 'manual') {
    const t0 = Date.now();
    const W = content.get();
    const spots = collectSpots(W.PLACES, t0);
    const scores = {};
    for (const c of W.CHARACTERS) {
      const canon = W.CANON[c.id] || {};
      scores[c.id] = {};
      for (const s of spots) {
        const meta = W.placeById.get(s.id) || {};
        scores[c.id][s.id] = Object.assign(scoreSpot(c, canon, s, meta), { scoredAt: new Date(t0).toISOString() });
      }
    }
    db = {
      version: (db.version || 0) + 1, updatedAt: new Date(t0).toISOString(),
      runs: [{ at: new Date(t0).toISOString(), trigger, count: spots.length, source: 'dummy', ms: Date.now() - t0 }, ...(db.runs || [])].slice(0, 50),
      spots: Object.fromEntries(spots.map(s => [s.id, s])), scores,
    };
    save();
    listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });
    return db.runs[0];
  }

  function stale() { return !db.updatedAt || Date.now() - Date.parse(db.updatedAt) > HOURS * 3600000 || Object.keys(db.spots || {}).length < content.get().PLACES.length - 20; }
  let timer = null;
  function startScheduler() {
    if (stale()) runBatch('startup');
    timer = setInterval(() => { if (stale()) runBatch('schedule'); }, 3600000);
    timer.unref && timer.unref();
  }

  /** 推しのスポットごとの相性の点数 { placeId: score } */
  function affinityFor(charId) {
    const s = (db.scores || {})[charId] || {};
    const out = {};
    for (const [k, v] of Object.entries(s)) out[k] = v.score;
    return out;
  }

  return {
    runBatch, startScheduler, affinityFor, stale,
    spot: id => (db.spots || {})[id] || null,
    score: (charId, id) => ((db.scores || {})[charId] || {})[id] || null,
    info: () => ({ version: db.version, updatedAt: db.updatedAt, runs: db.runs || [], count: Object.keys(db.spots || {}).length }),
    all: () => db,
    onUpdate: f => listeners.push(f),
  };
}

module.exports = { create };

// npm run spots:update
if (require.main === module && process.argv.includes('--run')) {
  const content = require('./content');
  const r = create(content).runBatch('cli');
  console.log('スポットDBを更新しました', r);
}
