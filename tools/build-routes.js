/**
 * tools/build-routes.js  （開発時にのみ実行する。アプリの実行時には使わない）
 *
 * 国土地理院のベクトルタイル（道路中心線 experimental_rdcl、鉄道中心線 experimental_railcl）を取得し、
 * 推しが歩く道のグラフを作って data/routes.json に保存する。
 *
 *   node tools/build-routes.js            タイルは tools/.cache に保存し、2回目からは通信しない
 *
 * 手順
 *  1. エリアごとの範囲（場所の広がり＋余白）のタイルを取得する
 *  2. 道路をノードと辺のグラフにする。タイルの境目で切れた線は座標を丸めてつなぐ。高速道路は除く
 *  3. 次数2のノードを畳んで、辺に線の形を持たせる。一番大きくつながった部分だけを残す
 *  4. 千光寺山などの斜面の範囲の辺に、歩く時間の倍率を付ける（道路データに高さがないため）
 *  5. 地下鉄は線路の線をたどって形を作る（たどれなければ直線）
 *
 * 経路そのもの（最短の道）は、保存したグラフを使って lib/router.js が実行時に計算する。
 * 全組み合わせを保存すると数百MBになるため、グラフを保存して計算と結果の控えを実行時に行う。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const world = require('../data/world');

const Z = 16;
const CACHE = path.join(__dirname, '.cache');
const OUT = path.join(__dirname, '..', 'data', 'routes.json');

// エリアごとの範囲（南, 西, 北, 東）。架空のスポットもこの範囲に作る（tools/build-spots.js）。
const BOUNDS = {
  osaka:    [34.6620, 135.4780, 34.7060, 135.5120],
  onomichi: [34.3950, 133.1860, 34.4165, 133.2200],
  mihara:   [34.3940, 133.0700, 34.4120, 133.0920],
};

/* ---------- タイルの計算 ---------- */
const lng2x = (lng, z) => Math.floor((lng + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
};

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'mini-oshi-dev-build' } }, res => {
      if (res.statusCode === 404) { res.resume(); return resolve(null); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(url + ' ' + res.statusCode)); }
      let s = ''; res.setEncoding('utf8');
      res.on('data', d => { s += d; }); res.on('end', () => resolve(s));
    }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tile(layer, x, y) {
  const file = path.join(CACHE, layer, String(Z), `${x}_${y}.geojson`);
  if (fs.existsSync(file)) { const s = fs.readFileSync(file, 'utf8'); return s ? JSON.parse(s) : null; }
  const url = `https://cyberjapandata.gsi.go.jp/xyz/${layer}/${Z}/${x}/${y}.geojson`;
  let text = null;
  for (let i = 0; i < 3; i++) {
    try { text = await fetchText(url); break; } catch (e) { console.warn('再試行', e.message); await sleep(1500); }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text || '');
  await sleep(120); // 間隔をあけて取得する
  return text ? JSON.parse(text) : null;
}

async function linesIn(layer, b, filter, onProgress) {
  const [s, w, n, e] = b;
  const x0 = lng2x(w, Z), x1 = lng2x(e, Z), y0 = lat2y(n, Z), y1 = lat2y(s, Z);
  const out = [];
  const total = (x1 - x0 + 1) * (y1 - y0 + 1); let done = 0;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const fc = await tile(layer, x, y);
    done++; if (onProgress) onProgress(done, total);
    if (!fc) continue;
    for (const f of fc.features || []) {
      if (filter && !filter(f.properties || {})) continue;
      const g = f.geometry; if (!g) continue;
      const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const p of parts) out.push(p.map(([lng, lat]) => [lat, lng]));
    }
  }
  return out;
}

