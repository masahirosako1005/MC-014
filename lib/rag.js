/**
 * lib/rag.js
 * キャラクターの設定資料のRAG（検索して参照する生成）。【AI差し替え箇所 9】
 *
 * 自治体の管理画面で、キャラクターごとに設定資料（設定書、作品のあらすじ、公式のプロフィールなど。テキストやMarkdown）を
 * 登録しておくと、「AIにおまかせ」で推しの説明からパラメータを決めるときや、特徴（性格、好きなもの、苦手なもの、紹介）を
 * 作るときに、資料の中から関係のある部分を探して参照する。参照した部分は、画面に「参照した資料」として出す。
 *
 * 本アプリでは外部のAIに接続できないため、次のように再現する（ダミー）。
 *   - 資料を段落ごとに区切り（チャンク）、data/rag.json に保存する（本番ではベクトルDBに埋め込みを保存する）
 *   - 検索は、文字の2文字ずつの重なり（バイグラム）の点数で上位を選ぶ（本番では埋め込みの類似度）
 *   - 生成は、参照した部分から「性格」「好き」「苦手」などの言葉を含む文を拾い、lib/persona-ai.js の照合にかける（本番ではAI）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { suggestParams } = require('./persona-ai');

const FILE = process.env.RAG_FILE || path.join(__dirname, '..', 'data', 'rag.json');
const MAX_DOC = 200 * 1024;

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { docs: [] }; } }
let db = load();
function persist() { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE); }

/** 資料を段落ごとに区切る（長い段落は約300文字で分ける） */
function chunk(text) {
  const paras = String(text).replace(/\r/g, '').split(/\n\s*\n|(?=^#{1,6}\s)/m).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const p of paras) {
    if (p.length <= 360) { out.push(p); continue; }
    const sentences = p.split(/(?<=[。！？\n])/);
    let buf = '';
    for (const s of sentences) { if ((buf + s).length > 300 && buf) { out.push(buf.trim()); buf = ''; } buf += s; }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.slice(0, 400);
}
const grams = s => { const t = String(s).replace(/\s+/g, ''); const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };

function addDoc(charId, orgId, name, text) {
  const t = String(text || '');
  if (!t.trim()) return { error: '資料の中身がありません' };
  if (Buffer.byteLength(t) > MAX_DOC) return { error: '資料は200KBまでにしてください' };
  // 1つのキャラクターの資料は20件・合わせて2MBまで（保存ファイルと検索の重さを抑える）
  const mine = db.docs.filter(d => d.charId === charId);
  if (mine.length >= 20) return { error: '資料は1つのキャラクターにつき20件までです。古い資料を消してから登録してください' };
  if (mine.reduce((s, d) => s + d.size, 0) + Buffer.byteLength(t) > 2 * 1024 * 1024) return { error: '資料は1つのキャラクターにつき合わせて2MBまでです' };
  const doc = { id: crypto.randomBytes(5).toString('hex'), charId, orgId, name: String(name || '資料').slice(0, 60), size: Buffer.byteLength(t), uploadedAt: Date.now(), chunks: chunk(t) };
  db.docs.push(doc); persist();
  return { doc: summary(doc) };
}
const summary = d => ({ id: d.id, name: d.name, size: d.size, uploadedAt: d.uploadedAt, chunks: d.chunks.length, orgId: d.orgId });
function list(charId) { return db.docs.filter(d => d.charId === charId).map(summary); }
function remove(charId, docId) { const before = db.docs.length; db.docs = db.docs.filter(d => !(d.charId === charId && d.id === docId)); persist(); return db.docs.length < before; }

/**
 * 資料の中から、問いに関係のある部分を探す（ダミーの検索）
 * @returns {Array<{doc, text, score}>}
 */
function search(charId, query, k = 5) {
  const q = grams(query);
  const hits = [];
  for (const d of db.docs.filter(x => x.charId === charId)) {
    d.chunks.forEach((text, i) => {
      const g = grams(text); let n = 0; for (const x of q) if (g.has(x)) n++;
      const score = q.size ? n / Math.sqrt(g.size + 1) : 0;
      if (score > 0) hits.push({ doc: d.name, docId: d.id, index: i, text, score: Math.round(score * 100) / 100 });
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, k);
}

/** 資料から特徴の文を拾う（ダミーの生成） */
function pickFeatures(texts) {
  const sentences = texts.join('\n').split(/[。\n]/).map(s => s.replace(/^[#\-*・\s]+/, '').trim()).filter(s => s.length >= 2 && s.length <= 60)
    // 見出しだけの行（「性格」「好きなもの」など）は特徴にしない
    .filter(s => !/^(性格|好きなもの|苦手なもの|嫌いなもの|趣味|行動|プロフィール|設定)$/.test(s));
  const uniq = a => [...new Set(a)].slice(0, 8);
  const listAfter = (re, s) => { const m = s.match(re); return m ? m[1].split(/[、,，・\/]|と(?=[^と]{2,})/).map(x => x.replace(/(が|も|は|を|など|です|だ)$/, '').trim()).filter(x => x && x.length <= 20) : []; };
  const likes = [], dislikes = [], personality = []; let tagline = '';
  for (const s of sentences) {
    likes.push(...listAfter(/(?:好きなもの|好物|趣味)[：:は\s]*(.+)/, s));
    dislikes.push(...listAfter(/(?:苦手なもの|苦手|嫌いなもの)[：:は\s]*(.+)/, s));
    const lk = s.match(/^(.{2,16})が(?:大)?好き/); if (lk && !/苦手/.test(s)) likes.push(lk[1]);
    const dk = s.match(/^(.{2,16})が(?:苦手|嫌い)/); if (dk) dislikes.push(dk[1]);
    if (/性格|な人|な子|タイプ|気質|やさしい|明るい|物静か|まじめ|頑固|好奇心|人見知り|気まぐれ/.test(s) && !/好きなもの|苦手なもの/.test(s)) personality.push(s.replace(/^性格[：:は\s]*/, ''));
    const tg = s.match(/^(?:肩書き|紹介|ひとこと|キャッチコピー)[：:\s]*(.{2,40})$/); if (tg && !tagline) tagline = tg[1];
  }
  const ok = (a, min) => uniq(a.filter(x => x && x.length >= min));
  return { personality: ok(personality, 4), likes: ok(likes, 1), dislikes: ok(dislikes, 1), tagline };
}

/**
 * 資料を参照して、パラメータと特徴を作る。【AI差し替え箇所 9】
 * @param {string} charId
 * @param {string} text 画面で書いた推しの説明（なくてもよい）
 * @param {object} cur 今の値
 */
function generate(charId, text, cur) {
  const docs = db.docs.filter(d => d.charId === charId);
  const query = (text || '') + ' 性格 好き 苦手 趣味 歩く 乗り物 夜 行かない';
  const refs = docs.length ? search(charId, query, 6) : [];
  const params = suggestParams([text || '', ...refs.map(r => r.text)].join('\n'), cur);
  const features = pickFeatures(refs.map(r => r.text));
  return Object.assign(params, {
    features, sources: refs.map(r => ({ doc: r.doc, excerpt: r.text.length > 140 ? r.text.slice(0, 140) + '…' : r.text, score: r.score })),
    rag: { docs: docs.length, chunks: docs.reduce((s, d) => s + d.chunks.length, 0), model: 'dummy-bigram-retrieval-v1' },
  });
}

module.exports = { addDoc, list, remove, search, generate, chunk, pickFeatures };

/* ============================================================================
 * 【AI差し替え箇所 9】本物のRAGに切り替える（実環境で外部APIへの接続が許される場合）
 * ----------------------------------------------------------------------------
 * 1. 資料を登録するとき（addDoc）に、チャンクごとに埋め込みを作ってベクトルDBに保存する
 *      const vectors = await embed(doc.chunks);          // 埋め込みのAPI
 *      await vectorDb.upsert(doc.chunks.map((text, i) => ({ id: doc.id + ':' + i, vector: vectors[i], meta: { charId, text, doc: doc.name } })));
 * 2. 検索（search）は、問いの埋め込みと近いチャンクをベクトルDBから取る
 *      const [qv] = await embed([query]);
 *      return (await vectorDb.query({ vector: qv, topK: k, filter: { charId } })).map(m => ({ doc: m.meta.doc, text: m.meta.text, score: m.score }));
 * 3. 生成（generate）は、取ったチャンクを根拠としてAIに渡す
 *      const ai = require('./ai');
 *      return ai.complete({ json: true,
 *        system: '次の設定資料だけを根拠に、キャラクターの性格、好きなもの、苦手なもの、紹介と、行動のパラメータ（lib/persona-ai.js と同じ形）をJSONで答えてください。資料にないことは作らないこと。推しに台詞を言わせないこと。',
 *        prompt: JSON.stringify({ description: text, sources: refs.map(r => r.text), current: cur }) });
 * ========================================================================== */
