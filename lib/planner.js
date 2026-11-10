/**
 * lib/planner.js
 * カップリングルート作成。推しが自分のために観光ルートを考える（「推し×自分」と「推し×推し」）。【AI差し替え箇所 4/7・5/7】
 *
 * 候補地ごとに点を合計し、時刻を進めながら最も点の高い場所を順に選ぶ（貪欲法）。材料は、
 * 推しの公式設定（関心、よく通う場所）、足あとの蓄積（場所ごとの訪問回数と滞在時間）、自分のプロフィール、
 * もう一人の推し、気分（「推し×自分」のときだけ）、期間のイベント、営業時間、スポットとの相性。
 * 目的は聞かない（推しが考えたルートであることに価値があり、個性も出しやすいため）。
 * ミニ推しは喋らない。文章はすべて第三者視点の天の声で書く。
 */
'use strict';

const { own } = require('./guard');

const crypto = require('crypto');
const cal = require('./calendar');
const { Router, dist } = require('./router');

const MIN = 60000, HOUR = 3600000;

// 気分の選択肢（「推し×自分」のときだけ）
const MOODS = [
  { id: 'relax', label: 'のんびり', boost: { cafe: 0.6, view: 0.5 }, walk: 0.8 },
  { id: 'eat', label: 'おなかすいた', boost: { food: 0.8, sweets: 0.6, cafe: 0.3 }, walk: 1 },
  { id: 'view', label: '景色が見たい', boost: { view: 0.9, shrine: 0.2 }, walk: 1 },
  { id: 'history', label: '歴史にふれたい', boost: { history: 0.8, shrine: 0.7 }, walk: 1 },
  { id: 'shop', label: 'お店を見たい', boost: { shop: 0.9, sweets: 0.3 }, walk: 1 },
  { id: 'quiet', label: '静かに過ごしたい', boost: { library: 0.6, shrine: 0.5, cafe: 0.3 }, walk: 0.9 },
  { id: 'walk', label: 'たくさん歩きたい', boost: { view: 0.4, shrine: 0.3 }, walk: 1.4 },
];
const LENGTHS = [
  { id: 'short', label: '2〜3時間', start: 13, stops: 3, hours: 3 },
  { id: 'half', label: '半日', start: 10, stops: 4, hours: 5 },
  { id: 'full', label: '1日', start: 9.5, stops: 6, hours: 8 },
];

// 気分の言葉の辞書（【AI差し替え箇所 4/7】ダミーは登録した言葉との照合）
const DICT = [
  { words: ['甘い', 'スイーツ', 'ケーキ', 'おやつ', 'アイス', 'プリン', 'ドーナツ'], label: '甘いもの', boost: { sweets: 0.9, cafe: 0.4 }, tags: ['甘味', 'ドーナツ', 'プリン', 'ジェラート', '和菓子'] },
  { words: ['ラーメン', '麺', 'うどん', 'お腹', 'おなか', 'ごはん', 'ご飯', '食べ'], label: '食事', boost: { food: 0.9 }, tags: ['ラーメン', 'うどん', '定食'] },
  { words: ['珈琲', 'コーヒー', 'カフェ', '喫茶'], label: 'カフェ', boost: { cafe: 0.9 }, tags: ['珈琲', '喫茶'] },
  { words: ['海', '港', '船', '潮'], label: '海', boost: { view: 0.6 }, tags: ['海辺', '港', '渡船', '潮風'] },
  { words: ['山', '登り', '高い'], label: '山', boost: { view: 0.5 }, tags: ['山', '展望'] },
  { words: ['猫', 'ねこ', 'ネコ'], label: '猫', boost: { view: 0.4, shop: 0.3 }, tags: ['猫', '路地'] },
  { words: ['写真', '映え', '景色', '夕日', '夕焼け', '夜景'], label: '景色', boost: { view: 0.9 }, tags: ['夕景', '展望', '写真'] },
  { words: ['歴史', 'お寺', '寺', '神社', '城', '昔'], label: '歴史', boost: { history: 0.7, shrine: 0.7 }, tags: ['寺', '城跡', '古刹', '古い町並み'] },
  { words: ['本', '図書館', '読書', '古本'], label: '本', boost: { library: 0.9, shop: 0.3 }, tags: ['本', '古書', '図書館'] },
  { words: ['静か', 'のんびり', 'ゆっくり', '落ち着'], label: '静か', boost: { cafe: 0.4, shrine: 0.4, library: 0.3 }, tags: ['静か'] },
  { words: ['疲れ', 'つかれ', '歩きたくない', '足が痛'], label: 'あまり歩かない', walk: 0.6 },
  { words: ['歩きたい', 'たくさん歩', '運動'], label: 'たくさん歩く', walk: 1.4 },
  { words: ['雑貨', '買い物', 'おみやげ', 'お土産', '器'], label: '買い物', boost: { shop: 0.9 }, tags: ['雑貨', '小物', '器'] },
];
const DOJO_WORDS = ['道場', '決闘', 'ジム', '空手', 'ボクシング', '剣道', '勝負', '稽古'];

