// public/js/map.js
// 地図（Leaflet + 国土地理院タイル）。推しが実際の道を移動する舞台。
// 歩いた道は点線、乗り物は実線。獲得したエリアの外側を暗くし、境目に線を引く。
// 地図の印は divIcon にHTML要素を渡して作り、style 属性の入ったHTML文字列は使わない（CSPのため）。

import { h, esc } from './core.js';
import { icon, catIcon, modeIcon } from './icons.js';
import { mapFace } from './avatar.js';

const L = window.L;
const TILES = {
  photo: { url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', max: 18 },
  pale: { url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', max: 18 },
  std: { url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', max: 18 },
};
const ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
const EAT = new Set(['food', 'cafe', 'sweets']);
export const MAIN = '#007190';

export function createMap(el, opts = {}) {
  const map = L.map(el, {
    zoomControl: false, attributionControl: true, scrollWheelZoom: opts.wheel !== false, tap: true,
    minZoom: 9, maxZoom: 18, zoomSnap: 0.5, preferCanvas: false,
  });
  map.attributionControl.setPrefix(false);
  let tile = null;
  function setStyle(style) {
    const t = TILES[style] || TILES.photo;
    if (tile) map.removeLayer(tile);
    tile = L.tileLayer(t.url, { maxNativeZoom: t.max, maxZoom: 18, attribution: ATTR, className: 'tiles-' + style });
    tile.addTo(map);
    el.dataset.style = style;
  }
  setStyle(opts.style || 'photo');

  const layers = { areas: L.layerGroup().addTo(map), stops: L.layerGroup().addTo(map), route: L.layerGroup().addTo(map), pins: L.layerGroup().addTo(map), face: L.layerGroup().addTo(map), fx: L.layerGroup().addTo(map) };
  let faceMarker = null; let faceChar = null;
  let areaBounds = null;

  /** 獲得したエリアの外側を暗くし、境目に線を引く */
  function drawAreas(areas) {
    layers.areas.clearLayers();
    const world = [[85, -179], [85, 179], [-85, 179], [-85, -179]];
    L.polygon([world, ...areas.map(a => a.polygon)], { stroke: false, fillColor: '#0b1233', fillOpacity: 0.42, interactive: false, className: 'outside' }).addTo(layers.areas);
    for (const a of areas) {
      L.polygon(a.polygon, { color: '#ffffff', weight: 6, opacity: 0.7, fill: false, interactive: false }).addTo(layers.areas);
      L.polygon(a.polygon, { color: MAIN, weight: 3, opacity: 1, fill: false, dashArray: null, interactive: false }).addTo(layers.areas);
    }
    areaBounds = areas.length ? L.latLngBounds(areas.flatMap(a => a.polygon)) : null;
  }
  function fitArea(a) { if (a) map.fitBounds(L.latLngBounds(a.polygon), { padding: [20, 20] }); }

  /** 駅、バス停、桟橋、ロープウェイの駅（拡大率13未満では隠す） */
  function drawStops(stops, onClick) {
    layers.stops.clearLayers();
    for (const s of stops || []) {
      const m = L.circleMarker([s.lat, s.lng], { radius: 4.5, color: '#1f2a4a', weight: 2, fillColor: '#ffffff', fillOpacity: 1, className: 'stop-dot' });
      m.bindTooltip(esc(`${s.name}（${s.lines.join('、')}）`), { direction: 'top', offset: [0, -4] });
      if (onClick) m.on('click', () => onClick(s));
      m.addTo(layers.stops);
    }
    const sync = () => { const z = map.getZoom(); el.classList.toggle('hide-stops', z < 13); };
    map.on('zoomend', sync); sync();
  }

  /** 1日の足取りを描く。until より後の道とピンは薄く描く（デイ・リプレイ） */
  function drawDay(j, o = {}) {
    layers.route.clearLayers(); layers.pins.clearLayers();
    const until = o.until === undefined ? Infinity : o.until;
    for (const l of j.legs || []) {
      if (l.mode === 'god' || !l.coords || l.coords.length < 2) continue;
      const walk = l.mode === 'walk';
      const style = { color: MAIN, weight: walk ? 4.5 : 6, opacity: 1, dashArray: walk ? '2 9' : null, lineCap: 'round', interactive: false };
      const faded = { ...style, color: '#ffffff', opacity: 0.55 };
      if (l.endAt <= until) { L.polyline(l.coords, { color: '#ffffff', weight: style.weight + 4, opacity: 0.85, interactive: false, dashArray: walk ? '2 9' : null, lineCap: 'round' }).addTo(layers.route); L.polyline(l.coords, style).addTo(layers.route); }
      else if (l.startAt >= until) L.polyline(l.coords, faded).addTo(layers.route);
      else {
        const f = (until - l.startAt) / Math.max(1, l.endAt - l.startAt);
        const [a, b] = splitLine(l.coords, f);
        L.polyline(a, style).addTo(layers.route); L.polyline(b, faded).addTo(layers.route);
      }
    }
    // 公共交通機関を使った区間の、乗った駅と降りた駅（バス停、桟橋、ロープウェイの駅）に乗り物のアイコンを出す。
    // 乗り換えで同じ駅に2つ重なるときは1つにまとめる。なぞった時刻より後のものは薄くする
    const seenStops = new Map();
    for (const l of j.legs || []) {
      if (l.mode === 'walk' || l.mode === 'god' || l.mode === 'taxi' || !l.coords || l.coords.length < 2) continue;
      const ends = [[l.coords[0], l.from, l.startAt, '乗った'], [l.coords[l.coords.length - 1], l.to, l.endAt, '降りた']];
      for (const [pt, name, at, verb] of ends) {
        const key = name || pt.map(v => v.toFixed(4)).join(',');
        const prev = seenStops.get(key);
        if (prev) { prev.lines.add(l.line); if (at < prev.at) prev.at = at; continue; }
        seenStops.set(key, { pt, name, at, mode: l.mode, lines: new Set([l.line]), verb });
      }
    }
    for (const s of seenStops.values()) {
      const later = s.at > until;
      const el = h('div.ride-stop' + (later ? '.later' : ''), { html: icon(modeIcon(s.mode)) });
      const m = L.marker(s.pt, { icon: L.divIcon({ html: el, className: 'pin-wrap', iconSize: [26, 26], iconAnchor: [13, 13] }), keyboard: false, title: s.name || '', zIndexOffset: later ? -150 : -50 });
      m.bindTooltip(esc(`${s.name || '乗り場'}（${[...s.lines].join('、')}）`), { direction: 'top', offset: [0, -12] });
      m.addTo(layers.pins);
    }
    for (const p of j.pins || []) {
      const later = p.at > until;
      const iconEl = h('div.pin' + (EAT.has(p.cat) ? '.eat' : '.see') + (later ? '.later' : '') + (p.fictional ? '.fic' : ''), { html: icon(catIcon(p.cat)) });
      // 右上に立ち寄った順番。なぞって見返している途中は、その時刻までに立ち寄った分だけ出す
      const nos = (p.orders || []).filter((n, k) => !(p.ats && p.ats[k] > until));
      if (p.orders && p.orders.length) iconEl.append(h('span.pin-no' + (nos.length ? '' : '.later'), (nos.length ? nos : p.orders.slice(0, 1)).join('・')));
      const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ html: iconEl, className: 'pin-wrap', iconSize: [30, 30], iconAnchor: [15, 15] }), keyboard: false, title: p.name, zIndexOffset: later ? -100 : 0 });
      if (o.onPin) m.on('click', () => o.onPin(p));
      m.addTo(layers.pins);
    }
    // その日のスタート地点（家や泊まった宿）。旗の印と「スタート」の札
    const st = (j.items || []).find(i => i.type === 'start' && i.lat !== undefined);
    if (st) {
      const el = h('div.pin.start-pin', { html: icon('flag') });
      el.append(h('span.start-tag', 'スタート'));
      const m = L.marker([st.lat, st.lng], { icon: L.divIcon({ html: el, className: 'pin-wrap', iconSize: [30, 30], iconAnchor: [15, 15] }), keyboard: false, title: `スタート: ${st.placeName || ''}`, zIndexOffset: 50 });
      if (o.onPin && st.placeId) m.on('click', () => o.onPin({ placeId: st.placeId }));
      m.addTo(layers.pins);
    }
  }

  function setFace(c, latlng, o = {}) {
    if (!latlng) { if (faceMarker) { layers.face.removeLayer(faceMarker); faceMarker = null; } return; }
    if (!faceMarker || faceChar !== c.id) {
      if (faceMarker) layers.face.removeLayer(faceMarker);
      faceMarker = L.marker(latlng, { icon: L.divIcon({ html: mapFace(c, o.size || 44), className: 'face-wrap', iconSize: [52, 52], iconAnchor: [26, 26] }), zIndexOffset: 1000, keyboard: false, interactive: false });
      faceMarker.addTo(layers.face); faceChar = c.id;
    } else faceMarker.setLatLng(latlng);
    el.classList.toggle('moving', !!o.moving);
  }
  const faceLatLng = () => faceMarker && faceMarker.getLatLng();

  /** 場所に黄色の輪を少しの間出す */
  function ring(lat, lng) {
    const c = L.circleMarker([lat, lng], { radius: 22, color: '#ffdd00', weight: 5, fill: false, className: 'ring-fx', interactive: false }).addTo(layers.fx);
    setTimeout(() => layers.fx.removeLayer(c), 2400);
  }
  /** 見えている部分（padBottom を除く）の真ん中に場所が来るように動かす */
  function focus(lat, lng, o = {}) {
    if (!map._loaded) return;
    const z = Math.max(map.getZoom(), o.zoom || 16);
    const size = map.getSize();
    const padBottom = o.padBottom || 0, padRight = o.padRight || 0;
    const target = map.project([lat, lng], z).add([padRight / 2, padBottom / 2]);
    const center = map.unproject(target, z);
    if (o.instant) map.setView(center, z, { animate: false }); else map.flyTo(center, z, { duration: 0.6 });
    if (o.ring !== false) ring(lat, lng);
  }
  function fitDay(j, o = {}) {
    const pts = [];
    for (const l of j.legs || []) if (l.mode !== 'god') for (const p of l.coords || []) pts.push(p);
    for (const p of j.pins || []) pts.push([p.lat, p.lng]);
    if (o.extra) pts.push(o.extra);
    if (!pts.length) return false;
    // 遠いエリアへの移動（新幹線）を含むと広くなりすぎるので、最後にいたエリアの点に絞る
    let use = pts;
    if (o.near) use = pts.filter(p => Math.abs(p[0] - o.near[0]) < 0.08 && Math.abs(p[1] - o.near[1]) < 0.1);
    if (!use.length) use = pts;
    const b = L.latLngBounds(use);
    map.fitBounds(b.pad(0.15), { paddingTopLeft: [20, o.padTop || 20], paddingBottomRight: [o.padRight || 20, o.padBottom || 20], maxZoom: 16, animate: !o.instant });
    return true;
  }
  function fitAll() { if (areaBounds) map.fitBounds(areaBounds, { padding: [20, 20] }); }

  /** 推しを線に沿って動かす（一緒に出かける画面の移動の場面） */
  let anim = null;
  function moveAlong(c, coords, ms = 2200) {
    stopAnim();
    if (!coords || coords.length < 2) return Promise.resolve();
    const total = lineLen(coords);
    return new Promise(resolve => {
      const t0 = performance.now();
      const step = now => {
        if (!faceMarker && !c) return resolve();
        const f = Math.min(1, (now - t0) / ms);
        const p = pointAt(coords, total * easeInOut(f));
        setFace(c, p, { moving: f < 1 });
        if (f < 1) anim = requestAnimationFrame(step); else { anim = null; resolve(); }
      };
      anim = requestAnimationFrame(step);
    });
  }
  function stopAnim() { if (anim) cancelAnimationFrame(anim); anim = null; }

  function destroy() { stopAnim(); try { map.stop(); map.remove(); } catch (e) { /* 片付け済み */ } faceMarker = null; }

  return { map, layers, setStyle, drawAreas, fitArea, drawStops, drawDay, setFace, faceLatLng, focus, ring, fitDay, fitAll, moveAlong, stopAnim, destroy,
    zoomIn: () => map.zoomIn(), zoomOut: () => map.zoomOut(), invalidate: () => map.invalidateSize() };
}

