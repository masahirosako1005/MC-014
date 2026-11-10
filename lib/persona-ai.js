/**
 * lib/persona-ai.js
 * 推しの説明の文章から、行動のパラメータとNG行動を決める。【AI差し替え箇所 8】
 *
 * 自治体の管理画面で「どんな推しか」を文章で書くと、場所の種類への関心、歩幅、分速、乗り物好き、好奇心、
 * 距離の許容、NG行動（行かない場所の種類、入らない場所の言葉、出歩かない時刻）を提案する。提案はそのまま使わず、
 * 画面で手で直してから申請する（事務局の承認後に反映）。
 * 本アプリでは外部のAIに接続できないため、登録した言葉との照合で再現する（ダミー）。AIに切り替えるコードは末尾。
 */
'use strict';

// 場所の種類ごとの言葉
const CAT_WORDS = {
  food: ['食べ', 'グルメ', 'ラーメン', 'ご飯', 'ごはん', '食堂', '定食', 'うどん', 'お好み焼き', 'カレー', '大食い', '食いしん坊'],
  cafe: ['カフェ', '珈琲', 'コーヒー', '喫茶', '紅茶', 'お茶'],
  sweets: ['甘い', '甘党', 'スイーツ', 'ケーキ', '和菓子', 'パン', 'ドーナツ', 'アイス', 'プリン', 'お菓子'],
  shop: ['買い物', '雑貨', 'ショッピング', '古着', '服', 'おしゃれ', '小物', '器', 'お土産'],
  view: ['景色', '写真', '夕日', '夕焼け', '海', '山', '自然', '散歩', '公園', '猫', '路地', '夜景', '空'],
  shrine: ['寺', '神社', 'お参り', '参拝', '御朱印', '信心'],
  history: ['歴史', '博物館', '美術', '城', '古い', '史跡', '昔', '文化', 'アート'],
  library: ['本', '読書', '図書館', '静か', '勉強', '物語'],
  dojo: ['剣', '武道', '格闘', '稽古', '決闘', '空手', 'ボクシング', '修行', '勝負'],
};
const CAT_LABEL = { food: '食事', cafe: 'カフェ', sweets: '甘味・パン', shop: '店', view: '景色', shrine: '寺社', history: '歴史・美術', library: '図書館', dojo: '道場' };
const NEG = /苦手|嫌い|きらい|行かない|避け|しない|入らない|興味がない|興味ない|近づかない|だめ|ダメ|無理/;
const STRONG_NEG = /絶対|決して|一切|行かない|入らない|近づかない/;

// 動き方の言葉 → [パラメータ, 値, 理由]
const MOVE_RULES = [
  [/足が速い|早足|せっかち|アクティブ|体力|運動|走る|活発/, { speed: 90, stride: 0.78, range: 3000 }, '動きがはやく、遠くまで歩く'],
  [/のんびり|ゆっくり|おっとり|マイペース|小柄|子ども|こども/, { speed: 54, stride: 0.58, range: 1200 }, 'ゆっくり歩き、近くを回る'],
  [/背が高い|大柄|長身/, { stride: 0.8 }, '歩幅が大きい'],
  [/乗り物|電車|鉄道|バス|船|ロープウェイ|新幹線/, { vehicle: 0.85 }, '乗り物に乗るのが好き'],
  [/歩くのが好き|乗り物が苦手|乗り物に乗らない|歩いて行く/, { vehicle: 0.1 }, '乗り物よりも歩く'],
  [/好奇心|冒険|新しいもの|気まぐれ|初めて|知らない場所/, { curiosity: 0.85 }, '初めての場所に入りやすい'],
  [/人見知り|慎重|いつもの|決まった|臆病|こわがり/, { curiosity: 0.3 }, 'いつもの場所を選びやすい'],
  [/遠出|旅|遠く|どこへでも/, { range: 3200 }, '遠くの場所まで足をのばす'],
  [/出不精|近所|家が好き|インドア/, { range: 900 }, '家の近くで過ごすことが多い'],
];
// NG行動の言葉
const NG_RULES = [
  [/夜は出歩かない|夜遊びしない|早寝|門限|夜道が苦手|暗くなる前に帰る/, { quietAfter: 18 }, '18時より後は新しい場所へ出かけない'],
  [/夜更かしはしない|22時/, { quietAfter: 21 }, '21時より後は新しい場所へ出かけない'],
  [/お酒|飲み屋|居酒屋|バー/, { words: ['酒', '居酒屋', 'バー', 'ビール'] }, 'お酒の店には入らない'],
  [/人ごみ|人混み|にぎやか|行列/, { words: ['商店街', 'にぎやか'] }, 'にぎやかな場所には入らない'],
  [/坂|石段|階段/, { words: ['坂', '石段'] }, '坂や石段の場所には行かない'],
];

/**
 * @param {string} text 推しの説明（性格、好きなこと、苦手なこと、行動のくせ）
 * @param {object} cur 今の値（interests, stride, speed, vehicle, curiosity, range）
 * @returns {{interests, stride, speed, vehicle, curiosity, range, ng:{cats, words, quietAfter}, reasons:string[], model:string}}
 */
