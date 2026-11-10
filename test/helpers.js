// テスト用の準備。ユーザーの保存先と管理の内容を一時ファイルにして、data/ を汚さない。
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-oshi-test-'));
process.env.STATE_FILE = path.join(dir, 'state.json');
process.env.CONTENT_FILE = path.join(dir, 'content.json');
process.env.SPOT_DB_FILE = path.join(dir, 'spot-db.json');
process.env.ORGS_FILE = path.join(dir, 'orgs.json');
process.env.UPLOAD_DIR = path.join(dir, 'uploads');
process.env.RAG_FILE = path.join(dir, 'rag.json');
module.exports = { dir };
