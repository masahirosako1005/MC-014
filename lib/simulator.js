/**
 * lib/simulator.js
 * 行動判断AI（ユーティリティAI）と旅の計算。
 *
 * 外部のAIを使えないため、推しの行動原理（data/world.js の数値と data/canon.js の公式設定）から、
 * 滞在を終えるたびに候補地に点数を付けて、次の行き先を決める（設計書 7章）。
 *
 * 旅の記録は保存しない。推しをエリアへ連れて行った履歴（travelLog）だけを持ち、
 * 最初に連れて行った日から1日ずつ、毎回最初から計算する。乱数の種は「キャラと日付」で固定しているので、
 * 何度計算しても過去は変わらない。1日分の結果は DAY_CACHE に覚えて使い回す。
 *
 * 1日の流れ
 *   起きる → （平日）通り道を通って学校・仕事へ → 放課後・休みの日は、連れて行ったエリアで寄り道 → 家に帰る
 *   神の手がエリアを移すと、その時刻に今の行動を切り上げて、移動先の最初の駅へ移る（移動の時間はかからない）。
 *   夜遅くに移されたときは、時間の感覚（canon.night）で、帰る・泊まる・夜を明かすを決める。
 */
'use strict';

const cal = require('./calendar');
const { Router, dist, inPoly } = require('./router');

const MIN = 60000;
const HOUR = 3600000;

