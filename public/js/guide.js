// public/js/guide.js
// 使い方の説明。初めて開いたときに6枚のカードで一度だけ出す。設定からいつでも見直せる。

import { app, h, api } from './core.js';
import { icon } from './icons.js';

const CARDS = [
  { ic: 'oshi', title: '推しの行動を見守るアプリ', text: '獲得した推しが、実際の町を自分の意思で旅します。どこへ行き、何をしたのかを、地図と足あとで見守れます。' },
  { ic: 'area', title: 'エリアに連れ出すと動き出す', text: '推しはふだん家で待っています。ホームのエリアのボタンから連れ出すと、その町で行動を始めます。' },
  { ic: 'route', title: '推しが観光ルートを考えてくれる', text: 'たくさん歩いた推しほど、お気に入りの場所が増えます。その足あとから、あなたのための観光ルートを考えてくれます。' },
  { ic: 'meetIcon', title: '推しと推しの組み合わせも', text: '「推し×推し」を選ぶと、ふたりで出かけたらどうなるかをシミュレーションできます（公式の関係ではありません）。' },
  { ic: 'meet', title: '現地で推しが増える', text: 'イベントやスタンプラリーの会場に貼られたQRコードやコードを「出会う」で読み取ると、推しやエリアが増えます。' },
  { ic: 'user', title: 'ログインは必要なときだけ', text: 'ログインしなくても使えます。プロフィールの下のボタンからIDを登録すると、データが保存されて、別の端末でも同じ内容を使えるようになります。' },
];

export function maybeShowGuide() { if (app.state && !app.state.guideSeen) showGuide(true); }

export function showGuide(first = false) {
  let i = 0;
  const card = h('div.guide-card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '使い方' });
  const root = h('div.guide', [card]);
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey); if (first) { app.state.guideSeen = true; api('/api/guide-seen', { method: 'POST', body: {} }).catch(() => {}); } };
  const onKey = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev(); };
  const next = () => { if (i < CARDS.length - 1) { i++; draw(); } else close(); };
  const prev = () => { if (i > 0) { i--; draw(); } };
  function draw() {
    const c = CARDS[i];
    card.replaceChildren(
      h('div.big-ic', { html: icon(c.ic) }),
      h('h3', c.title), h('p', c.text),
      h('div.guide-dots', CARDS.map((_, k) => h('i' + (k === i ? '.on' : '')))),
      h('div.guide-acts', [
        i > 0 ? h('button.btn.btn-white', { onclick: prev }, 'もどる') : h('button.btn.btn-white', { onclick: close }, 'とばす'),
        h('button.btn', { onclick: next }, i < CARDS.length - 1 ? 'つぎへ' : 'はじめる'),
      ]),
    );
    card.querySelector('.guide-acts .btn:last-child').focus();
  }
  document.addEventListener('keydown', onKey);
  document.body.append(root);
  draw();
}
