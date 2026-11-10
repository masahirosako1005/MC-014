/**
 * lib/calendar.js
 * 日付、祝日、創作の天気、推しをどのエリアへ連れて行ったか（travelLog）を扱う。
 *
 * 天気は外部のAPIに接続せず、地方と日付から決まる乱数で創作する。同じ日は何度開いても同じ天気になる。
 * 管理画面で日付ごとに上書きでき、上書きした日は時間ごとの天気も作り直す。
 * 本物の天気に切り替えるコードは、このファイルの末尾の【API差し替え箇所】にコメントアウトで残している。
 */
'use strict';

const JST = 9 * 3600 * 1000;
const DAY_MS = 86400000;

/** ミリ秒 → 'YYYY-MM-DD'（日本時間） */
function dayKey(ms) { return new Date(ms + JST).toISOString().slice(0, 10); }
/** 'YYYY-MM-DD' の0時（日本時間）のミリ秒 */
function dayStart(key) { return Date.parse(key + 'T00:00:00Z') - JST; }
function addDays(key, n) { return dayKey(dayStart(key) + n * DAY_MS + 3600000); }
/** 'YYYY-MM-DD' として正しい日付か（9999-99-99 や 2026-02-31 は正しくない） */
function validDay(key) { if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false; const t = dayStart(key); return Number.isFinite(t) && dayKey(t) === key; }
/** 曜日（0=日曜） */
function weekday(key) { return new Date(dayStart(key) + JST).getUTCDay(); }
/** その日の何分目か（日本時間） */
function minuteOfDay(ms) { const d = new Date(ms + JST); return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60; }
function daysBetween(a, b) { return Math.round((dayStart(b) - dayStart(a)) / DAY_MS); }

/** 文字列から作る、決まった並びの乱数（mulberry32） */
function hashStr(s) { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return (h >>> 0); }
function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashStr(String(seed));
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function create(content) {
  const holidays = () => content.get().HOLIDAYS;
  const breaks = () => content.get().SCHOOL_BREAKS || [];

  const isHoliday = key => !!holidays()[key];
  const isSchoolBreak = key => breaks().some(([a, b]) => key >= a && key <= b);
  /** 学校や仕事のある日か（月〜金、祝日を除く。学校は長い休みも除く） */
  function isWorkday(key, kind = 'school') {
    const w = weekday(key);
    if (w === 0 || w === 6 || isHoliday(key)) return false;
    if (kind === 'school' && isSchoolBreak(key)) return false;
    return true;
  }

  // 月ごとの雨の確率の目安（瀬戸内は少なめ、関西はやや多め）
  const RAIN = {
    setouchi: [0.18, 0.2, 0.25, 0.25, 0.27, 0.4, 0.35, 0.2, 0.3, 0.2, 0.18, 0.16],
    kansai:   [0.2, 0.22, 0.28, 0.28, 0.3, 0.42, 0.36, 0.24, 0.33, 0.24, 0.22, 0.2],
  };
  const CLOUD = 0.3;

  /** 1日の天気（sun / cloud / rain）。地方と日付から決まる */
  function pseudoWeather(key, region) {
    const r = rng('weather|' + region + '|' + key)();
    const m = Number(key.slice(5, 7)) - 1;
    const pr = (RAIN[region] || RAIN.setouchi)[m];
    if (r < pr) return 'rain';
    if (r < pr + CLOUD) return 'cloud';
    return 'sun';
  }

  /** 0〜23時の天気 */
  function hourlyWeather(daily, key, region) {
    const R = rng('hourly|' + region + '|' + key + '|' + daily);
    const h = new Array(24).fill(daily === 'rain' ? 'cloud' : daily);
    if (daily === 'sun') {
      if (R() < 0.45) { const s = 12 + Math.floor(R() * 4); const len = 1 + Math.floor(R() * 3); for (let i = s; i < Math.min(24, s + len); i++) h[i] = 'cloud'; }
    } else if (daily === 'cloud') {
      if (R() < 0.6) { const s = 9 + Math.floor(R() * 6); const len = 1 + Math.floor(R() * 3); for (let i = s; i < Math.min(24, s + len); i++) h[i] = 'sun'; }
    } else if (daily === 'rain') {
      const s = 5 + Math.floor(R() * 11); const len = 4 + Math.floor(R() * 6);
      for (let i = s; i < Math.min(24, s + len); i++) h[i] = 'rain';
      if (R() < 0.5) { const s2 = Math.min(23, s + len + 2 + Math.floor(R() * 4)); const l2 = 1 + Math.floor(R() * 2); for (let i = s2; i < Math.min(24, s2 + l2); i++) h[i] = 'rain'; }
    }
    return h;
  }

  /** 1日の天気。管理画面の上書きがあればそれを使う */
  function weatherOf(key, region) {
    const ov = (content.get().WEATHER_OVERRIDES || {})[region + '|' + key];
    return ov || pseudoWeather(key, region);
  }
  const hourlyCache = new Map();
  function hourlyOf(key, region) {
    const daily = weatherOf(key, region);
    const k = region + '|' + key + '|' + daily;
    let h = hourlyCache.get(k);
    if (!h) { h = hourlyWeather(daily, key, region); hourlyCache.set(k, h); if (hourlyCache.size > 5000) hourlyCache.clear(); }
    return h;
  }
  /** その時刻に雨が降っているか */
  function rainingAt(ms, region) { const key = dayKey(ms); return hourlyOf(key, region)[Math.floor(minuteOfDay(ms) / 60) % 24] === 'rain'; }

  return { isHoliday, isSchoolBreak, isWorkday, pseudoWeather, hourlyWeather, weatherOf, hourlyOf, rainingAt, holidayName: k => holidays()[k] || null };
}

