# ミニ推し！

獲得した推しが、実際の町（広島県尾道市、三原市、大阪市）を自分の意思で旅する。その行動を楽しむWEBアプリ。
既存のスタンプラリーWEBアプリに付随して使い、スタンプラリーのユーザーに再訪してもらうことを目的とする。

- 要件: [docs/要件定義.md](docs/要件定義.md)
- 設計: [docs/設計書.md](docs/設計書.md)（末尾の「0. 開発時の確認事項」に、作り直しで決めたことをまとめている）

## 起動

Node.js 19 以上。

```bash
npm install
npm start
```

| 画面 | URL | 備考 |
|---|---|---|
| ユーザー向け | http://localhost:3000 | スマホ表示はブラウザの開発者ツールの端末モードで確認する |
| 運営（事務局）の管理画面 | http://localhost:3100 | このPC（127.0.0.1）からのみ接続できる |
| 自治体・団体の管理画面 | http://localhost:3200 | 事務局が発行したアカウントで使う。デモではこのPCからのみ |

管理画面のログイン（デモ用の値。環境変数 `ADMIN_ID` と `ADMIN_PASSWORD` で変えられる）

| 項目 | 値 |
|---|---|
| ID | `admin` |
| パスワード | `mini-oshi-admin` |

自治体・団体の管理画面のデモ用アカウント（初めて起動したときに `data/orgs.json` に作る。事務局の管理画面の「自治体のアカウント」で変更・追加できる）

| 組織 | ログインID | パスワード | 担当 |
|---|---|---|---|
| 大阪市 観光課（デモ） | `osaka-city` | `osaka-demo-2026` | 大阪市 / 京町ありさ、堀江凪、GUMI、もやしペンギン |
| 尾道市 観光課（デモ） | `onomichi-city` | `onomichi-demo-2026` | 尾道市 / 宮本武蔵 |
| 三原市 観光課（デモ） | `mihara-city` | `mihara-demo-2026` | 三原市 / 小早川隆景 |

すぐに試すには、設定タブの「すべてのキャラとエリアを獲得する」を押す（90日前に獲得した扱いになり、足あとが溜まった状態を見られる）。

## 管理画面でできること（主なもの）

| 画面 | できること |
|---|---|
| 事務局の「マップ」 | 地図の上でエリアを描いて足す、範囲・最初の駅を直す、場所を置く、実在の場所を自動で集める、道のデータを作る（国土地理院のデータを取得） |
| 事務局の「自治体のアカウント」 | アカウントの発行、担当のエリア（足したエリアも）とキャラクターの割り振り |
| 自治体の「場所」 | 担当エリアの地図。実在の場所を自動で集める、スポット（アニメの聖地など）を足す・直す |
| 自治体の「キャラクター」 | 推しの説明からパラメータとNG行動を提案（デモではダミーのAI）、手で調整して申請。設定資料（RAG）を登録すると、AIが資料を参照して特徴を作り、参照した部分を画面に出す |

## サンプルコード

「出会う」のコード入力に入れる。QRコードの画像は [docs/demo-qr/](docs/demo-qr/README.md)。

| コード | 獲得できるもの |
|---|---|
| `MINI-TAKAKAGE-1T5M` | 小早川 隆景（三原市も開放） |
| `MINI-MUSASHI-6D2N` | 宮本 武蔵（初期キャラのため、新しい利用者では「もう一緒にいます」になる） |
| `MINI-NAGI-7K2F` | 堀江 凪 |
| `MINI-GUMI-9B4R` | GUMI（MELLOW BLUE） |
| `MINI-MOYASHI-3P7E` | もやしペンギン |
| `AREA-OSAKA-6N1K` | 大阪府大阪市 |
| `AREA-ONOMICHI-2H8D` | 広島県尾道市 |
| `AREA-MIHARA-3B8Y` | 広島県三原市 |

## テスト

```bash
npm test
```

## 開発時のツール（アプリの実行時には使わない）

