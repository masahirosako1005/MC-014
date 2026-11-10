// public/js/reveal.js
// 獲得の演出。推しならホームに連れて行くかをアイコンで選べる（新しく獲得した推しは自動ではホームに並ばない）。

import { h, api, app, loadState } from './core.js';
import { icon } from './icons.js';
import { avatar } from './avatar.js';

export function reveal(result) {
  return new Promise(resolve => {
    const card = h('div.reveal-card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '獲得' });
    const root = h('div.reveal', [card]);
    const close = () => { root.remove(); resolve(); };
    if (result.type === 'character') {
      const c = result.character; const w = result.work;
      const homeBtn = h('button.btn.btn-yellow', { 'aria-label': `${c.short}をホームに連れて行く` }, [h('span', { html: icon('home') }), h('span', { html: icon('plus') })]);
      homeBtn.addEventListener('click', async () => {
        homeBtn.disabled = true;
        await api('/api/selected-character', { method: 'PUT', body: { id: c.id } });
        await loadState();
        close(); location.hash = '#/home';
      });
      card.append(
        h('p.muted', '新しい推しに出会った'),
        avatar(c, 120),
        h('h3', c.name),
        w ? h('span.work', { dataset: { theme: w.theme } }, w.title) : null,
        h('p.small', c.tagline),
        result.areasUnlocked && result.areasUnlocked.length ? h('p.small', [h('span', { html: icon('area') }), `${result.areasUnlocked.join('、')}も行けるようになった`]) : null,
        h('div.acts', [homeBtn, h('button.btn.btn-white', { onclick: close }, 'あとで')]),
      );
    } else {
      const a = result.area;
      card.append(
        h('p.muted', '新しいエリア'),
        h('div.big-ic', { html: icon('area') }),
        h('h3', a.name),
        h('p.small', a.intro),
        h('div.acts', [h('button.btn', { onclick: close }, 'とじる')]),
      );
    }
    document.body.append(root);
    setTimeout(() => { const b = card.querySelector('button'); if (b) b.focus(); }, 50);
  });
}
