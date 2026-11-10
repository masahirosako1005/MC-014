// public/js/views/home.js
// ①ホーム: 一人の推しの世界。国土地理院の地図を舞台に、推しが実際の道を移動する。
// 上部の推しのカード（横にスライドして切り替え）、舞台の脇のボタン、足あと（歩数と距離、1日をなぞるつまみ、タイムライン）。
// ホームに出すのは、ミニ推しの一覧で家のアイコンを押した推しだけ。キャラのアイコンを一列に並べる選び方はしない。

import { app, api, h, clear, hm, md, mdw, addDays, fmtNum, km, onLeave, toast, charById, workById, areaById, isWide, reduceMotion } from '../core.js';
import { icon, catIcon, modeIcon } from '../icons.js';
import { avatar } from '../avatar.js';
import { createMap, positionAt, splitLine, lineLen } from '../map.js';
import { openSheet, openPlace } from '../sheet.js';
import { createScrubber } from '../scrubber.js';
import { renderDayView } from '../dayview.js';

const REFRESH = 30000;
// 神の手（親指と人差し指でつまむ手）。指は CSS でひらいたり、とじたりする。style 属性は使わない（CSPのため）
const GOD_HAND = `<svg class="god-hand" viewBox="0 0 80 92">
  <path d="M31 0h18v26H31z" fill="#fde7d4" stroke="#1f2a4a" stroke-width="3"/>
  <path d="M33 4h14M33 9h14" stroke="#e9c9ad" stroke-width="2"/>
  <path d="M20 26c0-7 40-7 40 0v16c0 9-40 9-40 0z" fill="#fde7d4" stroke="#1f2a4a" stroke-width="3" stroke-linejoin="round"/>
  <g class="gh-thumb"><path d="M27 44c-6 7-8 17-3 26" fill="none" stroke="#1f2a4a" stroke-width="11" stroke-linecap="round"/><path d="M27 44c-6 7-8 17-3 26" fill="none" stroke="#fde7d4" stroke-width="6" stroke-linecap="round"/></g>
  <g class="gh-index"><path d="M53 44c6 7 8 17 3 26" fill="none" stroke="#1f2a4a" stroke-width="11" stroke-linecap="round"/><path d="M53 44c6 7 8 17 3 26" fill="none" stroke="#fde7d4" stroke-width="6" stroke-linecap="round"/></g>
  <path d="M30 22c3-3 7-3 10 0M42 22c3-3 7-3 10 0" fill="none" stroke="#e9c9ad" stroke-width="2"/>
</svg>`;