function suggestParams(text, cur = {}) {
  const t = String(text || '').slice(0, 2000);
  const clauses = t.split(/[。．！!？?\n]/).map(s => s.trim()).filter(Boolean);
  const interests = {}; const reasons = [];
  const base = Object.assign({ food: 0.4, cafe: 0.4, sweets: 0.4, shop: 0.3, view: 0.5, shrine: 0.3, history: 0.3, library: 0.2, dojo: 0 }, cur.interests || {});
  for (const k of Object.keys(CAT_WORDS)) interests[k] = Math.min(1, base[k] * 0.6 + (k === 'dojo' ? 0 : 0.1));
  const ng = { cats: [], words: [], quietAfter: null };

  for (const c of clauses) {
    const neg = NEG.test(c);
    for (const [cat, words] of Object.entries(CAT_WORDS)) {
      const hit = words.find(w => c.includes(w));
      if (!hit) continue;
      if (neg) {
        interests[cat] = 0.05;
        if (STRONG_NEG.test(c)) { if (!ng.cats.includes(cat)) ng.cats.push(cat); reasons.push(`「${hit}」に行かないとあるので、${CAT_LABEL[cat]}をNGにした`); }
        else reasons.push(`「${hit}」が苦手とあるので、${CAT_LABEL[cat]}への関心を下げた`);
      } else {
        const strong = /大好き|いちばん|一番|夢中|目がない|毎日|とても|すごく/.test(c);
        interests[cat] = Math.min(cat === 'dojo' ? 1.6 : 1.2, Math.max(interests[cat], strong ? 1 : 0.8));
        reasons.push(`「${hit}」${strong ? 'が大好き' : 'が好き'}とあるので、${CAT_LABEL[cat]}への関心を上げた`);
      }
    }
  }
  const p = { stride: cur.stride || 0.68, speed: cur.speed || 66, vehicle: cur.vehicle !== undefined ? cur.vehicle : 0.5, curiosity: cur.curiosity !== undefined ? cur.curiosity : 0.6, range: cur.range || 1800 };
  for (const [re, set, why] of MOVE_RULES) {
    const m = t.match(re); if (!m) continue;
    // 「乗り物が苦手」は乗り物好きの言葉にも当たるので、否定が近くにあれば打ち消しの規則にまかせる
    if (set.vehicle === 0.85 && /乗り物が苦手|乗り物に乗らない|乗り物は苦手/.test(t)) continue;
    Object.assign(p, set); reasons.push(`「${m[0]}」から: ${why}`);
  }
  for (const [re, set, why] of NG_RULES) {
    const m = t.match(re); if (!m) continue;
    if (set.quietAfter) ng.quietAfter = ng.quietAfter === null ? set.quietAfter : Math.min(ng.quietAfter, set.quietAfter);
    if (set.words) for (const w of set.words) if (!ng.words.includes(w)) ng.words.push(w);
    reasons.push(`「${m[0]}」から: NG行動として、${why}`);
  }
  for (const k of Object.keys(interests)) interests[k] = Math.round(interests[k] * 20) / 20;
  if (!reasons.length) reasons.push('文章から読み取れる言葉がなかったので、今の値に近いままにした。好きなもの、苦手なもの、歩き方、乗り物の好みなどを書くと、パラメータに反映されます');
  return {
    interests, stride: Math.round(p.stride * 100) / 100, speed: Math.round(p.speed), vehicle: Math.round(p.vehicle * 100) / 100,
    curiosity: Math.round(p.curiosity * 100) / 100, range: Math.round(p.range / 100) * 100, ng, reasons, model: 'dummy-keywords-v1',
  };
}

module.exports = { suggestParams };

/* ============================================================================
 * 【AI差し替え箇所 8】推しの説明からパラメータを決める（実環境で外部APIへの接続が許される場合）
 * ----------------------------------------------------------------------------
 * const ai = require('./ai');
 * async function suggestParamsWithAI(text, cur) {
 *   const out = await ai.complete({
 *     json: true,
 *     system: [
 *       'あなたは、キャラクターの行動のパラメータを決める担当です。キャラクターの説明から、次のJSONだけを答えてください。',
 *       '{"interests": {"food":0〜1.2,"cafe":..,"sweets":..,"shop":..,"view":..,"shrine":..,"history":..,"library":..,"dojo":0〜1.6},',
 *       ' "stride": 0.4〜1.0（歩幅m）, "speed": 40〜110（分速m）, "vehicle": 0〜1（乗り物好き）, "curiosity": 0〜1（好奇心）, "range": 500〜5000（距離の許容m）,',
 *       ' "ng": {"cats": [行かない場所の種類], "words": [入らない場所の名前に含まれる言葉], "quietAfter": 出歩かなくなる時刻（0〜24）または null},',
 *       ' "reasons": ["どの言葉から、何を決めたか"]}',
 *     ].join('\n'),
 *     prompt: JSON.stringify({ description: text, current: cur }),
 *   });
 *   return Object.assign(out, { model: 'claude' });
 * }
 * // 呼び出し元（admin/org-server.js の /characters/:id/suggest）を async にして await を付ける
 * ========================================================================== */
