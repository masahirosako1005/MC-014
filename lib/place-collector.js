/**
 * lib/place-collector.js
 * 実在の場所の自動収集。【API差し替え箇所】
 *
 * 本アプリでは、国土地理院のベクトルタイルの「注記」（experimental_anno。地図に書かれている寺院、神社、公園、
 * 博物館などの名前と位置）から、エリアの範囲の実在の場所を集める。国土地理院の無料のWEBサービスなので、大会規定で接続できる。
 * 店舗（カフェ、飲食店など）は注記に載らないため、実際のサービスでは、末尾にコメントアウトで残した
 * Webの収集（OpenStreetMap の Overpass API、各店の公式サイトの構造化データなど）と組み合わせる。
 *
 * 集めた場所は「集めた場所」の印（collected）を付けて足す。説明やURLは、自治体や事務局が管理画面で書き足す。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { dist, inPoly } = require('./router');

const Z = 15; // 注記のタイルがある拡大率
const CACHE = path.join(__dirname, '..', 'tools', '.cache', 'experimental_anno');

const lng2x = (lng, z) => Math.floor((lng + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'mini-oshi-place-collector' } }, res => {
      if (res.statusCode === 404) { res.resume(); return resolve(''); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('国土地理院のデータを取得できませんでした（' + res.statusCode + '）')); }
      let s = ''; res.setEncoding('utf8'); res.on('data', d => { s += d; }); res.on('end', () => resolve(s));
    }).on('error', reject);
  });
}
async function tile(x, y) {
  const file = path.join(CACHE, `${x}_${y}.geojson`);
  if (fs.existsSync(file)) { const s = fs.readFileSync(file, 'utf8'); return s ? JSON.parse(s) : null; }
  const text = await fetchText(`https://cyberjapandata.gsi.go.jp/xyz/experimental_anno/${Z}/${x}/${y}.geojson`);
  fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file, text);
  await new Promise(r => setTimeout(r, 120)); // 間隔をあけて取得する
  return text ? JSON.parse(text) : null;
}

/** 注記の分類と名前から、アプリの場所の種類を決める。観光の場所にならないもの（町の名前、学校、役所など）は null */
function classify(ctg, name) {
  if (/学校|小学|中学|高校|高等|大学|幼稚園|保育|病院|医院|役所|役場|支所|警察|消防|郵便|裁判|税務|刑務|浄水|処理場|変電|工場|団地|住宅|墓地|霊園/.test(name)) return null;
  if (/居住地名|行政区画|町字|大字|郡|市区町村|都道府県/.test(ctg)) return null;
  if (/寺院|神社|教会/.test(ctg) || (/建物/.test(ctg) && /寺$|神社$/.test(name))) return 'shrine';
  if (/図書館/.test(name)) return 'library';
  if (/博物館|美術館|資料館|記念館|文学館|城跡|城址|史跡|遺跡|古墳/.test(name)) return 'history';
  if (/公園|庭園|展望|岬|浜|海岸|峠|滝|渓谷/.test(name) || /山|岳|峰|自然地名/.test(ctg)) return 'view';
  if (/文教施設/.test(ctg) && /会館|ホール|文化|芸術|センター/.test(name)) return 'history';
  return null;
}
const HOURS = { shrine: null, view: null, history: [9, 17], library: [9.5, 19] };

/**
 * エリアの範囲の実在の場所を集める
 * @param {object} area エリア（polygon を使う）
 * @param {Array} existing すでにある場所（近くにあるものは足さない）
 * @param {[number,number,number,number]} bounds 集める範囲（南, 西, 北, 東）。省けばエリアの範囲
 * @returns {Promise<Array>} 足す場所の候補
 */
