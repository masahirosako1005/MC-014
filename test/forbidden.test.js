// 「採用しないもの」（要件定義 8章）が画面とデータに入っていないことを確かめる
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? (d.name === 'vendor' || d.name === 'assets' ? [] : files(path.join(dir, d.name))) : [path.join(dir, d.name)]));
}
const targets = [...files(path.join(root, 'public')), ...files(path.join(root, 'data')), ...files(path.join(root, 'lib'))].filter(f => /\.(js|html|css|json)$/.test(f) && !/routes\.json$|state\.json$|spot-db\.json$/.test(f));

test('取りやめたキャラ名、ボタン名、機能が入っていない', () => {
  const NG = ['村上武吉', '福本ひより', 'が考えるルート', '今日を再生', '路地に寄り道しながら'];
  for (const f of targets) {
    const s = fs.readFileSync(f, 'utf8');
    for (const w of NG) assert.ok(!s.includes(w), `${path.relative(root, f)} に「${w}」`);
  }
});

test('「？？？」で未獲得のものを伏せて並べない', () => {
  for (const f of files(path.join(root, 'public', 'js'))) assert.ok(!fs.readFileSync(f, 'utf8').includes('？？？'), f);
});

test('外部のCDNやAPIを画面から読みこまない（国土地理院を除く）', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.ok(!/<script[^>]+src="https?:/.test(html) && !/<link[^>]+href="https?:/.test(html));
  for (const f of files(path.join(root, 'public', 'js'))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.match(/fetch\(\s*['"`]https?:[^'"`]+/g) || []) assert.ok(/cyberjapandata\.gsi\.go\.jp/.test(m), m);
  }
});

test('大会規定: サーバから接続する先は国土地理院だけ（コメントの中の差し替え用のコードは除く）', () => {
  const src = [path.join(root, 'server.js'), ...files(path.join(root, 'lib')), ...files(path.join(root, 'admin')), ...files(path.join(root, 'tools'))]
    .filter(f => f.endsWith('.js') && !f.includes(`${path.sep}.cache${path.sep}`));
  const allowed = /^https:\/\/(cyberjapandata|maps)\.gsi\.go\.jp\//;
  for (const f of src) {
    // コメント（/* */ と //）を消してから、通信の呼び出しと、そこに渡す URL を探す
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    if (/require\(['"](https?|net|tls|dgram)['"]\)/.test(code) || /\bfetch\(/.test(code)) {
      for (const m of code.match(/['"`]https?:\/\/[^'"`\s]+/g) || []) {
        const url = m.slice(1);
        if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) continue;
        assert.ok(allowed.test(url), `${path.relative(root, f)} が国土地理院以外へ接続する: ${url}`);
      }
    }
    // Anthropic などのAIのライブラリは、コメントの外で読みこまない
    assert.ok(!/require\(['"]@anthropic-ai\/sdk['"]\)/.test(code), `${path.relative(root, f)} がAIのライブラリを読みこんでいる`);
  }
});

test('大会規定: 画面の通信先は自分のサーバと国土地理院だけ（Content-Security-Policy）', () => {
  for (const f of ['server.js', 'admin/server.js', 'admin/org-server.js']) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(/connect-src 'self'/.test(s), f + ' の connect-src');
    assert.ok(/script-src 'self'/.test(s), f + ' の script-src');
    const img = (s.match(/img-src [^;"]+/) || [''])[0];
    assert.ok(img && img.split(' ').filter(x => /^https?:/.test(x)).every(x => /gsi\.go\.jp$/.test(x)), f + ' の img-src: ' + img);
  }
});