/* ---------- 距離と多角形 ---------- */
function dist(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function inPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function slopeAt(pt) {
  for (const s of world.SLOPES) if (inPoly(pt, s.polygon)) return s.factor;
  return 1;
}

/* ---------- グラフ ---------- */
function buildGraph(lines, all = false) {
  const key = p => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
  const id = new Map(); const pts = [];
  const adj = [];
  const nodeOf = p => {
    const k = key(p);
    let i = id.get(k);
    if (i === undefined) { i = pts.length; id.set(k, i); pts.push(p); adj.push(new Set()); }
    return i;
  };
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = nodeOf(line[i - 1]), b = nodeOf(line[i]);
      if (a !== b) { adj[a].add(b); adj[b].add(a); }
    }
  }
  // 一番大きくつながった部分
  const comp = new Int32Array(pts.length).fill(-1);
  let best = -1, bestSize = 0, c = 0;
  for (let s = 0; s < pts.length; s++) {
    if (comp[s] >= 0) continue;
    const stack = [s]; comp[s] = c; let size = 0;
    while (stack.length) { const u = stack.pop(); size++; for (const v of adj[u]) if (comp[v] < 0) { comp[v] = c; stack.push(v); } }
    if (size > bestSize) { bestSize = size; best = c; }
    c++;
  }
  const keep = i => all || comp[i] === best;
  // 次数2以外のノードを残し、その間を1本の辺にまとめる
  const isJunction = i => adj[i].size !== 2;
  const newId = new Map(); const nodes = [];
  const nid = i => { let k = newId.get(i); if (k === undefined) { k = nodes.length; newId.set(i, k); nodes.push(pts[i]); } return k; };
  const edges = []; const seen = new Set();
  const ek = (a, b) => a < b ? a + '_' + b : b + '_' + a;
  for (let s = 0; s < pts.length; s++) {
    if (!keep(s) || !isJunction(s)) continue;
    for (const first of adj[s]) {
      if (seen.has(ek(s, first))) continue;
      const chain = [s]; let prev = s, cur = first;
      seen.add(ek(s, first));
      while (!isJunction(cur)) {
        chain.push(cur);
        let next = -1; for (const v of adj[cur]) if (v !== prev) next = v;
        if (next < 0 || seen.has(ek(cur, next))) break;
        seen.add(ek(cur, next)); prev = cur; cur = next;
      }
      chain.push(cur);
      edges.push(chain);
    }
  }
  // 輪になっているだけの部分（交差点のない輪）は捨てる。辺の長さと斜面の倍率を求める
  const out = { nodes: [], edges: [] };
  for (const chain of edges) {
    const a = nid(chain[0]), b = nid(chain[chain.length - 1]);
    const coords = chain.map(i => pts[i]);
    let len = 0, slopeLen = 0;
    for (let i = 1; i < coords.length; i++) {
      const d = dist(coords[i - 1], coords[i]); len += d;
      const mid = [(coords[i - 1][0] + coords[i][0]) / 2, (coords[i - 1][1] + coords[i][1]) / 2];
      slopeLen += d * slopeAt(mid);
    }
    if (len < 0.5) continue;
    const factor = Math.round(slopeLen / len * 100) / 100;
    out.edges.push({ a, b, len: Math.round(len * 10) / 10, f: factor, g: simplify(coords, 3) });
  }
  out.nodes = nodes;
  return out;
}

// 線の間引き（Douglas-Peucker、許容は約 tol メートル）
function simplify(coords, tol) {
  if (coords.length <= 2) return coords;
  const keep = new Uint8Array(coords.length); keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  const toXY = p => [p[1] * 91000, p[0] * 111000];
  while (stack.length) {
    const [s, e] = stack.pop();
    const A = toXY(coords[s]), B = toXY(coords[e]);
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const P = toXY(coords[i]);
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const L = dx * dx + dy * dy || 1;
      let t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return coords.filter((_, i) => keep[i]);
}

/* ---------- 線路をたどる（地下鉄の形） ---------- */
// 線路の頂点をそのままノードにした小さなグラフで、駅から駅まで線路の上をたどる。
function makeRailNet(lines) {
  const key = p => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
  const id = new Map(); const pts = []; const adj = [];
  const nodeOf = p => { const k = key(p); let i = id.get(k); if (i === undefined) { i = pts.length; id.set(k, i); pts.push(p); adj.push([]); } return i; };
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const a = nodeOf(line[i - 1]), b = nodeOf(line[i]); if (a === b) continue;
    const w = dist(line[i - 1], line[i]); adj[a].push([b, w]); adj[b].push([a, w]);
  }
  return { pts, adj };
}
function railPath(net, from, to) {
  const near = p => { let best = -1, bd = Infinity; net.pts.forEach((n, i) => { const d = dist(n, p); if (d < bd) { bd = d; best = i; } }); return bd < 350 ? best : -1; };
  const s = near(from), t = near(to);
  if (s < 0 || t < 0) return null;
  const D = new Float64Array(net.pts.length).fill(Infinity); const prev = new Int32Array(net.pts.length).fill(-1);
  D[s] = 0; const open = new Set([s]);
  while (open.size) {
    let u = -1, du = Infinity; for (const v of open) if (D[v] < du) { du = D[v]; u = v; }
    open.delete(u); if (u === t) break;
    for (const [v, w] of net.adj[u]) if (du + w < D[v]) { D[v] = du + w; prev[v] = u; open.add(v); }
  }
  if (!isFinite(D[t]) || D[t] > dist(from, to) * 2.2 + 300) return null;
  const out = []; for (let c = t; c !== -1; c = prev[c]) out.unshift(net.pts[c]);
  return simplify([from, ...out, to], 6);
}