/**
 * 気分の言葉を読み取る。【AI差し替え箇所 4/7】
 * 実際のサービスでは、言葉の意味をAIに読み取らせる。
 *   const ai = require('./ai');
 *   const out = await ai.complete({ json: true,
 *     system: '利用者の気分の言葉から、行きたい場所の種類（food, cafe, sweets, shop, view, shrine, history, library）の重みと、歩く量（0.5〜1.5）をJSONで答えてください。',
 *     prompt: text });
 * 本アプリのダミーは、登録した言葉を含むときだけ反映する。読み取れなかったときは、そのことを天の声で伝える。
 */
function readFreeText(text) {
  const t = String(text || '').slice(0, 100);
  if (!t.trim()) return { hits: [], unknown: false, dojo: false, boost: {}, tags: [], walk: 1 };
  const hits = []; const boost = {}; const tags = []; let walk = 1;
  for (const d of DICT) {
    const w = d.words.find(x => t.includes(x));
    if (!w) continue;
    hits.push({ word: w, label: d.label });
    for (const [k, v] of Object.entries(d.boost || {})) boost[k] = Math.max(boost[k] || 0, v);
    tags.push(...(d.tags || []));
    if (d.walk) walk = d.walk;
  }
  const dojo = DOJO_WORDS.find(w => t.includes(w));
  if (dojo) hits.push({ word: dojo, label: '道場' });
  return { hits, unknown: !hits.length, dojo: !!dojo, boost, tags, walk };
}

