/**
 * lib/router.js
 * 推しが歩く道と乗り物の経路を求める。
 *
 * data/routes.json（tools/build-routes.js が国土地理院の道路データから作ったグラフ）に、
 * data/world.js の公共交通（乗り場ごとのホームのノード）を足した1つのグラフで、
 * 所要時間が最短の経路をダイクストラ法で求める。結果は出発地ごとに控えておく（実行時に外部へは接続しない）。
 *
 * 時間の単位は分。歩く時間は、経路を選ぶときは分速70mで見積もり、推しごとの時間は legMinutes で求める。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BASE_SPEED = 70; // 経路を選ぶときの歩く速さ（m/分）

function dist(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** 最小ヒープ（ダイクストラ法の候補） */
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const topV = v[0], topK = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    this.lastKey = topK; return topV;
  }
}

class Router {
  /**
   * @param {object} world data/world.js（または lib/content.js で重ねたもの）
   * @param {object} data  data/routes.json の中身
   */
  constructor(world, data) { this.init(world, data); }

  /** グラフを作る（管理画面で道のデータを作り直したときにも呼ぶ） */
  init(world, data) {
    this.world = world;
    this.data = data;
    this.version = data.version;
    this.placeById = new Map(world.PLACES.map(p => [p.id, p]));
    this.nodes = [];   // [lat, lng]
    this.area = [];    // ノードのエリア
    this.edges = [];   // {a, b, cost, len, f, mode, line, geom, stop}
    this.adj = [];     // ノードごとの辺の番号
    this.areaNodes = {};
    for (const [areaId, g] of Object.entries(data.areas)) {
      const off = this.nodes.length;
      this.areaNodes[areaId] = [off, off + g.nodes.length];
      for (const n of g.nodes) { this.nodes.push(n); this.area.push(areaId); this.adj.push([]); }
      for (const [a, b, len, f, geom] of g.edges) this.addEdge(off + a, off + b, { mode: 'walk', len, f, geom }, true);
    }
    this.buildGrid();
    this.snap = new Map(); // placeId → {node, d}
    for (const p of world.PLACES) this.snapPlace(p);
    this.cache = new Map();
    this.routeCache = new Map();
    this.stops = [];       // 乗り場（地図の印）
    this.lineGeom = data.lines || {};
    for (const line of world.TRANSIT) this.addLine(line);
    this.cache.clear(); // 乗り場を足す前の控えは捨てる
  }

  /** 道のデータ（data/routes.json の中身）を差し替えて作り直す */
  reload(world, data) { this.init(world, data); }

  /**
   * 管理画面で場所を足したり動かしたりしたときに、場所の一覧と、道への付け方を合わせ直す。
   * 道のデータのないエリアの場所は、道につながらない（その場所へは目安の直線で動く）
   */
  syncPlaces(world) {
    this.world = world;
    let changed = false;
    for (const p of world.PLACES) {
      const old = this.placeById.get(p.id);
      if (old && old.lat === p.lat && old.lng === p.lng && old.area === p.area) { if (old !== p) this.placeById.set(p.id, p); continue; }
      this.placeById.set(p.id, p); this.snap.delete(p.id); this.snapPlace(p); changed = true;
    }
    if (changed) this.routeCache.clear();
    return changed;
  }
  hasArea(areaId) { return !!this.areaNodes[areaId]; }

  addEdge(a, b, e, both) {
    const i = this.edges.length;
    const cost = e.cost !== undefined ? e.cost : e.len * (e.f || 1) / BASE_SPEED;
    this.edges.push(Object.assign({ a, b, cost }, e));
    this.adj[a].push(i);
    if (both) this.adj[b].push(i);
    return i;
  }

