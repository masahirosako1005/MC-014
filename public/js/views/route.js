// public/js/views/route.js
// カップリングルート作成（#/route/new）と、ルートの結果（#/route/:id）、一緒に出かける画面（goOut）。
// 「推し×自分」か「推し×推し」を選ぶ。気分は「推し×自分」のときだけ。目的は聞かない。
// ミニ推しは喋らない。文章はすべて天の声（第三者の視点）で、吹き出しは使わない。

import { app, api, h, esc, hm, hhmm, md, mdw, addDays, km, mins, charById, areaById, onLeave, toast, isWide, reduceMotion } from '../core.js';
import { icon, catIcon, modeIcon } from '../icons.js';
import { avatar, mapFace } from '../avatar.js';
import { createMap } from '../map.js';
import { openSheet, openPlace } from '../sheet.js';
import { routeFlow } from '../route-flow.js';

const EAT = new Set(['food', 'cafe', 'sweets']);
const L = window.L;

export async function render(view, route) {
  if (route.params[0] === 'new' || !route.params[0]) return renderForm(view, route.query);
  let r = cacheRoute && cacheRoute.id === route.params[0] ? cacheRoute : null;
  if (!r) r = await api('/api/routes/' + encodeURIComponent(route.params[0]));
  renderResult(view, r);
}
let cacheRoute = null;

