/**
 * tools/make-demo-qr.js  （開発時にのみ実行する）
 * デモ用の獲得コードのQRコード画像を docs/demo-qr/ に作る。
 *   npm run demo-qr
 */
'use strict';

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { CODES, CHARACTERS, AREAS } = require('../data/world');

const OUT = path.join(__dirname, '..', 'docs', 'demo-qr');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const lines = ['# デモ用のQRコード', '', '「出会う」のQRコードで読み取ると、推しやエリアを獲得できます。', '', '| 画像 | コード | 獲得できるもの |', '|---|---|---|'];
  for (const c of CODES) {
    const file = c.code.toLowerCase() + '.png';
    await QRCode.toFile(path.join(OUT, file), c.code, { width: 360, margin: 2, color: { dark: '#1f2a4a', light: '#ffffff' } });
    const name = c.type === 'character' ? (CHARACTERS.find(x => x.id === c.id) || {}).name : (AREAS.find(x => x.id === c.id) || {}).name;
    lines.push(`| ![${c.code}](${file}) | \`${c.code}\` | ${name} |`);
  }
  fs.writeFileSync(path.join(OUT, 'README.md'), lines.join('\n') + '\n');
  console.log('作成しました:', OUT);
})();
