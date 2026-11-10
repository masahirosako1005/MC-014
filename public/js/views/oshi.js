// public/js/views/oshi.js
// ③ミニ推し: 「わたしの推し」と「旅先で出会った推し」。推しのページ（#/oshi/:id）もここで描く。
// わたしの推しは分類と作品ごとに並べ、あらすじと権利表記を添える。ホームに出すかは家のアイコンで選ぶ。
// 獲得数の母数や、未獲得のものを伏せた表示は出さない。

import { app, api, h, hm, md, loadState, charById, workById, areaById, toast } from '../core.js';
import { icon, catIcon } from '../icons.js';
import { avatar } from '../avatar.js';
import { openTraveler, openPlace } from '../sheet.js';

const KIND_ORDER = ['anime', 'manga', 'movie', 'idol', 'mascot', 'company', 'history'];

export async function render(view, route) {
  if (route.params[0]) return renderPage(view, route.params[0]);
  let tab = route.query.tab === 'met' ? 'met' : 'mine';
  const seg = h('div.seg', { role: 'group', 'aria-label': '表示' });
  const b1 = h('button', { onclick: () => set('mine') }, [h('span', { html: icon('oshi') }), 'わたしの推し']);
  const b2 = h('button', { onclick: () => set('met') }, [h('span', { html: icon('meetIcon') }), '旅先で出会った推し']);
  seg.append(b1, b2);
  const body = h('div');
  view.append(h('h1.page-title', [h('span', { html: icon('oshi') }), 'ミニ推し']), seg, h('div.gap'), body);

  function set(t) {
    tab = t;
    b1.setAttribute('aria-pressed', String(t === 'mine')); b2.setAttribute('aria-pressed', String(t === 'met'));
    if (t === 'mine') mine(); else met();
  }

  function mine() {
    const st = app.state;
    const works = st.works.slice().sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const row = h('div.works-row');
    for (const w of works) {
      const chars = st.characters.filter(c => c.workId === w.id);
      const grid = h('div.oshi-grid', chars.map(c => tile(c)));
      row.append(h('section.work-block', [
        h('div.work-head', [h('div', [ // 作品ごとの色分けはしない（2026-11-09 の依頼）
          h('span.kind', w.kindLabel), h('h3', w.title),
          h('details', [h('summary', 'あらすじ'), h('p', w.synopsis)]),
          h('p.rights', w.rights),
        ])]),
        grid,
      ]));
    }
    body.replaceChildren(...(st.homeCharacterIds.length >= 2 ? [orderPanel()] : []), row);
  }

  /** ホームの推しの並び順。ホームでは左からこの順に並ぶ。ドラッグか左右のボタンで入れ替える */
  function orderPanel() {
    const ids = app.state.homeCharacterIds.filter(id => charById(id));
    const list = h('ol.home-order', { 'aria-label': 'ホームの推しの並び順' });
    const save = async next => {
      try { await api('/api/home-characters', { method: 'PUT', body: { ids: next } }); await loadState(); mine(); toast('ホームの並び順を変えました'); } catch (er) { toast(er.message); }
    };
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= ids.length) return; const next = ids.slice(); [next[i], next[j]] = [next[j], next[i]]; save(next); };
    let dragFrom = -1;
    ids.forEach((id, i) => {
      const c = charById(id);
      const li = h('li.order-item', { draggable: 'true', dataset: { i: String(i) } }, [
        // 番号のすぐ右に左の矢印、顔と名前を左右の矢印で挟む
        h('span.order-no', String(i + 1)),
        h('button.icon-btn.order-btn', { 'aria-label': `${c.short}を左へ`, title: '左へ', disabled: i === 0, html: icon('left'), onclick: () => move(i, -1) }),
        avatar(c, 34), h('span.order-name', c.short),
        h('button.icon-btn.order-btn', { 'aria-label': `${c.short}を右へ`, title: '右へ', disabled: i === ids.length - 1, html: icon('right'), onclick: () => move(i, 1) }),
      ]);
      li.addEventListener('dragstart', e => { dragFrom = i; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); });
      li.addEventListener('dragend', () => { li.classList.remove('dragging'); list.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')); });
      li.addEventListener('dragover', e => { e.preventDefault(); li.classList.add('drop'); });
      li.addEventListener('dragleave', () => li.classList.remove('drop'));
      li.addEventListener('drop', e => { e.preventDefault(); if (dragFrom < 0 || dragFrom === i) return; const next = ids.slice(); const [x] = next.splice(dragFrom, 1); next.splice(i, 0, x); dragFrom = -1; save(next); });
      list.append(li);
    });
    return h('section.panel.home-order-panel', [
      h('h3', [h('span', { html: icon('home') }), 'ホームの並び順']),
      h('p.muted.small', '推し中の推しは、ホームで左からこの順に並びます。ドラッグするか、左右のボタンで入れ替えられます。'),
      list,
    ]);
  }

  function tile(c) {
    const on = app.state.homeCharacterIds.includes(c.id);
    // ホームに出すかの切り替え。「推す！」でホームに並べ、「推し中！」はホームにいる（2026-11-10 の依頼で文言を変更）
    const btn = h('button.push-toggle' + (on ? '.on' : ''), { 'aria-pressed': String(on), 'aria-label': on ? `${c.short}は推し中（ホームにいる）。押すとホームから外す` : `${c.short}を推す（ホームに連れて行く）` }, [h('span', { html: icon(on ? 'heart' : 'plus') }), on ? '推し中！' : '推す！']);
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const ids = app.state.homeCharacterIds.slice();
      const i = ids.indexOf(c.id);
      if (i >= 0) { if (ids.length === 1) { toast('ホームには1人以上の推しが必要です'); return; } ids.splice(i, 1); } else ids.push(c.id);
      try { await api('/api/home-characters', { method: 'PUT', body: { ids } }); await loadState(); mine(); } catch (er) { toast(er.message); }
    });
    const t = h('article.oshi-tile', { tabindex: '0', 'aria-label': c.name }, [avatar(c, 84), h('h4', c.name), h('p', c.tagline), btn]);
    t.addEventListener('click', () => { location.hash = `#/oshi/${c.id}`; });
    t.addEventListener('keydown', e => { if (e.key === 'Enter') location.hash = `#/oshi/${c.id}`; });
    return t;
  }

  async function met() {
    body.replaceChildren(h('p.muted', '読みこみ中…'));
    const data = await api('/api/encounters');
    const order = app.state.settings.meetOrder === 'asc' ? 1 : -1;
    const list = data.encounters.slice().sort((a, b) => (a.at - b.at) * order);
    if (!list.length) { body.replaceChildren(h('div.panel', [h('p', 'まだ出会いはありません。'), h('p.muted.small', '推しが旅先で、ほかの人の推しと同じ場所に同じ時間にいると出会えます。')])); return; }
    const ul = h('ul.meet-list');
    for (const e of list) {
      const t = data.travelers[e.travelerId]; const mine = charById(e.characterId);
      const li = h('li', { tabindex: '0' }, [avatar(t, 56), h('div', [
        h('h4', `${t.name}（${t.fromShort}から）`),
        h('p.when', `${md(e.day)} ${hm(e.at)}　${e.placeName}（${e.areaName}）で${mine ? mine.short : ''}が出会った`),
      ])]);
      const open = () => openTraveler(t, data.encounters.filter(x => x.travelerId === t.id), data.shared);
      li.addEventListener('click', open); li.addEventListener('keydown', ev => { if (ev.key === 'Enter') open(); });
      ul.append(li);
    }
    body.replaceChildren(h('p.muted.small', `出会った順（${order < 0 ? '新しい順' : '古い順'}）。設定で並びを変えられます。閲覧のみです。`), ul);
  }
  set(tab);
}