/* ---------------------------------------------------------------- 入力 */
function renderForm(view, q) {
  const st = app.state;
  const chars = st.characters;
  let c = charById(q.c) || charById(st.selectedCharacterId) || chars[0];
  let partner = 'self';
  let areaId = q.area || c.placement || c.homeAreas[0];
  if (!areaById(areaId)) areaId = st.areas[0].id;
  let from = q.from || st.today, to = q.to || st.today;
  let length = q.len || 'half';
  let mood = null, moodText = '';
  let useTransit = q.transit !== '0', useTaxi = q.taxi !== '0';

  const head = h('div.planner-head');
  const form = h('div.form-grid');
  view.append(h('a.btn.btn-white.btn-small', { href: '#/routes' }, [h('span', { html: icon('left') }), '観光ルート']), h('div.gap'), head, form);
  // 考えてもらう推しは、推しの顔（切り替えの印つき）を押して選び直す。日付などの入力は引き継ぐ
  function drawHead() {
    const many = chars.length > 1;
    const face = h('button.rec-face', { 'aria-label': many ? '考えてもらう推しを選び直す' : c.name, title: many ? '推しを切り替える' : '', disabled: !many }, [avatar(c, 72), many ? h('span.swap-badge', { html: icon('swap') }) : null]);
    face.addEventListener('click', pickChar);
    head.replaceChildren(face, h('div', [h('h1.page-title', `${c.short}に観光ルートを考えてもらう`), h('p.muted.small', c.tagline)]));
  }
  function pickChar() {
    const list = h('div.area-pick');
    const s = openSheet({ title: '考えてもらう推し', content: list });
    for (const x of chars) list.append(h('button.area-opt' + (x.id === c.id ? '.cur' : ''), { onclick: () => {
      s.close(); if (x.id === c.id) return;
      c = x; if (partner === c.id) partner = 'self';
      areaId = c.placement || c.homeAreas[0]; if (!areaById(areaId)) areaId = st.areas[0].id;
      drawHead(); draw();
    } }, [avatar(x, 40), h('span', [x.name, h('small', x.tagline)])]));
  }
  function draw() {
    const others = chars.filter(x => x.id !== c.id);
    const pairSeg = h('div.seg', { role: 'group', 'aria-label': '組み合わせ' }, [
      h('button', { 'aria-pressed': String(partner === 'self'), onclick: () => { partner = 'self'; draw(); } }, [h('span', { html: icon('user') }), `${c.short}×自分`]),
      h('button', { 'aria-pressed': String(partner !== 'self'), disabled: !others.length, onclick: () => { partner = (others[0] || {}).id || 'self'; draw(); } }, [h('span', { html: icon('meetIcon') }), `${c.short}×推し`]),
    ]);
    const partnerChips = partner !== 'self' ? h('div.chips', others.map(x => h('button.chip', { 'aria-pressed': String(partner === x.id), onclick: () => { partner = x.id; draw(); } }, [avatar(x, 22), x.short]))) : null;
    const areaChips = h('div.chips', st.areas.map(a => h('button.chip', { 'aria-pressed': String(areaId === a.id), onclick: () => { areaId = a.id; draw(); } }, [h('span', { html: icon('area') }), a.short])));
    const fromIn = h('input', { type: 'date', value: from, min: st.today, max: addDays(st.today, 120), 'aria-label': 'いつから' });
    const toIn = h('input', { type: 'date', value: to, min: st.today, max: addDays(st.today, 150), 'aria-label': 'いつまで' });
    fromIn.addEventListener('change', () => { from = fromIn.value || st.today; if (to < from) { to = from; toIn.value = to; } });
    toIn.addEventListener('change', () => { to = toIn.value || from; });
    const lenChips = h('div.chips', st.options.lengths.map(l => h('button.chip', { 'aria-pressed': String(length === l.id), onclick: () => { length = l.id; draw(); } }, l.label)));
    const moodBlock = partner === 'self' ? h('div.field', [h('span.lbl', [h('span', { html: icon('sparkle') }), '今日の気分（あれば）']),
      h('div.chips', st.options.moods.map(m => h('button.chip', { 'aria-pressed': String(mood === m.id), onclick: () => { mood = mood === m.id ? null : m.id; draw(); } }, m.label))),
      h('div.gap'),
      (() => { const t = h('input', { type: 'text', maxlength: '60', value: moodText, placeholder: '言葉でも伝えられます（例: 甘いものが食べたい）', 'aria-label': '気分を言葉で' }); t.addEventListener('input', () => { moodText = t.value; }); return t; })(),
    ]) : h('p.note-box', '「推し×推し」では気分は選べません。ふたりの好みと足あとから、推しがルートを考えます。公式の関係ではありません。');
    const sw = (label, val, set) => { const b = h('button.switch', { role: 'switch', 'aria-checked': String(val), 'aria-label': label }); b.addEventListener('click', () => { set(!val); draw(); }); return h('div.toggle-row', [h('span', label), b]); };
    form.replaceChildren(
      h('div.field', [h('span.lbl', [h('span', { html: icon('meetIcon') }), '組み合わせ']), pairSeg, partnerChips ? h('div.gap') : null, partnerChips]),
      h('div.field', [h('span.lbl', [h('span', { html: icon('area') }), 'エリア']), areaChips]),
      h('div.field', [h('span.lbl', [h('span', { html: icon('calendar') }), 'いつ行く？（期間のイベントも考えてくれる）']), h('div.date-pair', [fromIn, '〜', toIn])]),
      h('div.field', [h('span.lbl', [h('span', { html: icon('walk') }), '長さ']), lenChips]),
      moodBlock,
      h('div.field', [h('span.lbl', [h('span', { html: icon('train') }), '移動手段']), sw('公共交通機関を使う', useTransit, v => { useTransit = v; }), sw('タクシーを使う', useTaxi, v => { useTaxi = v; }),
        !useTransit && !useTaxi ? h('p.muted.small', '歩いて回ります。') : null]),
      h('button.btn.btn-yellow.btn-wide', { onclick: submit }, [h('span', { html: icon('route') }), '観光ルートを考えてもらう']),
    );
  }

  async function submit() {
    const body = { characterId: c.id, partner, areaId, from, to, length, mood: partner === 'self' ? mood : null, moodText: partner === 'self' ? moodText : '', useTransit, useTaxi };
    const think = thinking(c, partner !== 'self' ? charById(partner) : null);
    const t0 = Date.now();
    try {
      const r = await api('/api/routes', { method: 'POST', body });
      await think.show(r.thoughts, Math.max(0, 2600 - (Date.now() - t0)));
      cacheRoute = r;
      location.hash = `#/route/${r.id}`;
    } catch (e) { think.close(); toast(e.message); }
  }
  drawHead(); draw();
}

