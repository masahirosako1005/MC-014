// public/js/views/routes.js
// ④観光ルート: 保存した観光ルートの一覧（作成時に自動で保存、100件まで）。推しごとに絞り込め、詳細を開ける。

import { app, api, h, md, charById } from '../core.js';
import { icon } from '../icons.js';
import { avatar } from '../avatar.js';
import { oshiSwitch } from '../oshi-switch.js';

export async function render(view, route) {
  let filter = route.query.c || 'all';
  const chips = h('div');
  const list = h('div.route-list');
  view.append(
    h('h1.page-title', [h('span', { html: icon('route') }), '観光ルート']),
    h('p.muted', '推しが考えてくれた観光ルート。推しと一緒に出かける気分で読めます。'),
    h('div.gap'),
    h('a.btn.btn-yellow', { href: `#/route/new${filter !== 'all' ? '?c=' + filter : ''}` }, [h('span', { html: icon('plus') }), '観光ルートを考えてもらう']),
    h('div.gap'), chips, h('div.gap'), list,
  );
  const data = await api('/api/routes');
  const ids = [...new Set(data.routes.map(r => r.characterId))];
  function draw() {
    // 推しで絞り込む（顔を押すとその推しのルートだけになる）
    const chars = app.state.characters;
    if (chars.length > 1 && !chips.firstChild) chips.replaceChildren(oshiSwitch({ chars, selected: filter, allLabel: 'すべて', label: '推しを選んで絞り込む', onSelect: id => { filter = id; draw(); } }).el);
    const newBtn = view.querySelector('a.btn-yellow');
    if (newBtn) newBtn.href = '#/route/new' + (filter !== 'all' ? '?c=' + filter : '');
    const rs = data.routes.filter(r => filter === 'all' || r.characterId === filter);
    if (!rs.length) { list.replaceChildren(h('div.panel', [h('p', filter === 'all' ? 'まだ観光ルートはありません。' : `${(charById(filter) || {}).short || ''}の観光ルートはまだありません。`), h('p.muted.small', '推しの足あとがたまるほど、推しらしいルートになります。')])); return; }
    list.replaceChildren(...rs.map(r => {
      const c = charById(r.characterId); const p = r.partner !== 'self' ? charById(r.partner) : null;
      return h('a.route-card', { href: `#/route/${r.id}` }, [
        h('div.pair-faces', [c ? avatar(c, 44) : null, p ? avatar(p, 44) : h('span.me', { html: icon('user') })]),
        h('div', [h('h4', `${md(r.day)} ${r.areaName}`), h('p.small', `${r.characterName} × ${r.partnerName}　${r.lengthLabel}・${r.stops}か所${r.event ? '　' + r.event : ''}`), h('p.names', r.names.join(' → '))]),
        h('span', { html: icon('right') }),
      ]);
    }));
  }
  draw();
}
