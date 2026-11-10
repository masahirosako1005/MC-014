/**
 * lib/spot-collector.js
 * スポット情報の収集（ダミー）。
 *
 * 場所ごとに、基本情報、属性（何の店か）、営業時間、口コミと評価、予算、メニューを集める。
 * 大会規定で外部のWebサイトに接続できないため、data/spot-sources.js の「集めた結果」のダミーから作る。
 * Webから集める処理は collectFromWeb として【API差し替え箇所】にコメントアウトで残している。
 */
'use strict';

const { GENRES, REVIEW_TEXTS, REAL_TEMPLATE_BY_CAT, REAL_TAGS } = require('../data/spot-sources');
const { rng } = require('./calendar');

const WEEK = 7 * 86400000;
const KIND = { food: 'shop', cafe: 'shop', sweets: 'shop', shop: 'shop', view: 'nature', shrine: 'facility', history: 'facility', library: 'facility', dojo: 'facility', station: 'transit', stay: 'stay' };

/** 1か所分の「集めた結果」（ダミー） */
function collectOne(p, now) {
  const tplKey = p.trait || REAL_TEMPLATE_BY_CAT[p.cat];
  const G = (tplKey && GENRES[tplKey]) || {};
  const kind = G.always || p.always ? (KIND[p.cat] === 'shop' ? 'shop' : (p.outdoor ? 'nature' : KIND[p.cat])) : KIND[p.cat] || 'facility';
  const week = Math.floor(now / WEEK);
  const R = rng(`reviews|${p.id}|${week}`);
  const base = 3.4 + rng(`base|${p.id}`)() * 1.2;
  const reviews = [0, 1, 2].map(i => {
    const r = Math.max(2.5, Math.min(5, Math.round((base + (R() - 0.5) * 0.9) * 10) / 10));
    const pool = r >= 3.8 ? REVIEW_TEXTS.good : REVIEW_TEXTS.mid;
    return { rating: r, text: pool[Math.floor(R() * pool.length)], at: new Date((week - i) * WEEK).toISOString().slice(0, 10) };
  });
  const rating = Math.round(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length * 10) / 10;
  const isShop = kind === 'shop';
  const tags = [...new Set([...(G.tags || []), ...(REAL_TAGS[p.id] || []), ...(p.trait === 'dojo' ? ['道場', '剣道', '稽古', '木刀'] : p.trait === 'karate' ? ['道場', '空手', '稽古'] : p.trait === 'boxing' ? ['ジム', 'ボクシング', '強い相手'] : [])])];
  return {
    id: p.id, name: p.name, address: p.address, url: p.url || '', lat: p.lat, lng: p.lng,
    exterior: G.exterior || '（外観の情報はありません）', description: p.desc,
    kind, category: p.cat, genre: p.genre || G.label || (p.cat === 'dojo' ? '道場' : ''), tags,
    hours: p.always || !p.hours ? { always: true } : { open: p.hours[0], close: p.hours[1], always: false },
    reviews, rating, reviewCount: 12 + Math.floor(rng(`cnt|${p.id}`)() * 180) + (week % 7),
    budget: isShop ? (G.budget || 1000) : (G.budget || 0),
    menu: isShop ? (G.menu || []).map(([name, price, t]) => ({ name, price, tags: t })) : (G.menu || []).map(([name, price, t]) => ({ name, price, tags: t })),
    fictional: !!p.fictional,
    source: { kind: 'dummy', collectedAt: new Date(now).toISOString() },
  };
}

/** エリアの全スポットを集める（自宅と学校は除く） */
function collectSpots(places, now = Date.now()) {
  return places.filter(p => p.cat !== 'home' && p.cat !== 'school').map(p => collectOne(p, now));
}

module.exports = { collectSpots, collectOne };

/* ============================================================================
 * 【API差し替え箇所】Webからスポット情報を集める（実環境で外部への接続が許される場合）
 * ----------------------------------------------------------------------------
 * サイトの利用規約と robots.txt を守り、間隔をあけて集めること。
 * 公式サイトの構造化データ（schema.org の LocalBusiness / Restaurant など）を読む例。
 *
 * async function collectFromWeb(p) {
 *   if (!p.url) return null;
 *   const res = await fetch(p.url, { headers: { 'User-Agent': 'mini-oshi-spot-collector' } });
 *   const html = await res.text();
 *   const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => {
 *     try { return JSON.parse(m[1]); } catch { return null; }
 *   }).filter(Boolean);
 *   const biz = blocks.flat().find(b => /LocalBusiness|Restaurant|CafeOrCoffeeShop|Bakery|Store|Museum|PlaceOfWorship/.test(b['@type']));
 *   if (!biz) return null;
 *   return {
 *     name: biz.name, address: biz.address && biz.address.streetAddress, url: p.url,
 *     genre: biz.servesCuisine || biz['@type'], budget: parseBudget(biz.priceRange),
 *     hours: parseOpeningHours(biz.openingHoursSpecification),
 *     rating: biz.aggregateRating && Number(biz.aggregateRating.ratingValue),
 *     reviewCount: biz.aggregateRating && Number(biz.aggregateRating.reviewCount),
 *     menu: (biz.hasMenu && biz.hasMenu.hasMenuSection || []).flatMap(s => s.hasMenuItem || []).map(i => ({ name: i.name, price: Number(i.offers && i.offers.price) })),
 *     source: { kind: 'web', collectedAt: new Date().toISOString(), url: p.url },
 *   };
 * }
 * // collectSpots の中で: const web = await collectFromWeb(p); return web ? Object.assign(collectOne(p, now), web) : collectOne(p, now);
 * ========================================================================== */