async function collectPlaces(area, existing, bounds, onProgress) {
  const poly = area.polygon;
  const [s, w, n, e] = bounds || [Math.min(...poly.map(p => p[0])), Math.min(...poly.map(p => p[1])), Math.max(...poly.map(p => p[0])), Math.max(...poly.map(p => p[1]))];
  const x0 = lng2x(w, Z), x1 = lng2x(e, Z), y0 = lat2y(n, Z), y1 = lat2y(s, Z);
  const total = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (total > 600) throw new Error(`範囲が広すぎます（タイル${total}枚）。道のデータの範囲などで狭めてください`);
  const found = []; let done = 0;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const fc = await tile(x, y); done++; if (onProgress) onProgress(done, total);
    for (const f of (fc && fc.features) || []) {
      const pr = f.properties || {}; const g = f.geometry || {};
      if (g.type !== 'Point' || !pr.knj) continue;
      const name = String(pr.knj).replace(/\s+/g, '');
      const cat = classify(String(pr.annoCtg || ''), name);
      if (!cat) continue;
      const pt = [g.coordinates[1], g.coordinates[0]];
      if (!inPoly(pt, poly) || pt[0] < s || pt[0] > n || pt[1] < w || pt[1] > e) continue;
      // すでにある場所の近く（同じ名前なら500m、ほかは25m）や、同じものを二度は足さない
      const dup = [...existing, ...found].some(p => { const d = dist([p.lat, p.lng], pt); return d < 25 || (d < 500 && (p.name.includes(name) || name.includes(p.name))); });
      if (dup) continue;
      found.push({ name, cat, lat: Math.round(pt[0] * 1e6) / 1e6, lng: Math.round(pt[1] * 1e6) / 1e6, kana: pr.kana || '', sourceCategory: pr.annoCtg || '' });
    }
  }
  return found.map(p => ({
    name: p.name, cat: p.cat, lat: p.lat, lng: p.lng, area: area.id,
    hours: HOURS[p.cat], always: HOURS[p.cat] === null, outdoor: p.cat === 'view' || p.cat === 'shrine', stay: p.cat === 'library' ? 60 : p.cat === 'history' ? 40 : 25,
    desc: `国土地理院の地図に載っている${p.sourceCategory.replace(/^建物（|）$/g, '') || '場所'}。説明は自治体が書き足せます。`,
    address: `${area.name}（国土地理院の地図の位置）`, url: '',
    collected: { source: '国土地理院 地図の注記', category: p.sourceCategory, kana: p.kana, at: new Date().toISOString() },
  }));
}

module.exports = { collectPlaces, classify };

/* ============================================================================
 * 【API差し替え箇所】Webからも集める（実環境で外部への接続が許される場合）
 * ----------------------------------------------------------------------------
 * 店やカフェなど、地図の注記に載らない場所は、OpenStreetMap の Overpass API などから集める。
 * 利用規約を守り、間隔をあけて取得すること。集めたものは、上の collectPlaces と同じ形にして足す。
 *
 * async function collectFromWeb(area, [s, w, n, e]) {
 *   const q = `[out:json][timeout:25];(
 *     node["amenity"~"cafe|restaurant|library"](${s},${w},${n},${e});
 *     node["shop"~"bakery|confectionery|books|gift"](${s},${w},${n},${e});
 *     node["tourism"~"museum|viewpoint|attraction"](${s},${w},${n},${e});
 *   );out body;`;
 *   const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
 *   const json = await res.json();
 *   return json.elements.filter(e => e.tags && e.tags.name).map(e => ({
 *     name: e.tags.name, lat: e.lat, lng: e.lon, area: area.id,
 *     cat: e.tags.amenity === 'cafe' ? 'cafe' : e.tags.amenity === 'restaurant' ? 'food' : e.tags.shop === 'books' ? 'shop' : e.tags.tourism === 'museum' ? 'history' : 'view',
 *     url: e.tags.website || '', hours: null, // opening_hours を解釈して [開く時, 閉じる時] にする
 *     collected: { source: 'OpenStreetMap', at: new Date().toISOString() },
 *   }));
 * }
 * ========================================================================== */
