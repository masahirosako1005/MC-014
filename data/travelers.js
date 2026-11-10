/**
 * data/travelers.js
 * 他の人の推し（デモ用）。別のユーザーが遠くの町で獲得した推しを、こちらのエリアで旅させている、という想定。
 *
 * 外部との通信ができないため、サーバ内で動かすデモデータとした。足取りは自分の推しと同じ行動判断AI（lib/simulator.js）で計算する。
 * 所有者は架空。出会った推しは閲覧のみで、自分の推しとして旅に出すことはできない。
 * 隆景、武蔵、信繁は実在の人物だが、現代を旅する描写は史実ではない。
 */
'use strict';

const TRAVELERS = [
  {
    id: 't-shizuku', name: '雪村 しずく', short: 'しずく', owner: 'ゆきみさん（架空の利用者）',
    from: '北海道小樽市', fromShort: '小樽', acquiredAt: '小樽運河のスタンプスポット', work: '『雪あかりの街』（架空のアニメ作品）',
    intro: '小樽は、石造りの倉庫が運河沿いに並ぶ港町。冬には雪あかりの路が町を照らす。ガラス工房と洋菓子の店が多い。',
    url: 'https://otaru.gr.jp/', urlLabel: '小樽観光協会',
    area: 'onomichi', home: 'green-hill', homeAreas: [],
    stride: 0.6, speed: 60, active: [9, 19], vehicle: 0.6, curiosity: 0.8, range: 1600,
    interests: { sweets: 0.9, cafe: 0.8, view: 0.8, shop: 0.7, shrine: 0.3, history: 0.4, food: 0.5, library: 0.2, dojo: 0 },
    favorites: [{ id: 'karasawa', w: 1.2 }, { id: 'peak', w: 1 }, { id: 'neko-hosomichi', w: 1 }, { id: 'roman-coffee', w: 1 }],
    look: { hair: '#e8e4f0', color: '#6b7fb3', bg: '#e6ecf7', accessory: 'scarf' },
    tastes: { keywords: ['ガラス', '洋菓子', '海辺', '雪', '甘味'], avoid: [], budget: 1500 },
  },
  {
    id: 't-masamune', name: '伊達 政宗', short: '政宗', owner: 'あおばさん（架空の利用者）', historical: true,
    from: '宮城県仙台市', fromShort: '仙台', acquiredAt: '青葉城跡のスタンプスポット', work: '戦国武将（歴史上の人物）',
    intro: '仙台は、伊達政宗が開いた杜の都。青葉城跡からは町と太平洋が見わたせる。牛たんとずんだが名物。',
    url: 'https://www.sentabi.jp/', urlLabel: '仙台観光情報サイト せんだい旅日和',
    area: 'onomichi', home: 'green-hill', homeAreas: [],
    stride: 0.72, speed: 72, active: [7, 19], vehicle: 0.5, curiosity: 0.7, range: 2200,
    interests: { history: 1, shrine: 0.9, view: 0.8, food: 0.7, cafe: 0.3, sweets: 0.4, shop: 0.3, library: 0.2, dojo: 0 },
    favorites: [{ id: 'senkoji', w: 1.2 }, { id: 'jodoji', w: 1 }, { id: 'saigokuji', w: 0.8 }, { id: 'ramen-ichibankan', w: 0.8 }],
    look: { portrait: true, hair: '#222', color: '#1d2b53', bg: '#e3e7f2', accessory: 'eyepatch' },
    tastes: { keywords: ['城跡', '寺', '国宝', '海辺', '定食'], avoid: [], budget: 2000 },
  },
  {
    id: 't-nobushige', name: '真田 信繁', short: '信繁', owner: 'ろくもんさん（架空の利用者）', historical: true,
    from: '長野県上田市', fromShort: '上田', acquiredAt: '上田城跡のスタンプスポット', work: '戦国武将（歴史上の人物）',
    intro: '上田は、真田氏が築いた上田城の城下町。千曲川の流れと、真田の六文銭の旗印で知られる。',
    url: 'https://www.ueda-cb.gr.jp/', urlLabel: '信州上田観光協会',
    area: 'onomichi', home: 'green-hill', homeAreas: [],
    stride: 0.7, speed: 70, active: [7, 19], vehicle: 0.55, curiosity: 0.75, range: 2000,
    interests: { history: 0.95, shrine: 0.8, view: 0.75, cafe: 0.5, food: 0.5, sweets: 0.4, shop: 0.3, library: 0.3, dojo: 0 },
    favorites: [{ id: 'roman-coffee', w: 1.2 }, { id: 'tenneiji', w: 1 }, { id: 'suido-shore', w: 0.8 }, { id: 'hondori', w: 0.8 }],
    look: { portrait: true, hair: '#2a2a2a', color: '#8a1c1c', bg: '#f1e2dc', accessory: 'kabuto' },
    tastes: { keywords: ['城跡', '寺', '珈琲', '古い町並み'], avoid: [], budget: 1500 },
  },
];

// 他の人の推しの公式設定（行動の描写と、知らない土地での振る舞い）
const TRAVELER_CANON = {
  't-shizuku': { routine: { wake: 8, bed: 22 }, away: { arrivalStayMin: 5, rangeFactor: 1, stayFactor: 1.2, curiosityFactor: 1.2, maxStops: 7, lines: {} }, night: { lateHour: 21, stayIfFarMin: 0, lines: {} }, likes: ['ガラス', '洋菓子'], tastes: TRAVELERS[0].tastes },
  't-masamune': { routine: { wake: 6, bed: 21 }, away: { arrivalStayMin: 5, rangeFactor: 1.2, stayFactor: 1.2, curiosityFactor: 1.2, maxStops: 7, lines: {} }, night: { lateHour: 20, stayIfFarMin: 0, lines: {} }, likes: ['城', '牛たん'], tastes: TRAVELERS[1].tastes },
  't-nobushige': { routine: { wake: 6.5, bed: 21 }, away: { arrivalStayMin: 5, rangeFactor: 1.1, stayFactor: 1.2, curiosityFactor: 1.2, maxStops: 7, lines: {} }, night: { lateHour: 20, stayIfFarMin: 0, lines: {} }, likes: ['城', '六文銭'], tastes: TRAVELERS[2].tastes },
};

module.exports = { TRAVELERS, TRAVELER_CANON };
