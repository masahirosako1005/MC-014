// public/js/dayview.js
// 過去の日のグラフと日記。
// 3本のリング（歩数、外にいた時間、立ち寄り）。時間ごとの歩数は、1日をなぞるつまみの帯の中の黄色の棒で見せる
// （ここにも棒を置いていたが、つまみの帯と同じ内容なので 2026-11-09 の依頼で外した）。リング1周はその推しのいつもの日（足あとの平均）で、
// 他の人や推しとはくらべない。順位や達成の言葉は使わない。日記は天の声（第三者の視点）。

import { h, fmtNum, mins, reduceMotion } from './core.js';
import { icon } from './icons.js';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#007190', '#7cc4a8', '#ffdd00'];

function ringsSvg(values) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  values.forEach((v, i) => {
    const r = 50 - i * 15; const c = 2 * Math.PI * r;
    const bg = document.createElementNS(NS, 'circle');
    bg.setAttribute('cx', 60); bg.setAttribute('cy', 60); bg.setAttribute('r', r);
    bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', COLORS[i]); bg.setAttribute('stroke-opacity', '0.2'); bg.setAttribute('stroke-width', '11');
    const fg = document.createElementNS(NS, 'circle');
    fg.setAttribute('cx', 60); fg.setAttribute('cy', 60); fg.setAttribute('r', r);
    fg.setAttribute('fill', 'none'); fg.setAttribute('stroke', COLORS[i]); fg.setAttribute('stroke-width', '11'); fg.setAttribute('stroke-linecap', 'round');
    const f = Math.max(0.02, Math.min(1, v));
    fg.setAttribute('stroke-dasharray', `${c * f} ${c}`);
    fg.setAttribute('transform', 'rotate(-90 60 60)');
    fg.dataset.len = String(c * f); fg.dataset.c = String(c);
    svg.append(bg, fg);
  });
  return svg;
}

/**
 * 日付を切り替えたときのアニメーション。リングが外側から順に、0から伸びて一周の位置まで描かれ、
 * 歩数などの数字も0から数え上がる。描き終わるとリングが小さくはずむ。
 * 動きを減らす設定の端末では、すぐに描き終わった状態にする。
 */
function animate(svg, counters) {
  if (reduceMotion()) return;
  const rings = [...svg.querySelectorAll('circle[data-len]')];
  for (const fg of rings) fg.setAttribute('stroke-dasharray', `0 ${fg.dataset.c}`);
  for (const k of counters) k.el.textContent = k.fmt(0);
  const t0 = performance.now(); const DUR = 900, GAP = 140;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const step = now => {
    if (!svg.isConnected && now - t0 > 100) return;
    let done = true;
    rings.forEach((fg, i) => {
      const p = Math.max(0, Math.min(1, (now - t0 - i * GAP) / DUR));
      if (p < 1) done = false;
      fg.setAttribute('stroke-dasharray', `${Number(fg.dataset.len) * ease(p)} ${fg.dataset.c}`);
    });
    const pc = Math.min(1, (now - t0) / (DUR + GAP * 2));
    for (const k of counters) k.el.textContent = k.fmt(k.to * ease(pc));
    if (!done || pc < 1) requestAnimationFrame(step);
    else { svg.classList.remove('pop'); void svg.getBoundingClientRect(); svg.classList.add('pop'); }
  };
  requestAnimationFrame(step);
}

export function renderDayView(j) {
  const r = j.rings || {};
  const avg = r.average || { steps: r.steps || 1, outsideMin: r.outsideMin || 1, stops: r.stops || 1 };
  const vals = [r.steps / Math.max(1, avg.steps), r.outsideMin / Math.max(1, avg.outsideMin), r.stops / Math.max(1, avg.stops)];
  const bSteps = h('b', fmtNum(r.steps)), bOut = h('b', mins(r.outsideMin)), bStops = h('b', String(r.stops));
  const legend = h('ul.ring-legend', [
    h('li', [ic(0), h('span', ['歩数 ', bSteps, '歩 ・ ', r.km, 'km'])]),
    h('li', [ic(1), h('span', ['外にいた時間 ', bOut])]),
    h('li', [ic(2), h('span', ['立ち寄り ', bStops, 'か所'])]),
  ]);
  const svg = ringsSvg(vals);
  // 描かれてから動かす（日付を切り替えるたびに作り直されるので、そのたびに動く）
  requestAnimationFrame(() => animate(svg, [
    { el: bSteps, to: r.steps, fmt: fmtNum },
    { el: bOut, to: r.outsideMin, fmt: v => mins(v) },
    { el: bStops, to: r.stops, fmt: v => String(Math.round(v)) },
  ]));
  return h('div', [
    h('div.dayview', [h('div.rings', [svg]), legend]),
    j.diary ? h('div.diary', [h('h4', [h('span', { html: icon('book') }), 'この日のこと']), h('p', j.diary)]) : null,
  ]);
}
function ic(i) { const el = h('i'); el.style.background = COLORS[i]; return el; }
