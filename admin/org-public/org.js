// admin/org-public/org.js
// 自治体・団体の管理画面。担当のエリアとキャラクターに関わるものだけを扱う。
// キャラクターの変更は申請として送り、事務局の承認後にアプリへ反映される。

const $ = s => document.querySelector(s);
const main = $('#main');
const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dt = ms => new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
let me = null;

async function api(path, opts = {}) {
  const res = await fetch('/org/api' + path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('ログインしてください'); }
  if (!res.ok) throw new Error(data.error || '失敗しました');
  return data;
}
function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = new FormData(e.target);
  try { await api('/login', { method: 'POST', body: { loginId: f.get('loginId'), password: f.get('password') } }); await boot(); }
  catch (er) { $('#loginMsg').textContent = er.message; }
});
$('#logout').addEventListener('click', async () => { await api('/logout', { method: 'POST', body: {} }); showLogin(); });

/** 推しの顔（絵があれば絵、なければ色の丸） */
function face(look, big) {
  const el = document.createElement('span');
  el.className = 'face' + (big ? ' big' : '');
  if (look && look.image) el.style.backgroundImage = `url("/${look.image}")`;
  else el.style.background = `radial-gradient(circle at 50% 38%, #fde7d4 0 30%, ${(look && look.hair) || '#333'} 31% 52%, ${(look && look.color) || '#007190'} 53%)`;
  if (look && look.image && look.crop) {
    // ありさのキービジュアル（切り抜き）
    const [x, y, w] = look.crop; const [IW, IH] = look.size || [750, 480]; // 枠線があっても見切れないよう、割合で指定する
    el.style.backgroundSize = `${IW / w * 100}% ${IH / w * 100}%`; el.style.backgroundPosition = `${x / (IW - w) * 100}% ${y / (IH - w) * 100}%`;
  }
  return el;
}
const stat = (k, v) => `<div class="card stat"><span class="muted">${esc(k)}</span><b>${esc(v)}</b></div>`;

