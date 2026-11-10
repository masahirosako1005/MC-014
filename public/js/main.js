// public/js/main.js
// タブの切り替え（URLの # で画面を選ぶ）。
//   #/home  #/meet  #/oshi  #/oshi/:id  #/routes  #/route/new  #/route/:id  #/areas  #/settings  #/profile  #/report  #/recommend

import { app, loadState, h, clear, runCleanups, toast } from './core.js';
import { icon } from './icons.js';
import { closeAllSheets } from './sheet.js';
import { maybeShowGuide } from './guide.js';

const VIEWS = {
  home: () => import('./views/home.js'),
  meet: () => import('./views/meet.js'),
  oshi: () => import('./views/oshi.js'),
  routes: () => import('./views/routes.js'),
  route: () => import('./views/route.js'),
  areas: () => import('./views/areas.js'),
  settings: () => import('./views/settings.js'),
  profile: () => import('./views/settings.js'),
  report: () => import('./views/settings.js'),
  recommend: () => import('./views/recommend.js'),
};
const TAB_OF = { route: 'routes', profile: 'settings', report: 'settings' };

// タブのアイコン
for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);

export function parseHash() {
  const raw = (location.hash || '#/home').slice(2);
  const [pathPart, query = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'home', params: parts.slice(1), query: Object.fromEntries(new URLSearchParams(query)) };
}
export function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

let seq = 0;
async function render() {
  const my = ++seq;
  const route = parseHash();
  const name = VIEWS[route.name] ? route.name : 'home';
  runCleanups();
  closeAllSheets();
  const tab = TAB_OF[name] || name;
  for (const a of document.querySelectorAll('.tabs a')) a.toggleAttribute('aria-current', a.dataset.tab === tab), a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  const view = document.getElementById('view');
  view.className = '';
  clear(view);
  try {
    const mod = await VIEWS[name]();
    if (my !== seq) return;
    await mod.render(view, { ...route, name });
  } catch (e) {
    console.error(e);
    if (my !== seq) return;
    view.append(h('div.panel', [h('p', '画面を表示できませんでした。'), h('p.muted.small', e.message)]));
  }
}

function applySettings() {
  const s = app.state.settings || {};
  document.documentElement.dataset.font = s.fontSize || 'normal';
}
export { applySettings };

async function boot() {
  try { await loadState(); } catch (e) { document.getElementById('view').append(h('div.panel', 'サーバに接続できませんでした。')); return; }
  applySettings();
  window.addEventListener('hashchange', render);
  await render();
  maybeShowGuide();
}
boot();

// 画面のどこからでも使えるように
window.miniOshi = { go, toast };
