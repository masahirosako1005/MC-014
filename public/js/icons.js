// public/js/icons.js
// 画面で使うアイコン（SVG）。文字を減らし、アイコンで直感的に操作できるようにする。
// style 属性は使わない（CSPで禁止しているため）。色は CSS の currentColor で付ける。

const P = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  meet: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 18v2.5"/>',
  oshi: '<circle cx="12" cy="9" r="4.2"/><path d="M4.5 20.5c1.2-4 4.2-6 7.5-6s6.3 2 7.5 6"/><path d="M17.5 3.5l.8 1.6 1.7.3-1.2 1.2.3 1.7-1.6-.8"/>',
  route: '<circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="6" r="2.4"/><path d="M8.2 17.2c3.5-1 1.5-5.2 4.8-6.2 2-.6 3.4-1.5 3.6-3"/>',
  area: '<path d="M9 4 3.5 6.5v13L9 17l6 2.5 5.5-2.5v-13L15 6.5 9 4z"/><path d="M9 4v13M15 6.5v13"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/>',
  star: '<path d="m12 3.2 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.4"/>',
  locate: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  city: '<path d="M3 20.5h18M5 20.5V9l5-3v14.5M10 20.5V4l6 3v13.5M16 20.5V11l3 1.5v8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  left: '<path d="m14.5 5-7 7 7 7"/>',
  right: '<path d="m9.5 5 7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  // 足跡（左右の足の裏とかかと）。ホームの「足あと」の見出しに使う
  feet: '<ellipse cx="7.2" cy="11.6" rx="2" ry="3.3" transform="rotate(-8 7.2 11.6)"/><ellipse cx="7.9" cy="18.6" rx="1.3" ry="1.5"/><ellipse cx="16.8" cy="5.6" rx="2" ry="3.3" transform="rotate(8 16.8 5.6)"/><ellipse cx="16.1" cy="12.6" rx="1.3" ry="1.5"/>',
  walk: '<circle cx="13" cy="4.6" r="1.8"/><path d="m9.5 21 2.4-6.2 2.6 2.4V21M11.9 14.8 12.6 9l-3.3 1.6-1.3 3.2M12.6 9l2.6 2.8 2.8.7"/>',
  train: '<rect x="5.5" y="3.5" width="13" height="13" rx="3"/><path d="M5.5 11h13M8.5 20.5l1.5-4M15.5 20.5l-1.5-4"/><circle cx="9" cy="13.8" r=".6"/><circle cx="15" cy="13.8" r=".6"/>',
  bus: '<rect x="4.5" y="3.5" width="15" height="14" rx="3"/><path d="M4.5 10.5h15M7.5 20.5v-3M16.5 20.5v-3"/><circle cx="8.3" cy="14.3" r=".6"/><circle cx="15.7" cy="14.3" r=".6"/>',
  ferry: '<path d="M3 17.5c2 1.6 4 1.6 6 0 2 1.6 4 1.6 6 0 2 1.6 4 1.6 6 0"/><path d="M5 14.5 6.5 9h11l1.5 5.5M9 9V5.5h6V9"/>',
  ropeway: '<path d="M3 4.5 21 8.5M12 6.5v3.5"/><rect x="7.5" y="10" width="9" height="8" rx="2"/><path d="M7.5 14h9"/>',
  taxi: '<path d="M5 15.5V12l2-4.5h10l2 4.5v3.5H5z"/><path d="M10 7.5V5.5h4v2M5 15.5v2.5M19 15.5v2.5"/><circle cx="8" cy="13.2" r=".7"/><circle cx="16" cy="13.2" r=".7"/>',
  shinkansen: '<path d="M3 16.5h15c2 0 3-1.5 3-3s-2-3.5-6-4.5L6 7.5H3z"/><path d="M3 11h10M7 19.5h10"/>',
  food: '<path d="M7 3.5v7.5M4.5 3.5v4.5a2.5 2.5 0 0 0 5 0V3.5M7 11v9.5M17 3.5c-2 1.5-2.8 4-2.8 7h2.8v9.5"/>',
  cafe: '<path d="M4.5 9.5h12v4.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9.5z"/><path d="M16.5 11h1.5a2.3 2.3 0 0 1 0 4.6h-1.8M8 3.5c-.8 1 .8 2-.1 3.2M12 3.5c-.8 1 .8 2-.1 3.2"/>',
  sweets: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M8 7.5l.7.6M15.5 8.3l.6-.8M16.7 13.8l.8.4M7 14.6l-.8.3"/>',
  shop: '<path d="M4 9.5 5.5 4.5h13L20 9.5"/><path d="M4 9.5c0 1.6 1.3 2.5 2.7 2.5S9.3 11 9.3 9.5c0 1.6 1.3 2.5 2.7 2.5s2.7-.9 2.7-2.5c0 1.6 1.3 2.5 2.6 2.5S20 11 20 9.5M5.5 12v8.5h13V12M10 20.5v-5h4v5"/>',
  view: '<path d="m2.5 19.5 6-9 4 5.5 3-3.5 6 7z"/><circle cx="17" cy="6.5" r="2.2"/>',
  shrine: '<path d="M3 6.5h18M4.5 4c2.5.9 12.5.9 15 0M6.5 6.5v14M17.5 6.5v14M5 10.5h14"/>',
  history: '<path d="M3.5 9 12 4l8.5 5M5 9v9M9.7 9v9M14.3 9v9M19 9v9M3.5 20h17"/>',
  library: '<path d="M4 5.5c3-1.3 5.5-1 8 .8 2.5-1.8 5-2.1 8-.8v13c-3-1.3-5.5-1-8 .8-2.5-1.8-5-2.1-8-.8z"/><path d="M12 6.3v13"/>',
  // 道場: 交差した2本の刀（反った刃、鍔、柄）。2026-11-10 の依頼で、和風の門から変更
  dojo: '<path d="M19.5 3c-2.6 4.6-6 8.2-10.2 10.8M7.6 12.2l3.4 3.4M9.3 13.9 4 19.2M4.5 3c2.6 4.6 6 8.2 10.2 10.8M16.4 12.2 13 15.6M14.7 13.9l5.3 5.3"/>',
  station: '<rect x="6" y="3.5" width="12" height="12" rx="3"/><path d="M6 10h12M9 19.5l1.5-3.5M15 19.5l-1.5-3.5"/>',
  stay: '<path d="M3.5 18.5v-9M3.5 14.5h17v4M20.5 14.5V12a2.5 2.5 0 0 0-2.5-2.5h-6.5v5"/><circle cx="7.5" cy="11.5" r="1.8"/>',
  school: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v5c3 2.5 8 2.5 11 0v-5"/>',
  god: '<path d="M7 11.5V6a1.5 1.5 0 0 1 3 0v4.5M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9a1.5 1.5 0 0 1 3 0v4.5c0 4-2.5 7-6.5 7-3 0-4.7-1.4-6-3.8L4.5 13a1.5 1.5 0 0 1 2.6-1.5l1 1.5"/>',
  meetIcon: '<circle cx="8" cy="9" r="3.2"/><circle cx="16.5" cy="9" r="3.2"/><path d="M2.5 19.5c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6M12.5 16c.9-.7 2.3-1.1 4-1.1 2.5 0 4.7 1.6 5.5 4.6"/>',
  poster: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/>',
  camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  cloud: '<path d="M7 18.5a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-1.2A4.4 4.4 0 0 1 17.5 18.5z"/>',
  rain: '<path d="M7 14.5a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-1.2 4.4 4.4 0 0 1 .4 9.2z"/><path d="M8.5 17.5 7.5 20M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>',
  moon: '<path d="M18.5 14.5A7.5 7.5 0 0 1 9.5 5.5a7.5 7.5 0 1 0 9 9z"/>',
  report: '<path d="M5 20.5V4.5M5 5h11l-2 3.5 2 3.5H5"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6"/>',
  book: '<path d="M5 4.5h11.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z"/><path d="M5 17.5a2 2 0 0 1 2-2h11.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 14h9l1-14"/>',
  think: '<circle cx="12" cy="10" r="6.5"/><circle cx="6" cy="19" r="1.5"/><circle cx="3.5" cy="21.5" r=".8"/>',
  flag: '<path d="M5 21V4M5 4.5c4-2 7 2 13 0v9c-6 2-9-2-13 0"/>',
  sort: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>',
  layers: '<path d="m12 3.5 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  out: '<path d="M14 4.5h5.5v15H14M10 8l-4 4 4 4M6 12h10"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  sparkle: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  swap: '<path d="M4 8.5h13.5M14 5l3.5 3.5L14 12M20 15.5H6.5M10 12l-3.5 3.5L10 19"/>',
  door:'<path d="M5 20.5h14M7 20.5V3.5h10v17"/><circle cx="14" cy="12" r=".9"/>',
};

/** アイコンのSVG文字列 */
export function icon(name, cls = '') {
  const body = P[name] || P.pin;
  const fill = name === 'star' || name === 'heart' || name === 'play' || name === 'feet';
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
/** 場所の種類のアイコン名 */
export function catIcon(cat) { return P[cat] ? cat : 'pin'; }
/** 移動手段のアイコン名 */
export function modeIcon(mode) {
  return { walk: 'walk', taxi: 'taxi', train: 'train', subway: 'train', bus: 'bus', ferry: 'ferry', ropeway: 'ropeway', shinkansen: 'shinkansen' }[mode] || 'walk';
}
export function weatherIcon(w, hour) { if (w === 'rain') return 'rain'; if (w === 'cloud') return 'cloud'; return hour >= 18 || hour < 5 ? 'moon' : 'sun'; }
