/**
 * tools/build-spots.js  （開発時にのみ実行する）
 *
 * デモ用の架空のスポット（尾道2460、三原510、大阪2040の合計5010か所）を作り、data/extra-places.json に書き出す。
 *   node tools/build-spots.js
 *
 * - 実在の店の名前や住所を作らないよう、名前は「麺処 汐見」のような架空の組み合わせにする
 * - 位置は data/routes.json（国土地理院の道路データ）の交差点と道の線の上の点から、他の場所と18m以上離れたところを選ぶ
 *   （数が多いので、交差点だけでは足りない。道の線を15mごとに区切った点も候補にする）
 * - 乱数の種が固定なので、何度作っても同じになる（通信もしない）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { GENRES, AREA_MIX, AREA_COUNT, WORDS } = require('../data/spot-sources');
const { rng } = require('../lib/calendar');
const world = require('../data/world');

const routes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'routes.json'), 'utf8'));
const OUT = path.join(__dirname, '..', 'data', 'extra-places.json');
const R = rng('build-spots-v1');

const dist = (a, b) => Math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 91000);
const SHORT = { onomichi: 'ono', mihara: 'mih', osaka: 'osk' };
const MIN_GAP = 18; // 場所どうしの最小の間隔（m）

function inSlope(pt) {
  return world.SLOPES.some(s => { const [a, b, c] = [s.polygon[0], s.polygon[1], s.polygon[2]]; return pt[0] >= a[0] && pt[0] <= c[0] && pt[1] >= a[1] && pt[1] <= b[1]; });
}

const real = world.REAL_PLACES.concat(world.HOMES, world.DOJO_PLACES);
const out = [];
for (const [areaId, total] of Object.entries(AREA_COUNT)) {
  const g = routes.areas[areaId];
  const [s, w, n, e] = g.bounds;
  const margin = 0.0012;
  // 交差点（範囲の端は除く）
  const inside = p => p[0] > s + margin && p[0] < n - margin && p[1] > w + margin && p[1] < e - margin;
  const nodes = g.nodes.filter(inside);
  for (const [, , len, , geom] of g.edges) {
    for (let i = 1; i < geom.length; i++) {
      const a = geom[i - 1], c = geom[i]; const d = dist(a, c); const k = Math.floor(d / 15);
      for (let j = 1; j <= k; j++) { const f = j / (k + 1); const p = [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f]; if (inside(p)) nodes.push(p); }
    }
  }
  // ジャンルごとの数（割合から合計に合わせる）
  const mix = AREA_MIX[areaId];
  const sum = Object.values(mix).reduce((a, b) => a + b, 0);
  const counts = Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, Math.floor(v / sum * total)]));
  let left = total - Object.values(counts).reduce((a, b) => a + b, 0);
  const keys = Object.keys(mix).filter(k => mix[k] > 0).sort((a, b) => mix[b] - mix[a]);
  for (let i = 0; left > 0; i++, left--) counts[keys[i % keys.length]]++;

  // 近くの場所だけを調べる格子（数が多いので、全部と比べると遅い）
  const grid = { cells: new Map(), key: p => Math.floor(p[0] / 0.0004) + ',' + Math.floor(p[1] / 0.0005),
    add(p) { const k = this.key(p); if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push(p); },
    ok(p) { const [y, x] = [Math.floor(p[0] / 0.0004), Math.floor(p[1] / 0.0005)]; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const q of this.cells.get((y + dy) + ',' + (x + dx)) || []) if (dist(q, p) < MIN_GAP) return false; return true; } };
  for (const p of real.filter(p => p.area === areaId)) grid.add([p.lat, p.lng]);
  const usedNames = new Set();
  let idx = 0;
  for (const [trait, count] of Object.entries(counts)) {
    const G = GENRES[trait];
    for (let k = 0; k < count; k++) {
      let pt = null;
      for (let tries = 0; tries < 400; tries++) {
        const cand = nodes[Math.floor(R() * nodes.length)];
        // 山は斜面の上、海辺は南寄り（海側）を選びやすくする
        if (trait === 'mountain' && areaId === 'onomichi' && !inSlope(cand) && tries < 300) continue;
        if (grid.ok(cand)) { pt = cand; break; }
      }
      if (!pt) continue;
      grid.add(pt);
      let name;
      for (let tries = 0; tries < 80; tries++) {
        const pre = G.prefix[Math.floor(R() * G.prefix.length)];
        // 名前がかぶるときは、言葉を2つ組み合わせる
        const word = tries < 40 ? WORDS[Math.floor(R() * WORDS.length)] : WORDS[Math.floor(R() * WORDS.length)] + 'の' + WORDS[Math.floor(R() * WORDS.length)];
        name = trait === 'temple' ? `${word}${pre}` : trait === 'jinja' ? `${word}${pre}` : trait === 'mountain' ? `${word}${pre}` : `${pre} ${word}`;
        if (!usedNames.has(name)) break;
      }
      usedNames.add(name);
      idx++;
      out.push({
        id: `x-${SHORT[areaId]}-${String(idx).padStart(4, '0')}`, area: areaId, name, cat: G.cat, trait, genre: G.label,
        lat: Math.round(pt[0] * 1e6) / 1e6, lng: Math.round(pt[1] * 1e6) / 1e6,
        hours: G.always ? null : G.hours, always: !!G.always, outdoor: !!G.outdoor, stay: G.stay,
        fictional: true, generated: true,
        address: '（架空の場所のため番地はありません）',
        desc: `デモ用に作った架空の場所です。実在しません。${G.exterior}`,
      });
    }
  }
  console.log(areaId, out.filter(p => p.area === areaId).length);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 0));
console.log('保存:', OUT, out.length, '件');