function createSimulator({ content, router, calendar }) {
  const DAY_CACHE = new Map();
  // エリアごとの場所の一覧（場所が5000か所を超えるので、毎回すべてを調べない）
  let areaIndex = null, areaIndexVer = null;
  function placesIn(areaId) {
    const w = W();
    if (areaIndexVer !== w.version || !areaIndex) {
      areaIndex = new Map(); areaIndexVer = w.version;
      for (const p of w.PLACES) {
        if (['home', 'stay', 'school', 'station'].includes(p.cat) || p.closed || p.hidden) continue;
        if (!areaIndex.has(p.area)) areaIndex.set(p.area, []);
        areaIndex.get(p.area).push(p);
      }
    }
    return areaIndex.get(areaId) || [];
  }

  /* ---------------------------------------------------------------- 補助 */
  const W = () => content.get();
  const place = id => W().placeById.get(id);
  const fmtArea = id => (W().areaById.get(id) || {}).short || id;

  function regionOf(areaId) { const a = W().areaById.get(areaId); return a ? a.region : 'setouchi'; }
  function slopeOf(p) { for (const s of W().SLOPES) if (inPoly([p.lat, p.lng], s.polygon)) return s; return null; }

  /** 開いているか（到着の時刻、時は小数） */
  function isOpen(p, hour) {
    if (p.closed) return false;
    if (p.always || !p.hours) return true;
    const [o, c] = p.hours;
    return hour >= o && hour <= c - 0.25;
  }

  /** イベントの関心（0〜1）。種類の関心のいちばん高いものに、ほかの一致を少し足す */
  function eventInterest(charId, ev) {
    const tags = (W().CANON[charId] || {}).eventTags || {}; // 他の人の推しは関心なし
    const vals = (ev.tags || []).map(t => tags[t] || 0).sort((a, b) => b - a);
    if (!vals.length) return 0;
    return Math.min(1, vals[0] + vals.slice(1).reduce((s, v) => s + v * 0.1, 0));
  }
  function eventsOn(areaId, day) {
    return W().EVENTS.filter(e => !e.hidden && e.area === areaId && day >= e.start && day <= e.end);
  }
  function postersOn(areaId, day) {
    return W().EVENTS.filter(e => !e.hidden && e.area === areaId && day >= cal.addDays(e.start, -21) && day <= e.end);
  }

  /** 公式設定の時間の感覚。次の日が学校や仕事の日か */
  function mustReturnNext(c, canon, day) {
    const next = cal.addDays(day, 1);
    const m = (canon.night || {}).mustReturn;
    if (m === 'school') return calendar.isWorkday(next, 'school');
    if (m === 'work') return calendar.isWorkday(next, 'work');
    if (m === 'deadline') { const d = Number(next.slice(8, 10)); return d === 10 || d === 25; }
    return false;
  }

  /** 推しが乗れない乗り物（時間外）。武蔵は遠くへ行くとき以外は乗らない */
  function excludeAt(ms) {
    const h = cal.minuteOfDay(ms) / 60;
    return W().TRANSIT.filter(l => l.hours && (h < l.hours[0] || h > l.hours[1])).map(l => l.id);
  }
  function routeFor(c, fromId, toId, ms, sameArea) {
    const o = { exclude: excludeAt(ms) };
    if (c.vehicle === 0 && sameArea) o.walkOnly = true;
    return router.route(fromId, toId, o);
  }

  /** NG行動に当たる場所か（行かない場所の種類、名前やジャンルに入らない言葉がある） */
  function isNg(c, p) {
    const g = c.ng; if (!g) return false;
    if ((g.cats || []).includes(p.cat)) return true;
    const text = (p.name || '') + (p.genre || '') + (p.trait || '');
    return (g.words || []).some(w => w && text.includes(w));
  }

  /* ---------------------------------------------------------------- 描写（【AI差し替え箇所 2/7】） */
  /**
   * 訪問先での推しの様子を書く。場所専用、キャラ固有、カテゴリ共通の順に、用意した文章から選ぶ。
   *
   * 【AI差し替え箇所 2/7】実際のサービスでは、ここでAIに推しの様子を書かせる。
   *   const ai = require('./ai');
   *   const text = await ai.complete({
   *     system: 'あなたは第三者の天の声です。推しに台詞を言わせず、1文で推しの様子を書いてください。',
   *     prompt: JSON.stringify({ character: canon.personality, place: p.name, category: p.cat, hour, weather }),
   *   });
   * 旅は毎回最初から計算するので、AIの結果は1日ごとに保存して使い回すこと（設計書 20章）。
   */
  function chooseDoing(c, p, R, used) {
    const canon = c.canon || W().CANON[c.id] || {};
    const pools = [(canon.doing || {})[p.id], (canon.doing || {})[p.trait], p.doing, (canon.doing || {})[p.cat], W().COMMON_DOING[p.trait], W().COMMON_DOING[p.cat]].filter(x => x && x.length);
    for (const pool of pools) {
      const fresh = pool.filter(s => !used.has(s));
      if (fresh.length) { const s = fresh[Math.floor(R() * fresh.length)]; used.add(s); return s; }
    }
    return '';
  }

  /* ---------------------------------------------------------------- 行き先を決める（【AI差し替え箇所 1/7】） */
  /**
   * 次の行き先を決める。候補ごとに点数を付け、最も点の高い場所へ向かう（設計書 7章の式）。
   *
   * 【AI差し替え箇所 1/7】実際のサービスでは、候補の一覧と推しの行動原理をAIに渡して選ばせる。
   *   const ai = require('./ai');
   *   const pick = await ai.complete({
   *     system: '推しの行動原理に従い、次に向かう場所のidを1つだけ答えてください。',
   *     prompt: JSON.stringify({ character: c, canon, candidates: list.map(x => ({ id: x.p.id, cat: x.p.cat, minutes: x.min })) }),
   *   });
   * 旅は毎回最初から計算するので、AIの結果は1日ごとに保存して使い回すこと（設計書 20章）。
   */
  function chooseNext(S, ctx, opts) {
    const c = ctx.c, canon = ctx.canon, R = ctx.R;
    const cur = place(S.place);
    if (!cur) return null;
    const hourAt = ms => cal.minuteOfDay(ms) / 60;
    const away = !c.homeAreas.includes(S.area);
    const aw = away ? (canon.away || {}) : {};
    const range = c.range * (aw.rangeFactor || 1);
    const raining = calendar.rainingAt(S.t, regionOf(S.area));
    const evs = eventsOn(S.area, ctx.day);
    const favorite = new Map((c.favorites || []).map(f => [f.id, f.w]));
    const avoidSlope = ((canon.tastes || {}).avoid || []).some(w => w === '坂' || w === '石段');
    const aff = ctx.affinity || null;
    const srcSnap = router.snap.get(S.place);
    if (!srcSnap) return null;
    const tree = router.tree(srcSnap.node, { exclude: excludeAt(S.t), walkOnly: c.vehicle === 0 });
    const pool = opts.pool ? new Set(opts.pool) : null;

    const prelim = [];
    for (const p of placesIn(S.area)) {
      if (p.id === S.place) continue;
      if (p.onlyFor && !p.onlyFor.includes(c.id)) continue;
      if (pool && !pool.has(p.id)) continue;
      if (isNg(c, p)) continue; // 自治体が決めたNG行動（行かない場所の種類、入らない場所の言葉）
      const d = dist([cur.lat, cur.lng], [p.lat, p.lng]);
      if (!pool && d > range * 2.2 && !favorite.has(p.id)) continue;
      const sn = router.snap.get(p.id); if (!sn) continue;
      const m = tree.D[sn.node]; if (!isFinite(m)) continue;
      const approxMin = m * 70 / c.speed + (sn.d + srcSnap.d) / c.speed;
      const arriveMs = S.t + approxMin * MIN;
      if (!isOpen(p, hourAt(arriveMs))) continue;
      if (opts.deadline && arriveMs + (p.stay || 30) * 0.6 * MIN > opts.deadline) continue;

      // 関心（場所の種類）。相性が60点を超える場所は、相性から見た関心と高いほうを使う（設計書 21章）
      let interest = (c.interests[p.cat] || 0) + ((aw.boost || {})[p.cat] || 0);
      const score = aff && aff[p.id];
      if (score !== undefined && score > 60) interest = Math.max(interest, score / 100);
      // 自治体が登録した、その推しの作品の聖地には立ち寄りやすい
      const seichi = p.seichi && p.seichi.workId === c.workId;
      if (seichi) interest = Math.max(interest, 0.9);
      if (interest <= 0.02 && !favorite.has(p.id)) continue;
      let s = interest * 3;
      // 時間帯の適合
      const h = hourAt(arriveMs);
      if ((p.cat === 'food') && ((h >= 11 && h < 14) || (h >= 18 && h < 20.5))) s += 1.4;
      if (p.cat === 'cafe' && h >= 13.5 && h < 17) s += 0.8;
      if (p.cat === 'sweets' && h >= 14 && h < 17.5) s += 0.9;
      if (p.cat === 'view' && h >= 16 && h < 18.7) s += 1.2;
      if ((p.cat === 'shrine') && h < 10) s += 0.6;
      if (p.cat === 'dojo' && h >= 9 && h < 20) s += 0.5;
      // 未訪問なら好奇心
      if (!ctx.everVisited.has(p.id)) s += c.curiosity * 1.5 * (aw.curiosityFactor || 1);
      // よく通う場所
      if (favorite.has(p.id)) s += favorite.get(p.id) * 2;
      if (seichi) s += 1.2;
      // 関心の高いイベントの開催中
      for (const ev of evs) if (ev.placeId === p.id && h >= ev.hours[0] && h <= ev.hours[1]) { const iv = eventInterest(c.id, ev); if (iv >= 0.7) s += iv * 5; }
      // 減点
      const cnt = S.todayCount.get(p.id) || 0;
      s -= cnt * 2.5 + (cnt >= 2 ? 3 : 0);
      const wet = p.outdoor && (raining || calendar.rainingAt(arriveMs, regionOf(S.area)));
      // 雨好き（もやしペンギン）は、雨の日に外の場所を選び、晴れた日は日なた（外の場所）を避ける
      if (c.rainLover) { if (p.outdoor) s += wet ? 2 : -1.2; } else if (wet) s -= 3;
      if (S.lastCat === p.cat) s -= 1;
      if ((p.cat === 'food' || p.cat === 'sweets') && S.lastMeal && arriveMs - S.lastMeal < 4 * HOUR) s -= c.eatFirst ? 1.5 : 4;
      if (avoidSlope && slopeOf(p)) s -= 2.5;
      // 相性（50点を境に最大2.2点）
      if (score !== undefined) s += Math.max(-2.2, Math.min(2.2, (score - 50) / 50 * 2.2));
      const walkGuess = m * 70;
      s -= walkGuess / range;
      s += R() * 0.8;
      prelim.push({ p, s, approxMin });
    }
    if (!prelim.length) return null;
    prelim.sort((a, b) => b.s - a.s);
    // 上位の候補だけ本当の経路を求め、乗り物の点を足して決める
    let best = null;
    for (const x of prelim.slice(0, 5)) {
      const r = routeFor(c, S.place, x.p.id, S.t, true);
      if (!r) continue;
      let s = x.s + x.approxMin * 0; // 歩く距離の減点は見積もり済み
      const rides = r.legs.filter(l => l.mode !== 'walk');
      for (const l of rides) {
        if (!S.ridden.has(l.mode)) s += c.vehicle * 1.8;
        s -= (Router.legMinutes(l, c.speed)) * 0.05;
      }
      if (!best || s > best.s) best = { p: x.p, s, r };
    }
    return best && best.s > -1.5 ? best : null;
  }

  /* ---------------------------------------------------------------- 1日の計算 */
  function simulateDay(c, day, startState, chain) {
    const canon = c.canon || W().CANON[c.id] || {};
    const routine = canon.routine || {};
    const night = canon.night || { lateHour: 21, stayIfFarMin: 60, lines: {} };
    const ds = cal.dayStart(day);
    const at = h => ds + h * HOUR;
    const R = cal.rng(`${c.id}|${day}|${W().version}`);
    const log = chain.log;
    const dayMoves = cal.moves(log, day);
    const used = new Set();
    const out = { day, items: [], legs: [], visits: [], walkM: 0, rideM: 0 };
    const ctx = { c, canon, R, day, everVisited: chain.everVisited, affinity: chain.affinity };
    const homeId = c.home;
    const S = {
      place: startState.place, area: placementAtSafe(ds), t: ds, todayCount: new Map(), ridden: new Set(),
      lastCat: null, lastMeal: chain.lastMeal || 0, pendingWalk: 0, stopAt: null, pos: null,
    };
    function placementAtSafe(ms) { return cal.placementAt(log, ms); }
    const pt = id => { const p = place(id); return p ? [p.lat, p.lng] : null; };
    const short = c.short;

    function push(item) {
      const p = item.placeId ? place(item.placeId) : null;
      if (p && item.lat === undefined) { item.lat = p.lat; item.lng = p.lng; }
      out.items.push(item);
      return item;
    }

    /** 経路をたどる。途中で神の手が入ったら false */
    function travel(toId, o = {}) {
      if (S.place === toId) return true;
      const from = place(S.place), to = place(toId);
      const sameArea = from && to && from.area === to.area;
      let r = routeFor(c, S.place, toId, S.t, sameArea);
      if (!r) { const m = Math.round(dist([from.lat, from.lng], [to.lat, to.lng]) * 1.3); r = { legs: [{ mode: 'walk', meters: m, effMeters: m, coords: [[from.lat, from.lng], [to.lat, to.lng]] }] }; }
      let t = S.t; let walkSince = S.pendingWalk;
      for (const leg of r.legs) {
        const durMin = Router.legMinutes(leg, c.speed);
        const startAt = leg.mode === 'walk' ? t : t + (leg.wait || 0) * MIN;
        const endAt = t + durMin * MIN;
        if (S.stopAt && endAt > S.stopAt) {
          // 途中で切り上げる
          const frac = Math.max(0, Math.min(1, (S.stopAt - startAt) / Math.max(1, endAt - startAt)));
          const part = cutLine(leg.coords, frac);
          if (part.length > 1 && frac > 0) {
            out.legs.push({ mode: leg.mode, line: leg.line, coords: part, startAt, endAt: S.stopAt, meters: Math.round(leg.meters * frac) });
            if (leg.mode === 'walk') { out.walkM += leg.meters * frac; } else { out.rideM += leg.meters * frac; }
          }
          S.t = S.stopAt; S.place = null; S.pos = part[part.length - 1] || null;
          return false;
        }
        out.legs.push({ mode: leg.mode, line: leg.line, from: leg.from, to: leg.to, fromId: leg.fromId, toId: leg.toId, coords: leg.coords, startAt, endAt, meters: leg.meters });
        if (leg.mode === 'walk') { out.walkM += leg.meters; walkSince += leg.meters; }
        else {
          out.rideM += leg.meters;
          S.ridden.add(leg.mode);
          const toP = place(leg.toId);
          push({ type: 'ride', at: startAt, mode: leg.mode, line: leg.line, from: leg.from, to: leg.to, toId: leg.toId,
            text: rideText(short, leg), meters: leg.meters, lat: leg.coords[0][0], lng: leg.coords[0][1],
            sub: o.morning && !o.morningUsed ? (o.morningUsed = true, night.lines.morning || '') : undefined });
          walkSince = 0;
          // 駅のポスター（降りた駅のエリアのイベント）
          if (toP) posterAt(toP, endAt);
        }
        t = endAt;
      }
      S.t = t; S.place = toId; S.pendingWalk = walkSince; S.pos = null;
      return true;
    }

    /** 場所で過ごす。途中で神の手が入ったら false */
    function stay(minutes) {
      const until = S.t + minutes * MIN;
      if (S.stopAt && until > S.stopAt) { S.t = S.stopAt; return false; }
      S.t = until; return true;
    }

    function visit(pId, minutes, kind = 'visit', sub) {
      const p = place(pId);
      const again = S.todayCount.has(pId);
      const text = kind === 'anchor' ? `${short}が${p.name}に着いた。` : kind === 'pass' ? `${short}が${p.name}の前を通った。` : again ? `${short}が${p.name}に戻った。` : `${short}が${p.name}を訪れた。`;
      const item = push({ type: kind === 'pass' ? 'pass' : 'visit', at: S.t, placeId: pId, text, walkM: Math.round(S.pendingWalk),
        sub: sub !== undefined ? sub : (kind === 'visit' ? chooseDoing(c, p, R, used) : undefined), cat: p.cat, fictional: !!p.fictional });
      S.pendingWalk = 0;
      const v = { placeId: pId, at: S.t, leave: S.t, kind, doing: item.sub || '' };
      out.visits.push(v);
      S.todayCount.set(pId, (S.todayCount.get(pId) || 0) + 1);
      S.lastCat = p.cat;
      if (p.cat === 'food' || p.cat === 'sweets') S.lastMeal = S.t;
      ctx.everVisited.add(pId);
      const ok = minutes > 0 ? stay(minutes) : true;
      v.leave = S.t; item.leave = S.t;
      return ok;
    }

    const posterSeen = new Set();
    function posterAt(st, ms) {
      if (st.cat !== 'station' || posterSeen.size) return;
      const d = cal.dayKey(ms);
      for (const ev of postersOn(st.area, d)) {
        if (posterSeen.has(ev.id)) continue;
        posterSeen.add(ev.id);
        const iv = eventInterest(c.id, ev);
        push({ type: 'poster', at: ms, placeId: st.id, eventId: ev.id, text: `${short}が${st.name}で「${ev.title}」のポスターを見つけた。`,
          sub: iv >= 0.35 ? 'ポスターの前で足を止め、日付のところをしばらく見ていた。' : 'ちらりと見ただけで、そのまま通り過ぎた。', interest: Math.round(iv * 100) / 100 });
        return;
      }
    }

    function goHome(sub) {
      if (S.place === homeId) return true;
      const ok = travel(homeId);
      if (!ok) return false;
      push({ type: 'home', at: S.t, placeId: homeId, text: `${short}が家に帰った。`, walkM: Math.round(S.pendingWalk), sub });
      S.pendingWalk = 0;
      return true;
    }

    /** 家までの時間（分） */
    function minutesTo(fromId, toId, ms) {
      const f = place(fromId), t = place(toId);
      if (!f || !t) return 0;
      return Router.routeMinutes(routeFor(c, fromId, toId, ms, f.area === t.area), c.speed);
    }

    /** 家までの時間の見積もり（家からの最短の木を使う。乗り物の待ち時間の向きの違いは無視する） */
    function minutesHome(fromId, homeIdArg, ms) {
      const f = place(fromId), hp = place(homeIdArg);
      if (!f || !hp) return 0;
      if (f.area !== hp.area) return minutesTo(fromId, homeIdArg, ms);
      const sh = router.snap.get(homeIdArg), sf = router.snap.get(fromId);
      if (!sh || !sf) return minutesTo(fromId, homeIdArg, ms);
      const d = router.tree(sh.node, { walkOnly: c.vehicle === 0 }).D[sf.node];
      return isFinite(d) ? d * 70 / c.speed + (sh.d + sf.d) / c.speed : minutesTo(fromId, homeIdArg, ms);
    }

    /** 夜遅くに移されたときの判断（設計書 14章 時間の感覚） */
    function settleNight() {
      const L = night.lines || {};
      const homeMin = minutesTo(S.place, homeId, S.t);
      if (homeMin <= 30) return goHome(L.near || L.goHome);
      if (mustReturnNext(c, canon, day)) return goHome(L.workday || L.goHome);
      if (homeMin <= (night.stayIfFarMin || 60)) return goHome(L.goHome);
      const hotels = W().PLACES.filter(p => p.cat === 'stay' && p.area === S.area && !p.closed);
      let hotel = null, hm = Infinity;
      if (!canon.camp && !c.camp) for (const h of hotels) { const m = minutesTo(S.place, h.id, S.t); if (m < hm) { hm = m; hotel = h; } }
      if (hotel && hm <= 45) {
        if (!travel(hotel.id)) return false;
        push({ type: 'stay', at: S.t, placeId: hotel.id, text: `${short}が${hotel.name}に泊まった。`, sub: L.stay, walkM: Math.round(S.pendingWalk) });
        S.pendingWalk = 0; S.overnight = hotel.id; return true;
      }
      if (canon.camp || c.camp) {
        const st = place(S.place);
        push({ type: 'stay', at: S.t + 20 * MIN, placeId: S.place, text: `${short}が${st.name}で夜を明かした。`, sub: L.camp || L.stay });
        S.overnight = S.place; return true;
      }
      return goHome(L.goHome);
    }

    /** 知らない土地の駅に着いたときの描写 */
    function arrive(areaId, byGod, atNight) {
      const st = place(S.place);
      const a = W().areaById.get(areaId);
      const aw = (canon.away || {}).lines || {};
      const home = c.homeAreas.includes(areaId);
      let sub = '';
      if (home) { if (chain.lastAwayArea && chain.lastAwayArea !== areaId) sub = (aw.back || [])[0] || ''; }
      else if (chain.visitedAreas.has(areaId)) sub = pick(aw.again, R);
      else sub = pick((aw.arrive || {})[a && a.urban ? 'city' : 'town'], R);
      if (!home) chain.lastAwayArea = areaId; else chain.lastAwayArea = null;
      chain.visitedAreas.add(areaId);
      if (atNight) sub = '';
      if (!sub && !byGod) return;
      push({ type: 'arrive', at: S.t, placeId: S.place, text: `${short}が${st.name}に降り立った。`, sub });
      const wait = home ? 2 : ((canon.away || {}).arrivalStayMin || 5);
      stay(wait);
      posterAt(st, S.t);
    }

    /** 寄り道（候補を選んでは向かう）。deadline までに家へ帰れる範囲で */
    function wander(o) {
      let stops = 0;
      const away = !c.homeAreas.includes(S.area);
      const aw = away ? (canon.away || {}) : {};
      const maxStops = o.maxStops !== undefined ? o.maxStops : (aw.maxStops || 6);
      while (stops < maxStops) {
        if (!S.place) return false;
        const back = o.returnTo ? minutesHome(S.place, o.returnTo, S.t) : 0;
        const deadline = o.until - back * MIN;
        if (S.t > deadline - 20 * MIN) break;
        // NG行動: この時刻より後は、新しい場所へ出かけない
        if (c.ng && c.ng.quietAfter && S.t >= at(c.ng.quietAfter)) break;
        const next = chooseNext(S, ctx, { pool: o.pool, deadline: o.until - 15 * MIN });
        if (!next) break;
        if (!travel(next.p.id)) return false;
        let mins = (next.p.stay || 40) * (aw.stayFactor || 1) * (0.8 + R() * 0.45);
        const left = (o.until - S.t) / MIN - (o.returnTo ? minutesHome(S.place, o.returnTo, S.t) : 0);
        mins = Math.max(10, Math.min(mins, left));
        if (!visit(next.p.id, Math.round(mins))) return false;
        stops++;
      }
      return true;
    }

    /* ---- 1日を進める ---- */
    const wake = (routine.wake || c.active[0]);
    const bed = routine.bed || Math.min(24, c.active[1] + 2);
    const activeEnd = c.active[1];
    let moveIdx = 0;
    const nextMoveAt = () => dayMoves[moveIdx] ? dayMoves[moveIdx].at : null;

    // 前の日の続き（宿に泊まった、駅で夜を明かした）
    if (startState.place && startState.place !== homeId) S.overnightStart = startState.place;
    S.area = cal.placementAt(log, ds);
    let lateMove = false, movedToday = false, firstPlacement = false;

    for (let guard = 0; guard < 12; guard++) {
      S.stopAt = nextMoveAt();
      const done = runSegment();
      if (done === 'interrupted' || (done === 'done' && S.stopAt)) {
        // 神の手が入るまで待つ
        const mv = dayMoves[moveIdx++];
        if (!mv) break;
        if (S.t < mv.at) S.t = mv.at;
        const prev = S.area;
        S.area = mv.areaId;
        movedToday = true;
        if (mv.areaId === null) {
          push({ type: 'god', at: mv.at, text: `神の手が${short}を家に帰した。`, lat: (S.pos || pt(S.place) || pt(homeId))[0], lng: (S.pos || pt(S.place) || pt(homeId))[1] });
          S.place = homeId; S.pos = null; S.overnight = null; S.overnightStart = null;
          out.legs.push({ mode: 'god', coords: [pt(homeId), pt(homeId)], startAt: mv.at, endAt: mv.at, meters: 0 });
          continue;
        }
        const a = W().areaById.get(mv.areaId);
        const curP = S.place ? place(S.place) : null;
        if (curP && curP.area === mv.areaId) {
          // 今いるエリアへ移すだけなら移動しない。神の手の記録だけを残す
          push({ type: 'god', at: mv.at, areaId: mv.areaId, text: `神の手が${short}を${a.short}エリアに移動させた。`, lat: curP.lat, lng: curP.lng });
          if (S.place === homeId && cal.minuteOfDay(mv.at) / 60 < wake) { movedToday = false; S.t = Math.max(S.t, at(wake)); }
          else if (S.place === homeId) { movedToday = true; S.arrivedDone = true; }
          continue;
        }
        firstPlacement = prev === null;
        S.arrivedDone = false;
        // 初めて地元へ連れて行くのが起きる前で、家にいるなら、家からいつもの1日を始める
        if (firstPlacement && c.homeAreas.includes(mv.areaId) && (!S.place || S.place === homeId) && cal.minuteOfDay(mv.at) / 60 < wake) {
          push({ type: 'god', at: mv.at, areaId: mv.areaId, text: `神の手が${short}を${a.short}エリアに移動させた。`, lat: pt(homeId)[0], lng: pt(homeId)[1] });
          S.place = homeId; movedToday = false; S.t = Math.max(S.t, at(wake)); continue;
        }
        const from = S.pos || (curP ? [curP.lat, curP.lng] : pt(homeId));
        push({ type: 'god', at: mv.at, areaId: mv.areaId, text: `神の手が${short}を${a.short}エリアに移動させた。`, lat: from[0], lng: from[1] });
        out.legs.push({ mode: 'god', coords: [from, pt(a.arrival)], startAt: mv.at, endAt: mv.at, meters: 0 });
        S.place = a.arrival; S.pos = null; S.overnightStart = null;
        lateMove = cal.minuteOfDay(mv.at) / 60 >= night.lateHour || cal.minuteOfDay(mv.at) / 60 < 4;
        if (cal.minuteOfDay(mv.at) / 60 < wake) { lateMove = false; S.t = Math.max(S.t, at(wake)); }
        continue;
      }
      break;
    }

    /** 次の神の手まで（またはその日の終わりまで）の行動 */
    function runSegment() {
      if (S.area === null || S.area === undefined) { return 'done'; } // 旅に出ていない（家で待っている）
      if (!S.place) S.place = homeId;
      if (S.t >= at(24)) return 'done';
      // 夜遅くの移動
      if (lateMove) { lateMove = false; arrive(S.area, true, true); return settleNight() ? 'done' : 'interrupted'; }
      if (movedToday && S.place === (W().areaById.get(S.area) || {}).arrival && !S.arrivedDone) { S.arrivedDone = true; arrive(S.area, true); }
      if (S.t < at(wake)) S.t = at(wake);
      if (S.stopAt && S.t >= S.stopAt) { S.t = S.stopAt; return 'interrupted'; } // 起きる前に神の手が入る
      if (S.t >= at(bed)) return 'done';

      const anchor = routine.anchor;
      const workday = anchor && calendar.isWorkday(day, routine.kind === 'school' ? 'school' : 'work');
      const homeRegion = regionOf(c.homeAreas[0] || S.area);
      const inHome = c.homeAreas.includes(S.area);
      const raining = calendar.weatherOf(day, regionOf(S.area)) === 'rain';

      // 学校・仕事（切り替えた当日は移動先で過ごす。初めて地元に連れて行ったときは授業の時間なら学校へ）
      const skipAnchor = movedToday && !(firstPlacement && inHome);
      if (workday && !skipAnchor && S.t < at(anchor.end) && !S.anchorDone) {
        S.anchorDone = true;
        const anchorP = place(anchor.placeId);
        const fromStay = S.overnightStart || (S.place !== homeId && place(S.place) && place(S.place).cat === 'stay' ? S.place : null);
        const viaPlan = !(S.overnightStart || (S.place !== homeId && place(S.place) && place(S.place).cat === 'stay')) && !movedToday ? (routine.via || []) : [];
        let toAnchor = 0, cursor = S.place;
        for (const v of [...viaPlan, anchor.placeId]) { toAnchor += minutesTo(cursor, v, S.t); cursor = v; }
        const leaveAt = Math.max(S.t, at(anchor.start) - (toAnchor + 4) * MIN);
        S.t = leaveAt;
        const viaList = !fromStay && !movedToday ? (routine.via || []) : [];
        for (const v of viaList) {
          if (!travel(v)) return 'interrupted';
          visit(v, 0, 'pass');
        }
        if (!travel(anchor.placeId, { morning: !!fromStay })) return 'interrupted';
        if (anchorP.id !== homeId) {
          const staySec = Math.max(at(anchor.end) - S.t, 10 * MIN) / MIN;
          if (!visit(anchor.placeId, staySec, 'anchor', anchor.label ? undefined : undefined)) return 'interrupted';
        }
        // 放課後
        const outingArea = S.area;
        const sameRegion = regionOf(outingArea) === regionOf(place(S.place).area);
        if (outingArea !== place(S.place).area) {
          const st = (W().areaById.get(outingArea) || {}).arrival;
          const go = minutesTo(S.place, st, S.t), back = minutesTo(st, homeId, S.t);
          if (!sameRegion && !(S.t + (go + 60 + back) * MIN <= at(bed - 0.25))) return goHome() ? 'done' : 'interrupted';
          if (!travel(st)) return 'interrupted';
          arrive(outingArea, false);
          if (!wander({ until: sameRegion ? at(activeEnd) : at(bed - 0.25), returnTo: homeId, maxStops: 3 })) return 'interrupted';
          return goHome() ? 'done' : 'interrupted';
        }
        const n = raining ? (routine.rainStops || 0) : (routine.afterStops || 1);
        if (n > 0 && !wander({ until: at(activeEnd), returnTo: homeId, maxStops: n, pool: inHome ? routine.pool : null })) return 'interrupted';
        return goHome() ? 'done' : 'interrupted';
      }
      if (S.anchorDone && !movedToday) return 'done';

      // 休みの日（または学校を切り上げて連れて行かれた日）
      const startHour = Math.max(cal.minuteOfDay(S.t) / 60, c.active[0], routine.workMorning && !movedToday ? routine.workMorning : 0);
      if (S.t < at(startHour)) S.t = at(startHour);
      if (S.t >= at(activeEnd)) {
        if (S.place !== homeId && place(S.place) && place(S.place).cat !== 'stay') return goHome() ? 'done' : 'interrupted';
        return 'done';
      }
      let target = S.area;
      // 遠出（休みの日、地元にいるときに、獲得済みの別のエリアへ）
      if (!movedToday && !S.overnightStart && inHome && !workday && R() < (routine.tripChance || 0) + tripBoost(c.id, day, chain.areas, S.t)) {
        const others = Object.keys(chain.areas).filter(a => a !== S.area && chain.areas[a] <= S.t);
        if (others.length) target = others[Math.floor(R() * others.length)];
      }
      if (place(S.place).area !== target) {
        const st = (W().areaById.get(target) || {}).arrival;
        // 別の地方へは、乗り物が動き出してから出かける
        if (regionOf(target) !== regionOf(place(S.place).area) && S.t < at(6.2)) S.t = at(6.2);
        const go = minutesTo(S.place, st, S.t), back = minutesTo(st, homeId, S.t);
        if (S.t + (go + 90 + back) * MIN <= at(bed)) {
          if (!travel(st)) return 'interrupted';
          arrive(target, false);
          S.tripArea = target;
        }
      }
      const curArea = place(S.place).area;
      const endAt = c.homeAreas.includes(curArea) ? at(activeEnd) : at(Math.min(bed - 0.5, activeEnd + 1));
      const prevArea = S.area; S.area = curArea;
      const ok = wander({ until: endAt, returnTo: homeId, maxStops: raining && inHome ? Math.max(1, (routine.rainStops || 1) + 1) : (c.homeAreas.includes(curArea) ? 9 : undefined) });
      S.area = prevArea;
      if (!ok) return 'interrupted';
      return goHome() ? 'done' : 'interrupted';
    }

    out.endPlace = S.overnight || homeId;
    out.walkM = Math.round(out.walkM); out.rideM = Math.round(out.rideM);
    out.steps = Math.round(out.walkM / c.stride);
    out.items.sort((a, b) => a.at - b.at);
    out.legs.sort((a, b) => a.startAt - b.startAt);
    // その日のスタート地点（朝を迎えた場所。家、泊まった宿、夜を明かした駅）。
    // 最初の出来事が神の手の移動や駅への到着でなければ、最初に動き出した時刻に「〇〇を出発した」を入れる（2026-11-10 の依頼）
    // 朝早くに神の手が入った日（起きる前に地元へ移した日など）も、神の手のあとに最初に動き出した場所をスタート地点にする。
    // 駅に降り立つところから始まる日は、その到着の行がスタートを表すので足さない
    {
      const morning = startState.place && startState.place !== homeId ? startState.place : homeId;
      const firstLeg = out.legs.find(l => l.mode !== 'god');
      const firstReal = out.items.find(i => i.type !== 'god');
      // 神の手で駅へ移され、駅に降り立つところから始まる日は、その到着の行をスタート地点にする
      if (firstReal && firstReal.type === 'arrive') {
        const sp = place(firstReal.placeId);
        firstReal.type = 'start'; firstReal.placeLabel = sp ? sp.name : ''; firstReal.arrived = true;
      } else if (firstLeg && firstReal && firstLeg.startAt <= firstReal.at) {
        const godsBefore = out.items.filter(i => i.type === 'god' && i.at <= firstLeg.startAt);
        const cands = [morning, homeId, ...godsBefore.map(g => (W().areaById.get(g.areaId) || {}).arrival)].filter(Boolean);
        const id = cands.find(x => { const p = place(x); return p && dist(firstLeg.coords[0], [p.lat, p.lng]) < 300; });
        const mp = id && place(id);
        if (mp) {
          // 「ありさの家」のように名前の頭が推しの名前なら、「家」だけにする（「ありさがありさの家を…」にしない）
          const nm = mp.name.startsWith(short + 'の') ? mp.name.slice(short.length + 1) : mp.name;
          const t = Math.max(firstLeg.startAt, ...godsBefore.map(g => g.at));
          out.items.push({ type: 'start', at: t, placeId: id, lat: mp.lat, lng: mp.lng, text: `${short}が${nm}を出発した。`, placeLabel: nm, fictional: !!mp.fictional });
          // 同じ時刻なら、神の手 → スタート → そのほか（乗り物など）の順に並べる
          const rank = i => (i.type === 'god' ? 0 : i.type === 'start' ? 1 : 2);
          out.items.sort((a, b) => a.at - b.at || rank(a) - rank(b));
        }
      }
    }
    out.hourlySteps = hourly(out.legs, ds, c.stride);
    out.firstAt = out.items.length ? out.items[0].at : null;
    out.outsideMin = outsideMinutes(out, homeId);
    out.area = cal.placementAt(log, ds + 12 * HOUR);
    chain.lastMeal = S.lastMeal;
    return out;
  }

  function tripBoost(charId, day, areas, ms) {
    let b = 0;
    for (const a of Object.keys(areas)) for (const ev of eventsOn(a, day)) { const iv = eventInterest(charId, ev); if (iv >= 0.7) b = Math.max(b, 0.25); }
    return b;
  }

  /* ---------------------------------------------------------------- 足あと（日をまたいだ計算） */
  /**
   * @param {object} c キャラ
   * @param {object} who { acquiredAt, log, areas, affinity, key } 利用者（または他の人の推し）の情報
   * @param {string} day 'YYYY-MM-DD'
   */
  function dayOf(c, who, day) {
    const log = who.log || [];
    if (!log.length) return emptyDay(day);
    const first = cal.dayKey(log[0].at);
    if (day < first) return emptyDay(day);
    const base = `${c.id}|${W().version}|${router.version}|${who.key}|${cal.hashStr(JSON.stringify(log))}`;
    const hit = DAY_CACHE.get(base + '|' + day);
    if (hit) return hit;
    // 最初の日から順に計算する（前の日の泊まった場所と、行ったことのある場所を引き継ぐ）
    let d = first, chainState = null;
    // 控えのある一番新しい日から続ける
    for (let k = cal.daysBetween(first, day); k >= 0; k--) {
      const dk = cal.addDays(first, k);
      const h = DAY_CACHE.get(base + '|' + dk);
      if (h && h.chainAfter) { d = cal.addDays(dk, 1); chainState = h.chainAfter; break; }
    }
    if (!chainState) chainState = { place: c.home, everVisited: [], visitedAreas: [], lastMeal: 0, lastAwayArea: null };
    let res = null;
    for (; d <= day; d = cal.addDays(d, 1)) {
      const chain = {
        log, areas: who.areas || {}, affinity: who.affinity || null,
        everVisited: new Set(chainState.everVisited), visitedAreas: new Set(chainState.visitedAreas),
        lastMeal: chainState.lastMeal, lastAwayArea: chainState.lastAwayArea,
      };
      res = simulateDay(c, d, { place: chainState.place }, chain);
      chainState = { place: res.endPlace, everVisited: [...chain.everVisited], visitedAreas: [...chain.visitedAreas], lastMeal: chain.lastMeal, lastAwayArea: chain.lastAwayArea };
      res.chainAfter = chainState;
      DAY_CACHE.set(base + '|' + d, res);
    }
    if (DAY_CACHE.size > 20000) DAY_CACHE.clear();
    return res;
  }

  function emptyDay(day) { return { day, items: [], legs: [], visits: [], walkM: 0, rideM: 0, steps: 0, hourlySteps: new Array(24).fill(0), outsideMin: 0, empty: true }; }

  /** 足あとのある日（最初に連れて行った日から今日まで） */
  function activeDays(c, who, today) {
    const log = who.log || [];
    if (!log.length) return [];
    const out = [];
    for (let d = cal.dayKey(log[0].at); d <= today; d = cal.addDays(d, 1)) {
      const r = dayOf(c, who, d);
      if (r.items.length) out.push(d);
    }
    return out;
  }

  /** 足あとの集計（場所ごとの訪問回数と滞在時間、ほかの日の平均） */
  function summarizeVisits(c, who, today, nowMs) {
    const days = activeDays(c, who, today);
    const byPlace = new Map();
    let stepsSum = 0, outsideSum = 0, stopsSum = 0, n = 0;
    for (const d of days) {
      const r = dayOf(c, who, d);
      for (const v of r.visits) {
        if (v.kind === 'pass' || (nowMs && v.at > nowMs)) continue;
        const p = place(v.placeId); if (!p) continue;
        let e = byPlace.get(v.placeId);
        if (!e) { e = { placeId: v.placeId, count: 0, minutes: 0, records: [] }; byPlace.set(v.placeId, e); }
        e.count++; e.minutes += Math.max(0, (v.leave - v.at) / MIN);
        e.records.push({ day: d, at: v.at, leave: v.leave, doing: v.doing, weather: calendar.hourlyOf(d, regionOf(p.area))[Math.floor(cal.minuteOfDay(v.at) / 60)], workday: calendar.isWorkday(d, 'work') });
      }
      if (d !== today) { stepsSum += r.steps; outsideSum += r.outsideMin; stopsSum += r.visits.filter(v => v.kind === 'visit').length; n++; }
    }
    return { days, places: [...byPlace.values()].sort((a, b) => b.count - a.count || b.minutes - a.minutes), average: n ? { steps: stepsSum / n, outsideMin: outsideSum / n, stops: stopsSum / n } : null };
  }

  /* ---------------------------------------------------------------- 今の様子 */
  function statusAt(c, r, ms) {
    const legs = r.legs.filter(l => l.startAt <= ms && l.mode !== 'god');
    const moving = legs.find(l => l.startAt <= ms && l.endAt > ms);
    if (moving) {
      if (moving.mode === 'walk') {
        const nextVisit = r.items.find(i => i.at >= moving.endAt - 1000 && i.placeId);
        const p = nextVisit && place(nextVisit.placeId);
        return { kind: 'walk', text: p ? `${p.cat === 'home' ? '家' : p.name}へ歩いている` : '歩いている' };
      }
      const ride = r.items.find(i => i.type === 'ride' && Math.abs(i.at - moving.startAt) < 1000);
      return { kind: 'ride', text: ride ? `${ride.line}で${ride.to}へ向かっている` : '乗り物で移動している' };
    }
    const past = r.items.filter(i => i.at <= ms && i.placeId);
    const last = past[past.length - 1];
    // 神の手で家に帰したあとは「家にいる」（帰した行には場所がないため、前にいた場所の名前が出ていた）
    const lastGod = r.items.filter(i => i.type === 'god' && i.at <= ms).pop();
    if (lastGod && !lastGod.areaId && (!last || lastGod.at >= last.at)) return { kind: 'home', text: '家にいる' };
    if (!last) return { kind: 'home', text: '家で待っている' };
    const p = place(last.placeId);
    if (last.type === 'home' || (p && p.cat === 'home')) return { kind: 'home', text: '家にいる' };
    if (last.type === 'stay') return { kind: 'stay', text: `${p.name}にいる` };
    if (p.cat === 'school') return { kind: 'school', text: '学校にいる' };
    return { kind: 'place', text: `${p.name}にいる`, placeId: p.id };
  }

  return { dayOf, activeDays, summarizeVisits, statusAt, eventInterest, eventsOn, isOpen, isNg, cache: DAY_CACHE, clear: () => DAY_CACHE.clear() };
}