/* ---- 線の計算 ---- */
export function dist(a, b) { const dx = (a[1] - b[1]) * 91000, dy = (a[0] - b[0]) * 111000; return Math.hypot(dx, dy); }
export function lineLen(c) { let s = 0; for (let i = 1; i < c.length; i++) s += dist(c[i - 1], c[i]); return s; }
export function pointAt(c, d) {
  for (let i = 1; i < c.length; i++) {
    const s = dist(c[i - 1], c[i]);
    if (d <= s) { const f = s ? d / s : 0; return [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * f, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * f]; }
    d -= s;
  }
  return c[c.length - 1];
}
export function splitLine(c, f) {
  const total = lineLen(c); let need = total * Math.max(0, Math.min(1, f));
  const a = [c[0]];
  for (let i = 1; i < c.length; i++) {
    const s = dist(c[i - 1], c[i]);
    if (need >= s) { a.push(c[i]); need -= s; continue; }
    const k = s ? need / s : 0; const m = [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * k, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * k];
    a.push(m); return [a, [m, ...c.slice(i)]];
  }
  return [a, [c[c.length - 1]]];
}
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * その時刻に推しがいた位置。区間の途中なら線の上の進んだ位置、区間の間なら直前の区間の終わり。
 * @returns {{pos:[number,number], moving:boolean, leg:object|null}}
 */
export function positionAt(legs, t, fallback) {
  const list = (legs || []).filter(l => l.coords && l.coords.length);
  let last = null;
  for (const l of list) {
    if (l.startAt <= t && t < l.endAt && l.mode !== 'god') {
      const f = (t - l.startAt) / Math.max(1, l.endAt - l.startAt);
      return { pos: pointAt(l.coords, lineLen(l.coords) * f), moving: true, leg: l };
    }
    if (l.endAt <= t || (l.mode === 'god' && l.startAt <= t)) last = l;
  }
  if (last) return { pos: last.coords[last.coords.length - 1], moving: false, leg: null };
  if (list[0]) return { pos: list[0].coords[0], moving: false, leg: null };
  return { pos: fallback || null, moving: false, leg: null };
}