export async function render(view) {
  view.classList.add('full');
  const st = app.state;
  const homeIds = st.homeCharacterIds.filter(id => charById(id));
  let idx = Math.max(0, homeIds.indexOf(st.selectedCharacterId));
  let char = charById(homeIds[idx]);
  let j = null;               // 表示中の足あと
  let day = null;             // null は今日
  let footMode = 'half';      // half / full / peek（地図を広げる）
  let replayT = null;
  let alive = true;
  let loadSeq = 0;
  let faceAnim = 0; // タイムラインの行を押して推しの印を動かしている間は、印を置き直さない

  /* ---- 骨組み ---- */
  const mapEl = h('div.stage-map');
  const rail = h('div.oshi-rail', { role: 'list', 'aria-label': 'ホームの推し' });
  // PCでは推しのカードの両脇（高さは中央）に置く。端の推しのときは、その向きの矢印を出さない
  const railPrev = h('button.icon-btn', { 'aria-label': '前の推し', title: '前の推し', html: icon('left'), onclick: () => { if (idx > 0) select(idx - 1, true); } });
  const railNext = h('button.icon-btn', { 'aria-label': '次の推し', title: '次の推し', html: icon('right'), onclick: () => { if (idx < homeIds.length - 1) select(idx + 1, true); } });
  const arrows = h('div.rail-arrows', [railPrev, railNext]);
  function syncArrows() {
    railPrev.classList.toggle('off', idx <= 0); railNext.classList.toggle('off', idx >= homeIds.length - 1);
    const card = rail.children[0];
    if (card) { arrows.style.top = (rail.offsetTop + card.offsetTop) + 'px'; arrows.style.height = card.offsetHeight + 'px'; }
    // 空は、足あとの欄の上端まで伸ばす（カードの下にすき間の帯が見えないように）
    // PCでは、足あとの欄を推しのカードのすぐ下から始め、空の下に余白を作らない
    if (isWide()) { foot.style.top = rail.offsetHeight + 'px'; sky.style.height = rail.offsetHeight + 'px'; } else { foot.style.top = ''; }
  }
  window.addEventListener('resize', syncArrows); onLeave(() => window.removeEventListener('resize', syncArrows));
  const routeBtn = toolBtn('route', '観光ルートを考えてもらう', () => { location.hash = `#/route/new?c=${char.id}`; });
  const eventBtn = toolBtn('calendar', 'このエリアのイベント', () => openEvents());
  const locateBtn = h('button.icon-btn', { 'aria-label': '推しの現在地', dataset: { tip: '推しの現在地へ' }, html: icon('locate'), onclick: () => locate() });
  const expandBtn = h('button.icon-btn', { 'aria-label': '地図を広げる', dataset: { tip: '地図を広げる' }, html: icon('expand'), onclick: () => setFoot(footMode === 'peek' ? 'half' : 'peek') });
  // 地図を広げるボタンはなくした（2026-11-10 の依頼）。エリア全体を見るボタンはいつも出す
  const cityBtn = h('button.icon-btn', { 'aria-label': 'エリア全体を見る', dataset: { tip: 'エリア全体を見る' }, html: icon('city'), onclick: () => cityView() });
  const zoom = h('div.zoom-pair', [
    h('button', { 'aria-label': '拡大', dataset: { tip: '拡大' }, html: icon('plus'), onclick: () => M.zoomIn() }),
    h('button', { 'aria-label': '縮小', dataset: { tip: '縮小' }, html: icon('minus'), onclick: () => M.zoomOut() }),
  ]);
  const tools = h('div.stage-tools', [h('div.tools-l', [routeBtn, eventBtn]), h('div.tools-r', [cityBtn, locateBtn, zoom])]);

  const footTitle = h('h2.foot-title', [h('span', { html: icon('feet') }), '足あと']);
  const prevBtn = h('button.icon-btn', { 'aria-label': '前の日', html: icon('left'), onclick: () => stepDay(-1) });
  const nextBtn = h('button.icon-btn', { 'aria-label': '次の日', html: icon('right'), onclick: () => stepDay(1) });
  const dayBtn = h('button.day-btn', { onclick: () => openCalendar() });
  const footHead = h('div.foot-head', [footTitle, h('div.day-nav', [prevBtn, dayBtn, nextBtn])]);
  const footBody = h('div.foot-body');
  const grip = h('button.foot-grip', { 'aria-label': '足あとを広げる', html: '<span></span>' });
  const foot = h('section.foot', { 'aria-label': '足あと' }, [grip, footHead, footBody]);
  // PCの推しのカードの後ろの空。地図に出している時刻の天気に合わせる（晴れ、くもり、雨、夜）
  const sky = h('div.rail-sky', { 'aria-hidden': 'true' }, [h('span.sky-fx')]);
  const stage = h('div.stage', [mapEl, sky, rail, arrows, tools, foot]);
  view.append(stage);

  const M = createMap(mapEl, { style: st.settings.mapStyle, wheel: true });
  onLeave(() => { alive = false; M.destroy(); });
  M.drawAreas(st.areas);
  M.drawStops(st.stops, s => { if (s.placeId) openPlace(s.placeId); else toast(`${s.name}（${s.lines.join('、')}）`); });
  const homeArea = areaById((char && char.homeAreas[0])) || st.areas[0];
  if (homeArea) M.map.setView(homeArea.center, 14);

  const scrub = createScrubber({ char, onChange: t => { stopFaceAnim(); replayT = t; drawMap(false); syncTimeline(); } });

  /* ---- 推しのカード ---- */
  function buildRail() {
    clear(rail);
    homeIds.forEach((id, i) => {
      const c = charById(id); const w = workById(c.workId);
      const status = h('div.status', [h('span.dot'), h('span.st-text', '…')]);
      const areaBtn = h('button.area-btn', { onclick: e => { e.stopPropagation(); select(i, true); openAreaPicker(); } });
      const card = h('div.oshi-card' + (homeIds.length === 1 ? '.single' : ''), { role: 'listitem', dataset: { id }, 'aria-label': c.name }, [
        // 縦の幅を抑えるため、名前と作品を1行に、今の様子をその下の1行にまとめる
        avatar(c, 40),
        h('div.who', [h('div.name-row', [h('span.name', c.name)]), status]), // 作品名の札は出さない（2026-11-10 の依頼）
        areaBtn,
      ]);
      card.addEventListener('click', () => select(i, true));
      rail.append(card);
    });
    updateCards();
    requestAnimationFrame(syncArrows);
  }
  function updateCards() {
    for (const card of rail.children) {
      const c = charById(card.dataset.id);
      const a = c.placement ? areaById(c.placement) : null;
      const btn = card.querySelector('.area-btn');
      btn.replaceChildren(h('span', { html: icon(a ? 'pin' : 'out') }), a ? a.short : '連れ出す');
      btn.setAttribute('aria-label', a ? `今いるエリア ${a.short}。エリアを変える` : `${c.short}をエリアへ連れ出す`);
      if (card.dataset.id === char.id && j && j.isToday) {
        const s = card.querySelector('.status');
        s.classList.toggle('live', !!j.placement);
        s.querySelector('.st-text').textContent = j.status ? j.status.text : '';
      }
    }
  }
  let scrollTimer = null;
  rail.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const r = rail.getBoundingClientRect();
      let best = 0, bd = Infinity;
      [...rail.children].forEach((c, i) => { const cr = c.getBoundingClientRect(); const d = Math.abs(cr.left + cr.width / 2 - (r.left + r.width / 2)); if (d < bd) { bd = d; best = i; } });
      if (best !== idx) select(best, false);
    }, 120);
  }, { passive: true });

  function select(i, scroll) {
    if (!homeIds.length) return;
    i = (i + homeIds.length) % homeIds.length;
    const changed = i !== idx;
    idx = i; char = charById(homeIds[idx]);
    syncArrows();
    if (scroll) { const card = rail.children[idx]; if (card) card.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' }); }
    if (changed) {
      app.state.selectedCharacterId = char.id;
      api('/api/selected-character', { method: 'PUT', body: { id: char.id } }).catch(() => {});
      day = null; replayT = null;
      scrub.el.replaceWith((scrubHolder.scrub = createScrubber({ char, onChange: t => { stopFaceAnim(); replayT = t; drawMap(false); syncTimeline(); } })).el);
      load(true);
    }
  }
  const scrubHolder = { scrub };
  const S = () => scrubHolder.scrub;

  /* ---- 足あとを読む ---- */
  async function load(fit) {
    if (!char) return;
    const my = ++loadSeq;
    try {
      const url = day ? `/api/characters/${char.id}/journey/${day}` : `/api/characters/${char.id}/journey`;
      const data = await api(url);
      if (!alive || my !== loadSeq) return;
      data.offset = data.now - Date.now();
      j = data;
      char.placement = day ? char.placement : j.placement;
      renderFoot();
      drawMap(fit);
      updateCards();
    } catch (e) { if (alive) footBody.replaceChildren(h('p.tl-empty', e.message)); }
  }
  const timer = setInterval(() => { if (!day && document.visibilityState === 'visible') load(false); }, REFRESH);
  onLeave(() => clearInterval(timer));

  /* ---- 地図 ---- */
  function padBottom() { return isWide() ? 0 : foot.getBoundingClientRect().height; }
  /** 地図に出している時刻の天気。過去の日で1日全体を見ているときは、その日の昼（9〜17時）にいちばん多い天気 */
  function updateSky() {
    if (!j || !j.hourlyWeather) return;
    let hr, w;
    if (replayT === null && !j.isToday) {
      const cnt = {}; for (let i = 9; i <= 17; i++) cnt[j.hourlyWeather[i]] = (cnt[j.hourlyWeather[i]] || 0) + 1;
      w = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]; hr = 12;
    } else {
      const t = replayT !== null ? replayT : Date.now() + j.offset;
      hr = Math.max(0, Math.min(23, Math.floor((t - j.dayStart) / 3600000))); w = j.hourlyWeather[hr];
    }
    const night = hr >= 18 || hr < 5;
    sky.dataset.sky = w || 'sun'; sky.classList.toggle('night', night);
  }
  function drawMap(fit) {
    if (!j) return;
    updateSky();
    const t = replayT !== null ? replayT : (j.isToday ? Date.now() + j.offset : Infinity);
    M.drawDay(j, { until: replayT !== null ? replayT : Infinity, onPin: p => openPlace(p.placeId) });
    const pos = positionAt(j.legs, t === Infinity ? j.dayStart + 86399000 : t);
    const show = j.isToday ? (j.placement || j.items.length ? pos.pos : null) : (pos.pos || null);
    if (!faceAnim) M.setFace(char, show, { moving: pos.moving });
    if (fit) {
      const near = show || (areaById(j.placement || char.homeAreas[0]) || {}).center;
      if (!M.fitDay(j, { near, padBottom: padBottom() + 10, padTop: isWide() ? 20 : 84, instant: true })) {
        const a = areaById(j.placement || char.homeAreas[0]); if (a) M.map.setView(a.center, 14, { animate: false });
      }
    } else if (replayT !== null && show && pos.moving) {
      // なぞっている間は推しを追いかける
      if (!M.map.getBounds().pad(-0.2).contains(show)) M.focus(show[0], show[1], { padBottom: padBottom(), ring: false, zoom: M.map.getZoom() });
    }
    eventBtn.querySelector('.badge') && eventBtn.querySelector('.badge').remove();
    eventBtn.classList.toggle('hidden', !j.placement || !j.isToday);
    if (j.eventCount) eventBtn.querySelector('.icon-btn').append(h('span.badge', String(j.eventCount)));
  }
  /** つまみをなぞったときは、動かしている途中の印を止めて、なぞった時刻の位置に置く */
  function stopFaceAnim() { if (faceAnim) { faceAnim = 0; M.stopAnim(); } }
  /** 地図の推しの印が今あらわしている時刻 */
  function shownTime() {
    if (!j) return null;
    if (replayT !== null) return replayT;
    return j.isToday ? Date.now() + j.offset : j.dayStart + 86399000;
  }
  /**
   * タイムラインの行を押したとき、推しの印を、前の時刻の位置から押した時刻の位置まで、
   * その間に通った道と乗り物の線に沿って動かす（時刻を戻すときは逆向きにたどる）
   */
  function moveFaceAlong(t0, t1) {
    if (t0 === null || t1 === null || t0 === t1 || reduceMotion()) return;
    const a = Math.min(t0, t1), b = Math.max(t0, t1);
    const path = [positionAt(j.legs, a).pos];
    for (const l of j.legs) {
      if (l.mode === 'god' || !l.coords || l.coords.length < 2 || l.endAt <= a || l.startAt >= b) continue;
      const dur = Math.max(1, l.endAt - l.startAt);
      const fa = Math.max(0, (a - l.startAt) / dur), fb = Math.min(1, (b - l.startAt) / dur);
      let part = fb < 1 ? splitLine(l.coords, fb)[0] : l.coords;
      if (fa > 0) part = splitLine(part, fa / fb)[1];
      path.push(...part);
    }
    path.push(positionAt(j.legs, b).pos);
    const pts = path.filter(Boolean);
    if (pts.length < 2) return;
    if (t1 < t0) pts.reverse();
    const len = lineLen(pts);
    if (len < 5) return;
    const my = ++faceAnim;
    M.moveAlong(char, pts, Math.min(2600, Math.max(700, len / 2.5))).then(() => {
      if (my !== faceAnim) return;
      faceAnim = 0;
      if (alive) drawMap(false);
    });
  }
  function locate() {
    const p = M.faceLatLng();
    if (p) M.focus(p.lat, p.lng, { padBottom: padBottom(), zoom: 16 });
    else { const a = areaById(char.placement || char.homeAreas[0]); if (a) M.map.setView(a.center, 14); }
  }
  function cityView() { const a = areaById(char.placement || char.homeAreas[0]); if (a) M.fitArea(a); }

  /* ---- 足あとのパネル ---- */
  function setFoot(mode) {
    footMode = mode;
    foot.classList.toggle('full', mode === 'full');
    foot.classList.toggle('peek', mode === 'peek');
    stage.dataset.foot = mode;
    expandBtn.innerHTML = icon(mode === 'peek' ? 'shrink' : 'expand');
    expandBtn.setAttribute('aria-label', mode === 'peek' ? '地図を戻す' : '地図を広げる');
    expandBtn.dataset.tip = mode === 'peek' ? '地図を戻す' : '地図を広げる';
    grip.setAttribute('aria-label', mode === 'full' ? '足あとを戻す' : '足あとを広げる');
    setTimeout(() => M.invalidate(), 300);
  }
  grip.addEventListener('click', () => setFoot(footMode === 'full' ? 'half' : footMode === 'peek' ? 'half' : 'full'));
  let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; });
  window.addEventListener('pointerup', e => { if (gy === null) return; const d = e.clientY - gy; gy = null; if (Math.abs(d) < 30) return; setFoot(d < 0 ? (footMode === 'peek' ? 'half' : 'full') : (footMode === 'full' ? 'half' : 'peek')); });

  function renderFoot() {
    const today = app.state.today;
    const isToday = !day;
    dayBtn.replaceChildren(h('span', { html: icon('calendar') }), isToday ? `今日 ${md(today)}` : mdw(day));
    dayBtn.classList.toggle('today', isToday);
    const days = j.activeDays || [];
    const cur = day || today;
    prevBtn.disabled = !days.some(d => d < cur);
    nextBtn.disabled = isToday;
    clear(footBody);
    if (isToday && !j.placement && !j.items.length) { footBody.append(waitCard()); return; }
    // 歩数と距離（今日はこれだけ。歩き方の文章は入れない）
    footBody.append(h('div.steps-line', isToday ? [h('span.lbl', '今日'), `${fmtNum(j.steps)}歩 ・ ${km(j.walkM)}`] : [h('span.lbl', md(day)), `${fmtNum(j.steps)}歩 ・ ${km(j.walkM)}`]));
    S().update(j);
    footBody.append(S().el);
    if (!isToday) footBody.append(renderDayView(j));
    if (isToday && !j.placement) footBody.append(waitCard(true));
    footBody.append(timeline());
  }

  function waitCard(after = false) {
    return h('div.wait-card', [
      after ? null : avatar(char, 72),
      h('h3', after ? `${char.short}は家に帰った` : `${char.short}は家で待っている`),
      h('p', 'エリアへ連れ出すと、その町で行動を始めます。'),
      h('button.btn.btn-yellow', { onclick: () => openAreaPicker() }, [h('span', { html: icon('out') }), `${char.short}をどこに連れ出す？`]),
    ]);
  }

  /* ---- タイムライン（第三者の視点の文章。訪れた理由は書かない） ---- */
  let tlEl = null;
  function timeline() {
    const order = app.state.settings.timelineOrder === 'desc' ? -1 : 1;
    const items = j.items.slice().sort((a, b) => (a.at - b.at) * order);
    tlEl = h('ol.timeline', { 'aria-label': 'タイムライン' });
    if (!items.length) tlEl.append(h('li.tl-empty', j.isToday ? 'まだ今日の足あとはありません。' : 'この日の足あとはありません。'));
    for (const it of items) {
      const dist = distTag(it);
      const text = h('div.tl-text', [h('span.t', hm(it.at) + '、'), ...linkPlace(it), dist]);
      const row = h('li.tl-row', { tabindex: '0', dataset: { type: it.type, at: String(it.at), lat: it.lat !== undefined ? String(it.lat) : '', lng: it.lng !== undefined ? String(it.lng) : '' } }, [
        h('span.tl-dot', { html: icon(rowIcon(it)) }),
        h('div', [text, it.sub ? h('p.tl-sub', it.sub) : null]),
      ]);
      const act = e => {
        if (e.target.closest('.pl')) return;
        if (it.lat !== undefined && it.lat !== null) M.focus(it.lat, it.lng, { padBottom: padBottom() });
        const from = shownTime();
        S().set(it.at + 1000); replayT = S().time;
        moveFaceAlong(from, shownTime());
        drawMap(false); syncTimeline();
      };
      row.addEventListener('click', act);
      row.addEventListener('keydown', e => { if (e.key === 'Enter') act(e); });
      tlEl.append(row);
    }
    syncTimeline();
    return tlEl;
  }
  function linkPlace(it) {
    if (!it.placeName || !it.text.includes(it.placeName)) return [it.text];
    const [a, ...rest] = it.text.split(it.placeName);
    const link = h('span.pl', { role: 'link', tabindex: '0', onclick: e => { e.stopPropagation(); if (it.lat !== undefined) M.focus(it.lat, it.lng, { padBottom: padBottom() }); openPlace(it.placeId); }, onkeydown: e => { if (e.key === 'Enter') { e.stopPropagation(); openPlace(it.placeId); } } }, it.placeName);
    return [a, link, rest.join(it.placeName)];
  }
  function distTag(it) {
    if (it.type === 'god') return null;
    if (it.type === 'ride' && it.meters > 0) return h('span.tl-dist', { html: icon(modeIcon(it.mode)) + km(it.meters) });
    if (['visit', 'pass', 'home', 'stay'].includes(it.type) && it.walkM > 0) return h('span.tl-dist', { html: icon('walk') + km(it.walkM) });
    return null;
  }
  function rowIcon(it) {
    if (it.type === 'start') return 'flag'; // その日のスタート地点
    if (it.type === 'ride') return modeIcon(it.mode);
    if (it.type === 'god') return 'god';
    if (it.type === 'meet') return 'meetIcon';
    if (it.type === 'home') return 'home';
    if (it.type === 'stay') return 'stay';
    if (it.type === 'poster') return 'poster';
    if (it.type === 'arrive') return 'station';
    return catIcon(it.cat || 'pin');
  }
  /** なぞった時刻の直前の出来事を選んだ状態にする */
  function syncTimeline() {
    if (!tlEl) return;
    const t = replayT;
    let sel = null;
    for (const row of tlEl.children) {
      if (!row.dataset.at) continue;
      const at = Number(row.dataset.at);
      row.classList.toggle('after', t !== null && at > t);
      row.classList.remove('sel');
      if (t !== null && at <= t && (!sel || at > Number(sel.dataset.at))) sel = row;
    }
    if (sel) { sel.classList.add('sel'); if (footMode !== 'peek') keepRowVisible(sel); }
  }
  /**
   * 選んだ行が見えるように、足あとのパネルの中だけを少しスクロールする。
   * つまみは上に固定しているので、行がつまみの下に隠れないよう、その高さを除いた範囲に入れる
   * （以前は scrollIntoView で、つまみごと見えない位置まで動いてしまっていた）
   */
  function keepRowVisible(row) {
    const box = footBody.getBoundingClientRect();
    const stuck = S().el.getBoundingClientRect();
    const top = Math.max(box.top, stuck.bottom) + 6, bottom = box.bottom - 8;
    const r = row.getBoundingClientRect();
    if (r.top < top) footBody.scrollTop -= top - r.top;
    else if (r.bottom > bottom) footBody.scrollTop += Math.min(r.bottom - bottom, r.top - top);
  }

  /* ---- 日付 ---- */
  function stepDay(d) {
    const days = (j && j.activeDays) || [];
    const today = app.state.today; const cur = day || today;
    let target = null;
    if (d < 0) target = days.filter(x => x < cur).pop();
    else target = days.find(x => x > cur) || today;
    if (!target) return;
    day = target === today ? null : target;
    replayT = null; load(true);
  }
  function openCalendar() {
    const days = new Set((j && j.activeDays) || []);
    const today = app.state.today;
    let month = (day || today).slice(0, 7);
    const box = h('div.cal');
    const s = openSheet({ title: '足あとのある日', content: box });
    function draw() {
      const [y, m] = month.split('-').map(Number);
      const first = new Date(Date.UTC(y, m - 1, 1)); const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const grid = h('div.cal-grid', ['日', '月', '火', '水', '木', '金', '土'].map(w => h('span.wd', w)));
      for (let i = 0; i < first.getUTCDay(); i++) grid.append(h('span'));
      for (let d = 1; d <= lastDay; d++) {
        const key = `${month}-${String(d).padStart(2, '0')}`;
        const has = days.has(key) || key === today;
        const b = h('button.cal-day' + (has ? '.has' : '') + (key === (day || today) ? '.sel' : '') + (key === today ? '.today' : ''), { disabled: !has, 'aria-label': `${m}月${d}日` }, String(d));
        b.addEventListener('click', () => { day = key === today ? null : key; replayT = null; s.close(); load(true); });
        grid.append(b);
      }
      const prevM = () => { const d0 = new Date(Date.UTC(y, m - 2, 1)); month = d0.toISOString().slice(0, 7); draw(); };
      const nextM = () => { const d0 = new Date(Date.UTC(y, m, 1)); month = d0.toISOString().slice(0, 7); draw(); };
      box.replaceChildren(h('div.cal-head', [h('button.icon-btn', { 'aria-label': '前の月', html: icon('left'), onclick: prevM }), `${y}年${m}月`, h('button.icon-btn', { 'aria-label': '次の月', html: icon('right'), onclick: nextM, disabled: month >= today.slice(0, 7) })]), grid,
        h('p.muted.small', '足あとのある日だけ選べます。'));
    }
    draw();
  }

  /* ---- エリアへ連れ出す（1つだけ。押すとすぐ出発する） ---- */
  function openAreaPicker() {
    const c = char;
    const cur = c.placement;
    const list = h('div.area-pick');
    for (const a of app.state.areas.filter(a => a.acquiredAt <= Date.now() + 60000)) {
      const b = h('button.area-opt' + (a.id === cur ? '.cur' : ''), { 'aria-current': a.id === cur ? 'true' : undefined }, [
        h('span', { html: icon(a.id === cur ? 'pin' : 'area') }),
        h('span', [a.name, h('small', a.id === cur ? 'いまここにいる' : c.homeAreas.includes(a.id) ? '地元' : '')]),
      ]);
      b.addEventListener('click', () => { s.close(); if (a.id !== cur) travel(c, a.id); });
      list.append(b);
    }
    const s = openSheet({ title: `${c.short}をどこに連れ出す？`, content: h('div', [list, cur ? h('button.btn.btn-white.btn-wide.go-home', { onclick: () => { s.close(); travel(c, null); } }, [h('span', { html: icon('home') }), 'おうちに連れて帰る']) : null]) });
  }
  async function travel(c, areaId) {
    // 神の手が上から降りてきて、推しをつまんで持ち上げ、運んでいくアニメーション（くり返す）
    const scene = h('div.god-scene', { 'aria-hidden': 'true' }, [
      h('div.god-carry', [h('div.god-face', [avatar(c, 56)]), h('div.god-hand-wrap', { html: GOD_HAND })]),
      h('div.god-shadow'),
    ]);
    const pop = h('div.moving-pop', { role: 'status' }, [h('div.box', [scene, h('p.god-label', areaId ? 'エリア切り替え中' : 'おうちへ連れて帰っています')])]);
    document.body.append(pop);
    const t0 = Date.now();
    try {
      await api(`/api/characters/${c.id}/travel`, { method: 'PUT', body: { areaId } });
      c.placement = areaId;
      day = null; replayT = null;
      await load(true);
      const wait = Math.max(0, 2500 - (Date.now() - t0)); // 神の手が推しを運び終えるまで見せる
      setTimeout(() => pop.remove(), reduceMotion() ? 0 : wait);
    } catch (e) { pop.remove(); toast(e.message); }
  }

  /* ---- このエリアのイベント ---- */
  async function openEvents() {
    if (!j || !j.placement) return;
    const a = areaById(j.placement);
    const body = h('div', [h('p.muted', '読みこみ中…')]);
    openSheet({ title: `${a.short}のイベント`, content: body });
    const data = await api(`/api/events?area=${a.id}`);
    const today = app.state.today;
    const list = data.events.filter(e => e.end >= today);
    body.replaceChildren(
      list.length ? h('ul.ev-list', list.map(e => evRow(e))) : h('p', 'これからのイベントはありません。'),
      h('a.btn.btn-white.btn-wide', { href: '#/areas?view=cal' }, [h('span', { html: icon('calendar') }), 'カレンダーで見る']),
    );
  }

  function toolBtn(ic, label, fn) {
    // 説明は、カーソルを重ねたときだけ出す（data-tip。style.css）
    return h('div.tool-btn', [h('button.icon-btn', { 'aria-label': label, dataset: { tip: label }, html: icon(ic), onclick: fn })]);
  }

  buildRail();
  if (!char) { footBody.append(h('p.tl-empty', '推しがいません。')); return; }
  setFoot(isWide() ? 'half' : 'half');
  requestAnimationFrame(() => { const card = rail.children[idx]; if (card) rail.scrollLeft = card.offsetLeft - 12; });
  await load(true);
}

export function evRow(e) {
  const go = e.reactions.filter(r => r.level === 'go');
  const poster = e.reactions.filter(r => r.level === 'poster');
  return h('li', [
    h('h4', [e.title, e.tentative ? h('span.tent', '予定') : null]),
    h('p.small', [`${md(e.start)}${e.end !== e.start ? '〜' + md(e.end) : ''}　${e.hours[0]}時〜${e.hours[1]}時`, e.placeName ? `　${e.placeName}` : '']),
    h('p.small.muted', e.desc),
    go.length || poster.length ? h('div.reac', [
      ...go.map(r => { const c = charById(r.characterId); return c ? h('span', [avatar(c, 20), `${c.short}が気にしている`]) : null; }),
      ...poster.map(r => { const c = charById(r.characterId); return c ? h('span', [avatar(c, 20), `${c.short}はポスターを見るかも`]) : null; }),
    ]) : null,
    e.url ? h('a.small', { href: e.url, target: '_blank', rel: 'noopener' }, '公式の情報') : null,
  ]);
}
