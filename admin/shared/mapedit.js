// admin/shared/mapedit.js
// 管理画面の「マップ」。事務局の管理画面と自治体の管理画面で共通に使う（API は lib/map-admin.js）。
//   事務局: エリアを地図の上で描いて足す、範囲や最初の駅を直す、道のデータを作る、実在の場所を集める、場所を足す・直す
//   自治体: 担当エリアの実在の場所を集める、スポット（アニメの聖地など）を足す・直す・動かす
// 地図は国土地理院のタイル（Leaflet）。

const L = window.L;
const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TILES = { pale: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', photo: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', std: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png' };
const GROUP_COLOR = { eat: '#ffdd00', see: '#7cc4a8', move: '#ffffff', stay: '#c9b8f0' };
const F = { GEN: 1, FIC: 2, ADDED: 4, HIDDEN: 8, CLOSED: 16, COLLECTED: 32, SEICHI: 64 };

/**
 * @param {HTMLElement} root 描く場所
 * @param {object} o { api(path, opts) → Promise<json>, admin: bool }
 */
export function mountMapEditor(root, o) {
  const api = o.api;
  let data = null, mode = 'select', sel = null, tile = null, drawPts = [], drawLayer = null, vertexLayer = null, dragMarker = null, editPoly = null, pollTimer = null;
  const show = { real: true, gen: false, lines: true, bounds: true, hidden: false };

  root.innerHTML = `<div class="me">
    <div class="me-bar">
      <div class="seg" role="group" aria-label="操作">
        <button data-mode="select" aria-pressed="true">選ぶ</button>
        <button data-mode="place">場所を置く</button>
        ${o.admin ? '<button data-mode="area">エリアを描く</button>' : ''}
      </div>
      <label><input type="checkbox" data-show="real" checked>実在の場所</label>
      <label><input type="checkbox" data-show="gen">架空のスポット</label>
      <label><input type="checkbox" data-show="lines" checked>乗り物の線</label>
      <label><input type="checkbox" data-show="bounds" checked>道のデータの範囲</label>
      <label><input type="checkbox" data-show="hidden">隠した場所</label>
      <select data-tile><option value="pale">淡色</option><option value="photo">写真</option><option value="std">標準</option></select>
      <span class="me-hint"></span>
    </div>
    <div class="me-body"><div class="me-map"></div><aside class="me-side"></aside></div>
  </div>`;
  const $ = s => root.querySelector(s);
  const side = $('.me-side'), hint = $('.me-hint');
  const map = L.map($('.me-map'), { zoomControl: true, minZoom: 6, maxZoom: 18, doubleClickZoom: false });
  map.attributionControl.setPrefix(false);
  const setTile = k => { if (tile) map.removeLayer(tile); tile = L.tileLayer(TILES[k], { maxNativeZoom: 18, maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>' }).addTo(map); };
  setTile('pale');
  const layers = { areas: L.layerGroup().addTo(map), bounds: L.layerGroup().addTo(map), lines: L.layerGroup().addTo(map), places: L.layerGroup().addTo(map), gen: L.layerGroup(), edit: L.layerGroup().addTo(map) };

  /* ---- 読みこみと描画 ---- */
  async function load(keepView) {
    data = await api('/map');
    drawAll();
    if (!keepView && data.areas.length) map.fitBounds(L.latLngBounds(data.areas.flatMap(a => a.polygon)).pad(0.05));
    if (!sel) overview();
  }
  const placeRow = id => data.places.find(p => p[0] === id);
  const areaOf = id => data.areas.find(a => a.id === id);
  const groupOf = cat => (data.categories[cat] || {}).group || 'see';

  function drawAll() {
    layers.areas.clearLayers(); layers.bounds.clearLayers(); layers.lines.clearLayers(); layers.places.clearLayers(); layers.gen.clearLayers();
    for (const a of data.areas) {
      const on = sel && sel.type === 'area' && sel.id === a.id;
      L.polygon(a.polygon, { color: on ? '#e0a400' : '#007190', weight: on ? 4 : 2.5, fillColor: '#007190', fillOpacity: 0.06, interactive: mode === 'select' })
        .bindTooltip(esc(a.name), { sticky: true }) /* 名前は文字として出す（Leaflet は HTML として入れるため） */.on('click', () => { if (mode === 'select') selectArea(a.id); }).addTo(layers.areas);
      if (show.bounds && a.roadBounds) { const [s, w, n, e] = a.roadBounds; L.rectangle([[s, w], [n, e]], { color: '#1f2a4a', weight: 1.5, dashArray: '6 6', fill: false, interactive: false }).addTo(layers.bounds); }
    }
    if (show.lines) for (const l of data.lines) if (l.stops.length > 1) L.polyline(l.stops.map(s => [s[0], s[1]]), { color: '#1f2a4a', weight: 3, opacity: 0.5, dashArray: l.mode === 'ferry' ? '4 6' : null }).bindTooltip(esc(l.name), { sticky: true }).addTo(layers.lines);
    for (const p of data.places) {
      const [id, name, cat, lat, lng, , fl] = p;
      if ((fl & F.HIDDEN) && !show.hidden) continue;
      const gen = !!(fl & F.GEN);
      if (gen && !show.gen) continue;
      if (!gen && !show.real) continue;
      const selected = sel && sel.type === 'place' && sel.id === id;
      const m = L.circleMarker([lat, lng], {
        radius: gen ? 3.5 : (fl & F.SEICHI) ? 8 : 6.5, weight: selected ? 4 : (fl & F.ADDED) ? 2.5 : 1.5,
        color: selected ? '#e0a400' : (fl & F.SEICHI) ? '#e53970' : '#1f2a4a', fillColor: (fl & F.SEICHI) ? '#ffc2d6' : gen ? '#b9bfd0' : GROUP_COLOR[groupOf(cat)],
        fillOpacity: (fl & F.HIDDEN) ? 0.25 : 0.95, dashArray: (fl & F.HIDDEN) ? '2 3' : null,
      });
      m.bindTooltip(`${esc(name)}${(fl & F.SEICHI) ? '（聖地）' : ''}${(fl & F.COLLECTED) ? '（自動で集めた）' : ''}${gen ? '（架空）' : ''}`, { direction: 'top' });
      m.on('click', e => { if (mode === 'select') { L.DomEvent.stopPropagation(e); selectPlace(id); } });
      m.addTo(gen ? layers.gen : layers.places);
    }
    if (show.gen) layers.gen.addTo(map); else map.removeLayer(layers.gen);
  }

  /* ---- 一覧（何も選んでいないとき） ---- */
  function overview() {
    sel = null; clearEdit(); drawAll();
    side.innerHTML = `<h3>エリア</h3>${o.admin ? '<p class="muted">「エリアを描く」で地図を押して範囲の角を置くと、新しいエリアを足せます。足したエリアは「自治体のアカウント」で自治体に割り振れます。</p>' : '<p class="muted">担当のエリアです。「場所を置く」で地図を押すと、スポット（アニメの聖地など）を足せます。実在の場所は「実在の場所を集める」で自動で集まります。</p>'}
      <ul class="me-list">${data.areas.map(a => `<li><button data-area="${esc(a.id)}"><b>${esc(a.name)}</b><span>${a.placeCount}か所（自動で集めた ${a.collectedCount}）・道のデータ ${a.hasRoads ? 'あり' : '<em>なし</em>'}${a.arrival ? '' : '・<em>最初の駅が未設定</em>'}</span></button></li>`).join('')}</ul>
      <p class="muted small">印: 黄=食事・カフェ・甘味、緑=見る場所、白=駅、紫=宿、桃の星=聖地、点線=隠した場所、太い縁=足した場所</p>`;
    side.querySelectorAll('[data-area]').forEach(b => b.onclick = () => selectArea(b.dataset.area, true));
  }

  /* ---- エリア ---- */
  function selectArea(id, fly) {
    const a = areaOf(id); if (!a) return;
    sel = { type: 'area', id }; clearEdit(); drawAll();
    if (fly) map.fitBounds(L.latLngBounds(a.polygon).pad(0.1));
    const stations = data.places.filter(p => p[5] === a.id && !(p[6] & F.GEN)).sort((x, y) => (y[2] === 'station') - (x[2] === 'station'));
    side.innerHTML = `<div class="me-head"><button class="sub" data-back>← 一覧</button><h3>${esc(a.name)}</h3></div>
      ${o.admin ? `<div class="me-form">
        <label>名前（例: 広島県福山市） <input name="name" value="${esc(a.name)}"></label>
        <label>短い名前（例: 福山市） <input name="short" value="${esc(a.short || '')}"></label>
        <label>都道府県 <input name="pref" value="${esc(a.pref || '')}"></label>
        <label>天気の地方 <select name="region">${data.regions.map(r => `<option value="${r.id}" ${a.region === r.id ? 'selected' : ''}>${r.name}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" name="urban" ${a.urban ? 'checked' : ''}>都会（知らない土地に着いたときの描写が変わる）</label>
        <label>最初の駅（エリアへ連れ出したときに推しが降り立つ場所） <select name="arrival"><option value="">（選んでください）</option>${stations.map(p => `<option value="${esc(p[0])}" ${a.arrival === p[0] ? 'selected' : ''}>${esc(p[1])}${p[2] === 'station' ? '（駅）' : ''}</option>`).join('')}</select></label>
        <label>紹介 <textarea name="intro">${esc(a.intro || '')}</textarea></label>
        <label>観光の公式サイト <input name="url" value="${esc(a.url || '')}" placeholder="https://"></label>
        <div class="row"><button data-save>保存</button><button class="sub" data-poly>範囲を直す</button>${a.added ? '<button class="sub danger" data-del>エリアを消す</button>' : ''}</div>
      </div>` : `<p>${esc(a.intro || '')}</p>`}
      <div class="me-box"><h4>実在の場所</h4><p class="muted small">国土地理院の地図に載っている寺社、公園、博物館、山などを自動で集めます（${a.hasRoads ? '道のデータの範囲' : 'エリアの範囲'}）。店などは、実際のサービスではWebからも集めます。</p><button data-collect>実在の場所を集める</button></div>
      ${o.admin ? `<div class="me-box"><h4>道のデータ ${a.hasRoads ? '（あり）' : '（なし）'}</h4><p class="muted small">推しが歩く道です。国土地理院の道路のデータから、エリアの場所が集まっているあたり（＋約600m）を作ります。場所を置いてから作ってください。${a.hasRoads ? '作り直すと、今の場所に合わせた範囲になります。' : ''}</p><button data-roads>${a.hasRoads ? '道のデータを作り直す' : '道のデータを作る'}</button></div>` : ''}
      <div class="me-job"></div>
      <p class="muted small">ID: ${esc(a.id)}　場所 ${a.placeCount}か所</p>`;
    side.querySelector('[data-back]').onclick = overview;
    side.querySelector('[data-collect]').onclick = () => startJob(`/areas/${a.id}/collect`);
    if (o.admin) {
      side.querySelector('[data-roads]').onclick = () => startJob(`/areas/${a.id}/roads`);
      side.querySelector('[data-save]').onclick = async () => {
        const f = form(side.querySelector('.me-form')); f.urban = !!f.urban; if (!f.arrival) f.arrival = null;
        try { await api(`/areas/${a.id}`, { method: 'PUT', body: f }); await load(true); selectArea(a.id); flash('保存しました'); } catch (e) { alert(e.message); }
      };
      side.querySelector('[data-poly]').onclick = () => editPolygon(a);
      const del = side.querySelector('[data-del]');
      if (del) del.onclick = async () => { if (!confirm(`${a.name} と、足した場所を消しますか？`)) return; try { await api(`/areas/${a.id}`, { method: 'DELETE' }); await load(true); overview(); } catch (e) { alert(e.message); } };
    }
  }

  /** 範囲の角をドラッグして直す */
  function editPolygon(a) {
    clearEdit();
    const pts = a.polygon.map(p => p.slice());
    editPoly = L.polygon(pts, { color: '#e0a400', weight: 3, fillOpacity: 0.08, interactive: false }).addTo(layers.edit);
    vertexLayer = L.layerGroup().addTo(layers.edit);
    pts.forEach((p, i) => {
      const m = L.marker(p, { draggable: true, icon: L.divIcon({ className: 'me-vertex', iconSize: [14, 14] }) }).addTo(vertexLayer);
      m.on('drag', () => { const ll = m.getLatLng(); pts[i] = [ll.lat, ll.lng]; editPoly.setLatLngs(pts); });
      m.on('contextmenu', () => { if (pts.length <= 3) return; pts.splice(i, 1); editPolygon(Object.assign({}, a, { polygon: pts })); });
    });
    const box = document.createElement('div'); box.className = 'me-box';
    box.innerHTML = '<h4>範囲を直す</h4><p class="muted small">黄色の角をドラッグして動かします。角を右クリックすると消せます。</p><div class="row"><button data-ok>この範囲で保存</button><button class="sub" data-cancel>やめる</button></div>';
    side.prepend(box);
    box.querySelector('[data-ok]').onclick = async () => { try { await api(`/areas/${a.id}`, { method: 'PUT', body: { polygon: pts } }); await load(true); selectArea(a.id); flash('範囲を保存しました'); } catch (e) { alert(e.message); } };
    box.querySelector('[data-cancel]').onclick = () => { clearEdit(); box.remove(); };
  }

  /* ---- 場所 ---- */
  async function selectPlace(id) {
    const p = await api('/map/places/' + encodeURIComponent(id));
    sel = { type: 'place', id }; clearEdit(); drawAll();
    placeForm(p, false);
    if (!p.generated && p.cat !== 'station') {
      dragMarker = L.marker([p.lat, p.lng], { draggable: true, icon: L.divIcon({ className: 'me-drag', iconSize: [22, 22] }), zIndexOffset: 1000 }).addTo(layers.edit);
      dragMarker.bindTooltip('ドラッグして位置を動かせます', { direction: 'top' });
      dragMarker.on('dragend', () => { const ll = dragMarker.getLatLng(); side.querySelector('[name=lat]').value = ll.lat.toFixed(6); side.querySelector('[name=lng]').value = ll.lng.toFixed(6); hint.textContent = '位置を動かしました。保存すると反映します'; });
    }
  }
  function placeForm(p, isNew) {
    const cats = Object.entries(data.categories).filter(([k]) => !['school'].includes(k));
    const fl = isNew ? 0 : (placeRow(p.id) || [])[6] || 0;
    const tags = [p.generated ? '架空のスポット（自動で作ったもの）' : null, p.fictional && !p.generated ? '架空の場所' : null, p.collected ? `自動で集めた（${esc(p.collected.source)}）` : null, p.seichi ? '聖地' : null, (fl & F.ADDED) ? `足した場所${p.addedBy ? '（' + esc(p.addedBy) + '）' : ''}` : null, p.hidden ? '隠しています' : null].filter(Boolean);
    side.innerHTML = `<div class="me-head"><button class="sub" data-back>← 一覧</button><h3>${isNew ? '場所を足す' : esc(p.name)}</h3></div>
      ${tags.length ? `<p>${tags.map(t => `<span class="pill">${t}</span>`).join(' ')}</p>` : ''}
      <div class="me-form">
        <label>名前 <input name="name" value="${esc(p.name || '')}" maxlength="40"></label>
        <label>種類 <select name="cat">${cats.map(([k, v]) => `<option value="${k}" ${p.cat === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        <label>ジャンル（例: 喫茶、古書店、寺） <input name="genre" value="${esc(p.genre || '')}" maxlength="20"></label>
        <div class="row"><label class="chk"><input type="checkbox" name="always" ${p.always || !p.hours ? 'checked' : ''}>いつでも入れる（屋外など）</label><label>開く時 <input name="open" type="number" min="0" max="24" step="0.5" value="${p.hours ? p.hours[0] : 9}"></label><label>閉じる時 <input name="close" type="number" min="0" max="24" step="0.5" value="${p.hours ? p.hours[1] : 18}"></label></div>
        <div class="row"><label class="chk"><input type="checkbox" name="outdoor" ${p.outdoor ? 'checked' : ''}>屋外（雨の日は避ける）</label><label>滞在の目安（分） <input name="stay" type="number" min="5" max="600" value="${p.stay || 40}"></label><label class="chk"><input type="checkbox" name="closed" ${p.closed ? 'checked' : ''}>休止中</label></div>
        <label>住所 <input name="address" value="${esc(p.address || '')}" maxlength="80"></label>
        <label>公式サイトなど <input name="url" value="${esc(p.url || '')}" placeholder="https://"></label>
        <label>説明（300文字まで） <textarea name="desc" maxlength="300">${esc(p.desc || '')}</textarea></label>
        <fieldset class="me-seichi"><legend><label class="chk"><input type="checkbox" name="isSeichi" ${p.seichi ? 'checked' : ''}>アニメなどの聖地</label></legend>
          <label>作品 <select name="workId">${data.works.map(w => `<option value="${esc(w.id)}" ${p.seichi && p.seichi.workId === w.id ? 'selected' : ''}>${esc(w.title)}</option>`).join('')}</select></label>
          <label>どんな場面の場所か（120文字まで） <input name="note" value="${esc((p.seichi || {}).note || '')}" maxlength="120"></label>
          <p class="muted small">その作品の推しは、この場所に立ち寄りやすくなり、観光ルートにも入りやすくなります。</p></fieldset>
        <div class="row small muted"><label>緯度 <input name="lat" value="${p.lat}" size="10" readonly></label><label>経度 <input name="lng" value="${p.lng}" size="10" readonly></label></div>
        <div class="row"><button data-save>${isNew ? '足す' : '保存'}</button>${isNew ? '<button class="sub" data-cancel>やめる</button>' : `<button class="sub danger" data-del>${(fl & F.ADDED) ? '消す' : (p.hidden ? '' : '隠す')}</button>${p.hidden ? '<button class="sub" data-unhide>隠すのをやめる</button>' : ''}`}</div>
      </div>`;
    side.querySelector('[data-back]').onclick = overview;
    const body = () => {
      const f = form(side.querySelector('.me-form'));
      const b = { name: f.name, cat: f.cat, genre: f.genre, always: !!f.always, outdoor: !!f.outdoor, closed: !!f.closed, stay: Number(f.stay), address: f.address, url: f.url, desc: f.desc, lat: Number(f.lat), lng: Number(f.lng) };
      if (!b.always) b.hours = [Number(f.open), Number(f.close)];
      b.seichi = f.isSeichi ? { workId: f.workId, note: f.note } : null;
      return b;
    };
    side.querySelector('[data-save]').onclick = async () => {
      try {
        if (isNew) { const r = await api('/places', { method: 'POST', body: body() }); await load(true); setMode('select'); selectPlace(r.id); flash('場所を足しました'); }
        else { await api('/map/places/' + encodeURIComponent(p.id), { method: 'PUT', body: body() }); await load(true); selectPlace(p.id); flash('保存しました'); }
      } catch (e) { alert(e.message); }
    };
    const c = side.querySelector('[data-cancel]'); if (c) c.onclick = () => { clearEdit(); overview(); };
    const d = side.querySelector('[data-del]'); if (d && d.textContent) d.onclick = async () => { if (!confirm(`${p.name} を${d.textContent === '消す' ? '消しますか？' : '隠しますか？（推しは立ち寄らなくなります）'}`)) return; try { await api('/map/places/' + encodeURIComponent(p.id), { method: 'DELETE' }); await load(true); overview(); } catch (e) { alert(e.message); } };
    else if (d) d.remove();
    const u = side.querySelector('[data-unhide]'); if (u) u.onclick = async () => { await api('/map/places/' + encodeURIComponent(p.id), { method: 'PUT', body: { hidden: false } }); await load(true); selectPlace(p.id); };
  }

  /* ---- 地図を押したとき（モードごと） ---- */
  map.on('click', e => {
    if (mode === 'place') {
      clearEdit();
      dragMarker = L.marker(e.latlng, { draggable: true, icon: L.divIcon({ className: 'me-drag', iconSize: [22, 22] }) }).addTo(layers.edit);
      sel = { type: 'new' };
      placeForm({ name: '', cat: 'view', lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6), always: false, hours: [9, 18], stay: 40 }, true);
      dragMarker.on('dragend', () => { const ll = dragMarker.getLatLng(); side.querySelector('[name=lat]').value = ll.lat.toFixed(6); side.querySelector('[name=lng]').value = ll.lng.toFixed(6); });
    } else if (mode === 'area') {
      drawPts.push([e.latlng.lat, e.latlng.lng]);
      drawArea();
    } else if (mode === 'select' && sel) overview();
  });
  map.on('dblclick', () => { if (mode === 'area' && drawPts.length >= 3) finishArea(); });

  function drawArea() {
    if (drawLayer) layers.edit.removeLayer(drawLayer);
    drawLayer = L.layerGroup().addTo(layers.edit);
    if (drawPts.length >= 2) L.polygon(drawPts, { color: '#e0a400', weight: 3, fillOpacity: 0.1, dashArray: '6 4' }).addTo(drawLayer);
    drawPts.forEach(p => L.circleMarker(p, { radius: 5, color: '#1f2a4a', fillColor: '#ffdd00', fillOpacity: 1, weight: 2 }).addTo(drawLayer));
    side.innerHTML = `<h3>エリアを描く</h3><p>地図を押して、エリアの範囲の角を順に置いてください（市の境界に沿って大きく囲むのがおすすめ。海を含んでもかまいません）。</p>
      <p>置いた角: <b>${drawPts.length}</b></p><div class="row"><button data-finish ${drawPts.length < 3 ? 'disabled' : ''}>描き終える（ダブルクリックでも）</button><button class="sub" data-undo ${drawPts.length ? '' : 'disabled'}>1つ戻す</button><button class="sub" data-quit>やめる</button></div>
      <p class="muted small">今見えている範囲をそのまま四角いエリアにすることもできます。</p><button class="sub" data-view>今見えている範囲を使う</button>`;
    side.querySelector('[data-finish]').onclick = finishArea;
    side.querySelector('[data-undo]').onclick = () => { drawPts.pop(); drawArea(); };
    side.querySelector('[data-quit]').onclick = () => { setMode('select'); overview(); };
    side.querySelector('[data-view]').onclick = () => { const b = map.getBounds().pad(-0.08); drawPts = [[b.getNorth(), b.getWest()], [b.getNorth(), b.getEast()], [b.getSouth(), b.getEast()], [b.getSouth(), b.getWest()]]; drawArea(); };
  }
  function finishArea() {
    if (drawPts.length < 3) return;
    side.innerHTML = `<h3>新しいエリア</h3><div class="me-form">
      <label>ID（半角英小文字。例: fukuyama） <input name="id"></label>
      <label>名前（例: 広島県福山市。市区町村を1つの単位にします） <input name="name"></label>
      <label>天気の地方 <select name="region">${data.regions.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" name="urban">都会</label>
      <div class="row"><button data-add>エリアを足す</button><button class="sub" data-back>描き直す</button></div>
      <p class="muted small">足したあとに、場所を置き、最初の駅を選び、道のデータを作ると、推しを連れ出せるようになります。利用者が獲得するコードは「獲得コード」で発行します。</p></div>`;
    side.querySelector('[data-back]').onclick = drawArea;
    side.querySelector('[data-add]').onclick = async () => {
      const f = form(side.querySelector('.me-form'));
      try { await api('/areas', { method: 'POST', body: { id: f.id, name: f.name, region: f.region, urban: !!f.urban, polygon: drawPts } }); drawPts = []; setMode('select'); await load(true); selectArea(f.id); flash('エリアを足しました'); } catch (e) { alert(e.message); }
    };
  }

  /* ---- 集める・作る処理 ---- */
  async function startJob(path) {
    try {
      const r = await api(path, { method: 'POST', body: {} });
      watchJob(r.job);
    } catch (e) { alert(e.message); }
  }
  function watchJob(job) {
    clearInterval(pollTimer);
    const box = side.querySelector('.me-job');
    const draw = j => { if (box) box.innerHTML = `<div class="me-box ${j.state}"><b>${esc(j.message)}</b>${j.total ? `<progress max="${j.total}" value="${j.done}"></progress><span class="muted small">${j.done} / ${j.total}</span>` : ''}</div>`; };
    draw(job);
    pollTimer = setInterval(async () => {
      const j = await api('/jobs/' + job.id).catch(() => null); if (!j) return;
      draw(j);
      if (j.state !== 'running') { clearInterval(pollTimer); await load(true); if (sel && sel.type === 'area') { selectArea(sel.id); const b2 = side.querySelector('.me-job'); if (b2) { b2.innerHTML = `<div class="me-box ${j.state}"><b>${esc(j.message)}</b></div>`; } } }
    }, 800);
  }

  /* ---- 補助 ---- */
  function setMode(m) {
    mode = m; drawPts = []; clearEdit();
    root.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    hint.textContent = m === 'place' ? '地図を押して、場所を置く位置を選んでください（担当エリアの範囲の中）' : m === 'area' ? '地図を押して、範囲の角を置いてください' : '';
    $('.me-map').classList.toggle('crosshair', m !== 'select');
    drawAll();
    if (m === 'area') drawArea();
  }
  function clearEdit() { layers.edit.clearLayers(); dragMarker = null; editPoly = null; vertexLayer = null; drawLayer = null; }
  function form(el) { const f = {}; el.querySelectorAll('[name]').forEach(i => { f[i.name] = i.type === 'checkbox' ? i.checked : i.value; }); return f; }
  function flash(t) { hint.textContent = t; setTimeout(() => { if (hint.textContent === t) hint.textContent = ''; }, 2500); }

  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  root.querySelectorAll('[data-show]').forEach(c => c.onchange = () => { show[c.dataset.show] = c.checked; drawAll(); });
  $('[data-tile]').onchange = e => setTile(e.target.value);
  load(false).catch(e => { side.innerHTML = `<p class="err">${esc(e.message)}</p>`; });
  return { destroy() { clearInterval(pollTimer); map.remove(); } };
}