const round = p => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];

async function main() {
  const result = { version: Date.now(), builtAt: new Date().toISOString(), source: '国土地理院ベクトルタイル（experimental_rdcl, experimental_railcl）', areas: {}, lines: {} };
  const placeById = Object.fromEntries(world.PLACES.map(p => [p.id, p]));
  for (const [areaId, b] of Object.entries(BOUNDS)) {
    console.log('道路を取得:', areaId);
    const roads = await linesIn('experimental_rdcl', b, pr => !String(pr.rdCtg || '').includes('高速'));
    const g = buildGraph(roads);
    console.log(`  ノード ${g.nodes.length} 辺 ${g.edges.length}`);
    result.areas[areaId] = {
      bounds: b,
      nodes: g.nodes.map(round),
      edges: g.edges.map(e => [e.a, e.b, e.len, e.f, e.g.map(round)]),
    };
  }
  // 地下鉄の形（線路をたどる）
  console.log('線路を取得: osaka');
  const rails = await linesIn('experimental_railcl', BOUNDS.osaka, pr => String(pr.type || '').includes('ＪＲ以外'));
  const rg = makeRailNet(rails);
  for (const line of world.TRANSIT.filter(l => l.geom === 'rail')) {
    const segs = [];
    for (let i = 1; i < line.stops.length; i++) {
      const a = placeById[line.stops[i - 1]], c = placeById[line.stops[i]];
      const p = railPath(rg, [a.lat, a.lng], [c.lat, c.lng]);
      segs.push((p || [[a.lat, a.lng], [c.lat, c.lng]]).map(round));
      console.log(`  ${line.name} ${a.name}→${c.name}: ${p ? '線路' : '直線'}`);
    }
    result.lines[line.id] = segs;
  }
  fs.writeFileSync(OUT, JSON.stringify(result));
  console.log('保存:', OUT, Math.round(fs.statSync(OUT).size / 1024) + 'KB');
}

/**
 * 1つのエリアの道のグラフを作る（管理画面の「マップ」で、足したエリアの道のデータを作るときに使う）。
 * 国土地理院のベクトルタイル（道路中心線）だけを取得する。取得したタイルは tools/.cache に保存する
 * @param {[number, number, number, number]} b 範囲（南, 西, 北, 東）
 */
async function buildAreaGraph(b, onProgress) {
  const roads = await linesIn('experimental_rdcl', b, pr => !String(pr.rdCtg || '').includes('高速'), onProgress);
  const g = buildGraph(roads);
  return { bounds: b, nodes: g.nodes.map(round), edges: g.edges.map(e => [e.a, e.b, e.len, e.f, e.g.map(round)]) };
}
/** 範囲のタイルの数（取得の前に大きすぎないか確かめる） */
function tileCount(b) { const [s, w, n, e] = b; return (lng2x(e, Z) - lng2x(w, Z) + 1) * (lat2y(s, Z) - lat2y(n, Z) + 1); }

module.exports = { buildAreaGraph, tileCount, BOUNDS };

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