| コマンド | 内容 |
|---|---|
| `npm run build-routes` | 国土地理院のベクトルタイルから道のグラフを作り `data/routes.json` に保存する（開発時のみ国土地理院へ接続。タイルは `tools/.cache` に保存） |
| `npm run build-spots` | デモ用の架空のスポット5010か所を `data/extra-places.json` に作る |
| `npm run spots:update` | スポットDB（`data/spot-db.json`）を手で更新する（サーバは起動時と1時間ごとに古さを確かめ、24時間ごとに自動で更新する） |
| `npm run demo-qr` | デモ用のQRコード画像を `docs/demo-qr/` に作る |

## 環境変数

| 変数 | 既定値 | 内容 |
|---|---|---|
| `PORT` | `3000` | ユーザー向けのポート |
| `HOST` | `127.0.0.1` | 待ち受けアドレス（管理画面には効かない） |
| `ADMIN_PORT` | `3100` | 管理画面のポート |
| `ADMIN_ID` `ADMIN_PASSWORD` | 上の表 | 管理画面のログイン情報 |
| `ORG_PORT` | `3200` | 自治体・団体の管理画面のポート |
| `SPOT_UPDATE_HOURS` | `24` | スポットDBを更新する間隔 |

## 大会規定への対応

- PHPは使わない（Node.js + Express）
- 実行時に外部のAPIへ接続しない。ブラウザの通信先はCSPで自サーバと国土地理院（`cyberjapandata.gsi.go.jp`）に限る
- AIを使う箇所は、ダミーデータで再現している。本物に切り替えるコードは「【AI差し替え箇所】」「【API差し替え箇所】」で検索すると見つかる（`lib/ai.js` に手順）

## 提出物に含めないもの

`node_modules/`、`data/state.json`（利用者の進行状況）、`data/orgs.json`（自治体のアカウントと申請）、`public/assets/uploads/`（申請された絵）、`data/content.json`（管理画面の編集内容）、`data/spot-db.json`（起動時に作り直す）、`tools/.cache/`。

## 絵の出典

| 推し | 絵 | 出典と権利 |
|---|---|---|
| 小早川 隆景 | public/assets/takakage/takakage.jpg | 絹本著色小早川隆景像（米山寺蔵、1594年）。Wikimedia Commons「File:Kobayakawa Takakage (Beisanji Mihara).jpg」、Public domain |
| 宮本 武蔵 | public/assets/musashi/musashi.jpg | 宮本武蔵の自画像と伝わる肖像（島田美術館蔵、17世紀前半）。Wikimedia Commons「File:Miyamoto Musashi Self-Portrait.jpg」、Public domain |
| 堀江 凪 | public/assets/nagi/nagi.png | 依頼者から提供されたイラスト |
| GUMI | public/assets/gumi/gumi.webp | 依頼者から提供された写真（公開前に肖像権と使用許可の確認が必要） |
| もやしペンギン | public/assets/moyashi/moyashi-penguin.png | イラスト: NARU.（依頼者から提供） |
| 文字ロゴ | public/assets/brand/wordmark.png | 依頼者から提供された画像（背景を透明にしたもの） |
| アイコン | public/favicon.svg | このアプリのために作ったもの（docs/logo/ にロゴの案もある） |

## 設計書

- docs/要件定義.md: 指示書
- docs/設計書.md: 設計書と開発時の確認事項（0章）
- docs/システム設計書.md: システム構成、画面設計、データ設計、機能一覧、API、セキュリティ、試験項目・シナリオ・結果

## 公開するときの注意（セキュリティ）

- 管理画面のパスワードは環境変数 `ADMIN_PASSWORD`（ID は `ADMIN_ID`）で必ず変えてください。デモ用の値のままだと、起動時に警告が出ます。
- 自治体のデモ用アカウント（上の表）は、事務局の画面でパスワードを変えるか、止めてください。
- デモ用の「全部獲得」（`/api/demo/unlock-all`）は、環境変数 `DEMO_UNLOCK=off` で止められます。止めないと、獲得コードがなくても全員が全部を獲得できます。
- HTTPS で公開するときは、Cookie に Secure を付けてください（今は localhost の HTTP で動かすため付けていません）。
- 管理画面（3100）と自治体の管理画面（3200）は、このPCからだけ開けます（127.0.0.1）。
