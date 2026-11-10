// public/js/views/recommend.js
// 推しのおすすめ（#/recommend）。推しのアイデンティティ（好みと行動原理）に合う、多く立ち寄ったスポット。
// 口コミの上位ではなく、推しの個性が出る形ですすめる。相性はハートと数字で見せる。
// 地図とカードはつながっている（ハートを押すとカードへ、カードを押すと地図がその場所へ）。
// スマホでは地図を上に固定し、読んでいるカードの場所を地図が追いかける。

import { app, api, h, km, mins, charById, onLeave, isWide, reduceMotion } from '../core.js';
import { icon, catIcon } from '../icons.js';
import { avatar } from '../avatar.js';
import { createMap } from '../map.js';
import { openSheet, spotBlock } from '../sheet.js';

const L = window.L;
const CAT_COLOR = { food: '#ffe680', cafe: '#b5decc', sweets: '#ffc9d6', shop: '#bfe3ff', view: '#9ed68f', shrine: '#ffcf9e', history: '#e8dcc0', library: '#d9cff2', dojo: '#ffb4a3' };

export async function render(view, route) {
  const st = app.state;
  let c = charById(route.query.c) || charById(st.selectedCharacterId) || st.characters[0];
  let data = null, area = 'all', cat = 'all', sort = 'fav', selId = null, seq = 0;
  const wrap = h('div.rec');
  const top = h('div.rec-top');
  const sortBox = h('div.rec-sort');
  const mapBox = h('div.rec-map', [h('div.map-el')]);
  const cards = h('div.rec-cards');
  const note = h('p.muted.small', '外観、メニュー、予算、口コミはデモ用のダミーデータです。相性は、推しの好みと足あとから求めた点数です。');
  wrap.append(top, mapBox, sortBox, cards, note);
  // 推しの切り替え。獲得した推しの顔を並べ、押すとその推しのおすすめに切り替わる（今の推しは黄色の縁）
  // 推しの切り替えは、紺色の面の推しの顔（切り替えの印つき）から行う
  view.append(h('h1.page-title', [h('span', { html: icon('star') }), '推しのおすすめ']), wrap);
  const M = createMap(mapBox.querySelector('.map-el'), { style: st.settings.mapStyle, wheel: !isWide() ? false : true });
  onLeave(() => { seq++; M.destroy(); });
  M.drawAreas(st.areas);

  async function load() {
    const my = ++seq;
    top.replaceChildren(h('p', '読みこみ中…')); cards.replaceChildren();
    const d = await api(`/api/characters/${c.id}/recommendations`);
    if (my !== seq) return; // 最後に頼んだ結果だけを使う
    data = d; area = 'all'; cat = 'all'; selId = null;
    draw(true);
  }

  function itemsNow() {
    let list = data.items.filter(x => (area === 'all' || x.area === area) && (cat === 'all' || x.cat === cat));
    list = list.slice().sort(sort === 'fav' ? (a, b) => b.score - a.score || b.count - a.count : (a, b) => b.count - a.count || b.score - a.score);
    return list;
  }

  function draw(fit) {
    const inArea = data.items.filter(x => area === 'all' || x.area === area);
    const fav = inArea.slice().sort((a, b) => b.score - a.score)[0];
    // 顔を押しても切り替えられる（切り替えの印を付ける）
    const face = h('button.rec-face', { 'aria-label': '推しを切り替える', title: '推しを切り替える', onclick: pickChar, disabled: st.characters.length <= 1 }, [avatar(c, 56), st.characters.length > 1 ? h('span.swap-badge', { html: icon('swap') }) : null]);
    const catCounts = {};
    for (const x of inArea) catCounts[x.cat] = (catCounts[x.cat] || 0) + x.count;
    const total = Object.values(catCounts).reduce((a, b) => a + b, 0) || 1;
    if (cat !== 'all' && !catCounts[cat]) cat = 'all';
    const bar = h('div.cat-bar', { 'aria-label': '好みの内訳' }, Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
      const b = h('button' + (cat !== 'all' && cat !== k ? '.dim' : ''), { 'aria-label': `${(st.categories[k] || {}).label}で絞り込む`, title: (st.categories[k] || {}).label, onclick: () => { cat = cat === k ? 'all' : k; draw(true); } });
      b.style.flex = String(v / total); b.style.background = CAT_COLOR[k] || '#ddd'; return b;
    }));
    top.replaceChildren(
      h('div.who', [face, h('div', [h('h2', `${c.short}のおすすめ`), fav ? h('p.fav', `一番のお気に入りは${fav.name}`) : h('p.fav', 'まだおすすめはありません')])]),
      data.areas.length >= 2 ? h('div.chips', [h('button.chip', { 'aria-pressed': String(area === 'all'), onclick: () => { area = 'all'; draw(true); } }, `すべてのエリア ${data.items.length}`),
        ...data.areas.map(a => h('button.chip', { 'aria-pressed': String(area === a.id), onclick: () => { area = a.id; draw(true); } }, [h('span', { html: icon('pin') }), `${a.name} ${a.count}`]))]) : null,
      bar,
      h('div.chips', [h('button.chip', { 'aria-pressed': String(cat === 'all'), onclick: () => { cat = 'all'; draw(true); } }, `すべて ${inArea.length}`),
        // 種類の札は、帯と同じ色・同じ並び（多い順）にして、帯のどの色がどの種類かを分かるようにする
        ...Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([k]) => {
          const b = h('button.chip.cat-chip' + (cat !== 'all' && cat !== k ? '.dim' : ''), { 'aria-pressed': String(cat === k), onclick: () => { cat = cat === k ? 'all' : k; draw(true); } },
            [h('span', { html: icon(cat === k ? 'check' : catIcon(k)) }), `${(st.categories[k] || {}).label} ${inArea.filter(x => x.cat === k).length}`]);
          b.style.background = CAT_COLOR[k] || '#ddd';
          return b;
        })]),
    );
    sortBox.replaceChildren(h('span.small', [h('span', { html: icon('sort') }), ' 並び順']), h('div.seg', [
      h('button', { 'aria-pressed': String(sort === 'fav'), onclick: () => { sort = 'fav'; draw(false); } }, 'お気に入り順'),
      h('button', { 'aria-pressed': String(sort === 'count'), onclick: () => { sort = 'count'; draw(false); } }, '訪れた回数順'),
    ]));
    const list = itemsNow();
    const maxCount = Math.max(1, ...list.map(x => x.count));
    cards.replaceChildren(...list.map((x, i) => card(x, i, maxCount)));
    if (!list.length) cards.append(h('div.panel', [h('p', 'まだおすすめはありません。'), h('p.muted.small', '推しをエリアに連れ出して、足あとがたまると、よく立ち寄る場所がおすすめになります。')]));
    drawPins(list);
    // 複数のエリアにまたがるときは、一番上のスポットのエリアに合わせる
    if (fit && list.length) { const ar = list[0].area; const pts = list.filter(x => x.area === ar).map(x => [x.lat, x.lng]); M.map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 16, animate: false }); }
  }

  const markers = new Map();
  function drawPins(list) {
    M.layers.pins.clearLayers(); markers.clear();
    const z = M.map.getZoom();
    list.forEach((x, i) => {
      const el = h('div.heart-pin' + (i < 3 ? '.top3' : '') + (x.placeId === selId ? '.sel' : ''), { html: icon('heart') + `<b>${i + 1}</b>` });
      el.querySelector('svg').setAttribute('fill', CAT_COLOR[x.cat] || '#ddd');
      if (z >= 15 || i < 3 || x.placeId === selId) el.append(h('span.heart-label', x.name));
      const m = L.marker([x.lat, x.lng], { icon: L.divIcon({ html: el, className: 'pin-wrap', iconSize: [34, 34], iconAnchor: [17, 30] }), title: x.name, zIndexOffset: 100 - i });
      m.on('click', () => { select(x.placeId, true); });
      m.addTo(M.layers.pins); markers.set(x.placeId, m);
    });
  }
  M.map.on('zoomend', () => { if (data) drawPins(itemsNow()); });

  function select(id, fromMap) {
    selId = id;
    for (const el of cards.children) el.classList.toggle('sel', el.dataset.id === id);
    const x = data.items.find(i => i.placeId === id);
    if (!x) return;
    drawPins(itemsNow());
    if (fromMap) {
      const el = [...cards.children].find(e => e.dataset.id === id);
      if (el) {
        if (isWide()) el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
        else { const y = el.getBoundingClientRect().top + window.scrollY - mapBox.getBoundingClientRect().bottom - 8 + (mapBox.getBoundingClientRect().top - (mapBox.offsetTop ? 0 : 0)); window.scrollTo({ top: el.offsetTop - mapBox.offsetHeight - 70, behavior: reduceMotion() ? 'auto' : 'smooth' }); }
      }
    } else M.focus(x.lat, x.lng, { zoom: Math.max(15, M.map.getZoom()), ring: true });
  }

  function card(x, i, maxCount) {
    const pct = Math.round(x.count / maxCount * 100);
    const barIn = h('span'); barIn.style.width = pct + '%';
    const band = h('div.rec-band.cat-' + x.cat, [h('span', { html: icon(catIcon(x.cat)) }), h('span.rank', `${i + 1}位`), h('span.small', x.catLabel), h('span.aff', { 'aria-label': `相性 ${x.score}点` }, [h('span', { html: icon('heart') }), String(x.score)])]);
    const more = h('details.rec-more', [h('summary', 'くわしく見る'), h('div', [
      h('p.small', x.address), x.exterior ? h('p.small', ['外観: ', x.exterior]) : null,
      x.menu && x.menu.length ? h('ul.menu-list', x.menu.map(m => h('li', [h('span', [m.name, m.name === x.highlight ? h('span', { html: icon('heart') }) : null]), h('span', `${m.price.toLocaleString()}円`)]))) : null,
      x.reviews && x.reviews.length ? h('ul.review-list', x.reviews.map(r => h('li', [h('span.rv-star', { html: icon('star') }), h('b', String(r.rating)), ' ', r.text]))) : null,
      h('p.dummy-note', '外観、メニュー、予算、口コミはデモ用のダミーデータです。'),
      x.url ? h('a.btn.btn-link.btn-small', { href: x.url, target: '_blank', rel: 'noopener' }, [h('span', { html: icon('link') }), '公式サイトなど']) : null,
    ])]);
    const el = h('article.rec-card' + (i === 0 ? '.first' : '') + (x.placeId === selId ? '.sel' : ''), { dataset: { id: x.placeId }, tabindex: '0' }, [band, h('div.rec-body', [
      h('p.genre', [x.genre, h('span', [h('span', { html: icon('pin') }), x.areaName]), x.fictional ? h('span.fic-tag', '架空の施設') : null]),
      h('h3', x.name),
      h('div.visit-bar', [h('div.bar', [barIn]), h('span', `${x.count}回・${mins(x.minutes)}`)]),
      h('div.reasons', x.reasons.map(s => h('p', s))),
      x.pick ? h('p.pick', [h('span', { html: icon('heart') }), `おすすめ: ${x.pick.text}`]) : null,
      h('div.rec-tags', [x.hours ? h('span', x.hours.always ? '24時間' : `${x.hours.open}〜${x.hours.close}時`) : null, x.budget ? h('span', `予算 ${x.budget.toLocaleString()}円`) : null, x.rating ? h('span', `評価 ${x.rating}`) : null]),
      more,
    ])]);
    el.addEventListener('click', e => { if (e.target.closest('a, button, summary, details')) return; select(x.placeId, false); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) select(x.placeId, false); });
    return el;
  }

  // スマホ: 地図のすぐ下に来たカードの場所を地図が追いかける
  let followTimer = null;
  const onScroll = () => {
    if (isWide() || !data) return;
    clearTimeout(followTimer);
    followTimer = setTimeout(() => {
      const line = mapBox.getBoundingClientRect().bottom + 10;
      const el = [...cards.children].find(e => e.getBoundingClientRect().bottom > line + 40);
      if (el && el.dataset.id && el.dataset.id !== selId) { selId = el.dataset.id; for (const x of cards.children) x.classList.toggle('sel', x === el); const it = data.items.find(i => i.placeId === selId); if (it) { M.map.panTo([it.lat, it.lng], { animate: !reduceMotion() }); drawPins(itemsNow()); } }
    }, 120);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onLeave(() => window.removeEventListener('scroll', onScroll));

  function pickChar() {
    const list = h('div.area-pick');
    const s = openSheet({ title: 'おすすめを見る推し', content: list });
    for (const x of st.characters) list.append(h('button.area-opt' + (x.id === c.id ? '.cur' : ''), { onclick: () => { c = x; s.close(); load(); } }, [avatar(x, 40), h('span', [x.name, h('small', x.tagline)])]));
  }
  await load();
}
