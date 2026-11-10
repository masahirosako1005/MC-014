// admin/public/admin.js
// 運営の管理画面。ダッシュボード、作品、キャラ設定と行動の試行、場所、イベント、天気、獲得コード、
// 解釈違いの報告、ユーザー、操作履歴、スポットDB。

const $ = s => document.querySelector(s);
const main = $('#main');
// JSON を画面に出すとき、値が null の項目は書かない（「null」と出さない。なくても同じ意味になる）
const noNull = (k, v) => (v === null ? undefined : v);
const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dt = ms => new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
const hm = ms => new Date(ms).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });

async function api(path, opts = {}) {
  const res = await fetch('/admin/api' + path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('ログインしてください'); }
  if (!res.ok) throw new Error(data.error || '失敗しました');
  return data;
}
function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = new FormData(e.target);
  try { await api('/login', { method: 'POST', body: { id: f.get('id'), password: f.get('password') } }); $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); route(); }
  catch (er) { $('#loginMsg').textContent = er.message; }
});
$('#logout').addEventListener('click', async () => { await api('/logout', { method: 'POST', body: {} }); showLogin(); });

let mapEditor = null;
const PAGES = {
  async map() {
    const { mountMapEditor } = await import('/shared/mapedit.js');
    main.innerHTML = '<h2>マップ</h2><p class="muted">エリアを地図の上で描いて足し、場所を置き、最初の駅を選び、道のデータを作ると、推しを連れ出せるエリアになります。足したエリアは「自治体のアカウント」で自治体に割り振れます。</p><div id="me"></div>';
    mapEditor = mountMapEditor(document.getElementById('me'), { api, admin: true });
  },
  async dashboard() {
    const d = await api('/dashboard');
    main.innerHTML = `<h2>ダッシュボード</h2><div class="grid">
      ${stat('ユーザー', d.users)}${stat('ログインあり', d.loggedIn)}${stat('推しの獲得数', d.acquisitions)}${stat('観光ルート', d.routes)}
      ${stat('イベントを含むルート', d.withEvent)}${stat('未来の日付のルート（再訪の意思）', d.future)}${stat('未読の解釈違いの報告', d.unreadReports)}${stat('スポットDB', d.spotDb.count + '件')}</div>
      <div class="two"><div class="card"><h3>人気の推し</h3>${list(d.popularChars)}</div><div class="card"><h3>エリア</h3>${list(d.areas)}</div>
      <div class="card"><h3>ルートに選ばれた場所</h3>${list(d.places)}</div><div class="card"><h3>スポットDB</h3><p>最後の更新: ${d.spotDb.updatedAt ? dt(Date.parse(d.spotDb.updatedAt)) : 'なし'}（版 ${d.spotDb.version}）</p></div></div>`;
  },
  async works() {
    const ws = await api('/works');
    main.innerHTML = `<h2>作品</h2><table><tr><th>ID</th><th>題</th><th>分類</th><th>世界の色</th><th>あらすじ / 権利表記</th><th></th></tr>${ws.map(w => `<tr data-id="${esc(w.id)}">
      <td>${esc(w.id)}</td><td><input name="title" value="${esc(w.title)}"></td><td><input name="kindLabel" value="${esc(w.kindLabel)}" size="10"></td>
      <td><select name="theme">${['teal', 'mint', 'yellow'].map(t => `<option ${t === w.theme ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><textarea name="synopsis">${esc(w.synopsis)}</textarea><input name="rights" value="${esc(w.rights)}" size="40"></td>
      <td><button data-save>保存</button> <button class="sub" data-del>削除</button></td></tr>`).join('')}</table>
      <h3>追加</h3><div class="row"><input id="nid" placeholder="ID（英小文字）"><input id="ntitle" placeholder="題"><input id="nkind" placeholder="分類（例: ゲーム作品）"><button id="addw">追加</button></div>`;
    main.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => { const tr = b.closest('tr'); await api('/works/' + tr.dataset.id, { method: 'PUT', body: fields(tr) }); alert('保存しました'); });
    main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('削除しますか？')) return; try { await api('/works/' + b.closest('tr').dataset.id, { method: 'DELETE' }); PAGES.works(); } catch (e) { alert(e.message); } });
    $('#addw').onclick = async () => { try { await api('/works', { method: 'POST', body: { id: $('#nid').value, title: $('#ntitle').value, kindLabel: $('#nkind').value, kind: 'other' } }); PAGES.works(); } catch (e) { alert(e.message); } };
  },
  async characters() {
    const cs = await api('/characters');
    main.innerHTML = `<h2>キャラ設定</h2>${cs.map(c => `<div class="card" data-id="${esc(c.id)}"><h3>${esc(c.name)} <span class="pill">${esc(c.id)}</span></h3>
      <div class="row"><label>紹介 <input name="tagline" value="${esc(c.tagline)}" size="30"></label><label>歩幅(m) <input name="stride" value="${c.stride}" size="5"></label><label>分速(m) <input name="speed" value="${c.speed}" size="5"></label>
      <label>乗り物好き <input name="vehicle" value="${c.vehicle}" size="5"></label><label>好奇心 <input name="curiosity" value="${c.curiosity}" size="5"></label><label>距離の許容(m) <input name="range" value="${c.range}" size="6"></label></div>
      <label>関心（JSON） <input name="interests" value='${esc(JSON.stringify(c.interests))}' size="90"></label>
      <div class="row"><button data-save>保存</button></div>
      <details><summary>公式設定（性格、日常、時間の感覚、天の声の文章など）をJSONで編集</summary><textarea class="canon" rows="14">${esc(JSON.stringify(c.canon, noNull, 1))}</textarea><button data-canon>公式設定を保存</button></details>
      <details><summary>行動を試す</summary><div class="row"><input type="date" class="tday"><select class="tw"><option value="">創作の天気</option><option value="sun">晴れ</option><option value="cloud">くもり</option><option value="rain">雨</option></select><select class="ta"><option value="osaka">大阪市</option><option value="onomichi">尾道市</option><option value="mihara">三原市</option></select><button data-try>試す</button></div><pre class="tout"></pre></details></div>`).join('')}`;
    main.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => { const card = b.closest('.card'); const f = fields(card); try { f.interests = JSON.parse(f.interests); await api('/characters/' + card.dataset.id, { method: 'PUT', body: f }); alert('保存しました'); } catch (e) { alert(e.message); } });
    main.querySelectorAll('[data-canon]').forEach(b => b.onclick = async () => { const card = b.closest('.card'); try { await api(`/characters/${card.dataset.id}/canon`, { method: 'PUT', body: { canon: JSON.parse(card.querySelector('.canon').value) } }); alert('保存しました'); } catch (e) { alert('JSONが正しくありません: ' + e.message); } });
    main.querySelectorAll('[data-try]').forEach(b => b.onclick = async () => { const card = b.closest('.card'); const r = await api(`/characters/${card.dataset.id}/try`, { method: 'POST', body: { day: card.querySelector('.tday').value, weather: card.querySelector('.tw').value || null, areaId: card.querySelector('.ta').value } }); card.querySelector('.tout').textContent = `${r.day}（${r.weather}） ${r.steps}歩 ${r.walkM}m\n` + r.items.map(i => `${hm(i.at)} ${i.text}${i.sub ? '\n      ' + i.sub : ''}`).join('\n'); });
  },
  async places() {
    main.innerHTML = `<h2>場所</h2><div class="row"><input id="pq" placeholder="名前で探す"><select id="pa"><option value="">すべてのエリア</option><option value="osaka">大阪市</option><option value="onomichi">尾道市</option><option value="mihara">三原市</option></select><label><input type="checkbox" id="preal"> 実在の場所だけ</label><button id="ps">表示</button></div><div id="pl"></div>
      <p class="muted">場所の追加と座標の変更には経路の再計算（npm run build-routes）が必要なので、ここでは情報の編集のみ。</p>`;
    const load = async () => {
      const d = await api(`/places?q=${encodeURIComponent($('#pq').value)}&area=${$('#pa').value}&real=${$('#preal').checked ? 1 : 0}`);
      $('#pl').innerHTML = `<p>${d.total}件（最大200件を表示）</p><table><tr><th>名前</th><th>説明 / URL</th><th>営業時間</th><th>状態</th><th></th></tr>${d.places.map(p => `<tr data-id="${esc(p.id)}">
        <td>${esc(p.name)}<br><span class="pill">${esc(p.cat)}</span>${p.fictional ? '<span class="pill warn">架空</span>' : ''}</td>
        <td><textarea name="desc">${esc(p.desc)}</textarea><input name="url" value="${esc(p.url)}" size="40"></td>
        <td><input name="hours" value="${esc(p.hours ? p.hours.join(',') : '')}" size="7" placeholder="9,18"></td>
        <td><label><input type="checkbox" name="closed" ${p.closed ? 'checked' : ''}>休止</label><label><input type="checkbox" name="noRoute" ${p.noRoute ? 'checked' : ''}>ルートに入れない</label><label><input type="checkbox" name="outdoor" ${p.outdoor ? 'checked' : ''}>屋外</label></td>
        <td><button data-save>保存</button></td></tr>`).join('')}</table>`;
      $('#pl').querySelectorAll('[data-save]').forEach(b => b.onclick = async () => { const tr = b.closest('tr'); const f = fields(tr); f.hours = f.hours ? f.hours.split(',').map(Number) : undefined; if (!f.url) delete f.url; try { await api('/places/' + tr.dataset.id, { method: 'PUT', body: f }); alert('保存しました'); } catch (e) { alert(e.message); } });
    };
    $('#ps').onclick = load; load();
  },
  async events() {
    const es = await api('/events');
    main.innerHTML = `<h2>イベント</h2><table><tr><th>題</th><th>エリア / 会場</th><th>日程</th><th>種類</th><th>推しの反応</th><th></th></tr>${es.map(e => `<tr data-id="${esc(e.id)}">
      <td><input name="title" value="${esc(e.title)}" size="22"><br><textarea name="desc">${esc(e.desc)}</textarea></td>
      <td>${esc(e.area)}<br><input name="placeId" value="${esc(e.placeId || '')}" size="14"></td>
      <td><input name="start" value="${esc(e.start)}" size="10">〜<input name="end" value="${esc(e.end)}" size="10"><br><label><input type="checkbox" name="tentative" ${e.tentative ? 'checked' : ''}>日程未確定（予定）</label><label><input type="checkbox" name="hidden" ${e.hidden ? 'checked' : ''}>非公開</label></td>
      <td><input name="tags" value="${esc((e.tags || []).join(','))}" size="16"></td>
      <td>${e.reactions.filter(r => r.interest > 0).map(r => `<span class="pill ${r.interest >= 0.7 ? 'warn' : ''}">${esc(r.short)} ${r.interest}</span>`).join(' ')}</td>
      <td><button data-save>保存</button> <button class="sub" data-del>削除</button></td></tr>`).join('')}</table>
      <h3>追加</h3><div class="row"><input id="et" placeholder="題"><select id="ea"><option value="osaka">大阪市</option><option value="onomichi">尾道市</option><option value="mihara">三原市</option></select><input id="es" type="date"><input id="ee" type="date"><input id="eg" placeholder="種類（photo,food など）"><button id="eadd">追加</button></div>`;
    main.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => { const tr = b.closest('tr'); const f = fields(tr); if (!f.placeId) f.placeId = null; try { await api('/events/' + tr.dataset.id, { method: 'PUT', body: f }); alert('保存しました'); } catch (e) { alert(e.message); } });
    main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('削除しますか？')) return; await api('/events/' + b.closest('tr').dataset.id, { method: 'DELETE' }); PAGES.events(); });
    $('#eadd').onclick = async () => { try { await api('/events', { method: 'POST', body: { title: $('#et').value, area: $('#ea').value, start: $('#es').value, end: $('#ee').value, tags: $('#eg').value } }); PAGES.events(); } catch (e) { alert(e.message); } };
  },
  async weather() {
    const ws = await api('/weather');
    const label = { sun: '晴れ', cloud: 'くもり', rain: '雨' };
    main.innerHTML = `<h2>天気</h2><p class="muted">創作の天気（外部APIには接続しない）。日付ごとに1日の天気を上書きでき、時間ごとの天気も作り直す。</p><table><tr><th>日付</th><th>地方</th><th>1日の天気</th><th>時間ごと（6〜23時）</th><th>上書き</th></tr>${ws.map(w => `<tr>
      <td>${w.day}</td><td>${w.region === 'kansai' ? '関西' : '瀬戸内'}</td><td class="w-${w.weather}">${label[w.weather]}${w.override ? '（上書き）' : ''}</td>
      <td>${w.hourly.slice(6).map(x => ({ sun: '☀', cloud: '☁', rain: '☂' }[x])).join('')}</td>
      <td><select data-day="${w.day}" data-region="${w.region}"><option value="">創作のまま</option>${['sun', 'cloud', 'rain'].map(x => `<option value="${x}" ${w.override === x ? 'selected' : ''}>${label[x]}</option>`).join('')}</select></td></tr>`).join('')}</table>`;
    main.querySelectorAll('select[data-day]').forEach(s => s.onchange = async () => { await api('/weather', { method: 'PUT', body: { day: s.dataset.day, region: s.dataset.region, weather: s.value || null } }); PAGES.weather(); });
  },
  async codes() {
    const cs = await api('/codes');
    main.innerHTML = `<h2>獲得コード</h2><table><tr><th>QR</th><th>コード</th><th>獲得対象</th><th>発行</th><th>使用回数</th><th>有効</th><th></th></tr>${cs.map(c => `<tr><td><img class="thumb" alt="" src="/admin/api/codes/${encodeURIComponent(c.code)}/qr.png?size=200"></td><td>${esc(c.code)}</td><td>${esc(c.type)} ${esc(c.id)}</td><td>${esc(c.org || '事務局')}</td><td>${c.uses}</td><td><input type="checkbox" data-code="${esc(c.code)}" ${c.enabled ? 'checked' : ''}></td><td><a href="/admin/api/codes/${encodeURIComponent(c.code)}/qr.png?size=1000&download=1" download>QRをダウンロード</a></td></tr>`).join('')}</table>
      <h3>追加</h3><div class="row"><input id="cc" placeholder="MINI-XXXX-XXXX"><select id="ct"><option value="character">キャラ</option><option value="area">エリア</option></select><input id="ci" placeholder="対象のID（arisa、osaka など）"><button id="cadd">追加</button></div>`;
    main.querySelectorAll('[data-code]').forEach(i => i.onchange = () => api('/codes/' + encodeURIComponent(i.dataset.code), { method: 'PUT', body: { enabled: i.checked } }));
    $('#cadd').onclick = async () => { try { await api('/codes', { method: 'POST', body: { code: $('#cc').value, type: $('#ct').value, id: $('#ci').value } }); PAGES.codes(); } catch (e) { alert(e.message); } };
  },
  async reports() {
    const rs = await api('/reports');
    const st = { unread: '未読', checked: '確認済み', shared: '公式に共有' };
    main.innerHTML = `<h2>解釈違いの報告</h2><p class="muted">キャラクター性は公式が判断するので、反映するかは公式と相談して決める。</p>${rs.length ? `<table><tr><th>日時</th><th>推し</th><th>種類</th><th>どこで</th><th>内容</th><th>呼び名</th><th>状態</th></tr>${rs.map(r => `<tr class="${r.status}">
      <td>${dt(r.at)}</td><td>${esc(r.characterName)}</td><td>${esc(r.kind)}</td><td>${esc(r.where)}</td><td>${esc(r.text)}</td><td>${esc(r.nickname)}</td>
      <td><select data-id="${esc(r.id)}">${Object.entries(st).map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}</table>` : '<p>まだ報告はありません。</p>'}`;
    main.querySelectorAll('select[data-id]').forEach(s => s.onchange = async () => { await api('/reports/' + s.dataset.id, { method: 'PUT', body: { status: s.value } }); PAGES.reports(); });
  },
  async users() {
    const us = await api('/users');
    main.innerHTML = `<h2>ユーザー</h2><p class="muted">パスワードは見られません。</p><table><tr><th>利用者</th><th>作成</th><th>ログイン</th><th>呼び名</th><th>推し</th><th>エリア</th><th>ルート</th><th>利用停止</th></tr>${us.map(u => `<tr>
      <td>${esc(u.id)}</td><td>${dt(u.createdAt)}</td><td>${u.loginId ? 'あり' : 'なし'}</td><td>${esc(u.nickname)}</td><td>${u.characters}</td><td>${u.areas}</td><td>${u.routes}</td>
      <td><input type="checkbox" data-id="${esc(u.fullId)}" ${u.disabled ? 'checked' : ''}></td></tr>`).join('')}</table>`;
    main.querySelectorAll('[data-id]').forEach(i => i.onchange = () => api('/users/' + i.dataset.id, { method: 'PUT', body: { disabled: i.checked } }));
  },
  async log() {
    const l = await api('/log');
    main.innerHTML = `<h2>操作履歴</h2><table><tr><th>日時</th><th>操作</th><th>内容</th></tr>${l.map(x => `<tr><td>${dt(x.at)}</td><td>${esc(x.action)}</td><td>${esc(x.detail)}</td></tr>`).join('')}</table>`;
  },
  async spots() {
    const d = await api('/spots');
    main.innerHTML = `<h2>スポットDB</h2><div class="row"><span>最後の更新: ${d.info.updatedAt ? dt(Date.parse(d.info.updatedAt)) : 'なし'}　${d.info.count}件　版 ${d.info.version}</span><button id="srun">今すぐ更新する</button></div>
      <p class="muted">収集とAIの分析はダミーデータで再現している（lib/spot-collector.js、lib/spot-scorer.js の【API差し替え箇所】【AI差し替え箇所】）。</p>
      <h3>更新の記録</h3><table><tr><th>日時</th><th>きっかけ</th><th>件数</th><th>出どころ</th><th>かかった時間</th></tr>${d.info.runs.slice(0, 10).map(r => `<tr><td>${dt(Date.parse(r.at))}</td><td>${esc(r.trigger)}</td><td>${r.count}</td><td>${esc(r.source)}</td><td>${r.ms}ms</td></tr>`).join('')}</table>
      <h3>スポット（最大150件）</h3><table><tr><th>名前</th><th>ジャンル</th><th>営業時間</th><th>予算</th><th>口コミ</th><th>相性の高い推し</th></tr>${d.spots.map(s => `<tr><td>${esc(s.name)}${s.fictional ? ' <span class="pill warn">架空</span>' : ''}</td><td>${esc(s.genre)}</td><td>${s.hours.always ? '24時間' : `${s.hours.open}〜${s.hours.close}`}</td><td>${s.budget || '-'}</td><td>${s.rating}（${s.reviewCount}件）${s.review ? '<br>' + esc(s.review.text) : ''}</td><td>${s.best.map(b => `${esc(b.short)} ${b.score}`).join('、')}</td></tr>`).join('')}</table>`;
    $('#srun').onclick = async () => { $('#srun').disabled = true; await api('/spots/run', { method: 'POST', body: {} }); PAGES.spots(); };
  },
};
// 自治体のアカウントと、自治体からの申請（承認すると反映）
const FIELD_LABEL = { tagline: '紹介', interests: '関心', look: '見た目・絵', stride: '歩幅（m）', speed: '分速（m）', vehicle: '乗り物好き', curiosity: '好奇心', range: '距離の許容（m）', ng: 'NG行動', profile: 'プロフィール', personality: '性格', likes: '好きなもの', dislikes: '苦手なもの', commute: 'いつもの道', episodes: '作中の出来事', relations: '関係' };
const show = v => (v === null || v === undefined ? '<span class="muted">（なし）</span>' : typeof v === 'string' ? esc(v) : `<pre>${esc(JSON.stringify(v, noNull, 1))}</pre>`);
Object.assign(PAGES, {
  async orgs() {
    const d = await api('/orgs');
    const checks = (name, list, sel) => list.map(x => `<label class="chk"><input type="checkbox" name="${name}" value="${esc(x.id)}" ${(sel || []).includes(x.id) ? 'checked' : ''}>${esc(x.name)}</label>`).join(' ');
    main.innerHTML = `<h2>自治体のアカウント</h2><p class="muted">自治体や団体が使う管理画面（http://localhost:3200）のアカウント。担当のエリアとキャラクターに関わるものだけを扱えます。パスワードは見られません（再発行のみ）。</p>
      ${d.orgs.map(o => `<div class="card" data-id="${esc(o.id)}"><h3>${esc(o.name)} <span class="pill">${esc(o.id)}</span> ${o.disabled ? '<span class="pill warn">停止中</span>' : ''}</h3>
        <div class="row"><label>名前 <input name="name" value="${esc(o.name)}" size="24"></label><label>ログインID <input name="loginId" value="${esc(o.loginId)}"></label><label>パスワードの再発行 <input name="password" type="password" placeholder="10文字以上" autocomplete="new-password"></label><label><input type="checkbox" name="disabled" ${o.disabled ? 'checked' : ''}>利用停止</label></div>
        <p><b>担当エリア</b> ${checks('areas', d.areas, o.areas)}</p><p><b>担当キャラクター</b> ${checks('characters', d.characters, o.characters)}</p>
        <p class="muted">最後のログイン: ${o.lastLoginAt ? dt(o.lastLoginAt) : 'なし'}</p>
        <div class="row"><button data-save>保存</button><button class="sub" data-del>削除</button></div></div>`).join('')}
      <div class="card"><h3>アカウントを作る</h3><div class="row"><label>組織のID <input name="id" placeholder="例: fukuyama"></label><label>名前 <input name="name" placeholder="例: 福山市 観光課"></label><label>ログインID <input name="loginId"></label><label>初期パスワード <input name="password" type="password" autocomplete="new-password"></label></div>
        <p><b>担当エリア</b> ${checks('areas', d.areas, [])}</p><p><b>担当キャラクター</b> ${checks('characters', d.characters, [])}</p><button id="oadd">作る</button></div>`;
    const collect = root => {
      const f = {};
      root.querySelectorAll('input[name="name"],input[name="loginId"],input[name="password"],input[name="id"]').forEach(i => { if (i.value) f[i.name] = i.value; });
      const dis = root.querySelector('input[name="disabled"]'); if (dis) f.disabled = dis.checked;
      f.areas = [...root.querySelectorAll('input[name="areas"]:checked')].map(i => i.value);
      f.characters = [...root.querySelectorAll('input[name="characters"]:checked')].map(i => i.value);
      return f;
    };
    main.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => { const card = b.closest('.card'); try { await api('/orgs/' + card.dataset.id, { method: 'PUT', body: collect(card) }); alert('保存しました'); PAGES.orgs(); } catch (e) { alert(e.message); } });
    main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('このアカウントを削除しますか？')) return; await api('/orgs/' + b.closest('.card').dataset.id, { method: 'DELETE' }); PAGES.orgs(); });
    $('#oadd').onclick = async () => { try { await api('/orgs', { method: 'POST', body: collect($('#oadd').closest('.card')) }); PAGES.orgs(); } catch (e) { alert(e.message); } };
  },
  async requests() {
    const rs = await api('/requests');
    const st = { pending: '確認待ち', approved: '承認・反映済み', rejected: '差し戻し' };
    const img = p => `<img class="thumb big" alt="" src="/${esc(p)}">`;
    main.innerHTML = `<h2>自治体からの申請</h2><p class="muted">キャラクターは作品の公式のものなので、自治体の変更は承認したときだけアプリに反映します。公式の権利者に確認してから承認してください。</p>
      ${rs.length ? rs.map(r => `<div class="card status-${r.status}" data-id="${esc(r.id)}"><h3>${esc(r.characterName)} <span class="pill">${esc(r.orgName)}</span> <span class="pill">${st[r.status]}</span></h3>
        <p class="muted">${dt(r.createdAt)}　${r.note ? 'メモ: ' + esc(r.note) : ''}</p>
        <table><tr><th>項目</th><th>今</th><th>申請</th></tr>
          ${Object.entries(r.character).map(([k, v]) => `<tr><td>${FIELD_LABEL[k] || k}</td><td>${k === 'look' && r.current.character.look && r.current.character.look.image && !r.current.character.look.crop ? img(r.current.character.look.image) : ''}${show(r.current.character[k])}</td><td>${k === 'look' && v.image ? img(v.image) : ''}${show(v)}</td></tr>`).join('')}
          ${Object.entries(r.canon).map(([k, v]) => `<tr><td>${FIELD_LABEL[k] || k}</td><td>${show(r.current.canon[k])}</td><td>${show(v)}</td></tr>`).join('')}</table>
        ${r.status === 'pending' ? '<div class="row"><input name="comment" placeholder="自治体へのコメント（任意）" size="40"><button data-ok>承認して反映</button><button class="sub" data-ng>差し戻す</button></div>' : `<p>${esc(r.comment)} <span class="muted">${r.reviewedAt ? dt(r.reviewedAt) : ''}</span></p>`}</div>`).join('') : '<p>申請はありません。</p>'}`;
    const act = (b, decision) => async () => { const card = b.closest('.card'); try { await api('/requests/' + card.dataset.id, { method: 'PUT', body: { decision, comment: card.querySelector('[name=comment]').value } }); PAGES.requests(); } catch (e) { alert(e.message); } };
    main.querySelectorAll('[data-ok]').forEach(b => b.onclick = act(b, 'approved'));
    main.querySelectorAll('[data-ng]').forEach(b => b.onclick = act(b, 'rejected'));
  },
});

const stat = (k, v) => `<div class="card stat"><span class="muted">${esc(k)}</span><b>${esc(v)}</b></div>`;
const list = xs => xs.length ? `<ol>${xs.map(x => `<li>${esc(x.name)}（${x.n}）</li>`).join('')}</ol>` : '<p class="muted">なし</p>';
function fields(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach(el => { out[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
  return out;
}

async function route() {
  if (mapEditor) { mapEditor.destroy(); mapEditor = null; }
  const name = (location.hash || '#dashboard').slice(1);
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + name));
  main.innerHTML = '<p class="muted">読みこみ中…</p>';
  try { await (PAGES[name] || PAGES.dashboard)(); } catch (e) { main.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
window.addEventListener('hashchange', route);
(async () => { try { await api('/me'); $('#app').classList.remove('hidden'); route(); } catch { showLogin(); } })();
