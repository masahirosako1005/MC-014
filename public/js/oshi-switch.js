// public/js/oshi-switch.js
// 推しの切り替え（推しのおすすめ、観光ルートの一覧、観光ルートを考えてもらう画面で使う）。
// 獲得した推しの顔と名前を並べ、押すとその推しに切り替わる。選んでいる推しは黄色。
// スマホでは横にスライド、PCでは折り返して全員を見せる。

import { h } from './core.js';
import { icon } from './icons.js';
import { avatar } from './avatar.js';

/**
 * @param {object} o
 * @param {Array} o.chars 推しの一覧
 * @param {string} o.selected 選んでいる推しのid（allLabel があるときは 'all' も）
 * @param {function} o.onSelect 押したときに id を受け取る
 * @param {string} o.label 見出し（例: 推しを選んで切り替え）
 * @param {string} [o.allLabel] 「すべて」の札を出すときの文字
 */
export function oshiSwitch({ chars, selected, onSelect, label, allLabel }) {
  let cur = selected;
  const row = h('div.oshi-switch', { role: 'tablist', 'aria-label': label });
  const wrap = h('div.oshi-switch-wrap', [h('p.oshi-switch-label', [h('span', { html: icon('swap') }), label]), row]);
  function draw() {
    const btn = (id, face, name, aria) => {
      const on = id === cur;
      const b = h('button.oshi-switch-btn' + (on ? '.on' : ''), { role: 'tab', 'aria-selected': String(on), 'aria-label': aria }, [face, h('span', name)]);
      b.addEventListener('click', () => { if (id === cur) return; cur = id; draw(); onSelect(id); });
      return b;
    };
    row.replaceChildren(
      ...(allLabel ? [btn('all', h('span.oshi-switch-all', { html: icon('oshi') }), allLabel, allLabel)] : []),
      ...chars.map(c => btn(c.id, avatar(c, 44), c.short, c.short)),
    );
    const on = row.querySelector('.on');
    if (on) requestAnimationFrame(() => { row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2); });
  }
  draw();
  return { el: wrap, set(id) { cur = id; draw(); } };
}