/** 推しが考えているようなローディング画面（文言は実際に計算に使った材料から作る） */
function thinking(c, p) {
  const line = h('p.thought', `${c.short}が考えている…`);
  const root = h('div.thinking', { role: 'status', 'aria-live': 'polite' }, [h('div.box', [
    h('div.bubble-think', [avatar(c, 100), h('div.dots', [h('i'), h('i'), h('i')])]),
    p ? h('p.muted.small', `${p.short}のことも考えながら`) : null, line,
  ])]);
  document.body.append(root);
  return {
    close: () => root.remove(),
    show(thoughts, ms) {
      return new Promise(res => {
        const list = thoughts && thoughts.length ? thoughts : ['考えている…'];
        let i = 0; const step = Math.max(500, (ms || 2400) / list.length);
        const tick = () => { line.style.opacity = '0'; setTimeout(() => { line.textContent = list[i % list.length]; line.style.opacity = '1'; i++; if (i > list.length) { root.remove(); res(); } else setTimeout(tick, step); }, 150); };
        tick();
      });
    },
  };
}

/* ---------------------------------------------------------------- 結果 */
function renderResult(view, r) {
  const c = charById(r.characterId) || { short: r.characterName, look: {} };
  const p = r.partner !== 'self' ? charById(r.partner) : null;
  const flow = routeFlow(r, app.state.stops);
  const mapBox = h('div.route-map', [h('div.map-el')]);
  const zoom = h('div.zoom-pair', [h('button', { 'aria-label': '拡大', html: icon('plus') }), h('button', { 'aria-label': '縮小', html: icon('minus') })]);
  mapBox.append(zoom);
  const top = h('div', [
    h('a.btn.btn-white.btn-small', { href: '#/routes' }, [h('span', { html: icon('left') }), '観光ルート']),
    h('div.gap'),
    h('div.planner-head', [h('div.pair-faces', [avatar(c, 60), p ? avatar(p, 60) : h('span.me', { html: icon('user') })]),
      h('div', [h('h1.page-title', `${mdw(r.day)} ${r.areaName}`), h('p.small', `${r.characterName} × ${r.partnerName}　${r.lengthLabel}・${r.stops.length}か所・歩く${km(r.totals.walkM)}${r.totals.rideM ? '・乗り物' + km(r.totals.rideM) : ''}`)])]),
    r.event ? h('p.small', [h('span', { html: icon('calendar') }), ` この日は「${r.event.title}」がある`]) : null,
  ]);
  const voice = h('div.voice', [r.open, r.moodNote ? h('p.small', r.moodNote) : null]);
  const list = h('div.flow', flow.map(x => flowItem(x, r)));
  const close = h('div.voice', r.close);
  const notes = h('div', [r.note ? h('p.note-box', r.note) : null, r.fictionalNote ? h('p.note-box', [h('span.fic-tag', '架空の施設'), ' ', r.fictionalNote]) : null]);
  // 「一緒に出かける」と「条件を変えて考えてもらう」は、見出しのすぐ下に置く（読む前に押せるように）
  const acts = h('div.chips.route-acts', [
    h('button.btn.btn-yellow', { onclick: () => goOut(r, flow) }, [h('span', { html: icon('play') }), `${c.short}と一緒に出かける`]),
    h('a.btn.btn-white', { href: `#/route/new?c=${r.characterId}&area=${r.areaId}&from=${r.from}&to=${r.to}&len=${r.length}&transit=${r.useTransit ? 1 : 0}&taxi=${r.useTaxi ? 1 : 0}` }, '条件を変えて考えてもらう'),
  ]);
  const del = h('div', [h('button.btn.btn-danger.btn-small', { onclick: async () => { if (!confirm('この観光ルートを消しますか？')) return; await api('/api/routes/' + r.id, { method: 'DELETE' }); location.hash = '#/routes'; } }, [h('span', { html: icon('trash') }), '消す'])]);
  view.append(h('div.route-result', [top, acts, mapBox, voice, list, close, notes, del]));
  const M = createMap(mapBox.querySelector('.map-el'), { style: app.state.settings.mapStyle, wheel: false });
  onLeave(() => M.destroy());
  zoom.children[0].onclick = () => M.zoomIn(); zoom.children[1].onclick = () => M.zoomOut();
  M.drawAreas(app.state.areas);
  drawRoute(M, r, flow, null);
  fitRoute(M, r);
}

