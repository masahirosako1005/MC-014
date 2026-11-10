// public/js/avatar.js
// キャラの絵。京町ありさはスタンプラリーのキービジュアルの切り抜き（アプリ内に同梱）。
// それ以外は、コードで描いた簡易な絵（隆景、武蔵、信繁、政宗は肖像画の代わりの簡易な絵）。
// 画像に差し替えるときは、data/world.js の look.image を指定する。

import { h } from './core.js';

const IMG_W = 750, IMG_H = 480;

/** キャラの顔（丸）。size はピクセル */
export function avatar(c, size = 56, cls = '') {
  const look = (c && c.look) || {};
  const el = h('span.avatar' + (cls ? '.' + cls : ''), { role: 'img', 'aria-label': c ? c.name || c.short : '' });
  el.style.width = size + 'px'; el.style.height = size + 'px';
  if (look.bg) el.style.background = look.bg;
  if (look.image && look.crop) {
    // 切り抜き: [x, y, w, h] を丸の大きさに合わせる。
    // 枠線の太さや、画面幅による大きさの変更（CSS）があっても同じ切り抜きになるよう、ピクセルではなく割合で指定する
    // （以前はピクセルで計算していて、枠線のぶん顔の右下が見切れていた。地図の上の推しの印は枠線がないので正しく見えていた）
    const [x, y, w, hh = w] = look.crop;
    // 元の絵の大きさ（look.size）。省いたときはありさのキービジュアル（750×480）
    const [IW, IH] = look.size || [IMG_W, IMG_H];
    const img = h('span.avatar-img');
    img.style.backgroundImage = `url("${look.image}")`;
    img.style.backgroundSize = `${IW / w * 100}% ${IH / hh * 100}%`;
    img.style.backgroundPosition = `${x / (IW - w) * 100}% ${y / (IH - hh) * 100}%`;
    el.append(img);
    return el;
  }
  if (look.image) {
    // 自治体から申請され、事務局が承認した絵（切り抜かず、丸に合わせて表示する）
    const img = h('span.avatar-img');
    img.style.backgroundImage = `url("${look.image}")`;
    img.style.backgroundSize = 'cover';
    img.style.backgroundPosition = 'center top';
    el.append(img);
    return el;
  }
  el.innerHTML = drawFace(look);
  return el;
}

/** コードで描いた簡易な顔（SVG）。style 属性は使わない */
function drawFace(look) {
  // 色は #RGB / #RRGGBB の形のときだけ使う（SVG の文字列に入れるため、ほかの文字を通さない）
  const okColor = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : d);
  const hair = okColor(look.hair, '#333'), color = okColor(look.color, '#007190');
  const acc = look.accessory || '';
  let extra = '';
  if (acc === 'glasses') extra = '<circle cx="40" cy="54" r="7" fill="none" stroke="#1f2a4a" stroke-width="2.5"/><circle cx="60" cy="54" r="7" fill="none" stroke="#1f2a4a" stroke-width="2.5"/><path d="M47 54h6" stroke="#1f2a4a" stroke-width="2.5"/>';
  if (acc === 'bun') extra = `<circle cx="50" cy="14" r="11" fill="${hair}"/>`;
  if (acc === 'ponytail') extra = `<path d="M74 34c14 6 14 30 4 40" fill="none" stroke="${hair}" stroke-width="9" stroke-linecap="round"/>`;
  if (acc === 'cap') extra = `<path d="M22 34c4-18 52-18 56 0z" fill="${color}"/><path d="M60 33h26" stroke="${color}" stroke-width="6" stroke-linecap="round"/>`;
  if (acc === 'eboshi') extra = '<path d="M30 30c2-22 36-26 42-4 2 6-2 8-8 6-10-3-22-3-30 2-4 2-5 0-4-4z" fill="#1d1d1d"/>';
  if (acc === 'swords') extra = '<path d="M14 92 34 70M86 92 66 70" stroke="#6b4a2a" stroke-width="5" stroke-linecap="round"/>';
  if (acc === 'kabuto') extra = '<path d="M22 38c2-24 54-24 56 0z" fill="#8a1c1c"/><path d="M38 16c4 6 20 6 24 0l-4 12H42z" fill="#d6a94a"/>';
  if (acc === 'eyepatch') extra = '<path d="M30 50c8-2 16-2 20 2" stroke="#111" stroke-width="2"/><ellipse cx="60" cy="55" rx="8" ry="6" fill="#111"/><path d="M28 44 72 60" stroke="#111" stroke-width="2"/>';
  if (acc === 'scarf') extra = `<path d="M30 82c12 6 28 6 40 0l2 8c-14 6-30 6-44 0z" fill="${color}"/>`;
  const portrait = look.portrait;
  const face = portrait ? '#f2dcc2' : '#fde7d4';
  return `<svg viewBox="0 0 100 100" class="face">
    <path d="M14 100c4-22 18-30 36-30s32 8 36 30z" fill="${color}"/>
    <path d="M22 52c0-24 12-36 28-36s28 12 28 36v14H22z" fill="${hair}"/>
    <ellipse cx="50" cy="55" rx="22" ry="24" fill="${face}"/>
    <path d="M28 46c6-14 38-16 44 0-6-6-16-8-22-8s-16 2-22 8z" fill="${hair}"/>
    ${portrait ? '<path d="M40 54h6M54 54h6" stroke="#2a2a2a" stroke-width="2.6" stroke-linecap="round"/><path d="M44 68c4 2 8 2 12 0" stroke="#7a4a3a" stroke-width="2" fill="none" stroke-linecap="round"/>' :
      '<circle cx="41" cy="56" r="3.4" fill="#1f2a4a"/><circle cx="59" cy="56" r="3.4" fill="#1f2a4a"/><path d="M45 67c3 2.5 7 2.5 10 0" stroke="#c0605a" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="35" cy="63" r="3" fill="#f6b3a8" opacity=".7"/><circle cx="65" cy="63" r="3" fill="#f6b3a8" opacity=".7"/>'}
    ${extra}
  </svg>`;
}

/** 地図の上の推しの印（顔と黄色の縁）。Leaflet の divIcon に入れるHTML要素 */
export function mapFace(c, size = 46) {
  const wrap = h('div.map-face');
  wrap.append(avatar(c, size));
  return wrap;
}
