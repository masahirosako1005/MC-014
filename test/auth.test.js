// ログインのテスト
'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const auth = require('../lib/auth');
const store = require('../lib/store');
const content = require('../lib/content');

test('パスワードはハッシュで保存し、照合できる', () => {
  const { salt, hash } = auth.hashPassword('password123');
  assert.ok(auth.verifyPassword('password123', salt, hash));
  assert.ok(!auth.verifyPassword('password124', salt, hash));
  assert.ok(!hash.includes('password'));
});

test('ログインIDは半角英数字のみで、メールアドレスは使えない', () => {
  const u = store.createUser(content.get());
  assert.strictEqual(auth.signup(store, u, 'me@example.com', 'password123').status, 400);
  assert.strictEqual(auth.signup(store, u, 'ab', 'password123').status, 400);
  assert.strictEqual(auth.signup(store, u, 'tabibito1', 'short').status, 400);
  assert.strictEqual(auth.signup(store, u, 'tabibito1', 'password123').status, 200);
  const u2 = store.createUser(content.get());
  assert.strictEqual(auth.signup(store, u2, 'TABIBITO1', 'password123').status, 409);
});

test('ログインで登録済みの内容へ切り替わり、失敗が続くと止まる', () => {
  const headers = {}; const res = { setHeader: (k, v) => { headers[k] = v; } }; const req = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
  assert.strictEqual(auth.login(store, req, res, 'tabibito1', 'password123').status, 200);
  assert.ok(/HttpOnly/.test(headers['Set-Cookie']) && /SameSite=Strict/.test(headers['Set-Cookie']));
  for (let i = 0; i < 5; i++) auth.login(store, req, res, 'tabibito1', 'wrong-pass');
  assert.strictEqual(auth.login(store, req, res, 'tabibito1', 'password123').status, 429);
});