const PAGES = {
  async dashboard() {
    const d = await api('/dashboard');
    main.innerHTML = `<h2>ダッシュボード</h2>
      <p class="muted">担当: ${me.areaList.map(a => esc(a.name)).join('、')} ／ ${me.characterList.map(c => esc(c.name)).join('、')}</p>
      <div class="grid">${stat('担当コードの使用回数', d.codeUses)}${stat('担当コードの数', d.codes)}${stat('担当エリアの観光ルート', d.routes)}${stat('未来の日付のルート（再訪の意思）', d.future)}
      ${stat('イベントを含むルート', d.withEvent)}${stat('これからのイベント', d.upcomingEvents)}${stat('確認待ちの申請', d.pending)}${stat('未読の解釈違いの報告', d.unreadReports)}</div>
      <div class="two"><div class="card"><h3>推しを獲得した利用者</h3><ul>${d.characters.map(c => `<li>${esc(c.name)}：${c.users}人</li>`).join('')}</ul></div>
      <div class="card"><h3>エリアを獲得した利用者</h3><ul>${d.areas.map(a => `<li>${esc(a.name)}：${a.users}人</li>`).join('')}</ul></div></div>`;
  },

  async characters() {
    const d = await api('/characters');
    main.innerHTML = `<h2>キャラクター</h2><p class="muted">紹介、性格、好きなもの、日常、作中の出来事、場所の種類への関心、絵を変えられます。変更は事務局に申請され、承認されるとアプリに反映されます。</p><div class="char-grid"></div>`;
    const grid = main.querySelector('.char-grid');
    for (const c of d.characters) {
      const card = document.createElement('div'); card.className = 'card char-card';
      card.append(face(c.look));
      const t = document.createElement('div');
      t.innerHTML = `<b>${esc(c.name)}</b><br><span class="muted">${esc(c.work)}</span><br>${c.pending ? `<span class="pill warn">確認待ち ${c.pending}件</span>` : ''}`;
      card.append(t);
      card.addEventListener('click', () => editCharacter(c, d.categories));
      grid.append(card);
    }
  },

  async codes() {
    const cs = await api('/codes');
    const opts = [...me.characterList.map(c => `<option value="character|${esc(c.id)}">キャラ: ${esc(c.name)}</option>`), ...me.areaList.map(a => `<option value="area|${esc(a.id)}">エリア: ${esc(a.name)}</option>`)].join('');
    main.innerHTML = `<h2>獲得コードとQRコード</h2>
      <p class="muted">スタンプラリーの会場やスポットに掲示するコードです。利用者は「出会う」のコード入力かQRコードの読み取りで、推しやエリアを獲得します。</p>
      <div class="card"><h3>コードを発行する</h3><div class="row"><select id="ctgt">${opts}</select><input id="cplace" placeholder="掲示する場所（例: 三原駅 観光案内所）" size="28"><input id="ccode" placeholder="コード（空なら自動）" size="22"><button id="cadd">発行</button></div></div>
      <div class="row no-print"><button class="sub" id="cprint">掲示用の一覧を印刷</button></div>
      <table><tr><th>QR</th><th>コード</th><th>獲得できるもの</th><th>掲示する場所</th><th>使用回数</th><th>有効</th><th></th></tr>${cs.map(c => `<tr>
        <td><img class="thumb" alt="" src="/org/api/codes/${encodeURIComponent(c.code)}/qr.png?size=200"></td>
        <td><b>${esc(c.code)}</b></td><td>${esc(c.target)}</td>
        <td><input data-place="${esc(c.code)}" value="${esc(c.place)}" size="22"></td><td>${c.uses}</td>
        <td><input type="checkbox" data-code="${esc(c.code)}" ${c.enabled ? 'checked' : ''}></td>
        <td><a class="dl" href="/org/api/codes/${encodeURIComponent(c.code)}/qr.png?size=1000&download=1" download>QRをダウンロード</a></td></tr>`).join('')}</table>`;
    $('#cadd').onclick = async () => { const [type, id] = $('#ctgt').value.split('|'); try { const r = await api('/codes', { method: 'POST', body: { type, id, code: $('#ccode').value, place: $('#cplace').value } }); alert('発行しました: ' + r.code); PAGES.codes(); } catch (e) { alert(e.message); } };
    main.querySelectorAll('[data-code]').forEach(i => i.onchange = () => api('/codes/' + encodeURIComponent(i.dataset.code), { method: 'PUT', body: { enabled: i.checked } }));
    main.querySelectorAll('[data-place]').forEach(i => i.onchange = () => api('/codes/' + encodeURIComponent(i.dataset.place), { method: 'PUT', body: { place: i.value } }));
    $('#cprint').onclick = () => printSheet(cs.filter(c => c.enabled));
  },

  async events() {
    const es = await api('/events');
    const areaOpts = me.areaList.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
    main.innerHTML = `<h2>イベント</h2><p class="muted">担当エリアのイベントは、アプリのカレンダーに出て、推しの行動（会場に行く、駅でポスターを見る）にも反映されます。日程が公式に決まっていないものは「予定」にしてください。</p>
      <table><tr><th>題と説明</th><th>会場の場所ID</th><th>日程</th><th>種類</th><th>推しの関心</th><th></th></tr>${es.map(e => `<tr data-id="${esc(e.id)}">
      <td><input name="title" value="${esc(e.title)}" size="22"><br><textarea name="desc">${esc(e.desc)}</textarea><input name="url" value="${esc(e.url || '')}" size="30" placeholder="https://"></td>
      <td>${esc((me.areaList.find(a => a.id === e.area) || {}).name)}<br><input name="placeId" value="${esc(e.placeId || '')}" size="14"></td>
      <td><input name="start" value="${esc(e.start)}" size="10">〜<input name="end" value="${esc(e.end)}" size="10"><br><label><input type="checkbox" name="tentative" ${e.tentative ? 'checked' : ''}>予定（未確定）</label><label><input type="checkbox" name="hidden" ${e.hidden ? 'checked' : ''}>非公開</label></td>
      <td><input name="tags" value="${esc((e.tags || []).join(','))}" size="14"></td>
      <td>${e.reactions.map(r => `<span class="pill ${r.interest >= 0.7 ? 'warn' : ''}">${esc(r.name)} ${r.interest}</span>`).join(' ')}</td>
      <td><button data-save>保存</button> <button class="sub" data-del>削除</button></td></tr>`).join('')}</table>
      <h3>追加</h3><div class="row"><input id="et" placeholder="題"><select id="ea">${areaOpts}</select><input id="es" type="date"><input id="ee" type="date"><input id="eg" placeholder="種類（photo, food, history など）"><button id="eadd">追加</button></div>`;
    main.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => { const tr = b.closest('tr'); const f = fields(tr); try { await api('/events/' + tr.dataset.id, { method: 'PUT', body: f }); alert('保存しました'); } catch (e) { alert(e.message); } });
    main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('削除しますか？')) return; await api('/events/' + b.closest('tr').dataset.id, { method: 'DELETE' }); PAGES.events(); });
    $('#eadd').onclick = async () => { try { await api('/events', { method: 'POST', body: { title: $('#et').value, area: $('#ea').value, start: $('#es').value, end: $('#ee').value, tags: $('#eg').value } }); PAGES.events(); } catch (e) { alert(e.message); } };
  },

  async places() {
    // 担当エリアの地図。実在の場所は自動で集め、スポット（アニメの聖地など）は地図を押して足す（admin/shared/mapedit.js）
    const { mountMapEditor } = await import('/shared/mapedit.js');
    main.innerHTML = '<h2>場所</h2><p class="muted">実在の場所は「実在の場所を集める」で、国土地理院の地図から自動で集まります。アニメの聖地などのスポットは「場所を置く」で地図を押して足せます。足した場所はすぐにアプリに反映され、推しが立ち寄るようになります。</p><div id="me"></div>';
    mapEditor = mountMapEditor(document.getElementById('me'), { api, admin: false });
  },

  async reports() {
    const rs = await api('/reports');
    const st = { unread: '未読', checked: '確認済み', shared: '公式に共有' };
    main.innerHTML = `<h2>解釈違いの報告</h2><p class="muted">担当キャラクターについて利用者から届いた意見です。キャラクター性は作品の公式が判断するため、反映するかは事務局・公式と相談して決めます。</p>${rs.length ? `<table><tr><th>日時</th><th>推し</th><th>種類</th><th>どこで</th><th>内容</th><th>状態</th></tr>${rs.map(r => `<tr class="${r.status}"><td>${dt(r.at)}</td><td>${esc(r.characterName)}</td><td>${esc(r.kind)}</td><td>${esc(r.where)}</td><td>${esc(r.text)}</td>
      <td><select data-id="${esc(r.id)}">${Object.entries(st).map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}</table>` : '<p>まだ報告はありません。</p>'}`;
    main.querySelectorAll('select[data-id]').forEach(s => s.onchange = async () => { await api('/reports/' + s.dataset.id, { method: 'PUT', body: { status: s.value } }); PAGES.reports(); });
  },

  async requests() {
    const rs = await api('/requests');
    const st = { pending: '確認待ち', approved: '承認・反映済み', rejected: '差し戻し' };
    main.innerHTML = `<h2>申請の履歴</h2>${rs.length ? `<table><tr><th>申請日時</th><th>キャラクター</th><th>変える項目</th><th>メモ</th><th>状態</th><th>事務局から</th></tr>${rs.map(r => `<tr class="status-${r.status}"><td>${dt(r.createdAt)}</td><td>${esc(r.characterName)}</td>
      <td>${[...Object.keys(r.character), ...Object.keys(r.canon)].map(k => `<span class="pill">${esc(LABEL[k] || k)}</span>`).join(' ')}</td><td>${esc(r.note)}</td><td>${st[r.status]}</td><td>${esc(r.comment)}${r.reviewedAt ? '<br><span class="muted">' + dt(r.reviewedAt) + '</span>' : ''}</td></tr>`).join('')}</table>` : '<p>まだ申請はありません。</p>'}`;
  },

  async account() {
    main.innerHTML = `<h2>アカウント</h2><div class="card form"><p>${esc(me.name)}（ログインID: ${esc(me.loginId)}）</p>
      <label>今のパスワード <input type="password" id="pc" autocomplete="current-password"></label>
      <label>新しいパスワード（10文字以上） <input type="password" id="pn" autocomplete="new-password"></label>
      <button id="pchg">パスワードを変える</button><p class="err" id="pmsg"></p></div>
      <p class="muted">担当のエリアとキャラクターの変更、アカウントの追加は事務局に依頼してください。</p>`;
    $('#pchg').onclick = async () => { try { await api('/account/password', { method: 'PUT', body: { current: $('#pc').value, next: $('#pn').value } }); $('#pmsg').textContent = ''; alert('変更しました'); } catch (e) { $('#pmsg').textContent = e.message; } };
  },
};

const LABEL = { tagline: '紹介', interests: '関心', look: '見た目・絵', stride: '歩幅', speed: '分速', vehicle: '乗り物好き', curiosity: '好奇心', range: '距離の許容', ng: 'NG行動', profile: 'プロフィール', personality: '性格', likes: '好きなもの', dislikes: '苦手なもの', commute: 'いつもの道', episodes: '作中の出来事', relations: '関係' };

/* ---- キャラクターの編集（申請） ---- */
const numRow = (id, label, min, max, step, v) => `<label>${label}<input type="range" data-num="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><input type="number" class="numv" data-numv="${id}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
function editCharacter(c, cats) {
  const cn = c.canon;
  const lines = a => (a || []).join('\n');
  const pairs = a => (a || []).map(([k, v]) => `${k}：${v}`).join('\n');
  const eps = a => (a || []).map(e => `${e.title}｜${e.text}`).join('\n');
  let image = c.look && c.look.image && !c.look.crop ? c.look.image : null; let imageChanged = false;
  main.innerHTML = `<h2>${esc(c.name)} のカスタマイズ</h2>
    <p class="notice">ここで変えた内容は事務局に申請され、承認されるとアプリに反映されます。推しは喋らない設定なので、台詞や吹き出しの言葉は書かないでください。</p>
    <div class="form">
      <div class="card"><h3>絵</h3><div class="row"><span id="facePrev"></span>
        <label>絵の画像ファイル（PNG / JPEG / WebP、1.5MBまで。正方形がおすすめ） <input type="file" id="img" accept="image/png,image/jpeg,image/webp"></label></div>
        <p class="muted">アプリでは、丸く切り抜いて表示します。絵の権利は申請する側で確認してください。</p></div>
      <div class="card rag-card"><h3>設定資料（RAG） <span class="pill">デモではダミー</span></h3>
        <p class="muted">キャラクターの設定書、作品のあらすじ、公式のプロフィールなどを登録しておくと、下の「AIにおまかせ」が資料の中から関係のある部分を探して参照し、パラメータと特徴を作ります。テキスト（.txt）、Markdown（.md）、CSV、JSON に対応（1ファイル200KBまで）。</p>
        <div class="row"><input type="file" id="ragFile" accept=".txt,.md,.markdown,.csv,.json,text/plain,text/markdown"><span class="muted">または</span><button class="sub" id="ragPasteBtn" type="button">文章を貼りつけて登録</button></div>
        <div id="ragPaste" class="hidden"><label>資料の名前 <input id="ragName" placeholder="例: 公式設定書 第2版"></label><label>資料の中身 <textarea id="ragText" rows="6"></textarea></label><button id="ragAdd" type="button">登録する</button></div>
        <ul id="ragDocs" class="rag-docs"></ul></div>
      <div class="card ai-card"><h3>AIにおまかせ <span class="pill">デモではダミー</span></h3>
        <label>どんな推しですか？（性格、好きなこと、苦手なこと、歩き方、乗り物の好み、しないこと。設定資料があれば空でもかまいません） <textarea id="persona" rows="4" placeholder="例: のんびり屋で甘いものが大好き。カフェで本を読むのが好き。坂は苦手で、お酒の店には絶対に入らない。夜は出歩かない。"></textarea></label>
        <div class="row"><button id="suggest" type="button">AIにパラメータを決めてもらう</button><span class="muted">下の「場所の種類への関心」「行動の数値」「NG行動」に入ります。そのあと手で直せます。</span></div>
        <label class="chk"><input type="checkbox" id="overwrite">性格、好きなもの、苦手なもの、紹介を、資料の内容で上書きする（外すと空の欄にだけ入れる）</label>
        <ul id="reasons" class="reasons"></ul><div id="sources" class="sources"></div></div>
      <div class="card"><label>紹介（40文字まで） <input id="tagline" value="${esc(c.tagline)}" maxlength="40"></label></div>
      <div class="card"><h3>場所の種類への関心（推しの行動に使います。0〜2）</h3><div class="sliders">${Object.entries(cats).filter(([k]) => !['station', 'stay', 'home', 'school'].includes(k)).map(([k, v]) => `<label>${esc(v.label)}<input type="range" min="0" max="2" step="0.05" data-int="${k}" value="${(c.interests || {})[k] || 0}"><span>${((c.interests || {})[k] || 0).toFixed(2)}</span></label>`).join('')}</div></div>
      <div class="card"><h3>行動の数値</h3><div class="sliders nums">
        ${numRow('stride', '歩幅（m）', 0.4, 1, 0.01, c.stride)}${numRow('speed', '分速（m）', 40, 110, 1, c.speed)}${numRow('vehicle', '乗り物好き', 0, 1, 0.05, c.vehicle)}
        ${numRow('curiosity', '好奇心', 0, 1, 0.05, c.curiosity)}${numRow('range', '距離の許容（m）', 500, 5000, 100, c.range)}</div>
        <p class="muted">歩幅と分速は歩数と移動の時間に、乗り物好きは電車やバスを選ぶかに、好奇心は初めての場所に入るかに、距離の許容はどこまで歩くかに使います。</p></div>
      <div class="card"><h3>NG行動（推しがしないこと）</h3>
        <p><b>行かない場所の種類</b> ${Object.entries(cats).filter(([k]) => !['station', 'stay', 'home', 'school'].includes(k)).map(([k, v]) => `<label class="chk"><input type="checkbox" data-ngcat="${k}" ${(c.ng.cats || []).includes(k) ? 'checked' : ''}>${esc(v.label)}</label>`).join(' ')}</p>
        <div class="two"><label>入らない場所の言葉（名前やジャンルに含まれる。1行に1つ） <textarea id="ngwords">${esc((c.ng.words || []).join('\n'))}</textarea></label>
        <label>この時刻より後は、新しい場所へ出かけない（空なら決めない） <input type="number" id="quiet" min="10" max="24" step="1" value="${c.ng.quietAfter === null || c.ng.quietAfter === undefined ? '' : c.ng.quietAfter}"></label></div>
        <p class="muted">NG行動に当たる場所には、推しは立ち寄らず、観光ルートにも入れません。</p></div>
      <div class="card two">
        <label>性格（1行に1つ） <textarea id="personality">${esc(lines(cn.personality))}</textarea></label>
        <label>プロフィール（1行に「項目：内容」） <textarea id="profile">${esc(pairs(cn.profile))}</textarea></label>
        <label>好きなもの（1行に1つ） <textarea id="likes">${esc(lines(cn.likes))}</textarea></label>
        <label>苦手なもの（1行に1つ） <textarea id="dislikes">${esc(lines(cn.dislikes))}</textarea></label>
        <label>いつもの道（300文字まで） <textarea id="commute">${esc(cn.commute || '')}</textarea></label>
        <label>関係（1行に「相手：説明」） <textarea id="relations">${esc(pairs(cn.relations))}</textarea></label>
      </div>
      <div class="card"><label>作中の出来事（1行に「題｜内容」） <textarea id="episodes" rows="5">${esc(eps(cn.episodes))}</textarea></label></div>
      <div class="card"><label>事務局へのメモ（任意） <textarea id="note" placeholder="変更の理由や、公式との確認状況など"></textarea></label></div>
      <div class="row"><button id="send">申請する</button><button class="sub" id="back">戻る</button><span class="err" id="emsg"></span></div>
    </div>`;
  const drawFace = () => { const p = $('#facePrev'); p.replaceChildren(face(Object.assign({}, c.look, imageChanged ? { image, crop: null } : {}), true)); };
  drawFace();
  main.querySelectorAll('[data-int]').forEach(r => r.addEventListener('input', () => { r.nextElementSibling.textContent = Number(r.value).toFixed(2); }));
  $('#img').addEventListener('change', () => {
    const f = $('#img').files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => { try { const r = await api(`/characters/${c.id}/image`, { method: 'POST', body: { data: rd.result } }); image = r.path; imageChanged = true; drawFace(); } catch (e) { alert(e.message); } };
    rd.readAsDataURL(f);
  });
  main.querySelectorAll('[data-num]').forEach(r => { const n = main.querySelector(`[data-numv=${r.dataset.num}]`); r.addEventListener('input', () => { n.value = r.value; }); n.addEventListener('input', () => { r.value = n.value; }); });
  // AIにパラメータを決めてもらう（デモではダミー。lib/persona-ai.js）。提案は下書きで、手で直してから申請する
  $('#suggest').onclick = async () => {
    try {
      const r = await api(`/characters/${c.id}/suggest`, { method: 'POST', body: { text: $('#persona').value } });
      main.querySelectorAll('[data-int]').forEach(el => { const v = r.interests[el.dataset.int]; if (v !== undefined) { el.value = v; el.nextElementSibling.textContent = Number(v).toFixed(2); } });
      for (const k of ['stride', 'speed', 'vehicle', 'curiosity', 'range']) { main.querySelector(`[data-num=${k}]`).value = r[k]; main.querySelector(`[data-numv=${k}]`).value = r[k]; }
      main.querySelectorAll('[data-ngcat]').forEach(el => { el.checked = r.ng.cats.includes(el.dataset.ngcat); });
      $('#ngwords').value = r.ng.words.join('\n'); $('#quiet').value = r.ng.quietAfter === null ? '' : r.ng.quietAfter;
      $('#reasons').innerHTML = r.reasons.map(x => `<li>${esc(x)}</li>`).join('') + '<li class="muted">提案は申請前の下書きです。下の値を手で直してから「申請する」を押してください。</li>';
      // 設定資料から作った特徴（空の欄にだけ入れるか、上書きするかを選べる）
      const fz = r.features || {};
      const fill = (id, list) => { if (list && list.length && ($('#overwrite').checked || !$(id).value.trim())) $(id).value = list.join('\n'); };
      fill('#personality', fz.personality); fill('#likes', fz.likes); fill('#dislikes', fz.dislikes);
      if (fz.tagline && ($('#overwrite').checked || !$('#tagline').value.trim())) $('#tagline').value = fz.tagline;
      $('#sources').innerHTML = r.sources && r.sources.length
        ? `<h4>参照した資料（${r.rag.docs}件の資料、${r.rag.chunks}の区切りから）</h4>` + r.sources.map(x => `<blockquote><b>${esc(x.doc)}</b>　<span class="muted">一致 ${x.score}</span><br>${esc(x.excerpt)}</blockquote>`).join('')
        : '<p class="muted">設定資料が登録されていないので、上の文章だけから決めました。資料を登録すると、資料も参照します。</p>';
      main.querySelectorAll('.ai-card ~ .card').forEach(el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
    } catch (e) { alert(e.message); }
  };
  // 設定資料（RAG）: 一覧、登録、削除
  const drawDocs = async () => {
    const d = await api(`/characters/${c.id}/docs`);
    $('#ragDocs').innerHTML = d.docs.length ? d.docs.map(x => `<li><b>${esc(x.name)}</b> <span class="muted">${Math.ceil(x.size / 1024)}KB・${x.chunks}の区切り・${new Date(x.uploadedAt).toLocaleDateString('ja-JP')}</span> <button class="sub" data-deldoc="${esc(x.id)}" type="button">消す</button></li>`).join('') : '<li class="muted">まだ資料はありません。</li>';
    $('#ragDocs').querySelectorAll('[data-deldoc]').forEach(b => b.onclick = async () => { if (!confirm('この資料を消しますか？')) return; await api(`/characters/${c.id}/docs/${b.dataset.deldoc}`, { method: 'DELETE' }); drawDocs(); });
  };
  const addDoc = async (name, text) => { try { await api(`/characters/${c.id}/docs`, { method: 'POST', body: { name, text } }); drawDocs(); } catch (e) { alert(e.message); } };
  $('#ragFile').addEventListener('change', () => { const f = $('#ragFile').files[0]; if (!f) return; if (f.size > 200 * 1024) { alert('資料は200KBまでにしてください'); return; } const rd = new FileReader(); rd.onload = () => { addDoc(f.name, rd.result); $('#ragFile').value = ''; }; rd.readAsText(f); });
  $('#ragPasteBtn').onclick = () => $('#ragPaste').classList.toggle('hidden');
  $('#ragAdd').onclick = () => { addDoc($('#ragName').value || '貼りつけた資料', $('#ragText').value); $('#ragText').value = ''; $('#ragName').value = ''; $('#ragPaste').classList.add('hidden'); };
  drawDocs();
  $('#back').onclick = () => PAGES.characters();
  $('#send').onclick = async () => {
    const split = v => v.split('\n').map(s => s.trim()).filter(Boolean);
    const toPairs = v => split(v).map(l => { const i = l.search(/[：:]/); return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });
    const toEps = v => split(v).map(l => { const i = l.search(/[｜|]/); return i < 0 ? { title: l, text: '' } : { title: l.slice(0, i).trim(), text: l.slice(i + 1).trim() }; });
    const character = {}, canon = {};
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if ($('#tagline').value !== c.tagline) character.tagline = $('#tagline').value;
    const ints = {}; main.querySelectorAll('[data-int]').forEach(r => { ints[r.dataset.int] = Number(r.value); });
    const before = Object.fromEntries(Object.keys(ints).map(k => [k, (c.interests || {})[k] || 0]));
    if (!same(ints, before)) character.interests = Object.assign({}, c.interests, ints);
    // 見た目は、絵の画像だけを申請する（髪や服の色は指定しない）
    if (imageChanged) character.look = { image };
    for (const k of ['stride', 'speed', 'vehicle', 'curiosity', 'range']) { const v = Number(main.querySelector(`[data-numv=${k}]`).value); if (v !== c[k]) character[k] = v; }
    const ng = { cats: [...main.querySelectorAll('[data-ngcat]:checked')].map(i => i.dataset.ngcat), words: split($('#ngwords').value), quietAfter: $('#quiet').value === '' ? null : Number($('#quiet').value) };
    if (!same(ng, { cats: c.ng.cats || [], words: c.ng.words || [], quietAfter: c.ng.quietAfter === undefined ? null : c.ng.quietAfter })) character.ng = ng;
    const next = { personality: split($('#personality').value), likes: split($('#likes').value), dislikes: split($('#dislikes').value), commute: $('#commute').value.trim(), profile: toPairs($('#profile').value), relations: toPairs($('#relations').value), episodes: toEps($('#episodes').value) };
    for (const [k, v] of Object.entries(next)) if (!same(v, cn[k] === null ? (k === 'commute' ? '' : []) : cn[k])) canon[k] = v;
    try {
      await api(`/characters/${c.id}/requests`, { method: 'POST', body: { character, canon, note: $('#note').value } });
      alert('申請しました。事務局の承認後に反映されます。'); location.hash = '#requests';
    } catch (e) { $('#emsg').textContent = e.message; }
  };
}

/* ---- 掲示用のQRコードの一覧（印刷） ---- */
function printSheet(codes) {
  main.innerHTML = `<div class="row no-print"><button id="pp">印刷する</button><button class="sub" id="pb">戻る</button><span class="muted">ブラウザの印刷で、PDFにも保存できます。</span></div>
    <div class="qr-sheet">${codes.map(c => `<div class="qr-card"><img alt="" src="/org/api/codes/${encodeURIComponent(c.code)}/qr.png?size=600"><h4>${esc(c.target)}に出会えます</h4>
      <p class="code">${esc(c.code)}</p><p class="muted">ミニ推し！の「出会う」で読み取るか、コードを入力してください${c.place ? '<br>' + esc(c.place) : ''}</p></div>`).join('')}</div>`;
  $('#pp').onclick = () => window.print();
  $('#pb').onclick = () => PAGES.codes();
}

function fields(root) { const out = {}; root.querySelectorAll('[name]').forEach(el => { out[el.name] = el.type === 'checkbox' ? el.checked : el.value; }); return out; }

let mapEditor = null;
async function route() {
  if (mapEditor) { mapEditor.destroy(); mapEditor = null; }
  const name = (location.hash || '#dashboard').slice(1);
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + name));
  main.innerHTML = '<p class="muted">読みこみ中…</p>';
  try { await (PAGES[name] || PAGES.dashboard)(); } catch (e) { main.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
async function boot() {
  me = await api('/me');
  $('#orgName').textContent = me.name;
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  route();
}
window.addEventListener('hashchange', route);
boot().catch(() => showLogin());
