// public/js/scrubber.js
// デイ・リプレイ（1日をなぞるつまみ）。推しの1日を6時〜24時の1本の帯で見せる。
// 帯の中に時間ごとの歩数（黄色の棒）、帯の上に時間ごとの天気、帯の縁に出来事の印。
// つまみ（シンプルな丸いスライダー）を左右にすべらせると、onChange(t) で地図とタイムラインに時刻を伝える。今日は今の時刻がライブ。
// つまんでいる間は、つまみを少し大きくし、後ろが透けるガラスのような半透明にする（.grabbing）。

import { h, hm, minuteOfDay } from './core.js';
import { icon, weatherIcon } from './icons.js';
import { positionAt } from './map.js';

const MIN = 60000;

export function createScrubber({ char, onChange }) {
  let j = null, t = null; // t: 選んだ時刻（null はライブ / 1日全体）
  let startH = 6; const endH = 24;
  const wx = h('div.scrub-wx', { 'aria-hidden': 'true' });
  const bars = h('div.scrub-bars');
  const marks = h('div.scrub-marks');
  const future = h('div.scrub-future');
  // つまみの中には、歩いている人のピクトグラム
  const knob = h('div.scrub-knob', { 'aria-hidden': 'true', html: icon('walk') });
  const band = h('div.scrub-band', { tabindex: '0', role: 'slider', 'aria-label': '1日をなぞる', 'aria-valuemin': '0', 'aria-valuemax': '100' }, [bars, future, marks, knob]);
  const ticks = h('div.scrub-ticks', { 'aria-hidden': 'true' });
  const sayTime = h('span.time');
  const sayTxt = h('span.txt');
  const sayBtn = h('button.btn.btn-small.btn-white');
  const say = h('div.scrub-say', [h('span.txt', [sayTime, ' ', sayTxt]), sayBtn]);
  const el = h('div.scrub', [wx, band, ticks, say]);

  const ds = () => j.dayStart;
  const nowT = () => j.isToday ? Date.now() + (j.offset || 0) : null;
  const tToX = ms => ((ms - ds()) / 3600000 - startH) / (endH - startH);
  const xToT = f => ds() + (startH + f * (endH - startH)) * 3600000;

  function layout() {
    // その日の最初の出来事が6時より前なら、帯をその時まで広げる（3時まで）
    const first = j.items.length ? j.items[0].at : null;
    const fh = first ? (first - ds()) / 3600000 : 6;
    startH = Math.max(3, Math.min(6, Math.floor(fh)));
    const span = endH - startH;
    wx.replaceChildren(); bars.replaceChildren(); marks.replaceChildren(); ticks.replaceChildren();
    const max = Math.max(300, ...j.hourlySteps.slice(startH));
    for (let hr = startH; hr < endH; hr++) {
      const x = (hr - startH + 0.5) / span * 100;
      const w = j.hourlyWeather[hr];
      const wi = h('span', { html: icon(weatherIcon(w, hr), w === 'rain' ? 'rain' : '') });
      const ic = wi.firstChild; ic.style.left = x + '%';
      wx.append(ic);
      const b = h('span.scrub-bar');
      b.style.left = ((hr - startH) / span * 100 + 0.6) + '%';
      b.style.width = (100 / span - 1.2) + '%';
      b.style.height = Math.round(j.hourlySteps[hr] / max * 100) + '%';
      bars.append(b);
    }
    for (const it of j.items) {
      const kind = it.type === 'ride' ? 'ride' : it.type === 'meet' ? 'meet' : it.type === 'god' ? 'god' : (it.type === 'visit' || it.type === 'stay' || it.type === 'home') ? 'visit' : null;
      if (!kind) continue;
      const f = tToX(it.at); if (f < 0 || f > 1) continue;
      const m = h('span.scrub-mark.' + kind); m.style.left = f * 100 + '%'; marks.append(m);
    }
    for (const hr of [startH, 9, 12, 15, 18, 21, 24]) {
      if (hr < startH) continue;
      const s = h('span' + (hr === startH ? '.edge-l' : hr === 24 ? '.edge-r' : ''), `${hr}時`);
      s.style.left = ((hr - startH) / span * 100) + '%';
      ticks.append(s);
    }
    if (j.isToday) { const f = Math.max(0, Math.min(1, tToX(nowT()))); future.style.left = f * 100 + '%'; future.hidden = false; }
    else future.hidden = true;
  }

  /** その時刻の推しの様子の一文 */
  function stateText(ms) {
    const p = positionAt(j.legs, ms);
    if (p.leg) {
      if (p.leg.mode === 'walk') {
        const next = j.items.find(i => i.at >= p.leg.endAt - 1000 && i.placeName);
        return next ? `${next.placeName}へ歩いている` : '歩いている';
      }
      const ride = j.items.filter(i => i.type === 'ride' && i.at <= ms + 1000).pop();
      return ride ? `${ride.line}で${(ride.text.match(/で(.+?)へ/) || [])[1] || '次の駅'}へ向かっている` : '乗り物で移動している';
    }
    const last = j.items.filter(i => i.at <= ms).pop();
    if (!last) return j.placement || j.items.length ? 'まだ家にいる' : '家で待っている';
    if (last.type === 'home' || (last.type === 'god' && !last.placeName && /家に帰した/.test(last.text))) return '家にいる';
    if (last.type === 'stay') return `${last.placeName}にいる`;
    if (last.placeName) return `${last.placeName}にいる`;
    return '';
  }

  function draw() {
    const live = j.isToday && t === null;
    const cur = t !== null ? t : (j.isToday ? nowT() : null);
    // 過去の日で何も選んでいないときは、つまみを帯の左端に置く（右へすべらせて1日をたどれる）
    const f = cur === null ? 0 : Math.max(0, Math.min(1, tToX(cur)));
    knob.style.left = f * 100 + '%';
    knob.classList.toggle('live', live);
    if (cur !== null) {
      sayTime.textContent = hm(cur);
      sayTxt.textContent = stateText(cur);
      band.setAttribute('aria-valuenow', String(Math.round(f * 100)));
      band.setAttribute('aria-valuetext', `${hm(cur)} ${sayTxt.textContent}`);
    } else {
      sayTime.textContent = '';
      sayTxt.textContent = '';
      band.setAttribute('aria-valuetext', '1日全体');
    }
    // 過去の日の「1日全体を見る」ボタンは出さない（2026-11-10 の依頼）
    sayBtn.classList.toggle('hidden', !live && !j.isToday);
    if (live) { sayBtn.replaceChildren(h('span.live-tag', 'ライブ')); sayBtn.disabled = true; sayTxt.textContent = stateText(cur) || ''; }
    else if (j.isToday) { sayBtn.textContent = 'いまに戻る'; sayBtn.disabled = false; }
  }

  function setT(ms, notify = true) {
    if (ms !== null) {
      const lo = ds() + startH * 3600000, hi = j.isToday ? nowT() : ds() + endH * 3600000;
      ms = Math.max(lo, Math.min(hi, ms));
      // 出来事の印の9分以内では、印の時刻に吸い付く
      let best = null;
      for (const it of j.items) if (Math.abs(it.at - ms) <= 9 * MIN && (!best || Math.abs(it.at - ms) < Math.abs(best - ms))) best = it.at;
      if (best !== null) ms = best + 1000;
      // 今日は今の時刻まで戻すとライブに戻る
      if (j.isToday && hi - ms < 2 * MIN) ms = null;
    }
    t = ms; draw();
    if (notify && onChange) onChange(t);
  }

  // なぞる
  let dragging = false;
  const fromEvent = e => { const r = band.getBoundingClientRect(); return xToT(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); };
  band.addEventListener('pointerdown', e => { dragging = true; knob.classList.add('grabbing'); band.setPointerCapture(e.pointerId); setT(fromEvent(e)); });
  band.addEventListener('pointermove', e => { if (dragging) setT(fromEvent(e)); });
  const release = () => { dragging = false; knob.classList.remove('grabbing'); };
  band.addEventListener('pointerup', release);
  band.addEventListener('pointercancel', release);
  band.addEventListener('lostpointercapture', release);
  band.addEventListener('keydown', e => {
    const cur = t !== null ? t : (j.isToday ? nowT() : ds() + endH * 3600000);
    if (e.key === 'ArrowLeft') { setT(cur - 10 * MIN); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setT(cur + 10 * MIN); e.preventDefault(); }
    else if (e.key === 'Home') { setT(ds() + startH * 3600000); e.preventDefault(); }
    else if (e.key === 'End') { setT(j.isToday ? null : ds() + endH * 3600000 - MIN); e.preventDefault(); }
    else if (e.key === 'Escape') { setT(null); }
  });
  sayBtn.addEventListener('click', () => setT(null));

  return {
    el,
    update(journey, keep = true) { const sameDay = j && j.day === journey.day; j = journey; if (!sameDay || !keep) t = null; layout(); draw(); },
    set(ms) { setT(ms, false); },
    get time() { return t; },
    stateText,
  };
}
