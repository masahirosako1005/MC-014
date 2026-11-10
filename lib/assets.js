/**
 * lib/assets.js
 * 獲得コードのQRコード画像と、キャラクターの絵の受け取り。どちらもサーバ内で作り、外部には接続しない。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'public', 'assets', 'uploads');

/** 獲得コードのQRコード（PNG）。「出会う」のQRコード読み取りで、そのままコードとして読める */
function qrPng(code, width = 480) {
  return QRCode.toBuffer(code, { width, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#1f2a4a', light: '#ffffff' } });
}

const TYPES = [
  { ext: 'png', mime: 'image/png', magic: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', magic: b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];
const MAX = 1.5 * 1024 * 1024;

/**
 * キャラクターの絵を保存する（data URL で受け取る）。中身の先頭のバイトで種類を確かめ、PNG / JPEG / WebP だけを受け付ける。
 * @returns {{path:string}|{error:string}} path は画面から参照する場所（assets/uploads/...）
 */
/**
 * 申請用の絵を保存する。keep は消してはいけない絵（今の絵や確認待ちの申請の絵）のパス。
 * 1つのキャラクターの絵は、keep 以外は新しい順に10枚までにし、古いものは消す（送るたびにファイルが増え続けないように）
 */
function saveCharacterImage(charId, dataUrl, keep = []) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return { error: '画像は PNG、JPEG、WebP にしてください' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX) return { error: '画像は1.5MB以下にしてください' };
  const t = TYPES.find(x => x.magic(buf));
  if (!t) return { error: '画像の形式を確かめられませんでした' };
  if (!/^[a-z0-9-]+$/.test(charId)) return { error: 'キャラクターが正しくありません' };
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${charId}-${crypto.randomBytes(5).toString('hex')}.${t.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  try {
    const keepSet = new Set(keep.map(p => String(p || '').replace(/^assets\/uploads\//, '')));
    const mine = fs.readdirSync(UPLOAD_DIR).filter(f => f.startsWith(charId + '-') && f !== name && !keepSet.has(f))
      .map(f => ({ f, t: fs.statSync(path.join(UPLOAD_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const x of mine.slice(9)) fs.unlinkSync(path.join(UPLOAD_DIR, x.f));
  } catch { /* 片づけに失敗しても、保存はできている */ }
  return { path: 'assets/uploads/' + name };
}

module.exports = { qrPng, saveCharacterImage, UPLOAD_DIR };