function flowItem(x, r) {
  if (x.type === 'spot') {
    const s = x.stop;
    const el = h('div.flow-spot', [
      h('div.no' + (EAT.has(s.cat) ? '.eat' : '.see'), { html: icon(catIcon(s.cat)) + `<span class="n">${x.index + 1}</span>` }),
      h('div', [
        h('p.tm', `${hhmm(s.arriveAt)}〜${hhmm(s.leaveAt)}（${mins(s.stayMin)}）`),
        h('h4', [s.name, s.fictional ? h('span.fic-tag', '架空の施設') : null]),
        h('p.small.muted', s.genre),
        h('p', s.narration),
        s.highlight ? h('p.small', [h('span', { html: icon('heart') }), ` おすすめ: ${s.highlight}`]) : null,
        h('div.why', (s.why || []).map(w => h('span', w))),
      ]),
    ]);
    el.querySelector('h4').addEventListener('click', () => openPlace(s.placeId));
    return el;
  }
  if (x.type === 'station') {
    const rides = x.rides.map(rd => `${rd.kind === 'board' ? (x.transfer ? '乗り換える' : '乗る') : '降りる'}: ${rd.line}`).join('　');
    return h('div.flow-station', [h('div.no', { html: icon(x.start ? 'flag' : modeIcon((x.rides[0] || {}).mode || 'train')) }), h('div', [
      h('p.tm', x.start ? `${hhmm(x.departAt)} 出発` : `${hhmm(x.at)} 着${x.departAt > x.at + 60000 ? ` ・ ${hhmm(x.departAt)} 発` : ''}`),
      h('b', x.name), rides ? h('p.small.muted', rides) : null,
    ])]);
  }
  return h('div.flow-move', [h('div.rail' + (x.mode === 'walk' ? '' : '.ride'), [h('i')]), h('div', [
    h('p.move-head', `${hhmm(x.startAt)} → ${hhmm(x.endAt)}（${mins(x.minutes)}）`),
    moveSteps(x),
  ])]);
}

/** 行き方の内訳 */
export function moveSteps(x) {
  const li = (ic, text) => h('li', [h('span', { html: icon(ic) }), h('span', text)]);
  if (x.mode === 'walk') return h('ul.move-steps', [li('walk', `歩く ${km(x.meters)}・約${mins(x.minutes)}`)]);
  if (x.mode === 'taxi') return h('ul.move-steps', [li('taxi', `タクシー ${km(x.meters)}・${hhmm(x.startAt + x.waitMin * 60000)}に乗って${hhmm(x.endAt)}に降りる（乗っている時間 約${mins(x.minutes - x.waitMin)}、乗り場で待つ時間 約${x.waitMin}分）`)]);
  return h('ul.move-steps', [li(modeIcon(x.mode), `${x.name}　${x.from} から乗って ${x.to} で降りる`), li('calendar', `${hhmm(x.startAt + x.waitMin * 60000)}に乗車、${hhmm(x.endAt)}に降車（乗っている時間 約${mins(x.minutes - x.waitMin)}、待ち時間 約${x.waitMin}分、${km(x.meters)}）`)]);
}

/** 地図にルートを描く。cur は一緒に出かける画面の今の場面 */
function drawRoute(M, r, flow, cur) {
  M.layers.route.clearLayers(); M.layers.pins.clearLayers();
  const curIdx = cur === null ? flow.length : cur;
  flow.forEach((x, k) => {
    if (x.type !== 'move' || !x.coords || x.coords.length < 2) return;
    const done = k < curIdx; const now = k === curIdx;
    const walk = x.mode === 'walk';
    L.polyline(x.coords, { color: '#ffffff', weight: now ? 12 : 8, opacity: done || now || cur === null ? 0.9 : 0.4, dashArray: walk ? '2 10' : null, lineCap: 'round', interactive: false }).addTo(M.layers.route);
    L.polyline(x.coords, { color: x.mode === 'taxi' ? '#e0a400' : '#007190', weight: now ? 7 : 5, opacity: done || now || cur === null ? 1 : 0.35, dashArray: walk ? '2 10' : null, lineCap: 'round', interactive: false, className: now ? 'route-now' : '' }).addTo(M.layers.route);
  });
  flow.forEach((x, k) => {
    if (x.type === 'spot') {
      const s = x.stop; const later = cur !== null && k > curIdx;
      const el = h('div.pin' + (EAT.has(s.cat) ? '.eat' : '.see') + (later ? '.later' : ''), { html: icon(catIcon(s.cat)) + `<span class="num">${x.index + 1}</span>` });
      L.marker([s.lat, s.lng], { icon: L.divIcon({ html: el, className: 'pin-wrap', iconSize: [30, 30], iconAnchor: [15, 15] }), title: s.name }).on('click', () => openPlace(s.placeId)).addTo(M.layers.pins);
    } else if (x.type === 'station' && x.lat !== undefined) {
      const later = cur !== null && k > curIdx; const next = cur !== null && k === curIdx + 1;
      L.circleMarker([x.lat, x.lng], { radius: next ? 7 : 5, color: '#1f2a4a', weight: 2, fillColor: next ? '#ffdd00' : '#fff', fillOpacity: 1, opacity: later && !next ? 0.4 : 1 }).bindTooltip(esc(x.name)).addTo(M.layers.pins);
    }
  });
}
function fitRoute(M, r, extra = []) {
  const pts = [...r.stops.map(s => [s.lat, s.lng]), ...r.stops.flatMap(s => s.access.flatMap(a => a.coords)), ...extra];
  if (pts.length) M.map.fitBounds(L.latLngBounds(pts).pad(0.1), { maxZoom: 16, animate: false });
}

