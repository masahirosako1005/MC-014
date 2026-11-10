/**
 * lib/ai.js
 * AIの接続口（本アプリでは使わない）。
 *
 * 大会規定で外部のAPIに接続できないため、本アプリではダミーデータでAIを再現している（設計書 20章）。
 * 実際のサービスで生成AIを使うときは、次の手順で切り替える。
 *   1. npm install @anthropic-ai/sdk を実行し、環境変数 ANTHROPIC_API_KEY を設定する
 *   2. このファイルのコメントアウトを外す
 *   3. ソースを「【AI差し替え箇所】」で検索し、7か所のコメントアウトを外してダミーの処理と入れ替える
 *   4. 呼び出し元の関数を async にして await を付ける
 *
 * 呼び出すのはサーバ側だけで、ブラウザからは接続しない。
 * ミニ推しは喋らない。指示文で、第三者の天の声として書くよう必ず伝える。
 */
'use strict';

/*
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 推しの台詞を書かせないための、共通の指示
const BASE_SYSTEM = [
  'あなたは「ミニ推し！」の天の声です。',
  '推しのキャラクターは喋りません。台詞、かぎかっこ、吹き出しを使わず、第三者の視点で書いてください。',
  '訪れた理由や、歩き方の説明は書かないでください。',
].join('\n');

async function complete({ system, prompt, maxTokens = 400, json = false }) {
  const res = await client.messages.create({
    model: 'claude-sonnet-5-5',
    max_tokens: maxTokens,
    system: BASE_SYSTEM + '\n' + (system || ''),
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content.map(c => c.text || '').join('');
  return json ? JSON.parse(text) : text.trim();
}

module.exports = { complete };
*/

module.exports = {
  /** ダミー。本アプリでは呼ばれない */
  complete() { throw new Error('外部のAIには接続しません（大会規定）。lib/ai.js のコメントを参照してください。'); },
};
