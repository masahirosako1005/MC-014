// public/js/views/settings.js
// ⑥設定（#/settings）、プロフィール（#/profile）、解釈違いの報告（#/report）。
// ログインは前面に出さず、プロフィール画面の一番下の控えめなボタンだけにする。
// プロフィールは呼び名（任意）、好きなもの、歩ける量の3つ。個人を特定できる項目は持たない。

import { app, api, h, loadState, toast, charById } from '../core.js';
import { icon } from '../icons.js';
import { avatar } from '../avatar.js';
import { openSheet } from '../sheet.js';
import { showGuide } from '../guide.js';
import { applySettings } from '../main.js';

export async function render(view, route) {
  if (route.name === 'profile') return profile(view);
  if (route.name === 'report') return report(view, route.query);
  const s = app.state.settings;
  const row = (ic, title, sub, onclick, href) => (href ? h('a.set-row', { href }, [h('span', { html: icon(ic) }), h('span.grow', [title, sub ? h('small', sub) : null]), h('span', { html: icon('right') })])
    : h('button.set-row', { onclick }, [h('span', { html: icon(ic) }), h('span.grow', [title, sub ? h('small', sub) : null]), h('span', { html: icon('right') })]));
  const choose = (key, title, options) => {
    const wrap = h('div.panel', [h('h4', title), h('div.gap'), h('div.chips', options.map(([v, label]) => h('button.chip', { 'aria-pressed': String(s[key] === v), onclick: async () => { await api('/api/settings', { method: 'PUT', body: { [key]: v } }); await loadState(); applySettings(); render(view.replaceChildren() || view, route); } }, label)))]);
    return wrap;
  };
  view.append(
    h('h1.page-title', [h('span', { html: icon('settings') }), '設定']),
    h('div.set-list', [
      row('user', 'わたしのこと（プロフィール）', '推しが観光ルートを考えるときに使います', null, '#/profile'),
      row('report', '解釈違いを報告する', '推しのキャラクター性についての意見を送れます', null, '#/report'),
    ]),
    h('div.set-group', [h('h3', '表示'), h('div.set-list', [
      choose('mapStyle', '地図の種類', [['photo', '写真'], ['pale', '淡色'], ['std', '標準']]),
      choose('timelineOrder', 'タイムラインの順番', [['asc', '古い順'], ['desc', '新しい順']]),
      choose('meetOrder', '旅先で出会った推しの並び', [['desc', '新しい順'], ['asc', '古い順']]),
      choose('fontSize', '文字の大きさ', [['normal', 'ふつう'], ['large', '大きい']]),
    ])]),
    h('div.set-group', [h('h3', 'デモ'), h('div.set-list', [
      h('button.set-row', { onclick: async () => { await api('/api/demo/unlock-all', { method: 'POST', body: {} }); await loadState(); toast('すべてのキャラとエリアを獲得しました（90日前に獲得した扱い）'); } }, [h('span', { html: icon('sparkle') }), h('span.grow', ['すべてのキャラとエリアを獲得する', h('small', '審査用。90日前に獲得した扱いになり、足あとが溜まった状態を見られます')])]),
      h('button.set-row', { onclick: async () => { if (!confirm('獲得状況、観光ルート、設定を消して最初からやり直します。プロフィールとIDは残ります。よろしいですか？')) return; await api('/api/reset', { method: 'POST', body: {} }); await loadState(); applySettings(); location.hash = '#/home'; toast('最初からやり直しました'); } }, [h('span', { html: icon('trash') }), h('span.grow', ['最初からやり直す', h('small', '獲得状況、観光ルート、設定を消します')])]),
    ])]),
    h('div.set-group', [h('h3', 'このアプリ'), h('div.set-list', [
      row('book', 'アプリの説明', '使い方をもう一度見る', () => showGuide(false)),
      h('a.set-row', { href: 'https://app.raund.net/nttw-demo/', target: '_blank', rel: 'noopener' }, [h('span', { html: icon('link') }), h('span.grow', ['スタンプラリーへ', h('small', 'ミニ推しのもとになったスタンプラリーのサイトを開きます')])]),
    ])]),
    h('p.note-box', '地図は国土地理院の地図を使っています。天気、行動、観光ルートの文章は、アプリの中で作った創作です。実在の店舗や施設はデモとして掲載しており、営業時間などはリンク先で確かめてください。'),
  );
}

