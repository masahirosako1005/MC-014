// public/js/views/areas.js
// ⑤エリア: 獲得したエリアの一覧とイベントカレンダー。一覧に地図は出さない（エリアのタブでは地図を表示しない）。
// 押すとエリアの情報、主な場所（実在の場所だけ。架空のスポットは数を書く）、過去の旅の履歴が見られる。
// カレンダーは獲得したエリアのイベントだけを見せる。90日を超えるものは一覧にだけ出す。

import { app, api, h, md, mdw, addDays, charById } from '../core.js';
import { icon, catIcon } from '../icons.js';
import { avatar } from '../avatar.js';
import { openSheet, openPlace } from '../sheet.js';
import { evRow } from './home.js';

export async function render(view, route) {
  let tab = route.query.view === 'cal' ? 'cal' : 'list';
  const seg = h('div.seg.areas-tabs', { role: 'group', 'aria-label': '表示' });
  const b1 = h('button', { onclick: () => set('list') }, [h('span', { html: icon('area') }), '一覧']);
  const b2 = h('button', { onclick: () => set('cal') }, [h('span', { html: icon('calendar') }), 'カレンダー']);
  seg.append(b1, b2);
  const listCol = h('section', [h('h2.section-title', [h('span', { html: icon('area') }), '獲得したエリア']), h('div.area-list')]);
  const calCol = h('section', [h('h2.section-title', [h('span', { html: icon('calendar') }), 'イベントカレンダー']), h('div.panel.cal-wrap')]);
  view.append(h('h1.page-title', [h('span', { html: icon('area') }), 'エリア']), seg, h('div.gap'), h('div.areas-cols', [listCol, calCol]));
  function set(t) { tab = t; b1.setAttribute('aria-pressed', String(t === 'list')); b2.setAttribute('aria-pressed', String(t === 'cal')); listCol.classList.toggle('hidden', t !== 'list'); calCol.classList.toggle('hidden', t !== 'cal'); }
  set(tab);

  // 一覧
  const list = listCol.querySelector('.area-list');
  for (const a of app.state.areas) {
    const here = app.state.characters.filter(c => c.placement === a.id);
    const card = h('button.area-card', { 'aria-label': a.name }, [
      h('span.emblem', { html: icon('area') }),
      h('div', [h('h3', a.name), h('p', `${md(new Date(a.acquiredAt + 9 * 3600000).toISOString().slice(0, 10))}に獲得`), here.length ? h('p', `いまいる推し: ${here.map(c => c.short).join('、')}`) : null]),
      h('span', { html: icon('right') }),
    ]);
    card.addEventListener('click', () => openArea(a.id));
    list.append(card);
  }

  // カレンダー
  const data = await api('/api/events');
  const today = data.today;
  let month = (route.query.month || today).slice(0, 7);
  let sel = today;
  const calBox = calCol.querySelector('.cal-wrap');
  function drawCal() {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)); const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const grid = h('div.cal-grid', ['日', '月', '火', '水', '木', '金', '土'].map(w => h('span.wd', w)));
    for (let i = 0; i < first.getUTCDay(); i++) grid.append(h('span'));
    for (let d = 1; d <= last; d++) {
      const key = `${month}-${String(d).padStart(2, '0')}`;
      const evs = data.events.filter(e => !e.long && key >= e.start && key <= e.end);
      const b = h('button.cal-day' + (key === sel ? '.sel' : '') + (key === today ? '.today' : ''), { 'aria-label': `${m}月${d}日 イベント${evs.length}件` }, [String(d), evs.length ? h('span.ev') : null]);
      b.addEventListener('click', () => { sel = key; drawCal(); });
      grid.append(b);
    }
    const dayEvs = data.events.filter(e => sel >= e.start && sel <= e.end);
    const longs = data.events.filter(e => e.long && e.end >= today);
    const prevM = () => { month = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); drawCal(); };
    const nextM = () => { month = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); drawCal(); };
    calBox.replaceChildren(
      h('div.cal-head', [h('button.icon-btn', { 'aria-label': '前の月', html: icon('left'), onclick: prevM }), `${y}年${m}月`, h('button.icon-btn', { 'aria-label': '次の月', html: icon('right'), onclick: nextM })]),
      grid,
      h('h3.section-title', mdw(sel)),
      dayEvs.length ? h('ul.ev-list', dayEvs.map(evRow)) : h('p.muted', 'この日のイベントはありません。'),
      longs.length ? h('div', [h('h3.section-title', '長い期間のイベント'), h('ul.ev-list', longs.map(evRow))]) : null,
      h('p.muted.small', '日程は2026年11月時点の公開情報による目安です。「予定」は公式に確認できていないものです。'),
    );
  }
  drawCal();
}

export async function openArea(id) {
  const body = h('div', [h('p.muted', '読みこみ中…')]);
  const s = openSheet({ title: 'エリア', content: body });
  const a = await api('/api/areas/' + encodeURIComponent(id));
  s.el.querySelector('.sheet-title').textContent = a.name;
  body.replaceChildren(
    h('p', a.intro),
    a.url ? h('a.btn.btn-link', { href: a.url, target: '_blank', rel: 'noopener' }, [h('span', { html: icon('link') }), '観光の公式サイト']) : null,
    h('h3.section-title', [h('span', { html: icon('pin') }), '主な場所']),
    h('div.place-chips', a.mainPlaces.map(p => h('button', { onclick: () => openPlace(p.id) }, p.model ? `${p.name}（作中の${p.model}）` : p.name))),
    a.fictionalCount ? h('p.muted.small', `このほかに、デモ用の架空のスポットが${a.fictionalCount}か所あります。`) : null,
    h('h3.section-title', [h('span', { html: icon('walk') }), '旅の履歴']),
    a.history.length ? h('ul.hist', a.history.map(x => { const c = charById(x.characterId); return h('li', [c ? avatar(c, 28) : null, h('span', `${md(x.day)} ${c ? c.short : ''}　${x.places.join('、')}${x.count > x.places.length ? ' ほか' : ''}（${x.count}か所）`)]); })) : h('p.muted', 'まだこのエリアの旅の履歴はありません。'),
    a.events.length ? h('div', [h('h3.section-title', [h('span', { html: icon('calendar') }), 'イベント']), h('ul.ev-list', a.events.map(evRow))]) : null,
  );
}
