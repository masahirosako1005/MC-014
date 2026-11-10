/**
 * data/events.js
 * 地域のイベントと祝日の初期値。管理画面（イベント）で追加・編集でき、data/content.json に保存される。
 *
 * - 日程は2026年11月時点の公開情報をもとにした目安。公式に確認できていないものは tentative: true で、画面に「予定」と出す。
 * - tags はイベントの種類。キャラの eventTags（data/canon.js）と照らして関心を求める（lib/simulator.js の eventInterest）。
 * - placeId は会場（data/world.js の場所）。会場が地図の範囲外のときは null にし、駅のポスターだけに反映する。
 */
'use strict';

const EVENTS = [
  {
    id: 'ev-utsubo-rose', area: 'osaka', title: '靱公園 秋のバラ', start: '2026-10-15', end: '2026-11-20', hours: [9, 17],
    placeId: 'utsubo-park', tags: ['flower', 'photo', 'nature'], tentative: true,
    desc: '靱公園のバラ園で、秋のバラが見ごろになる時期。', url: 'https://www.osakapark.osgf.or.jp/utsubo/',
  },
  {
    id: 'ev-midosuji-illumi', area: 'osaka', title: '御堂筋イルミネーション', start: '2026-11-15', end: '2026-12-31', hours: [17, 23],
    placeId: 'kitamido', tags: ['light', 'night', 'photo'], tentative: true,
    desc: '御堂筋のいちょう並木が光で彩られる。会場は御堂筋の沿道。', url: 'https://osaka-info.jp/',
  },
  {
    id: 'ev-hikari-renaissance', area: 'osaka', title: 'OSAKA光のルネサンス', start: '2026-12-14', end: '2026-12-25', hours: [17, 22],
    placeId: 'nakanoshima-park', tags: ['light', 'night', 'art', 'photo'], tentative: true,
    desc: '中之島の水辺と建物を光で演出する冬のイベント。', url: 'https://osaka-info.jp/',
  },
  {
    id: 'ev-tokaebisu', area: 'osaka', title: '今宮戎神社 十日戎', start: '2027-01-09', end: '2027-01-11', hours: [9, 22],
    placeId: null, tags: ['festival', 'shrine', 'food'], tentative: true,
    desc: '商売繁盛を願って笹を受ける、大阪の新春の祭り。会場は浪速区の今宮戎神社（地図の範囲外）。', url: 'https://osaka-info.jp/',
  },
  {
    id: 'ev-library-oldbook', area: 'osaka', title: '中央図書館 古い地図の展示', start: '2026-11-21', end: '2026-12-06', hours: [10, 18],
    placeId: 'central-library', tags: ['book', 'history', 'quiet'], tentative: true,
    desc: '大阪の古い地図を集めた展示（デモ用に想定したイベント）。', url: 'https://www.oml.city.osaka.lg.jp/',
  },
  {
    id: 'ev-senkoji-momiji', area: 'onomichi', title: '千光寺公園の紅葉', start: '2026-11-14', end: '2026-12-06', hours: [7, 18],
    placeId: 'senkoji', tags: ['nature', 'photo', 'temple'], tentative: true,
    desc: '千光寺山の木々が色づく時期。山頂の展望台から尾道水道と紅葉を一緒に見られる。', url: 'https://www.ononavi.jp/',
  },
  {
    id: 'ev-jodoji-joya', area: 'onomichi', title: '浄土寺 除夜の鐘', start: '2026-12-31', end: '2026-12-31', hours: [22, 24],
    placeId: 'jodoji', tags: ['temple', 'history', 'night'], tentative: true,
    desc: '大みそかの夜、国宝の本堂のある浄土寺で鐘をつく。', url: 'https://www.ononavi.jp/',
  },
  {
    id: 'ev-hina', area: 'onomichi', title: '尾道雛めぐり', start: '2027-02-11', end: '2027-03-03', hours: [10, 17],
    placeId: 'hondori', tags: ['history', 'craft', 'photo'], tentative: true,
    desc: '商店街や町家に古いひな人形が飾られ、町を歩いてめぐる。', url: 'https://www.ononavi.jp/',
  },
  {
    id: 'ev-shinmeiichi', area: 'mihara', title: '三原神明市', start: '2027-02-12', end: '2027-02-14', hours: [9, 21],
    placeId: 'saigoku-kaido', tags: ['festival', 'history', 'food'], tentative: true,
    desc: '大だるまが並ぶ、三原の冬の市。西国街道の沿道に露店が続く。', url: 'https://www.mihara-kankou.com/',
  },
  {
    id: 'ev-mihara-castle-walk', area: 'mihara', title: '三原城跡 石垣めぐり', start: '2026-11-22', end: '2026-11-23', hours: [10, 15],
    placeId: 'mihara-castle', tags: ['history', 'castle', 'walk'], tentative: true,
    desc: '三原城の天主台跡と船入櫓跡をめぐる散策会（デモ用に想定したイベント）。', url: 'https://www.mihara-kankou.com/',
  },
];

// 祝日（内閣府の公表に基づく。2027年の春分・秋分は前年に官報で公示されるため予定）
const HOLIDAYS = {
  '2026-01-01': '元日', '2026-01-12': '成人の日', '2026-02-11': '建国記念の日', '2026-02-23': '天皇誕生日',
  '2026-03-20': '春分の日', '2026-04-29': '昭和の日', '2026-05-03': '憲法記念日', '2026-05-04': 'みどりの日',
  '2026-05-05': 'こどもの日', '2026-05-06': '振替休日', '2026-07-20': '海の日', '2026-08-11': '山の日',
  '2026-09-21': '敬老の日', '2026-09-22': '国民の休日', '2026-09-23': '秋分の日', '2026-10-12': 'スポーツの日',
  '2026-11-03': '文化の日', '2026-11-23': '勤労感謝の日',
  '2027-01-01': '元日', '2027-01-11': '成人の日', '2027-02-11': '建国記念の日', '2027-02-23': '天皇誕生日',
  '2027-03-21': '春分の日', '2027-03-22': '振替休日', '2027-04-29': '昭和の日', '2027-05-03': '憲法記念日',
  '2027-05-04': 'みどりの日', '2027-05-05': 'こどもの日', '2027-07-19': '海の日', '2027-08-11': '山の日',
  '2027-09-20': '敬老の日', '2027-09-23': '秋分の日', '2027-10-11': 'スポーツの日', '2027-11-03': '文化の日',
  '2027-11-23': '勤労感謝の日',
};
// 学校の休み（目安）。この間は学校のある推しも休みの日として動く
const SCHOOL_BREAKS = [['2026-07-21', '2026-08-31'], ['2026-12-24', '2027-01-07'], ['2027-03-25', '2027-04-07']];

module.exports = { EVENTS, HOLIDAYS, SCHOOL_BREAKS };