function create({ content, router, calendar, sim, spotDb }) {
  const W = () => content.get();
  const place = id => W().placeById.get(id);

  /** 区間の行き方を決める（設計書 16章 移動手段） */
  function chooseLegs(fromId, toId, ms, o) {
    const ex = W().TRANSIT.filter(l => l.hours && (cal.minuteOfDay(ms) / 60 < l.hours[0] || cal.minuteOfDay(ms) / 60 > l.hours[1])).map(l => l.id);
    const all = o.useTransit ? router.route(fromId, toId, { exclude: ex }) : null;
    const walk = router.route(fromId, toId, { walkOnly: true });
    const taxiOf = r => {
      const coords = r ? r.legs.flatMap(l => l.coords) : [[place(fromId).lat, place(fromId).lng], [place(toId).lat, place(toId).lng]];
      const meters = r ? r.walkM : Math.round(dist(coords[0], coords[coords.length - 1]) * 1.3);
      return { legs: [{ mode: 'taxi', name: 'タクシー', meters, coords, wait: 5 }], walkM: 0, rideM: meters, taxi: true };
    };
    if (o.useTransit && all) {
      const hasRide = all.legs.some(l => l.mode !== 'walk');
      if (all.walkM <= o.limit) return all;
      if (hasRide && all.walkM <= o.limit * 1.6) return all;
      if (o.useTaxi) {
        const special = all.legs.some(l => l.mode === 'ferry' || l.mode === 'ropeway');
        if (!special) return taxiOf(walk);
        // 渡船やロープウェイはそのまま。電車やバスと長い徒歩はまとめてタクシーにする
        const legs = []; let buf = [];
        const flush = () => { if (!buf.length) return; const m = buf.reduce((s, l) => s + l.meters, 0); const coords = buf.flatMap(l => l.coords); if (buf.every(l => l.mode === 'walk') && m <= o.limit * 0.6) legs.push(...buf); else legs.push({ mode: 'taxi', name: 'タクシー', meters: m, coords, wait: 5 }); buf = []; };
        for (const l of all.legs) { if (l.mode === 'ferry' || l.mode === 'ropeway') { flush(); legs.push(l); } else buf.push(l); }
        flush();
        return { legs, walkM: legs.filter(l => l.mode === 'walk').reduce((s, l) => s + l.meters, 0), rideM: legs.filter(l => l.mode !== 'walk').reduce((s, l) => s + l.meters, 0), taxi: true };
      }
      return all;
    }
    if (!walk) return null;
    if (walk.walkM <= o.limit || !o.useTaxi) return walk;
    return taxiOf(walk);
  }

  /** 行き方の内訳（時刻つき） */
  function accessOf(r, startMs, speed) {
    const out = []; let t = startMs;
    for (const l of r.legs) {
      const mins = l.mode === 'taxi' ? 5 + l.meters / 350 : Router.legMinutes(l, speed);
      const wait = l.mode === 'walk' ? 0 : (l.wait || 0);
      const prev = out[out.length - 1];
      if (l.mode === 'walk' && prev && prev.mode === 'walk') { prev.meters += l.meters; prev.minutes += mins; prev.endAt = t + mins * MIN; prev.coords.push(...l.coords); t += mins * MIN; continue; }
      out.push({ mode: l.mode === 'subway' || l.mode === 'shinkansen' ? (l.mode === 'subway' ? 'train' : 'train') : l.mode, rawMode: l.mode, name: l.mode === 'walk' ? '徒歩' : l.mode === 'taxi' ? 'タクシー' : l.line, from: l.from, to: l.to, fromId: l.fromId, toId: l.toId,
        meters: Math.round(l.meters), minutes: Math.round(mins), waitMin: Math.round(wait), startAt: t, endAt: t + mins * MIN, coords: l.coords.slice() });
      t += mins * MIN;
    }
    return { access: out, endAt: t };
  }

  /** 公式設定の天の声から、使っていない文を選ぶ */
  function line(list, used, R) {
    const fresh = (list || []).filter(s => !used.has(s));
    const s = fresh.length ? fresh[Math.floor(R() * fresh.length)] : (list || [])[0] || '';
    used.add(s); return s;
  }

  const REASON_LINES = {
    favorite: ['{place}は、{short}がこれまでに{count}回立ち寄った場所。', '{short}の足あとには、{place}の名前が何度も出てくる。'],
    long: ['{short}は、{place}でいつも長い時間を過ごしている。', '{place}に入ると、{short}はなかなか出てこない。'],
    affinity: ['{place}は、{short}の好みにぴったりの場所。', '{matched}。{short}がひと目で気に入りそうな場所を選んだ。'],
    event: ['この日は「{event}」がある。{short}は、ずっとその日を気にしていた。'],
    mood: ['「{mood}」という気分に合わせて、{short}は{place}を入れた。'],
    partner: ['{partner}の好みも考えて、{short}は{place}を選んだ。', '{place}なら、{partner}も楽しめると{short}は考えた。'],
    new: ['{short}もまだ行ったことのない{place}。いっしょに初めて訪れる場所として選んだ。'],
    time: ['ちょうどいい時間に着けるように、{short}は{place}を入れた。'],
    meal: ['お昼どきに合わせて、{short}は{place}を選んだ。'],
    dojo: ['{place}は、{short}が勝負を挑みたい道場。'],
    seichi: ['{place}は、{short}の物語の舞台になった場所。', '{short}にとって、{place}は特別な思い出のある場所。'],
  };
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? v[k] : ''));

  /**
   * 観光ルートを考える。【AI差し替え箇所 5/7】
   * 実際のサービスでは、候補と材料をAIに渡してルートと天の声の文章を考えさせる。
   *   const ai = require('./ai');
   *   const out = await ai.complete({ json: true,
   *     system: '推しが相手のために考えた観光ルートを作ってください。推しは喋りません。文章はすべて第三者の天の声で書いてください。',
   *     prompt: JSON.stringify({ character, canon, visits: summary.places.slice(0, 30), partner, mood, events, candidates }) });
   * 本アプリのダミーは、点数計算と用意した文章で作る。
   */
  function plan(u, b, ctx) {
    const w = W();
    const c = w.charById.get(b.characterId);
    if (!c || !own(u.characters, c.id)) return { error: '推しを選んでください', status: 400 };
    const canon = w.CANON[c.id] || {};
    const partnerIsSelf = !b.partner || b.partner === 'self';
    const pc = partnerIsSelf ? null : w.charById.get(b.partner);
    if (!partnerIsSelf && (!pc || !own(u.characters, pc.id) || pc.id === c.id)) return { error: 'もう一人の推しを選んでください', status: 400 };
    const areaId = String(b.areaId || '');
    if (!own(u.areas, areaId)) return { error: 'エリアを選んでください', status: 400 };
    const len = LENGTHS.find(l => l.id === b.length) || LENGTHS[1];
    // 正しくない日付（9999-99-99 など）は使わない。以前は日を1日ずつ進める処理が終わらず、サーバ全体が止まった
    const from = cal.validDay(b.from) ? b.from : ctx.today;
    let to = cal.validDay(b.to) ? b.to : from;
    if (to < from) to = from;
    if (cal.daysBetween(from, to) > 30) to = cal.addDays(from, 30);
    const useTransit = b.useTransit !== false, useTaxi = b.useTaxi !== false;
    const mood = partnerIsSelf ? MOODS.find(m => m.id === b.mood) || null : null;
    const moodText = partnerIsSelf ? String(b.moodText || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 100) : '';
    const read = partnerIsSelf ? readFreeText(moodText) : readFreeText('');
    const R = cal.rng(`plan|${u.id}|${c.id}|${pc ? pc.id : 'self'}|${areaId}|${from}|${to}|${len.id}|${mood ? mood.id : ''}|${moodText}|${useTransit}|${useTaxi}|${Date.now() >> 16}`);
    const usedLines = new Set();

    // 足あとの蓄積
    const sum = sim.summarizeVisits(c, ctx.whoOf(c.id), ctx.today, ctx.now);
    const visits = new Map(sum.places.map(x => [x.placeId, x]));
    const psum = pc ? sim.summarizeVisits(pc, ctx.whoOf(pc.id), ctx.today, ctx.now) : null;
    const pvisits = psum ? new Map(psum.places.map(x => [x.placeId, x])) : new Map();
    const aff = spotDb.affinityFor(c.id); const paff = pc ? spotDb.affinityFor(pc.id) : {};

    // 日を選ぶ（期間の中で、関心の高いイベントのある日）
    let day = from, event = null, best = 0;
    for (let d = from, n = 0; d <= to && n < 32; d = cal.addDays(d, 1), n++) {
      for (const ev of sim.eventsOn(areaId, d)) {
        if (!ev.placeId || !place(ev.placeId)) continue;
        const iv = Math.max(sim.eventInterest(c.id, ev), pc ? sim.eventInterest(pc.id, ev) * 0.8 : 0);
        if (iv >= 0.7 && iv > best) { best = iv; day = d; event = ev; }
      }
    }
    if (!event) { // 休みの日を選びやすくする
      for (let d = from, n = 0; d <= to && n < 32; d = cal.addDays(d, 1), n++) if (!calendar.isWorkday(d, 'work')) { day = d; break; }
    }
    const region = (w.areaById.get(areaId) || {}).region;
    const hourly = calendar.hourlyOf(day, region);

    // 歩ける量（推しと利用者、もう一人の推しの少ないほう）
    const userWalk = partnerIsSelf ? ({ little: 3000, normal: 6000, lots: 10000 }[(u.profile || {}).walk] || 6000) : (pc.range * 4);
    const walkFactor = (mood ? mood.walk : 1) * read.walk;
    const limit = Math.max(700, Math.min(c.range * 0.55, userWalk / 5) * walkFactor);
    const speed = pc ? Math.min(c.speed, pc.speed) : Math.min(c.speed, 70);
    const userLikes = partnerIsSelf ? ((u.profile || {}).likes || []) : [];
    const LIKE_CAT = { 甘いもの: 'sweets', ラーメン: 'food', 珈琲: 'cafe', パン: 'sweets', 景色: 'view', 写真: 'view', 寺社: 'shrine', 歴史: 'history', 本: 'library', 猫: 'view', 雑貨: 'shop', 海: 'view', 山: 'view', 夜景: 'view', 和菓子: 'sweets' };

    const arrival = (w.areaById.get(areaId) || {}).arrival;
    let start = cal.dayStart(day) + len.start * HOUR;
    if (event && event.hours[0] >= 16) start = cal.dayStart(day) + Math.max(9.5, event.hours[0] - len.hours) * HOUR;
    let t = start; let cur = arrival;
    const stops = []; const genreCount = new Map(); const chosen = new Set();
    const dojoOk = read.dojo && c.id === 'musashi';
    const candidates = w.PLACES.filter(p => p.area === areaId && !p.closed && !p.hidden && !['home', 'school', 'station', 'stay'].includes(p.cat) &&
      !sim.isNg(c, p) && !(pc && sim.isNg(pc, p)) && // NG行動の場所は、ルートにも入れない
      (!p.noRoute || (dojoOk && p.cat === 'dojo')) && (!p.onlyFor || (dojoOk && p.onlyFor.includes(c.id))));
    const reachable = id => useTransit || router.route(arrival, id, { walkOnly: true });
    const maxStops = len.stops;

    for (let k = 0; k < maxStops; k++) {
      const lastStop = k === maxStops - 1;
      const scored = [];
      const curP = place(cur);
      for (const p of candidates) {
        if (chosen.has(p.id)) continue;
        if (dist([curP.lat, curP.lng], [p.lat, p.lng]) > limit * 3.5) continue;
        let s = 0; let reason = 'time'; let top = 0;
        const add = (key, v) => { s += v; if (v > top) { top = v; reason = key; } };
        add('time', ((c.interests[p.cat] || 0)) * 2.5);
        if (pc) add('partner', (pc.interests[p.cat] || 0) * 2);
        const v = visits.get(p.id);
        if (v) { add('favorite', Math.log(1 + v.count) * 1.3); add('long', Math.min(2, v.minutes / 240)); }
        const pv = pvisits.get(p.id); if (pv) add('partner', Math.log(1 + pv.count) * 0.9);
        if (aff[p.id] !== undefined) add('affinity', Math.max(-2, (aff[p.id] - 50) / 50 * 2.4));
        if (pc && paff[p.id] !== undefined) s += Math.max(-1.5, (paff[p.id] - 50) / 50 * 1.5);
        if (mood) add('mood', (mood.boost[p.cat] || 0) * 2);
        if (read.boost[p.cat]) add('mood', read.boost[p.cat] * 1.6);
        if (read.tags.length) { const sp = spotDb.spot(p.id); if (sp && read.tags.some(tg => (sp.tags || []).includes(tg) || (sp.genre || '').includes(tg))) add('mood', 1.5); }
        for (const l of userLikes) if (LIKE_CAT[l] === p.cat) add('mood', 0.6);
        if (!v && !pv) add('new', c.curiosity * 0.8);
        if (dojoOk && p.cat === 'dojo') add('dojo', 4);
        if (p.seichi && (p.seichi.workId === c.workId || (pc && p.seichi.workId === pc.workId))) add('seichi', 2.5);
        if (event && p.id === event.placeId) add('event', lastStop || event.hours[0] < 16 ? 6 : -10);
        const g = p.trait || p.cat; s -= (genreCount.get(g) || 0) ** 2 * 3;
        const sn = router.snap.get(p.id); const sc = router.snap.get(cur);
        if (!sn || !sc) continue;
        const D = router.tree(sc.node, { walkOnly: !useTransit }).D[sn.node];
        if (!isFinite(D)) continue;
        const approx = D * 70;
        s -= approx / (limit * 2.2);
        const arriveH = cal.minuteOfDay(t + D * MIN) / 60;
        if (!sim.isOpen(p, arriveH)) continue;
        if (p.cat === 'food' && arriveH >= 11.3 && arriveH < 13.8 && !stops.some(x => x.cat === 'food')) add('meal', 2);
        if (p.outdoor) { const wet = hourly[Math.floor(arriveH)] === 'rain'; if (c.rainLover) s += wet ? 1.5 : -1; else if (wet) s -= 2.5; } // 雨好きは雨の日に外を選ぶ
        s += R() * 0.6;
        scored.push({ p, s, reason });
      }
      scored.sort((a, b) => b.s - a.s);
      let pickd = null;
      for (const x of scored.slice(0, 6)) {
        if (!useTransit && !reachable(x.p.id)) continue;
        const r = chooseLegs(cur, x.p.id, t, { useTransit, useTaxi, limit });
        if (!r) continue;
        const pen = r.taxi ? 0.8 : 0;
        if (!pickd || x.s - pen > pickd.s) pickd = { ...x, s: x.s - pen, r };
      }
      if (!pickd) break;
      const { access, endAt } = accessOf(pickd.r, t, speed);
      const stayMin = Math.round(Math.max(20, Math.min(90, (pickd.p.stay || 40) * (len.id === 'short' ? 0.8 : 1))));
      const p = pickd.p;
      const v = visits.get(p.id);
      const sp = spotDb.spot(p.id); const scoreRec = spotDb.score(c.id, p.id);
      const vars = { short: c.short, place: p.name, count: v ? v.count : 0, partner: pc ? pc.short : (u.profile.nickname || 'あなた'), event: event ? event.title : '', mood: mood ? mood.label : (read.hits[0] || {}).word || '', matched: scoreRec && scoreRec.matched.length ? `${scoreRec.matched.slice(0, 2).join('と')}が好きな${c.short}` : `${c.short}` };
      const doing = sim && (w.CANON[c.id] || {}).doing ? null : null;
      const narration = fill(line(REASON_LINES[pickd.reason] || REASON_LINES.time, usedLines, R), vars);
      stops.push({
        placeId: p.id, name: p.name, cat: p.cat, genre: p.genre || (sp && sp.genre) || (w.CATEGORIES[p.cat] || {}).label, lat: p.lat, lng: p.lng,
        fictional: !!p.fictional, departAt: t, arriveAt: endAt, leaveAt: endAt + stayMin * MIN, stayMin,
        access, reasonKey: pickd.reason, narration,
        why: whyList(pickd.reason, { v, aff: aff[p.id], event, mood, read, p, pc, pv: pvisits.get(p.id) }),
        highlight: scoreRec && scoreRec.highlight ? scoreRec.highlight : null,
        desc: p.desc, url: p.url || '',
      });
      genreCount.set(p.trait || p.cat, (genreCount.get(p.trait || p.cat) || 0) + 1);
      chosen.add(p.id);
      t = endAt + stayMin * MIN; cur = p.id;
      if (t > cal.dayStart(day) + Math.min(21.5, len.start + len.hours + 1.5) * HOUR) break;
    }
    if (!stops.length) return { error: '条件に合う場所が見つかりませんでした。移動手段や長さを変えてみてください', status: 422 };

    const walkM = stops.reduce((s, x) => s + x.access.filter(a => a.mode === 'walk').reduce((a, b) => a + b.meters, 0), 0);
    const rideM = stops.reduce((s, x) => s + x.access.filter(a => a.mode !== 'walk').reduce((a, b) => a + b.meters, 0), 0);
    const nickname = partnerIsSelf ? (u.profile.nickname || 'あなた') : pc.short;
    const thoughts = [
      `${c.short}は、これまでの足あと${sum.days.length}日分を思い返している。`,
      sum.places[0] ? `${place(sum.places[0].placeId).name}のことを考えている。` : `${w.areaById.get(areaId).short}の地図を広げている。`,
      event ? `「${event.title}」の日付を確かめている。` : `${cal.weekday(day) === 0 || cal.weekday(day) === 6 ? '休みの日' : 'その日'}の天気を気にしている。`,
      pc ? `${pc.short}の好きなものを思い出している。` : (userLikes.length ? `${nickname}の好きな「${userLikes[0]}」のことを考えている。` : `${nickname}が楽しめそうな場所を探している。`),
      `歩く道と乗り物を見くらべている。`,
    ];
    let moodNote = '';
    if (partnerIsSelf && moodText) {
      if (read.dojo && c.id !== 'musashi') moodNote = `道場や勝負のことは、${c.short}にはよくわからなかった。`;
      else if (read.unknown) moodNote = `「${moodText.slice(0, 20)}」という言葉の意味を、${c.short}はうまく読み取れなかった。`;
      else moodNote = `${c.short}は、「${read.hits.map(h => h.word).join('」「')}」という言葉を受けとめた。`;
    }
    const route = {
      id: crypto.randomBytes(8).toString('hex'), createdAt: ctx.now,
      characterId: c.id, characterName: c.short, partner: pc ? pc.id : 'self', partnerName: nickname,
      areaId, areaName: w.areaById.get(areaId).short, day, from, to, length: len.id, lengthLabel: len.label,
      mood: mood ? mood.id : null, moodLabel: mood ? mood.label : null, moodText, read: read.hits, moodNote,
      useTransit, useTaxi, event: event ? { id: event.id, title: event.title, hours: event.hours, placeId: event.placeId } : null,
      start: arrival, startName: place(arrival).name, startAt: start,
      stops, totals: { walkM: Math.round(walkM), rideM: Math.round(rideM), minutes: Math.round((stops[stops.length - 1].leaveAt - start) / MIN), stops: stops.length },
      open: line((canon.narration || {}).open, usedLines, R) || `${c.short}は、静かにルートを考えはじめた。`,
      close: line((canon.narration || {}).close, usedLines, R) || `${c.short}の考えたルートは、ここでおしまい。`,
      thoughts, weather: hourly,
      note: pc ? `「推し×推し」は、ふたりを組み合わせたらどうなるかのシミュレーションです。公式の関係ではありません。` : null,
      fictionalNote: stops.some(s => s.fictional) ? '「架空の施設」はデモ用に作った場所で、実在しません。' : null,
    };
    return route;
  }

  function whyList(key, o) {
    const out = [];
    if (o.v) out.push(`足あと: ${o.v.count}回、合わせて${Math.round(o.v.minutes)}分`);
    if (o.aff !== undefined) out.push(`好みとの相性: ${o.aff}点`);
    if (o.event && o.p.id === o.event.placeId) out.push(`イベント: ${o.event.title}`);
    if (o.mood && (o.mood.boost[o.p.cat] || 0) > 0) out.push(`気分: ${o.mood.label}`);
    if (o.read && o.read.boost[o.p.cat]) out.push(`言葉: ${o.read.hits.map(h => h.word).join('、')}`);
    if (o.pc && o.pv) out.push(`${o.pc.short}の足あと: ${o.pv.count}回`);
    if (!o.v) out.push('まだ行ったことのない場所');
    return out;
  }

  function summary(r) {
    return { id: r.id, createdAt: r.createdAt, characterId: r.characterId, characterName: r.characterName, partner: r.partner, partnerName: r.partnerName,
      areaId: r.areaId, areaName: r.areaName, day: r.day, lengthLabel: r.lengthLabel, stops: r.stops.length, names: r.stops.slice(0, 3).map(s => s.name), event: r.event ? r.event.title : null, moodLabel: r.moodLabel };
  }

  return { plan, summary, chooseLegs, readFreeText, MOODS: MOODS.map(m => ({ id: m.id, label: m.label })), LENGTHS: LENGTHS.map(l => ({ id: l.id, label: l.label })) };
}

module.exports = { create, readFreeText, MOODS, LENGTHS };