/* ---------------------------------------------------------------- プロフィール */
function profile(view) {
  const st = app.state; const p = st.profile;
  let likes = new Set(p.likes || []); let walk = p.walk || 'normal';
  const nick = h('input', { type: 'text', maxlength: '20', value: p.nickname || '', placeholder: '例: たびびと', autocomplete: 'off', 'aria-label': '呼び名' });
  const likeBox = h('div.chips'); const walkBox = h('div.chips');
  const draw = () => {
    likeBox.replaceChildren(...st.options.likes.map(l => h('button.chip', { 'aria-pressed': String(likes.has(l)), onclick: () => { likes.has(l) ? likes.delete(l) : likes.add(l); draw(); } }, l)));
    walkBox.replaceChildren(...st.options.walk.map(w => h('button.chip', { 'aria-pressed': String(walk === w.id), onclick: () => { walk = w.id; draw(); } }, w.label)));
  };
  draw();
  const save = h('button.btn.btn-wide', { onclick: async () => { try { await api('/api/profile', { method: 'PUT', body: { nickname: nick.value, likes: [...likes], walk } }); await loadState(); toast('保存しました'); } catch (e) { toast(e.message); } } }, [h('span', { html: icon('check') }), '保存する']);
  view.append(
    h('a.btn.btn-white.btn-small', { href: '#/settings' }, [h('span', { html: icon('left') }), '設定']), h('div.gap'),
    h('h1.page-title', [h('span', { html: icon('user') }), 'わたしのこと']),
    h('p.muted', '推しがあなたのために観光ルートを考えるときに使います。'),
    h('div.panel.form-grid', [
      h('div.field', [h('label', '呼び名（なくてもかまいません）'), nick, h('p.muted.small', '本名は入れないでください。空のときは「あなた」と書きます。')]),
      h('div.field', [h('span.lbl', '好きなもの'), likeBox]),
      h('div.field', [h('span.lbl', '歩ける量'), walkBox]),
      save,
    ]),
    h('div.login-mini', [st.user.loggedIn ? h('p.small.muted', `ID: ${st.user.loginId} でログインしています`) : null,
      h('button', { onclick: openLogin }, st.user.loggedIn ? 'ログアウト' : 'ログイン・IDの登録')]),
  );
}
function openLogin() {
  const st = app.state;
  if (st.user.loggedIn) {
    const body = h('div', [h('p', 'ログアウトすると、この端末は新しい状態から始まります。登録した内容は、もう一度ログインすれば戻ります。'), h('div.gap'),
      h('button.btn.btn-wide', { onclick: async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); await loadState(); location.hash = '#/home'; location.reload(); } }, 'ログアウトする')]);
    return openSheet({ title: 'ログアウト', content: body });
  }
  let mode = 'signup';
  const id = h('input', { type: 'text', autocomplete: 'username', maxlength: '20', 'aria-label': 'ID（半角英数字）' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', maxlength: '64', 'aria-label': 'パスワード（8文字以上）' });
  const msg = h('p.form-msg', { role: 'alert' });
  const seg = h('div.seg', [h('button', { 'aria-pressed': 'true' }, 'IDを登録'), h('button', { 'aria-pressed': 'false' }, 'ログイン')]);
  const submit = h('button.btn.btn-wide', 'IDを登録する');
  const setMode = m => { mode = m; seg.children[0].setAttribute('aria-pressed', String(m === 'signup')); seg.children[1].setAttribute('aria-pressed', String(m === 'login')); submit.textContent = m === 'signup' ? 'IDを登録する' : 'ログインする'; pw.autocomplete = m === 'signup' ? 'new-password' : 'current-password'; };
  seg.children[0].onclick = () => setMode('signup'); seg.children[1].onclick = () => setMode('login');
  submit.addEventListener('click', async () => {
    msg.textContent = '';
    try {
      await api(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body: { loginId: id.value.trim(), password: pw.value } });
      await loadState(); s.close(); toast(mode === 'signup' ? 'IDを登録しました' : 'ログインしました'); location.hash = '#/home';
    } catch (e) { msg.textContent = e.message; }
  });
  const s = openSheet({ title: 'ログイン', content: h('div.form-grid', [
    h('p.small', 'ログインしなくても使えます。IDを登録すると、データが保存されて、別の端末でも同じ内容を使えるようになります（今は同じサーバに接続できる端末どうしのみ）。'),
    seg,
    h('div.field', [h('label', 'ID（半角英数字4〜20文字。メールアドレスは使えません）'), id]),
    h('div.field', [h('label', 'パスワード（8文字以上）'), pw]),
    msg, submit,
  ]) });
}

