/**
 * lib/recommend.js
 * 推しのおすすめ。足あとで多く立ち寄ったスポットを、スポットの情報と相性と一緒に返す。【AI差し替え箇所 7/7】
 *
 * 人気の順ではなく、推しの好みと過ごし方の記録で決める。理由はスポットごとに別のものを書く（設計書 21章）。
 *   1文目: 過ごし方（よく来る時間帯、雨の日・休みの日、滞在の長さ、通いはじめた時期）
 *   2文目: 好みとのつながり（性格ごとの言い回し）か、前に来たときの様子
 * 同じ推しのおすすめの中では、同じ理由の文を二度使わず、同じ言い回しは2回までにする。
 */
'use strict';

const cal = require('./calendar');

const BUCKETS = [[5, 10, '朝'], [10, 13, '昼'], [13, 16, '午後'], [16, 19, '夕方'], [19, 26, '夜']];
const bucketOf = h => (BUCKETS.find(([a, b]) => h >= a && h < b) || BUCKETS[4]);

// 性格ごとの、好みとのつながりの言い回し（{matched} は相性で合った好みの言葉、{place} は場所）
const TIE = {
  arisa: ['撮りためた写真を見返すと、{place}の景色が何枚も出てくる。', '{matched}の話になると、ありさはカメラを持つ手に力が入る。', 'ありさのフィルムには、{place}で撮ったひとこまが残っている。'],
  nagi: ['{matched}のある場所では、凪は時間を忘れる。', '凪の手帳には、{place}の名前が小さな字で書きこまれている。', '静かな{place}は、凪にとって落ち着ける場所のひとつ。'],
  takakage: ['{matched}を確かめるのが、隆景の日課のひとつになっている。', '{place}からは、隆景が気にかける潮の流れが見える。', '隆景は、{place}の地形を城を築く者の目で見ている。'],
  gumi: ['GUMIが{place}の写真を載せた次の日は、店の前に人が集まる。', '{matched}の話になると、GUMIは予定帳に何かを書きこむ。', 'GUMIの予定帳には、{place}の名前が何度も出てくる。'],
  moyashi: ['{place}は、もやしペンギンが日陰を探して見つけた場所。', '{matched}があると、もやしペンギンは片足キックのポーズをとる。', '雨の日になると、もやしペンギンの足は{place}の方へ向かう。'],
  musashi: ['{matched}のある場所なら、武蔵はどこへでも歩いていく。', '{place}での勝負は、まだついていない。', '武蔵は、{place}の門の前で一度も足を止めたことがない。'],
};