  /** 道のノードの格子（いちばん近いノードを速く探すため。約110m四方） */
  buildGrid() {
    this.grid = new Map();
    for (const [areaId, [s, e]] of Object.entries(this.areaNodes)) for (let i = s; i < e; i++) {
      const n = this.nodes[i]; const k = areaId + ':' + Math.floor(n[0] / 0.001) + ',' + Math.floor(n[1] / 0.0012);
      if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(i);
    }
  }
  nearestNode(pt, areaId) {
    if (areaId && this.grid) {
      const gy = Math.floor(pt[0] / 0.001), gx = Math.floor(pt[1] / 0.0012);
      let best = -1, bd = Infinity;
      for (let ring = 1; ring <= 3 && best < 0; ring++) {
        for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
          for (const i of this.grid.get(areaId + ':' + (gy + dy) + ',' + (gx + dx)) || []) {
            const n = this.nodes[i]; const d = Math.abs(n[0] - pt[0]) * 111000 + Math.abs(n[1] - pt[1]) * 91000;
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      if (best >= 0) return { node: best, d: dist(this.nodes[best], pt) };
    }
    const ranges = areaId && this.areaNodes[areaId] ? [this.areaNodes[areaId]] : Object.values(this.areaNodes);
    let best = -1, bd = Infinity;
    for (const [s, e] of ranges) for (let i = s; i < e; i++) {
      const n = this.nodes[i];
      const d = Math.abs(n[0] - pt[0]) * 111000 + Math.abs(n[1] - pt[1]) * 91000;
      if (d < bd) { bd = d; best = i; }
    }
    return best < 0 ? null : { node: best, d: dist(this.nodes[best], pt) };
  }

  snapPlace(p) {
    if (!this.areaNodes[p.area]) return;
    const s = this.nearestNode([p.lat, p.lng], p.area);
    if (s) this.snap.set(p.id, s);
  }

  stopInfo(line, sid) {
    const pl = this.placeById.get(sid);
    if (pl) return { id: sid, name: pl.name, lat: pl.lat, lng: pl.lng, area: pl.area, placeId: sid };
    const ex = (line.extraStops || []).find(s => s.id === sid);
    if (!ex) throw new Error('乗り場がありません: ' + sid);
    return Object.assign({ area: this.areaOf([ex.lat, ex.lng]) }, ex);
  }

  areaOf(pt) {
    for (const [areaId, [s]] of Object.entries(this.areaNodes)) {
      const b = this.world.AREAS.find(a => a.id === areaId);
      if (b && inPoly(pt, b.polygon)) return areaId;
    }
    return null;
  }

  /** 乗り物の線を足す。乗り場ごとにホームのノードを作り、乗る（待ち時間）、乗っている、降りるの辺でつなぐ */
  addLine(line) {
    const infos = line.stops.map(sid => this.stopInfo(line, sid));
    const plat = [];
    infos.forEach((st, i) => {
      const snap = this.nearestNode([st.lat, st.lng], st.area);
      const pn = this.nodes.length;
      this.nodes.push([st.lat, st.lng]); this.area.push(st.area); this.adj.push([]);
      plat.push(pn);
      const walkLen = snap ? snap.d : 0;
      // 道から乗り場へ（乗る。待ち時間を含む）と、乗り場から道へ（降りる）
      this.addEdge(snap.node, pn, { mode: 'board', line: line.id, cost: line.wait + walkLen / BASE_SPEED, len: walkLen, stop: i }, false);
      this.addEdge(pn, snap.node, { mode: 'alight', line: line.id, cost: walkLen / BASE_SPEED, len: walkLen, stop: i }, false);
      this.stops.push({ key: line.id + ':' + st.id, lineId: line.id, lineName: line.name, mode: line.mode, ...st });
    });
    for (let i = 1; i < infos.length; i++) {
      const a = infos[i - 1], b = infos[i];
      let geom = null;
      if (line.geom === 'rail' && this.lineGeom[line.id]) geom = this.lineGeom[line.id][i - 1];
      if (line.geom === 'road') {
        geom = this.walkGeom([a.lat, a.lng], [b.lat, b.lng], a.area);
        // 道が大きく回り道になるとき（道路データの切れ目など）は直線にする
        if (geom && polyLen(geom) > dist([a.lat, a.lng], [b.lat, b.lng]) * 1.8) geom = null;
      }
      if (!geom) geom = [[a.lat, a.lng], [b.lat, b.lng]];
      const len = polyLen(geom);
      this.addEdge(plat[i - 1], plat[i], { mode: 'ride', line: line.id, cost: line.seg[i - 1], len, geom, from: i - 1, to: i }, false);
      this.addEdge(plat[i], plat[i - 1], { mode: 'ride', line: line.id, cost: line.seg[i - 1], len, geom: geom.slice().reverse(), from: i, to: i - 1 }, false);
    }
  }

  /** 道路だけで2点の間の線を求める（バスの線の形に使う） */
  walkGeom(a, b, areaId) {
    const s = this.nearestNode(a, areaId), t = this.nearestNode(b, areaId);
    if (!s || !t) return null;
    const tree = this.tree(s.node, { walkOnly: true });
    const legs = this.extract(tree, s.node, t.node);
    if (!legs) return null;
    return [a, ...legs.flatMap(l => l.coords), b];
  }

  profileKey(o) { return (o.walkOnly ? 'W' : 'T') + (o.exclude && o.exclude.length ? ':' + o.exclude.slice().sort().join(',') : '') + (o.maxCost ? '<' + o.maxCost : ''); }

  /** 出発ノードからの最短経路の木（控えあり） */
  tree(src, o = {}) {
    const key = this.profileKey(o) + '|' + src;
    const hit = this.cache.get(key);
    if (hit) { this.cache.delete(key); this.cache.set(key, hit); return hit; }
    const n = this.nodes.length;
    const D = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const ex = new Set(o.exclude || []);
    const h = new Heap(); D[src] = 0; h.push(0, src);
    while (h.size) {
      const u = h.pop(); const du = h.lastKey;
      if (du > D[u]) continue;
      if (o.maxCost && du > o.maxCost) break; // 近くだけでよいときは、そこで打ち切る
      for (const ei of this.adj[u]) {
        const e = this.edges[ei];
        if (e.mode !== 'walk') { if (o.walkOnly || ex.has(e.line)) continue; }
        const v = e.a === u ? e.b : e.a;
        if (e.mode !== 'walk' && e.a !== u) continue; // 乗り物の辺は向きがある
        const nd = du + e.cost;
        if (nd < D[v]) { D[v] = nd; prev[v] = ei; h.push(nd, v); }
      }
    }
    const t = { D, prev };
    this.cache.set(key, t);
    if (this.cache.size > 900) this.cache.delete(this.cache.keys().next().value);
    return t;
  }

  /** 木からノードtまでの道のりを、歩く区間と乗り物の区間に分けて返す */
  extract(tree, s, t) {
    if (!isFinite(tree.D[t])) return null;
    const seq = [];
    for (let v = t; v !== s; ) {
      const ei = tree.prev[v]; if (ei < 0) return null;
      const e = this.edges[ei];
      const u = e.a === v && e.mode === 'walk' ? e.b : e.a;
      seq.unshift({ e, forward: e.a === u });
      v = u;
    }
    const legs = [];
    let cur = null;
    for (const { e, forward } of seq) {
      if (e.mode === 'walk') {
        const g = forward ? e.geom : e.geom.slice().reverse();
        if (!cur || cur.mode !== 'walk') { cur = { mode: 'walk', meters: 0, effMeters: 0, coords: [] }; legs.push(cur); }
        cur.meters += e.len; cur.effMeters += e.len * (e.f || 1);
        for (const p of g) if (!cur.coords.length || dist(cur.coords[cur.coords.length - 1], p) > 0.5) cur.coords.push(p);
      } else if (e.mode === 'board') {
        const line = this.world.TRANSIT.find(l => l.id === e.line);
        cur = { mode: line.mode, lineId: line.id, line: line.name, wait: line.wait, ride: 0, meters: 0, coords: [], fromIdx: e.stop, toIdx: e.stop };
        legs.push(cur);
      } else if (e.mode === 'ride') {
        cur.ride += e.cost; cur.meters += e.len; cur.toIdx = e.to;
        for (const p of e.geom) if (!cur.coords.length || dist(cur.coords[cur.coords.length - 1], p) > 0.5) cur.coords.push(p);
      } else if (e.mode === 'alight') {
        const line = this.world.TRANSIT.find(l => l.id === e.line);
        const st = i => this.stopInfo(line, line.stops[i]);
        cur.from = st(cur.fromIdx).name; cur.to = st(cur.toIdx).name;
        cur.fromId = line.stops[cur.fromIdx]; cur.toId = line.stops[cur.toIdx];
        cur = null;
      }
    }
    return legs.filter(l => l.mode !== 'walk' || l.meters > 1 || l.coords.length > 1);
  }

  /**
   * 場所から場所への経路
   * @returns {{legs:Array, walkM:number, rideM:number}|null}
   */
  route(fromId, toId, o = {}) {
    // 同じ組み合わせは控えを使う（足あとの計算で何度も同じ道を通るため）
    const ck = fromId + '>' + toId + '|' + this.profileKey(o);
    if (this.routeCache.has(ck)) return this.routeCache.get(ck);
    const res = this.routeRaw(fromId, toId, o);
    this.routeCache.set(ck, res);
    if (this.routeCache.size > 60000) this.routeCache.delete(this.routeCache.keys().next().value);
    return res;
  }
  routeRaw(fromId, toId, o = {}) {
    const a = this.placeById.get(fromId), b = this.placeById.get(toId);
    if (!a || !b) return null;
    if (fromId === toId) return { legs: [], walkM: 0, rideM: 0 };
    const sa = this.snap.get(fromId), sb = this.snap.get(toId);
    if (!sa || !sb) return a.area !== b.area ? this.intercity(a, b, o) : straight(a, b);
    let legs = this.extract(this.tree(sa.node, o), sa.node, sb.node);
    if (!legs && o.walkOnly) legs = this.extract(this.tree(sa.node, { exclude: o.exclude }), sa.node, sb.node);
    if (!legs) return a.area !== b.area ? this.intercity(a, b, o) : null; // 同じエリアで道がつながらないとき（渡船を使わない向島など）は行けない
    // 場所と道のあいだの短い区間を足す
    const pa = [a.lat, a.lng], pb = [b.lat, b.lng];
    if (!legs.length || legs[0].mode !== 'walk') legs.unshift({ mode: 'walk', meters: 0, effMeters: 0, coords: [pa] });
    else legs[0].coords.unshift(pa);
    legs[0].meters += sa.d; legs[0].effMeters += sa.d;
    const last = legs[legs.length - 1];
    if (last.mode !== 'walk') legs.push({ mode: 'walk', meters: sb.d, effMeters: sb.d, coords: [last.coords[last.coords.length - 1] || pb, pb] });
    else { last.coords.push(pb); last.meters += sb.d; last.effMeters += sb.d; }
    for (const l of legs) { l.meters = Math.round(l.meters); if (l.effMeters) l.effMeters = Math.round(l.effMeters); }
    const walkM = legs.filter(l => l.mode === 'walk').reduce((s, l) => s + l.meters, 0);
    const rideM = legs.filter(l => l.mode !== 'walk').reduce((s, l) => s + l.meters, 0);
    return { legs: legs.filter(l => l.mode !== 'walk' || l.meters > 0), walkM, rideM };
  }

  /**
   * 乗り物の線でつながっていないエリアどうし（管理画面で足したエリアなど）の、目安の移動。
   * それぞれのエリアの最初の駅まで道で行き、駅と駅のあいだは「鉄道など（目安）」として直線で結ぶ。
   * 時間は距離から見積もる（時速80km、乗り場で20分待つ）。実際の路線は、data/world.js の TRANSIT に足すと使われる
   */
  intercity(a, b, o) {
    if (o && o.noIntercity) return null;
    const A = (this.world.AREAS || []).find(x => x.id === a.area), B = (this.world.AREAS || []).find(x => x.id === b.area);
    if (!A || !B || A.id === B.id) return straight(a, b);
    const sa = this.placeById.get(A.arrival), sb = this.placeById.get(B.arrival);
    if (!sa || !sb) return straight(a, b);
    const first = a.id === sa.id ? { legs: [] } : (this.route(a.id, sa.id, Object.assign({}, o, { noIntercity: true })) || straight(a, sa));
    const last = b.id === sb.id ? { legs: [] } : (this.route(sb.id, b.id, Object.assign({}, o, { noIntercity: true })) || straight(sb, b));
    const m = dist([sa.lat, sa.lng], [sb.lat, sb.lng]);
    const ride = { mode: 'train', lineId: 'intercity', line: '鉄道など（目安）', wait: 20, ride: Math.round(m / 1333), meters: Math.round(m), coords: [[sa.lat, sa.lng], [sb.lat, sb.lng]], from: sa.name, to: sb.name, fromId: sa.id, toId: sb.id };
    const legs = [...first.legs, ride, ...last.legs];
    return { legs, walkM: legs.filter(l => l.mode === 'walk').reduce((s, l) => s + l.meters, 0), rideM: legs.filter(l => l.mode !== 'walk').reduce((s, l) => s + l.meters, 0), intercity: true };
  }

  /** 経路にかかる時間（分）。歩く区間はキャラの分速、乗り物は待ち時間と乗車時間 */
  static legMinutes(leg, speed) {
    if (leg.mode === 'walk') return (leg.effMeters || leg.meters) / speed;
    if (leg.mode === 'taxi') return (leg.wait || 0) + leg.meters / 350;
    return (leg.wait || 0) + (leg.ride || 0);
  }
  static routeMinutes(r, speed) { return r ? r.legs.reduce((s, l) => s + Router.legMinutes(l, speed), 0) : Infinity; }
}

function polyLen(g) { let s = 0; for (let i = 1; i < g.length; i++) s += dist(g[i - 1], g[i]); return s; }
function inPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function straight(a, b) {
  const m = Math.round(dist([a.lat, a.lng], [b.lat, b.lng]) * 1.3);
  return { legs: [{ mode: 'walk', meters: m, effMeters: m, coords: [[a.lat, a.lng], [b.lat, b.lng]] }], walkM: m, rideM: 0 };
}

let shared = null;
/** data/routes.json を読んで Router を作る（1回だけ） */
function load(world) {
  if (shared && shared.world === world) return shared;
  const file = path.join(__dirname, '..', 'data', 'routes.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  shared = new Router(world, data);
  return shared;
}

module.exports = { Router, load, dist, inPoly, polyLen, BASE_SPEED };
