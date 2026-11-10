// public/js/sheet.js
// 詳細の表示。スマホでは下からのシート、PCでは中央の窓。
// 場所の詳細（openPlace）と、他の人の推しの詳細（openTraveler）もここで作る。

import { h, api, hm, md, toast, isWide } from './core.js';
import { icon, catIcon } from './icons.js';
import { avatar } from './avatar.js';

let stack = [];

/** シートを開く。content は要素。戻り値の close() で閉じる */
export function openSheet({ title, content, cls = '', onClose, label }) {
  const back = h('div.sheet-back');
  const closeBtn = h('button.icon-btn.sheet-close', { 'aria-label': '閉じる', html: icon('close') });
  const panel = h('div.sheet' + (cls ? '.' + cls : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title || '詳細' }, [
    h('div.sheet-grip', { 'aria-hidden': 'true' }),
    h('div.sheet-head', [title ? h('h2.sheet-title', title) : h('span'), closeBtn]),
    h('div.sheet-body', [content]),
  ]);
  const root = h('div.sheet-root', [back, panel]);
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('open'));
  const prevFocus = document.activeElement;
  const close = () => {
    if (!root.isConnected) return;
    root.classList.remove('open');
    setTimeout(() => root.remove(), 260);
    stack = stack.filter(s => s !== api_);
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  const onKey = e => { if (e.key === 'Escape' && stack[stack.length - 1] === api_) close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  // 下に引っぱって閉じる（スマホ）
  let y0 = null;
  panel.querySelector('.sheet-grip').addEventListener('pointerdown', e => { y0 = e.clientY; panel.setPointerCapture(e.pointerId); });
  panel.addEventListener('pointerup', e => { if (y0 !== null && e.clientY - y0 > 80) close(); y0 = null; });
  setTimeout(() => closeBtn.focus(), 50);
  const api_ = { close, el: panel, body: panel.querySelector('.sheet-body') };
  stack.push(api_);
  return api_;
}
export function closeAllSheets() { for (const s of stack.slice()) s.close(); }

const EAT = new Set(['food', 'cafe', 'sweets']);

/** 場所の詳細 */
export async function openPlace(id, o = {}) {
  const body = h('div.place-detail', [h('p.muted', '読みこみ中…')]);
  const s = openSheet({ title: '場所', content: body, label: '場所の詳細' });
  try {
    const p = await api('/api/places/' + encodeURIComponent(id));
    body.replaceChildren(
      h('div.place-head', [
        h('span.cat-badge' + (EAT.has(p.cat) ? '.eat' : '.see'), { html: icon(catIcon(p.cat)) }),
        h('div', [h('h3.place-name', p.name), h('p.place-meta', [p.genre || p.catLabel, ' ・ ', p.areaName])]),
      ]),
      p.fictional ? h('p.fic-note', [h('span.fic-tag', '架空の施設'), ' デモ用に作った場所です。実在しません。']) : null,
      p.model ? h('p.model-note', ['作中では「', p.model, '」のモデル']) : null,
      p.seichi ? h('p.model-note', ['『', p.seichi.work, '』の聖地', p.seichi.note ? `　${p.seichi.note}` : '']) : null,
      p.collected ? h('p.muted.small', `この場所は、${p.collected}から自動で集めました。`) : null,
      p.school ? h('p.warn-note', '実在の学校です。生徒以外は立ち入らないでください。') : null,
      h('p.place-desc', p.desc),
      p.address ? h('p.place-addr', { html: icon('pin') }, []) : null,
      p.address ? h('p.place-addr-text', p.address) : null,
      p.visitors.length ? h('div.visitors', [h('h4', '今日ここに来た推し'), h('ul', p.visitors.map(v => h('li', [hm(v.at), ' ', v.short, v.kind === 'traveler' ? `（${v.from}から旅してきた推し）` : ''])))]) : null,
      p.spot ? spotBlock(p.spot) : null,
      p.url ? h('a.btn.btn-link', { href: p.url, target: '_blank', rel: 'noopener' }, [h('span', { html: icon('link') }), '公式サイトなど']) : null,
      p.url ? h('p.muted.small', '営業日や時間は、リンク先で確かめてください。') : null,
    );
    s.el.querySelector('.sheet-title').textContent = p.name;
  } catch (e) { body.replaceChildren(h('p', e.message)); }
  return s;
}

export function spotBlock(sp) {
  return h('div.spot-block', [
    h('p.dummy-note', 'ここから下の外観、メニュー、予算、口コミは、デモ用のダミーデータです。'),
    sp.exterior ? h('p', [h('b', '外観 '), sp.exterior]) : null,
    sp.hours ? h('p', [h('b', '営業の目安 '), sp.hours.always ? '24時間（屋外）' : `${fmtH(sp.hours.open)}〜${fmtH(sp.hours.close)}`]) : null,
    sp.budget ? h('p', [h('b', '予算の目安 '), `${sp.budget.toLocaleString()}円`]) : null,
    sp.menu && sp.menu.length ? h('ul.menu-list', sp.menu.map(m => h('li', [m.name, h('span', `${m.price.toLocaleString()}円`)]))) : null,
    sp.reviews && sp.reviews.length ? h('ul.review-list', sp.reviews.map(r => h('li', [h('span.rv-star', { html: icon('star') }), h('b', String(r.rating)), ' ', r.text]))) : null,
  ]);
}
const fmtH = x => `${Math.floor(x)}:${String(Math.round((x % 1) * 60)).padStart(2, '0')}`;

/** 他の人の推しの詳細（閲覧のみ） */
export function openTraveler(t, encounters = [], shared = []) {
  const body = h('div.traveler', [
    h('div.traveler-head', [avatar(t, 72), h('div', [h('h3', t.name), h('p.muted', t.work), h('p.small', [t.owner, 'の推し'])])]),
    h('p.view-only', [h('span', { html: icon('oshi') }), '閲覧のみ。自分の推しとして旅に出すことはできません。']),
    h('div.info-card', [h('h4', [h('span', { html: icon('pin') }), '獲得した場所']), h('p', `${t.from}の${t.acquiredAt}`)]),
    h('div.info-card', [h('h4', [h('span', { html: icon('area') }), `${t.fromShort}のこと`]), h('p', t.intro), h('a.btn.btn-link', { href: t.url, target: '_blank', rel: 'noopener' }, [h('span', { html: icon('link') }), t.urlLabel])]),
    encounters.length ? h('div.info-card', [h('h4', [h('span', { html: icon('meetIcon') }), '出会った記録']), h('ul', encounters.map(e => h('li', `${md(e.day)} ${hm(e.at)}　${e.placeName}（${e.areaName}）`)))]) : null,
    shared.length ? h('div.info-card.shared', [h('h4', [h('span', { html: icon('sparkle') }), 'こちらの推しの紹介も届いています']), h('p', `${t.owner}の画面には、${shared.map(s => `${s.short}（${s.homeArea}）`).join('、')}の獲得した場所と地域の紹介が表示されています。`), h('p.muted.small', 'デモのため、実際の送信はしていません。')]) : null,
  ]);
  return openSheet({ title: '旅先で出会った推し', content: body });
}