/* ---------------------------------------------------------------- 解釈違いの報告 */
function report(view, q) {
  const st = app.state;
  let charId = q.c || st.selectedCharacterId; let kind = null;
  const caution = h('div.note-box', [
    h('p', 'ミニ推しのキャラクター性は公式が判断するものです。いただいた意見が必ず反映されるわけではありません。'),
    h('p', '個別のお返事はしていません。'),
    h('p', 'お名前や連絡先など、個人を特定できることは書かないでください。'),
  ]);
  const charBox = h('div.chips'); const kindBox = h('div.chips');
  const where = h('input', { type: 'text', maxlength: '100', placeholder: '例: ホームのタイムライン、11月9日の日記', 'aria-label': 'どこで見たか' });
  const text = h('textarea', { maxlength: '1000', placeholder: 'どんなところが解釈違いだと感じたかを教えてください（5〜1000文字）', 'aria-label': '内容' });
  const count = h('p.muted.small', '0 / 1000');
  text.addEventListener('input', () => { count.textContent = `${text.value.length} / 1000`; });
  const msg = h('p.form-msg', { role: 'alert' });
  const draw = () => {
    charBox.replaceChildren(...st.characters.map(c => h('button.chip', { 'aria-pressed': String(charId === c.id), onclick: () => { charId = c.id; draw(); } }, [avatar(c, 22), c.short])));
    kindBox.replaceChildren(...st.options.reportKinds.map(k => h('button.chip', { 'aria-pressed': String(kind === k), onclick: () => { kind = k; draw(); } }, k)));
  };
  draw();
  const send = h('button.btn.btn-wide', [h('span', { html: icon('report') }), '送る']);
  send.addEventListener('click', async () => {
    msg.textContent = '';
    if (!kind) { msg.textContent = 'どんな解釈違いかを選んでください'; return; }
    try {
      await api('/api/reports', { method: 'POST', body: { characterId: charId, kind, where: where.value, text: text.value } });
      view.replaceChildren(h('div.panel', [h('h2', '受け取りました'), h('div.gap'), caution.cloneNode(true), h('div.gap'), h('a.btn', { href: '#/settings' }, '設定に戻る')]));
    } catch (e) { msg.textContent = e.message; }
  });
  view.append(
    h('a.btn.btn-white.btn-small', { href: '#/settings' }, [h('span', { html: icon('left') }), '設定']), h('div.gap'),
    h('h1.page-title', [h('span', { html: icon('report') }), '解釈違いを報告する']),
    caution,
    h('div.panel.form-grid', [
      h('div.field', [h('span.lbl', '推し'), charBox]),
      h('div.field', [h('span.lbl', 'どんな解釈違い？'), kindBox]),
      h('div.field', [h('label', 'どこで見たか（なくてもかまいません）'), where]),
      h('div.field', [h('label', '内容'), text, count]),
      msg, send,
    ]),
    h('p.muted.small', '報告は外部のサービスには送らず、このアプリのサーバに保存し、運営が確認します。'),
  );
}