function create({ content, sim, spotDb, calendar }) {
  const W = () => content.get();

  function fmtMin(m) { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + '分' : ''}` : `${m}分`; }

  /**
   * おすすめの理由とおすすめを書く。【AI差し替え箇所 7/7】
   * 実際のサービスでは、そのスポットでの過ごし方の記録をAIに渡して書かせる。
   *   const ai = require('./ai');
   *   const out = await ai.complete({ json: true,
   *     system: '推しのおすすめの理由を、第三者の天の声で2文書いてください。1文目は過ごし方、2文目は好みとのつながり。推しには喋らせないこと。',
   *     prompt: JSON.stringify({ name: c.short, place: p.name, records: entry.records.slice(-20), matched: score.matched, personality: canon.personality }) });
   */
  function writeRecommendation(c, p, entry, score, used) {
    const R = cal.rng(`rec|${c.id}|${p.id}`);
    const recs = entry.records;
    const hours = recs.map(r => cal.minuteOfDay(r.at) / 60);
    const counts = {}; for (const h of hours) { const b = bucketOf(h)[2]; counts[b] = (counts[b] || 0) + 1; }
    const topBucket = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const avgH = hours.reduce((s, h) => s + h, 0) / hours.length;
    const rainy = recs.filter(r => r.weather === 'rain').length;
    const offDays = recs.filter(r => !r.workday).length;
    const avgStay = entry.minutes / Math.max(1, entry.count);
    const first = recs[0];
    const options = [];
    if (topBucket && topBucket[1] / recs.length >= 0.5) options.push({ k: 'time', s: { 朝: `朝のうちに${p.name}へ立ち寄ることが多い。`, 昼: `お昼どきになると、${c.short}は${p.name}へ向かうことが多い。`, 午後: `午後、少し時間があくと${p.name}へ足が向く。`, 夕方: `夕方、空の色が変わりはじめるころに${p.name}へ立ち寄ることが多い。`, 夜: `夜になってから${p.name}へ寄ることが多い。` }[topBucket[0]] });
    if (rainy && rainy / recs.length >= 0.3) options.push({ k: 'rain', s: `雨の日になると、${c.short}の足はなぜか${p.name}へ向く。` });
    if (offDays && offDays / recs.length >= 0.7) options.push({ k: 'off', s: `休みの日には、${c.short}はたいてい${p.name}に顔を出す。` });
    if (offDays / recs.length <= 0.3 && recs.length >= 2) options.push({ k: 'weekday', s: `平日の帰り道、${c.short}はよく${p.name}に寄っていく。` });
    if (avgStay >= 50) options.push({ k: 'long', s: `${p.name}に入ると、${c.short}は${fmtMin(avgStay)}ほど出てこない。` });
    if (avgStay < 25) options.push({ k: 'short', s: `${p.name}には、通りがかりに少しだけ寄っていくことが多い。` });
    if (entry.count >= 4) options.push({ k: 'count', s: `${c.short}がこれまでに${entry.count}回立ち寄った${p.genre || p.name}。` });
    if (first) { const d = first.day; options.push({ k: 'since', s: `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日に初めて訪れてから、${c.short}は${p.name}に通っている。` }); }
    const s1 = (options.find(o => !used.has(o.s) && (used.get ? true : true) && countKey(used, o.k) < 2) || options[0] || { s: `${c.short}は、${p.name}に何度か立ち寄っている。`, k: 'none' });
    used.add(s1.s); bump(used, s1.k);

    // 2文目
    const lastDoing = recs.map(r => r.doing).filter(Boolean).pop();
    const tie = (TIE[c.id] || ['{place}は、{short}の好みに合う場所。']).map(t => t.replace('{place}', p.name).replace('{short}', c.short).replace('{matched}', (score && score.matched.length ? score.matched.slice(0, 2).join('や') : (p.genre || p.name))));
    const second = [];
    if (score && score.matched.length) second.push(...tie);
    if (lastDoing) second.push(`前に${p.name}へ来たときは、${lastDoing.replace(/。$/, '')}。`);
    second.push(...tie);
    const s2 = second.find(s => !used.has(s)) || second[Math.floor(R() * second.length)];
    used.add(s2);

    let pick = null;
    if (score && score.highlight) pick = { type: 'menu', text: score.highlight };
    else if (topBucket) pick = { type: 'time', text: `${topBucket[0]}（${Math.round(avgH)}時ごろ）に行く` };
    return { reasons: [s1.s, s2], pick };
  }
  function countKey(used, k) { return (used.keys_ && used.keys_[k]) || 0; }
  function bump(used, k) { used.keys_ = used.keys_ || {}; used.keys_[k] = (used.keys_[k] || 0) + 1; }

  function list(c, who, today, now) {
    const w = W();
    const sum = sim.summarizeVisits(c, who, today, now);
    const items = [];
    const used = new Set();
    for (const e of sum.places) {
      const p = w.placeById.get(e.placeId);
      if (!p || ['station', 'stay', 'home', 'school'].includes(p.cat)) continue;
      const spot = spotDb.spot(p.id); const score = spotDb.score(c.id, p.id);
      const rec = writeRecommendation(c, Object.assign({ genre: p.genre || (spot && spot.genre) }, p), e, score, used);
      items.push({
        placeId: p.id, name: p.name, cat: p.cat, catLabel: (w.CATEGORIES[p.cat] || {}).label, genre: p.genre || (spot && spot.genre) || (w.CATEGORIES[p.cat] || {}).label,
        area: p.area, areaName: (w.areaById.get(p.area) || {}).short, lat: p.lat, lng: p.lng, fictional: !!p.fictional,
        count: e.count, minutes: Math.round(e.minutes), score: score ? score.score : 0, matched: score ? score.matched : [],
        reasons: rec.reasons, pick: rec.pick,
        hours: spot ? spot.hours : null, budget: spot ? spot.budget : 0, rating: spot ? spot.rating : null,
        exterior: spot ? spot.exterior : '', address: p.address, url: p.url || '', menu: spot ? spot.menu : [], reviews: spot ? spot.reviews : [], highlight: score ? score.highlight : null,
        dummy: !spot || spot.source.kind === 'dummy',
      });
      if (items.length >= 40) break;
    }
    const areas = {}; const cats = {};
    for (const it of items) { areas[it.area] = (areas[it.area] || 0) + 1; cats[it.cat] = (cats[it.cat] || 0) + it.count; }
    return {
      characterId: c.id, items,
      areas: Object.entries(areas).map(([id, n]) => ({ id, name: (w.areaById.get(id) || {}).short, count: n })),
      categories: Object.entries(cats).map(([cat, visits]) => ({ cat, label: (w.CATEGORIES[cat] || {}).label, visits })).sort((a, b) => b.visits - a.visits),
      days: sum.days.length,
    };
  }

  return { list, writeRecommendation };
}

module.exports = { create };