/* ---------------------------------------------------------------- 一緒に出かける */
function goOut(r, flow) {
  const c = charById(r.characterId) || { short: r.characterName, look: {} };
  const scenes = [{ type: 'begin' }, ...flow.filter(x => !(x.type === 'station' && x.start)), { type: 'end' }];
  let k = 0;
  const mapEl = h('div.map-el');
  const progress = h('div.progress', { role: 'list', 'aria-label': '進み具合' });
  const body = h('div.goout-body', { 'aria-live': 'polite' });
  const backBtn = h('button.btn.btn-white', { onclick: () => show(k - 1) }, '戻る');
  const nextBtn = h('button.btn', { onclick: () => (k >= scenes.length - 1 ? close() : show(k + 1)) });
  const root = h('div.goout', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `${c.short}と一緒に出かける` }, [
    h('div.goout-top', [avatar(c, 36), h('h3', `${c.short}と一緒に出かける　${md(r.day)} ${r.areaName}`), h('button.icon-btn', { 'aria-label': '閉じる', html: icon('close'), onclick: () => close() })]),
    h('div.goout-map', [mapEl]), progress, body, h('div.goout-foot', [backBtn, nextBtn]),
  ]);
  document.body.append(root);
  const M = createMap(mapEl, { style: app.state.settings.mapStyle, wheel: false });
  M.drawAreas(app.state.areas);
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() { M.stopAnim(); M.destroy(); root.remove(); document.removeEventListener('keydown', onKey); }
  onLeave(close);

  // 進み具合（地点の丸と、移動の小さな丸）
  scenes.forEach((s, i) => {
    if (i > 0) progress.append(h('span.pg-line'));
    let node;
    if (s.type === 'begin' || s.type === 'end') node = h('button.pg-node.station', { 'aria-label': s.type === 'begin' ? '出発' : 'おつかれさま', html: icon(s.type === 'begin' ? 'flag' : 'star') });
    else if (s.type === 'spot') node = h('button.pg-node.spot', { 'aria-label': `${s.index + 1}か所目 ${s.name}`, html: icon(catIcon(s.stop.cat)) + `<span class="n">${s.index + 1}</span>` });
    else if (s.type === 'station') node = h('button.pg-node.station', { 'aria-label': s.name, html: icon('station') });
    else node = h('button.pg-node.move', { 'aria-label': `移動 ${s.name || ''}`, html: icon(modeIcon(s.mode)) });
    node.addEventListener('click', () => show(i));
    progress.append(node);
  });
  const nodes = () => [...progress.querySelectorAll('.pg-node')];

  function sceneName(s) { return s.type === 'spot' ? s.name : s.type === 'station' ? s.name : s.type === 'end' ? 'おつかれさま' : ''; }
  function show(i) {
    k = Math.max(0, Math.min(scenes.length - 1, i));
    const s = scenes[k];
    nodes().forEach((n, j) => { n.classList.toggle('done', j < k); n.classList.toggle('cur', j === k); });
    const cur = nodes()[k]; if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
    backBtn.disabled = k === 0;
    const nx = scenes[k + 1];
    nextBtn.textContent = !nx ? '閉じる' : nx.type === 'move' ? `次は ${(scenes.slice(k + 2).find(z => z.type !== 'move') || {}).name || ''} へ` : nx.type === 'end' ? 'おつかれさま' : `${sceneName(nx)}に到着`;
    M.stopAnim();
    const flowIdx = s.type === 'begin' ? -1 : s.type === 'end' ? flow.length : flow.indexOf(s);
    drawRoute(M, r, flow, s.type === 'begin' ? 0 : flowIdx);
    if (s.type === 'begin') {
      body.replaceChildren(h('h2', '出発'), h('p.tm', `${mdw(r.day)}　${hhmm(r.startAt)} ${r.startName}`), h('p.small', `${r.stops.length}か所・歩く${km(r.totals.walkM)}${r.totals.rideM ? '・乗り物' + km(r.totals.rideM) : ''}`), h('div.gap'), h('div.voice', r.open));
      fitRoute(M, r); const p0 = flow[0]; M.setFace(c, p0 && p0.lat !== undefined ? [p0.lat, p0.lng] : [r.stops[0].lat, r.stops[0].lng]);
    } else if (s.type === 'end') {
      body.replaceChildren(h('h2', 'おつかれさま'), h('div.voice', r.close), r.note ? h('p.note-box', r.note) : null);
      fitRoute(M, r); const last = r.stops[r.stops.length - 1]; M.setFace(c, [last.lat, last.lng]);
    } else if (s.type === 'spot') {
      const st = s.stop;
      body.replaceChildren(h('p.tm', `${s.index + 1}か所目　${hhmm(st.arriveAt)}〜${hhmm(st.leaveAt)}`), h('h2', [st.name, st.fictional ? h('span.fic-tag', '架空の施設') : null]), h('p.small.muted', st.genre),
        h('div.gap'), h('div.voice', st.narration), h('p.place-desc', st.desc), st.highlight ? h('p.small', `おすすめ: ${st.highlight}`) : null,
        h('button.btn.btn-white.btn-small', { onclick: () => openPlace(st.placeId) }, '場所の情報'));
      M.setFace(c, [st.lat, st.lng]); M.focus(st.lat, st.lng, { zoom: 16, ring: true });
    } else if (s.type === 'station') {
      const rides = s.rides.map(rd => `${rd.kind === 'board' ? (s.transfer ? '乗り換える' : '乗る') : '降りる'}: ${rd.line}`).join('　');
      body.replaceChildren(h('p.tm', `${hhmm(s.at)} 着${s.departAt > s.at + 60000 ? ` ・ ${hhmm(s.departAt)} 発` : ''}`), h('h2', `${s.name}に到着`), h('p', rides),
        s.placeId ? h('button.btn.btn-white.btn-small', { onclick: () => openPlace(s.placeId) }, '駅の情報') : null);
      if (s.lat !== undefined) { M.setFace(c, [s.lat, s.lng]); M.focus(s.lat, s.lng, { zoom: 16, ring: false }); }
    } else {
      const toName = s.toName || '';
      const how = s.mode === 'walk' ? '歩いて' : s.mode === 'taxi' ? 'タクシーに乗って' : `${s.name}に乗って`;
      const pn = r.partner === 'self' ? r.partnerName : r.partnerName;
      body.replaceChildren(h('p.tm', `${hhmm(s.startAt)} → ${hhmm(s.endAt)}（${mins(s.minutes)}）`), h('h2', [h('span', { html: icon(modeIcon(s.mode)) }), ' 移動']),
        h('div.voice', `${c.short}は${pn}と一緒に、${how}${toName}へ向かう。`), h('div.gap'), moveSteps(s));
      if (s.coords && s.coords.length > 1) {
        M.map.fitBounds(L.latLngBounds(s.coords).pad(0.3), { maxZoom: 17, animate: false });
        M.setFace(c, s.coords[0]);
        if (!reduceMotion()) M.moveAlong(c, s.coords, Math.min(4000, 1200 + s.coords.length * 40)); else M.setFace(c, s.coords[s.coords.length - 1]);
      }
    }
  }
  show(0);
  setTimeout(() => M.invalidate(), 60);
}