/* ---------------------------------------------------------------- 推しのページ */
async function renderPage(view, id) {
  const data = await api('/api/characters/' + encodeURIComponent(id));
  const c = data.character, w = data.work, cn = data.canon;
  const a = c.placement ? areaById(c.placement) : null;
  const homeOn = data.inHome;
  const homeBtn = h('button.btn.btn-white', { 'aria-pressed': String(homeOn) }, [h('span', { html: icon(homeOn ? 'heart' : 'plus') }), homeOn ? '推し中！' : '推す！']);
  homeBtn.addEventListener('click', async () => {
    const ids = app.state.homeCharacterIds.slice(); const i = ids.indexOf(c.id);
    if (i >= 0) { if (ids.length === 1) return toast('ホームには1人以上の推しが必要です'); ids.splice(i, 1); } else ids.push(c.id);
    await api('/api/home-characters', { method: 'PUT', body: { ids } }); await loadState(); renderPageAgain();
  });
  const renderPageAgain = () => { view.replaceChildren(); renderPage(view, id); };
  const side = h('div.side', [h('div.panel', [
    h('div.oshi-hero', [avatar(c, 110), h('div', [h('h2', c.name), w ? h('span.work', { dataset: { theme: w.theme } }, w.title) : null, h('p.muted.small', c.tagline)])]),
    h('p.small', [h('span', { html: icon('pin') }), a ? ` いま ${a.short}にいる` : ' 家で待っている']),
    h('div.oshi-acts', [
      h('a.btn', { href: '#/home', onclick: async () => { await api('/api/selected-character', { method: 'PUT', body: { id: c.id } }); await loadState(); } }, [h('span', { html: icon('out') }), 'ホームで見る']),
      homeBtn,
      h('a.btn.btn-yellow', { href: `#/route/new?c=${c.id}` }, [h('span', { html: icon('route') }), '観光ルートを考えてもらう']),
    ]),
  ]),
  h('div.panel', [h('h3.section-title', [h('span', { html: icon('walk') }), '足あとの集計']),
    h('dl.kv', [h('dt', '足あとのある日'), h('dd', `${data.totals.days}日`), h('dt', '歩いた歩数'), h('dd', `${data.totals.steps.toLocaleString()}歩`), h('dt', '歩いた距離'), h('dd', `${data.totals.km}km`)]),
    data.top.length ? h('div', [h('h4.section-title', 'よく立ち寄る場所'), h('div.place-chips', data.top.map(p => h('button', { onclick: () => openPlace(p.placeId) }, `${p.name}（${p.count}回）`)))]) : null,
  ])]);
  const main = h('div', [
    h('div.panel', [h('h3.section-title', [h('span', { html: icon('user') }), 'プロフィール']), h('dl.kv', (cn.profile || []).flatMap(([k, v]) => [h('dt', k), h('dd', v)]))]),
    h('div.panel', [h('h3.section-title', [h('span', { html: icon('sparkle') }), '性格']), h('ul.bullet', (cn.personality || []).map(x => h('li', x))),
      h('h4.section-title', '好きなもの'), h('div.chips', (cn.likes || []).map(x => h('span.chip', x))),
      cn.dislikes && cn.dislikes.length ? h('h4.section-title', '苦手なもの') : null, cn.dislikes && cn.dislikes.length ? h('div.chips', cn.dislikes.map(x => h('span.chip', x))) : null]),
    h('div.panel', [h('h3.section-title', [h('span', { html: icon('route') }), '行動原理']),
      h('dl.kv', [h('dt', '歩幅'), h('dd', `${data.principle.stride}m`), h('dt', '歩く速さ'), h('dd', `分速${data.principle.speed}m`), h('dt', '活動する時間'), h('dd', `${data.principle.active[0]}時〜${data.principle.active[1]}時`)]),
      h('div', [bar('乗り物好き', data.principle.vehicle), ...Object.entries(data.principle.interests).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).map(([k, v]) => bar((app.state.categories[k] || {}).label || k, Math.min(1, v)))]),
    ]),
    h('div.panel', [h('h3.section-title', [h('span', { html: icon('walk') }), 'いつもの道']), h('p', cn.commute),
      data.regulars.length ? h('div.place-chips', data.regulars.map(p => h('button', { onclick: () => openPlace(p.id) }, p.model ? `${p.name}（作中の${p.model}）` : p.name))) : null]),
    cn.episodes && cn.episodes.length ? h('div.panel', [h('h3.section-title', [h('span', { html: icon('book') }), '作中の出来事']), h('ul', cn.episodes.map(e => h('li', [h('b', e.title), h('p.small', e.text)])))]) : null,
    cn.relations && cn.relations.length ? h('div.panel', [h('h3.section-title', '関係'), h('dl.kv', cn.relations.flatMap(([k, v]) => [h('dt', k), h('dd', v)]))]) : null,
    w ? h('p.muted.small', w.rights) : null,
  ]);
  view.append(h('a.btn.btn-white.btn-small', { href: '#/oshi' }, [h('span', { html: icon('left') }), 'ミニ推し']), h('div.gap'), h('div.oshi-page', [side, main]));
}
function bar(label, v) { const s = h('span'); s.style.width = Math.round(v * 100) + '%'; return h('div.bar-row', [h('span', label), h('div.bar', [s]), h('span.small', String(Math.round(v * 10) / 10))]); }