/* ---------------------------------------------------------------- 計算の補助 */
function pick(list, R) { return list && list.length ? list[Math.floor(R() * list.length)] : ''; }

function rideText(short, leg) {
  if (leg.mode === 'ropeway') return `${short}が${leg.line}で${leg.toId === 'rw-top' ? '山頂駅へ上がった' : '山麓駅へ下りた'}。`;
  if (leg.mode === 'ferry') return `${short}が${leg.line}で${leg.toId === 'tomihama-pier' ? '向島' : '尾道'}へ渡った。`;
  return `${short}が${leg.line}で${leg.to}へ向かった。`;
}

/** 線の先頭から frac の割合までを切り出す */
function cutLine(coords, frac) {
  if (!coords || coords.length < 2) return coords || [];
  let total = 0; const seg = [];
  for (let i = 1; i < coords.length; i++) { const d = dist(coords[i - 1], coords[i]); seg.push(d); total += d; }
  let need = total * frac; const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (need >= seg[i - 1]) { out.push(coords[i]); need -= seg[i - 1]; continue; }
    const f = seg[i - 1] ? need / seg[i - 1] : 0;
    out.push([coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f]);
    break;
  }
  return out;
}

/** 時間ごとの歩数（歩いた区間を時間で割り振る） */
function hourly(legs, ds, stride) {
  const h = new Array(24).fill(0);
  for (const l of legs) {
    if (l.mode !== 'walk' || !(l.endAt > l.startAt)) continue;
    const steps = l.meters / stride; const span = l.endAt - l.startAt;
    for (let t = l.startAt; t < l.endAt; ) {
      const hr = Math.floor((t - ds) / HOUR);
      const next = Math.min(l.endAt, ds + (hr + 1) * HOUR);
      if (hr >= 0 && hr < 24) h[hr] += steps * (next - t) / span;
      t = next;
    }
  }
  return h.map(Math.round);
}

/** 家の外にいた時間（分） */
function outsideMinutes(r, homeId) {
  const ev = r.items.filter(i => i.type === 'visit' || i.type === 'home' || i.type === 'god' || i.type === 'stay' || i.type === 'ride' || i.type === 'arrive' || i.type === 'start' || i.type === 'pass');
  if (!ev.length) return 0;
  const firstLeg = r.legs.find(l => l.mode === 'walk' || l.mode !== 'god');
  const start = Math.min(...[ev[0].at, firstLeg ? firstLeg.startAt : Infinity]);
  const homeItem = [...r.items].reverse().find(i => i.type === 'home' || (i.type === 'god' && !i.areaId));
  const end = homeItem ? homeItem.at : (r.items[r.items.length - 1].leave || r.items[r.items.length - 1].at);
  return Math.max(0, Math.round((end - start) / MIN));
}

module.exports = { createSimulator, cutLine, hourly };
