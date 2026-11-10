// public/js/core.js
// 画面の共通部品: サーバとの通信、状態、要素の組み立て、日時の書き方。

export const app = { state: null, view: null, cleanups: [] };

/*
 * 要素に子を足すとき（append / prepend / replaceChildren / before / after）、null や undefined や false は足さない。
 * ブラウザの標準では、これらを渡すと「null」という文字がそのまま画面に出てしまう
 * （例: 条件しだいで出す部品を `cond ? 部品 : null` と書いたとき）。2026-11-10、カレンダーに「null」と出ていたため。
 */
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const name of ['append', 'prepend', 'replaceChildren', 'before', 'after']) {
    const orig = proto[name];
    if (!orig || orig.__noNull) continue;
    const wrapped = function (...nodes) { return orig.apply(this, nodes.filter(n => n !== null && n !== undefined && n !== false)); };
    wrapped.__noNull = true;
    proto[name] = wrapped;
  }
}

/** サーバのAPIを呼ぶ（JSON） */
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) { const e = new Error((data && data.error) || '通信に失敗しました'); e.status = res.status; e.data = data; throw e; }
  return data;
}

export async function loadState() { app.state = await api('/api/state'); return app.state; }

/**
 * 要素を作る。h('div.card.big', { onclick, 'aria-label': '…' }, [子, '文字'])
 * 文字は textContent で入れる（HTMLとして解釈しない）。SVGアイコンなど信頼できるHTMLは { html } で渡す。
 */
/** HTML として入れる文字の特殊記号を無害にする（地図のツールチップなど、HTML の文字列しか受け取らない所で使う） */
export const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function h(tag, attrs = {}, children = []) {
  const [name, ...classes] = tag.split('.');
  let id = null; let el;
  const n = name.includes('#') ? name.split('#') : [name];
  if (n[1]) id = n[1];
  el = document.createElement(n[0] || 'div');
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  if (attrs === null || typeof attrs !== 'object' || Array.isArray(attrs) || attrs instanceof Node) { children = attrs; attrs = {}; }
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

/* ---- 日時 ---- */
const JST = 9 * 3600000;
const jst = ms => new Date(ms + JST);
export const hm = ms => { const d = jst(ms); return `${d.getUTCHours()}時${String(d.getUTCMinutes()).padStart(2, '0')}分`; };
export const hhmm = ms => { const d = jst(ms); return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
export const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function md(day) { const d = new Date(day + 'T00:00:00Z'); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; }
export function mdw(day) { const d = new Date(day + 'T00:00:00Z'); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WD[d.getUTCDay()]}）`; }
export function dayKey(ms) { return jst(ms).toISOString().slice(0, 10); }
export function addDays(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const minuteOfDay = ms => { const d = jst(ms); return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60; };
export const fmtNum = n => Math.round(n).toLocaleString('ja-JP');
export const km = m => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);
export const mins = m => { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + '分' : ''}` : `${m}分`; };

/* ---- 状態の補助 ---- */
export const charById = id => (app.state.characters || []).find(c => c.id === id);
export const workById = id => (app.state.works || []).find(w => w.id === id);
export const areaById = id => (app.state.areas || []).find(a => a.id === id);

/** 画面を離れるときに片付ける処理を登録する */
export function onLeave(fn) { app.cleanups.push(fn); }
export function runCleanups() { const list = app.cleanups.splice(0); for (const f of list) { try { f(); } catch (e) { console.error(e); } } }

/** 小さなお知らせ */
export function toast(text) {
  const t = h('div.toast', { role: 'status' }, text);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2600);
}

export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isWide = () => window.matchMedia('(min-width: 900px)').matches;