/* ------------------------------------------------------------ 連れて行った履歴（travelLog） */
// travelLog は [{at: ミリ秒, areaId: 'osaka' | null, demo?: true}] を時刻順に並べたもの。null は「家に帰した」。

/** その時刻に推しがいるエリア（連れて行っていなければ null） */
function placementAt(log, ms) {
  let cur = null;
  for (const e of log || []) { if (e.at <= ms) cur = e.areaId; else break; }
  return cur;
}
/** その日のうちに神の手がエリアを移した記録 */
function moves(log, key) {
  const s = dayStart(key), e = s + DAY_MS;
  return (log || []).filter(x => x.at >= s && x.at < e);
}

module.exports = { create, dayKey, dayStart, addDays, validDay, weekday, minuteOfDay, daysBetween, rng, hashStr, placementAt, moves, DAY_MS, JST };

/* ============================================================================
 * 【API差し替え箇所】本物の天気に切り替える（実環境で外部APIへの接続が許される場合）
 * ----------------------------------------------------------------------------
 * 大会規定で外部APIに接続できないため、コメントアウトしている。
 * サーバの起動時と1時間ごとに時間ごとの天気を取って覚えておき、weatherOf と hourlyOf はその結果を先に返す。
 * （推しの行動の計算から何度も呼ばれるので、APIを直接呼ばないこと）
 *
 * const REGION_POINT = { setouchi: [34.4089, 133.2050], kansai: [34.6840, 135.4930] };
 * const live = new Map(); // 'region|YYYY-MM-DD' → ['sun' | 'cloud' | 'rain' x 24]
 * async function refreshLiveWeather() {
 *   for (const [region, [lat, lng]] of Object.entries(REGION_POINT)) {
 *     const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
 *       '&hourly=weathercode&past_days=31&forecast_days=7&timezone=Asia%2FTokyo';
 *     const res = await fetch(url);
 *     const json = await res.json();
 *     json.hourly.time.forEach((t, i) => {
 *       const key = t.slice(0, 10), hour = Number(t.slice(11, 13));
 *       const code = json.hourly.weathercode[i];
 *       const w = code >= 51 ? 'rain' : code >= 2 ? 'cloud' : 'sun';
 *       const k = region + '|' + key;
 *       if (!live.has(k)) live.set(k, new Array(24).fill('cloud'));
 *       live.get(k)[hour] = w;
 *     });
 *   }
 * }
 * // refreshLiveWeather(); setInterval(refreshLiveWeather, 3600 * 1000);
 * // hourlyOf の先頭で: const l = live.get(region + '|' + key); if (l) return l;
 * // weatherOf の先頭で: 雨の時間が3時間以上なら 'rain'、晴れが半分以上なら 'sun'、それ以外は 'cloud'
 * ========================================================================== */
