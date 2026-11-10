/**
 * lib/diary.js
 * 1日のまとめ（天の声の日記）。【AI差し替え箇所 3/7】
 *
 * ミニ推しは喋らないので、第三者の視点で書く。実際の訪問の記録だけから作り、同じ日は同じ文章になる。
 * 雨の日は降っていた時間を書く。歩き方や訪れた理由は書かない。順位や達成の言葉も使わない。
 */
'use strict';

const cal = require('./calendar');

/**
 * @param {object} c キャラ
 * @param {object} r その日の計算結果（lib/simulator.js の dayOf）
 * @param {function} placeOf id → 場所
 * @param {string[]} hourly 時間ごとの天気
 */
function writeDiary(c, r, placeOf, hourly, areaName) {
  /*
   * 【AI差し替え箇所 3/7】実際のサービスでは、その日の訪問の記録をAIに渡して日記を書かせる。
   *   const ai = require('./ai');
   *   const text = await ai.complete({
   *     system: '推しの1日を、第三者の天の声として3〜5文の日記に書いてください。推しに台詞を言わせないこと。',
   *     prompt: JSON.stringify({ name: c.short, visits: r.items.map(i => ({ at: i.at, text: i.text, sub: i.sub })), weather: hourly }),
   *   });
   * 1日分の結果は保存して使い回すこと。
   */
  const R = cal.rng(`diary|${c.id}|${r.day}`);
  const lines = [];
  const visits = r.items.filter(i => i.type === 'visit');
  const god = r.items.filter(i => i.type === 'god');
  const rides = r.items.filter(i => i.type === 'ride');
  const rainHours = hourly.map((w, h) => (w === 'rain' ? h : -1)).filter(h => h >= 0 && h >= 6);
  const hm = ms => { const m = cal.minuteOfDay(ms); return `${Math.floor(m / 60)}時`; };

  if (!r.items.length) return `この日、${c.short}は家で過ごした。`;
  // 天気
  if (rainHours.length) {
    const s = rainHours[0], e = rainHours[rainHours.length - 1] + 1;
    lines.push(`${s}時から${e}時ごろまで、${areaName ? areaName + 'には' : ''}雨が降っていた。`);
  }
  // 神の手
  for (const g of god) lines.push(`${hm(g.at)}ごろ、${g.text.replace(/。$/, '')}。`);
  // 学校・仕事
  const anchor = r.items.find(i => i.type === 'visit' && /着いた。$/.test(i.text));
  if (anchor) { const p = placeOf(anchor.placeId); if (p) lines.push(`${hm(anchor.at)}すぎには${p.model || p.name}にいた。`); }
  // 立ち寄った場所（最初と、いちばん長くいた場所と、最後）
  const real = visits.filter(v => !/着いた。$/.test(v.text));
  if (real.length) {
    const names = [...new Set(real.map(v => (placeOf(v.placeId) || {}).name).filter(Boolean))];
    const longest = real.slice().sort((a, b) => (b.leave - b.at) - (a.leave - a.at))[0];
    const lp = placeOf(longest.placeId);
    const openers = [`この日${c.short}が立ち寄ったのは、${names.slice(0, 4).join('、')}${names.length > 4 ? 'など' : ''}。`, `${names[0]}から始まって、${names.length}か所に立ち寄った一日だった。`];
    lines.push(openers[Math.floor(R() * openers.length)]);
    if (lp && longest.leave - longest.at > 40 * 60000) lines.push(`いちばん長くいたのは${lp.name}で、${Math.round((longest.leave - longest.at) / 60000)}分ほど過ごした。${longest.sub ? longest.sub : ''}`);
  }
  if (rides.length) { const ls = [...new Set(rides.map(x => x.line))]; lines.push(`${ls.slice(0, 3).join('、')}に乗った。`); }
  const meet = r.items.filter(i => i.type === 'meet');
  if (meet.length) lines.push(meet[0].text);
  const stay = r.items.find(i => i.type === 'stay');
  const home = [...r.items].reverse().find(i => i.type === 'home');
  if (stay) lines.push(stay.text);
  else if (home) lines.push(`${hm(home.at)}すぎに家に帰った。`);
  return lines.join('');
}

module.exports = { writeDiary };
