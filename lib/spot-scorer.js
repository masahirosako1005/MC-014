/**
 * lib/spot-scorer.js
 * 推しとスポットの相性（0〜100点）、理由（天の声）、おすすめの一品を求める。【AI差し替え箇所 6/7】
 *
 * 人気の順（口コミの上位）ではなく、推しの好みに合うかで決める。評価の影響は小さくしている。
 * 本アプリのダミーは、好みの言葉（canon.tastes.keywords）とスポットの特徴の言葉の照合と、点数計算で行う（設計書 21章）。
 *
 *   基本12点 + 場所の種類への関心（最大26点。好きな言葉が2つ以上合えば関心0.8とみなす）
 *   + 好きな言葉と特徴・メニューの一致（3つまで、1つ10点） + 公式設定の好きなものに通じる（8点）
 *   + 口コミの評価（3.5を境に1あたり8点） + 予算（使えるお金の1.5倍を超えると−12点、以内なら+4点）
 *   − 苦手なもの（18点） − 駅と宿（15点）。0〜100に収める。
 */
'use strict';

const MODEL = 'dummy-rules-v1';

function words(spot) {
  return [spot.name, spot.genre, ...(spot.tags || []), ...(spot.menu || []).flatMap(m => [m.name, ...(m.tags || [])])].filter(Boolean).join(' ');
}

/**
 * @param {object} c    キャラ（data/world.js）
 * @param {object} canon 公式設定（data/canon.js）
 * @param {object} spot スポットDBの1件（lib/spot-collector.js）
 */
function scoreSpot(c, canon, spot, placeMeta = {}) {
  const tastes = canon.tastes || { keywords: [], avoid: [], budget: 1000 };
  if (placeMeta.onlyFor && !placeMeta.onlyFor.includes(c.id)) return { score: 0, reasons: [], highlight: null, matched: [], model: MODEL };
  const text = words(spot);
  const matched = (tastes.keywords || []).filter(k => text.includes(k));
  let interest = (c.interests || {})[spot.category] || 0;
  if (matched.length >= 2) interest = Math.max(interest, 0.8);
  let s = 12 + Math.min(1, interest) * 26 + Math.min(3, matched.length) * 10;
  const likeHit = (canon.likes || []).find(l => l.split(/[のな・、\s]/).filter(w => w.length >= 2).some(w => text.includes(w)) || text.includes(l));
  if (likeHit) s += 8;
  if (spot.rating) s += (spot.rating - 3.5) * 8;
  const budget = tastes.budget || 0;
  let budgetNote = null;
  if (budget > 0 && spot.budget > 0) { if (spot.budget > budget * 1.5) { s -= 12; budgetNote = 'over'; } else { s += 4; budgetNote = 'ok'; } }
  const avoidHit = [...(tastes.avoid || []), ...(canon.dislikes || [])].find(a => a && text.includes(a.replace(/な場所|もの$/, '')));
  if (avoidHit) s -= 18;
  if (spot.kind === 'transit' || spot.kind === 'stay') s -= 15;
  const score = Math.max(0, Math.min(100, Math.round(s)));

  // おすすめの一品（好きな言葉にいちばん合うメニュー）
  let highlight = null, best = -1;
  for (const m of spot.menu || []) {
    const hit = (tastes.keywords || []).filter(k => (m.name + (m.tags || []).join(' ')).includes(k)).length;
    if (hit > best) { best = hit; highlight = m.name; }
  }
  if (best <= 0 && !(spot.menu || []).length) highlight = null;

  // 理由（天の声。推しには喋らせない）
  const reasons = [];
  if (likeHit) reasons.push(`公式設定の「${likeHit}」に通じる場所。`);
  if (matched.length) reasons.push(`${matched.slice(0, 3).join('、')}が、${c.short}の好みに合う。`);
  if (highlight && best > 0) reasons.push(`おすすめは${highlight}。`);
  if (avoidHit) reasons.push(`${avoidHit}が苦手な${c.short}には、少し合わないところがある。`);
  if (budgetNote === 'over') reasons.push(`${c.short}の使えるお金からすると、少し高い。`);
  return { score, reasons, highlight: best > 0 ? highlight : null, matched, model: MODEL };
}

module.exports = { scoreSpot, MODEL };

/* ============================================================================
 * 【AI差し替え箇所 6/7】AIで相性を判断する（実環境で外部APIへの接続が許される場合）
 * ----------------------------------------------------------------------------
 * バッチ（lib/spot-db.js の runBatch）でまとめて呼ぶ。画面を開くたびには呼ばない。
 *
 * const ai = require('./ai');
 * async function scoreSpotWithAI(c, canon, spot) {
 *   const out = await ai.complete({
 *     json: true,
 *     system: '推しの好みとスポットの情報から、相性を0〜100の点数で判断してください。人気の順ではなく、推しの好みに合うかで決めます。' +
 *             '出力は {"score": 数, "reasons": ["天の声の文", ...], "highlight": "おすすめの一品またはnull", "matched": ["合った好みの言葉"]} のJSONだけ。',
 *     prompt: JSON.stringify({
 *       character: { name: c.name, interests: c.interests, likes: canon.likes, dislikes: canon.dislikes, tastes: canon.tastes },
 *       spot: { name: spot.name, genre: spot.genre, tags: spot.tags, menu: spot.menu, budget: spot.budget, hours: spot.hours, reviews: spot.reviews },
 *     }),
 *   });
 *   return Object.assign(out, { model: 'claude' });
 * }
 * ========================================================================== */
