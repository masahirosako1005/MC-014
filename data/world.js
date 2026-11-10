/**
 * data/world.js
 * ミニ推し！の世界の初期値。作品、エリア、場所、公共交通、キャラ、獲得コード。
 *
 * - 管理画面で編集した内容は data/content.json に保存され、lib/content.js がこの初期値の上に重ねる。
 * - 場所の座標は地図上の目安。経路は tools/build-routes.js が国土地理院の道路データから作る。
 * - デモ用の架空のスポット（data/extra-places.json）は tools/build-spots.js が作り、ここで PLACES に足す。
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ---------------------------------------------------------------- 作品 */
// theme は画面の世界の色。指定の3色から作った3種類（teal / mint / yellow）のみ。
const WORKS = [
  {
    id: 'meguru', title: 'めぐる、N西市。', kind: 'anime', kindLabel: 'アニメ作品', theme: 'teal',
    synopsis: '海と坂の街・N西市。写真部の二年生、京町ありさは、古いフィルムカメラを片手に、毎日少しだけ遠回りをして帰る。何でもない街角が、ファインダーの中でだけ特別になる、ひと夏からはじまる日常の物語。',
    rights: '© めぐる、N西市。製作委員会（架空の作品です）',
  },
  {
    id: 'sengoku', title: '戦国の武将と剣豪', kind: 'history', kindLabel: '歴史上の人物', theme: 'yellow',
    synopsis: '三原城を築いた毛利の知将・小早川隆景と、生涯で六十余度の勝負に負けなかったと伝わる剣豪・宮本武蔵。現代の町を旅したら、という空想のもとに描く。',
    rights: '史実の人物をもとにした創作です。現代を旅する描写は史実ではありません。',
  },
  {
    id: 'mellowblue', title: 'MELLOW BLUE', kind: 'idol', kindLabel: 'アイドルグループ', theme: 'teal',
    synopsis: '「青は、いちばんやさしい反抗の色。」を掲げる5人組のアイドルグループ。メンバーが自分で撮った写真と言葉で日々を発信し、10代・20代から「真似したい」と支持される。センターのGUMIは、着た服も入った店も次の日には行列になる、若者のカリスマ。',
    rights: '© MELLOW BLUE 運営事務局（架空のアイドルグループです）',
  },
  {
    id: 'nnishi', title: 'N西市 公式キャラクター', kind: 'mascot', kindLabel: '自治体の公式キャラクター', theme: 'mint',
    synopsis: '架空の町・N西市の地下水路の、ひんやり暗い倉庫で育ったという、もやしのように細長いペンギン。泳げない、日なたが苦手、なのに雨の日だけは誰よりも元気。市の広報として、片足キックのポーズで町を盛り上げている。',
    rights: 'イラスト: NARU.／N西市は『めぐる、N西市。』に出てくる架空の町です',
  },
];

/* ---------------------------------------------------------------- エリア */
// 市区町村を1単位とし、範囲は市の広がりを近似した多角形（正確な市境ではなく海も含む）。
const AREAS = [
  {
    id: 'osaka', name: '大阪府大阪市', short: '大阪市', pref: '大阪府', region: 'kansai', urban: true,
    arrival: 'awaza-st', center: [34.6840, 135.4930],
    intro: '水の都と呼ばれた大阪の中心。西区は堀を埋め立てた町で、京町堀や江戸堀の名前に水の記憶が残る。『めぐる、N西市。』のN西市のモデル。',
    url: 'https://osaka-info.jp/',
    polygon: [[34.775, 135.43], [34.775, 135.56], [34.72, 135.585], [34.62, 135.565], [34.585, 135.50], [34.60, 135.40], [34.66, 135.395], [34.72, 135.41]],
  },
  {
    id: 'onomichi', name: '広島県尾道市', short: '尾道市', pref: '広島県', region: 'setouchi', urban: false,
    arrival: 'onomichi-st', center: [34.4075, 133.2010],
    intro: '尾道水道に面した坂と寺の町。千光寺山の斜面に家々と路地が重なり、渡船で向島へ渡れる。映画や文学の舞台としても知られる。',
    url: 'https://www.ononavi.jp/',
    polygon: [[34.52, 133.13], [34.52, 133.29], [34.44, 133.31], [34.34, 133.27], [34.28, 133.20], [34.30, 133.13], [34.37, 133.115], [34.44, 133.12]],
  },
  {
    id: 'mihara', name: '広島県三原市', short: '三原市', pref: '広島県', region: 'setouchi', urban: false,
    arrival: 'mihara-st', center: [34.4015, 133.0800],
    intro: '小早川隆景が海に浮かぶように築いた三原城の城下町。駅のすぐ裏に天主台の石垣が残り、港からは瀬戸内の島々へ船が出る。',
    url: 'https://www.mihara-kankou.com/',
    polygon: [[34.58, 132.92], [34.58, 133.12], [34.44, 133.12], [34.37, 133.115], [34.33, 133.05], [34.36, 132.92]],
  },
];

/* ---------------------------------------------------------------- 場所の種類 */
// cat は画面のアイコンと色、行動判断の関心の単位。
const CATEGORIES = {
  food:    { label: '食事', group: 'eat' },
  cafe:    { label: 'カフェ', group: 'eat' },
  sweets:  { label: '甘味・パン', group: 'eat' },
  shop:    { label: '店', group: 'see' },
  view:    { label: '景色', group: 'see' },
  shrine:  { label: '寺社', group: 'see' },
  history: { label: '歴史・美術', group: 'see' },
  library: { label: '図書館', group: 'see' },
  dojo:    { label: '道場', group: 'see' },
  station: { label: '駅', group: 'move' },
  stay:    { label: '宿', group: 'stay' },
  home:    { label: '家', group: 'stay' },
  school:  { label: '学校', group: 'stay' },
};

/* ---------------------------------------------------------------- 場所 */
// hours: [開く時, 閉じる時]（目安。定休日は反映しない）。always は24時間（自然や屋外）。
// outdoor: 雨の日に避ける。stay: 滞在の目安（分）。model: 作中名（モデルになった場所のとき）。
function P(id, area, name, cat, lat, lng, o = {}) {
  return Object.assign({ id, area, name, cat, lat, lng, desc: '', address: '', url: '', hours: [9, 18], outdoor: false, stay: 40 }, o);
}

const ONONAVI = 'https://www.ononavi.jp/';
const MIHARA_NAVI = 'https://www.mihara-kankou.com/';

const PLACES = [
  // ---- 大阪市（N西市のモデル） ----
  P('awaza-st', 'osaka', '阿波座駅', 'station', 34.68240, 135.48990, { model: '海ノ丘駅', hours: null, always: true, stay: 5, address: '大阪府大阪市西区靱本町3丁目', desc: '大阪メトロ中央線と千日前線が交わる駅。作中では海ノ丘駅として、ありさの通学の起点になる。' }),
  P('nishinagahori-st', 'osaka', '西長堀駅', 'station', 34.67410, 135.48640, { always: true, hours: null, stay: 5, address: '大阪府大阪市西区北堀江4丁目', desc: '大阪メトロ千日前線と長堀鶴見緑地線の駅。中央図書館の最寄り。' }),
  P('yotsubashi-st', 'osaka', '四ツ橋駅', 'station', 34.67570, 135.49740, { always: true, hours: null, stay: 5, address: '大阪府大阪市西区北堀江1丁目', desc: '大阪メトロ四つ橋線の駅。堀江の町の東の入口。' }),
  P('hommachi-st', 'osaka', '本町駅（四つ橋線）', 'station', 34.68290, 135.49770, { always: true, hours: null, stay: 5, address: '大阪府大阪市西区靱本町1丁目', desc: '大阪メトロ四つ橋線の駅。靱公園の南東。' }),
  P('higobashi-st', 'osaka', '肥後橋駅', 'station', 34.69190, 135.49720, { always: true, hours: null, stay: 5, address: '大阪府大阪市西区江戸堀1丁目', desc: '大阪メトロ四つ橋線の駅。中之島の美術館や科学館へ歩ける。' }),
  P('nishiumeda-st', 'osaka', '西梅田駅', 'station', 34.69950, 135.49550, { always: true, hours: null, stay: 5, address: '大阪府大阪市北区梅田2丁目', desc: '大阪メトロ四つ橋線の北の始発駅。JR大阪駅へ歩いて乗り換えられる。' }),
  P('osaka-st', 'osaka', '大阪駅', 'station', 34.70250, 135.49590, { always: true, hours: null, stay: 5, address: '大阪府大阪市北区梅田3丁目', desc: 'JRの大阪駅。新幹線と在来線で広島方面へ向かう起点（このアプリでは乗り継ぎをまとめて扱う）。' }),
  P('sakuragawa-st', 'osaka', '桜川駅', 'station', 34.66860, 135.48830, { always: true, hours: null, stay: 5, address: '大阪府大阪市浪速区桜川1丁目', desc: '大阪メトロ千日前線の駅。' }),
  P('namba-st', 'osaka', 'なんば駅', 'station', 34.66560, 135.50020, { always: true, hours: null, stay: 5, address: '大阪府大阪市中央区難波', desc: '大阪メトロの各線が集まる、ミナミの中心の駅。' }),
  P('nishi-hs', 'osaka', '大阪府立西高等学校', 'school', 34.68140, 135.48780, { model: 'N西高校', noRoute: true, hours: [8, 18], stay: 420, address: '大阪府大阪市西区（実在の学校のため詳しい住所は載せません）', desc: '『めぐる、N西市。』のN西高校のモデルとした実在の高校。ルートの行き先には入れません。生徒以外は立ち入らないでください。' }),
  P('utsubo-park', 'osaka', '靱公園', 'view', 34.68560, 135.49300, { always: true, hours: null, outdoor: true, stay: 35, address: '大阪府大阪市西区靱本町', url: 'https://www.osakapark.osgf.or.jp/utsubo/', desc: '東西に長い、けやき並木とバラ園の公園。作中では、写真部がよく撮影に来る並木道として描かれる。' }),
  P('orange-st', 'osaka', 'オレンジストリート', 'shop', 34.67460, 135.49110, { model: '潮風坂', hours: [11, 20], stay: 45, address: '大阪府大阪市西区南堀江（立花通り）', desc: '雑貨や家具、古着の店が並ぶ立花通り。作中では潮風坂として、ありさの帰り道の寄り道先になる。' }),
  P('tosainari', 'osaka', '土佐稲荷神社', 'shrine', 34.67480, 135.48700, { model: '汐音神社', always: true, hours: null, outdoor: true, stay: 20, address: '大阪府大阪市西区北堀江4丁目', desc: '土佐藩の蔵屋敷に祀られていた稲荷社。桜の名所。作中では汐音神社として登場する。' }),
  P('nakanoshima-park', 'osaka', '中之島公園', 'view', 34.69280, 135.50880, { model: '夕凪展望台', always: true, hours: null, outdoor: true, stay: 40, address: '大阪府大阪市北区中之島1丁目', desc: '堂島川と土佐堀川にはさまれた中洲の公園。川面に映る夕景が美しい。作中では夕凪展望台として、ありさが一番好きな撮影の場所。' }),
  P('central-library', 'osaka', '大阪市立中央図書館', 'library', 34.67330, 135.48500, { hours: [9, 21], stay: 90, address: '大阪府大阪市西区北堀江4丁目3-2', url: 'https://www.oml.city.osaka.lg.jp/', desc: '大阪市の中央図書館。地下から上階まで、たっぷりの閲覧席がある。凪の放課後の定位置。' }),
  P('horie-park', 'osaka', '堀江公園', 'view', 34.67270, 135.48880, { always: true, hours: null, outdoor: true, stay: 20, address: '大阪府大阪市西区北堀江3丁目', desc: '堀江の住宅街の中の公園。' }),
  P('nmao', 'osaka', '国立国際美術館', 'history', 34.69130, 135.49170, { hours: [10, 17], stay: 80, address: '大阪府大阪市北区中之島4丁目2-55', url: 'https://www.nmao.go.jp/', desc: '竹の生命力と現代美術の発展をイメージした銀色の外観の、地下にある美術館。' }),
  P('sci-museum', 'osaka', '大阪市立科学館', 'history', 34.69180, 135.49290, { hours: [9.5, 17], stay: 90, address: '大阪府大阪市北区中之島4丁目2-1', url: 'https://www.sci-museum.jp/', desc: 'プラネタリウムのある科学館。' }),
  P('enoco', 'osaka', '江之子島文化芸術創造センター', 'history', 34.68270, 135.48670, { hours: [10, 20], stay: 40, address: '大阪府大阪市西区江之子島2丁目1-34', desc: '旧大阪府庁の跡地に建つ、展示とイベントの拠点。' }),
  P('kitamido', 'osaka', '北御堂（本願寺津村別院）', 'shrine', 34.68580, 135.50000, { hours: [7, 17], stay: 25, address: '大阪府大阪市中央区本町4丁目1-3', desc: '御堂筋の名前の由来になった寺院。大きな石段の上に本堂がある。' }),
  P('arca', 'osaka', 'CAFE&BAKE ARCA', 'sweets', 34.68350, 135.48850, { model: '菓子舗 月あかり', hours: [10, 18], stay: 35, address: '大阪府大阪市西区（デモのため番地は載せません）', desc: '焼き菓子とパンの店。作中では菓子舗 月あかりとして、ありさが部活の帰りに焼き菓子を買う店になる。営業や品ぞろえは店に確認を。' }),
  P('pan-espresso', 'osaka', 'パンとエスプレッソと 京町堀', 'cafe', 34.68780, 135.49420, { model: '港食堂 なぎさ亭', hours: [8, 18], stay: 45, address: '大阪府大阪市西区京町堀（デモのため番地は載せません）', desc: 'パンとエスプレッソの店。作中では港食堂 なぎさ亭として、休みの日の朝ごはんの場所になる。営業は店に確認を。' }),
  P('hotel-nikko', 'osaka', 'ホテル日航大阪', 'stay', 34.67310, 135.50050, { hours: null, always: true, stay: 600, address: '大阪府大阪市中央区西心斎橋1丁目3-3', desc: '心斎橋のホテル。このアプリでは、夜遅くに大阪へ移された推しが泊まる宿として扱う。' }),

  // ---- 広島県尾道市 ----
  P('onomichi-st', 'onomichi', '尾道駅', 'station', 34.40450, 133.19370, { always: true, hours: null, stay: 5, address: '広島県尾道市東御所町1-1', desc: 'JR山陽本線の駅。駅を出るとすぐ尾道水道が見える。' }),
  P('ekimae-pier', 'onomichi', '駅前渡船 尾道側乗り場', 'station', 34.40400, 133.19560, { always: true, hours: null, stay: 5, address: '広島県尾道市東御所町', desc: '尾道と向島の富浜を結ぶ渡船の乗り場。自転車ごと乗れる。' }),
  P('tomihama-pier', 'onomichi', '駅前渡船 向島側乗り場', 'station', 34.40120, 133.19620, { always: true, hours: null, stay: 5, address: '広島県尾道市向島町富浜', desc: '向島側の渡船の乗り場。' }),
  P('rw-bottom', 'onomichi', '千光寺山ロープウェイ 山麓駅', 'station', 34.40870, 133.20330, { hours: [9, 17.25], stay: 5, address: '広島県尾道市長江1丁目3-3', url: 'https://www.onomichibus.jp/ropeway/', desc: '千光寺山の山頂まで約3分で上がるロープウェイの山麓駅。' }),
  P('rw-top', 'onomichi', '千光寺山ロープウェイ 山頂駅', 'station', 34.41140, 133.19970, { hours: [9, 17.25], stay: 5, address: '広島県尾道市西土堂町', url: 'https://www.onomichibus.jp/ropeway/', desc: '千光寺公園の山頂駅。' }),
  P('senkoji', 'onomichi', '千光寺', 'shrine', 34.41000, 133.20030, { always: true, hours: null, outdoor: true, stay: 30, address: '広島県尾道市東土堂町15-1', url: 'https://www.senkouji.jp/', desc: '千光寺山の中腹にある古刹。朱塗りの本堂と、巨岩の玉の岩で知られる。' }),
  P('peak', 'onomichi', '千光寺公園頂上展望台 PEAK', 'view', 34.41220, 133.19900, { always: true, hours: null, outdoor: true, stay: 25, address: '広島県尾道市西土堂町19-1', url: ONONAVI, desc: '尾道水道と向島、しまなみの島々を見わたす展望台。' }),
  P('city-museum', 'onomichi', '尾道市立美術館', 'history', 34.41160, 133.19830, { hours: [9, 17], stay: 50, address: '広島県尾道市西土堂町17-19', url: 'https://www.onomichi-museum.jp/', desc: '千光寺公園の中の美術館。安藤忠雄の設計で改修された。' }),
  P('bungaku-komichi', 'onomichi', '文学のこみち', 'view', 34.41100, 133.20020, { always: true, hours: null, outdoor: true, stay: 25, address: '広島県尾道市東土堂町', url: ONONAVI, desc: '尾道ゆかりの作家の言葉を刻んだ石が並ぶ、山頂から千光寺へ下る散策路。' }),
  P('neko-hosomichi', 'onomichi', '猫の細道', 'view', 34.40930, 133.20260, { always: true, hours: null, outdoor: true, stay: 25, address: '広島県尾道市東土堂町', url: ONONAVI, desc: '艮神社の裏から天寧寺の方へ抜ける細い路地。福石猫と、本物の猫に出会える。' }),
  P('ushitora', 'onomichi', '艮神社', 'shrine', 34.40910, 133.20370, { always: true, hours: null, outdoor: true, stay: 15, address: '広島県尾道市長江1丁目3-5', url: ONONAVI, desc: '尾道で最も古いといわれる神社。大きな楠の上をロープウェイが通る。' }),
  P('tenneiji', 'onomichi', '天寧寺 三重塔', 'shrine', 34.40950, 133.19950, { always: true, hours: null, outdoor: true, stay: 20, address: '広島県尾道市東土堂町17-29', url: ONONAVI, desc: '坂の上に立つ三重塔。千光寺の参道から、塔と尾道水道を一緒に見下ろせる。' }),
  P('shiga-house', 'onomichi', '志賀直哉旧居', 'history', 34.40960, 133.20120, { hours: [10, 17], stay: 25, address: '広島県尾道市東土堂町8-28', url: ONONAVI, desc: '志賀直哉が『暗夜行路』の構想を練った長屋。' }),
  P('uou-tei', 'onomichi', '帆雨亭', 'cafe', 34.40990, 133.20180, { hours: [10, 17], stay: 40, address: '広島県尾道市東土堂町（デモのため番地は載せません）', url: ONONAVI, desc: '千光寺の参道沿いの古民家の喫茶。' }),
  P('mitsugi-tenmangu', 'onomichi', '御袖天満宮', 'shrine', 34.40820, 133.20110, { always: true, hours: null, outdoor: true, stay: 15, address: '広島県尾道市長江1丁目11-16', url: ONONAVI, desc: '菅原道真ゆかりの神社。映画の舞台にもなった長い石段がある。' }),
  P('jikoji', 'onomichi', '持光寺', 'shrine', 34.40850, 133.19550, { hours: [9, 17], stay: 20, address: '広島県尾道市西土堂町9-2', url: ONONAVI, desc: '花崗岩の延命門がある寺。' }),
  P('hondori', 'onomichi', '尾道本通り商店街', 'shop', 34.40640, 133.19990, { hours: [10, 18], stay: 40, address: '広島県尾道市土堂1丁目〜久保1丁目', url: ONONAVI, desc: '尾道水道に沿って東西に続く、約1.2kmのアーケードの商店街。' }),
  P('fumiko-statue', 'onomichi', '林芙美子像', 'history', 34.40520, 133.19680, { always: true, hours: null, outdoor: true, stay: 10, address: '広島県尾道市土堂1丁目', url: ONONAVI, desc: '本通り商店街の入口近くにある、旅行かばんを置いた林芙美子の像。' }),
  P('kobo-hanpu', 'onomichi', '工房尾道帆布', 'shop', 34.40580, 133.19820, { hours: [10, 18], stay: 30, address: '広島県尾道市土堂1丁目（デモのため番地は載せません）', url: ONONAVI, desc: '尾道の帆布を使ったかばんや小物の工房と店。' }),
  P('karasawa', 'onomichi', 'からさわ', 'sweets', 34.40620, 133.20230, { hours: [10, 18], stay: 20, address: '広島県尾道市土堂1丁目（デモのため番地は載せません）', url: ONONAVI, desc: 'アイスもなかで知られる店。' }),
  P('roman-coffee', 'onomichi', '尾道浪漫珈琲 本店', 'cafe', 34.40700, 133.20560, { hours: [8, 19], stay: 45, address: '広島県尾道市（デモのため番地は載せません）', url: ONONAVI, desc: '自家焙煎の珈琲の店。' }),
  P('ramen-ichibankan', 'onomichi', '尾道ラーメン 壱番館', 'food', 34.40520, 133.19500, { hours: [11, 21], stay: 35, address: '広島県尾道市東御所町（デモのため番地は載せません）', url: ONONAVI, desc: '背脂の浮いた醤油の尾道ラーメンの店。' }),
  P('rekishi-museum', 'onomichi', 'おのみち歴史博物館', 'history', 34.40720, 133.20460, { hours: [10, 18], stay: 50, address: '広島県尾道市久保1丁目14-1', url: ONONAVI, desc: '旧尾道銀行の建物を使った小さな博物館。' }),
  P('onomichi-library', 'onomichi', '尾道市立中央図書館', 'library', 34.40880, 133.20850, { hours: [9.5, 19], stay: 80, address: '広島県尾道市東久保町（デモのため番地は載せません）', desc: '尾道市の中央図書館。郷土の資料がそろう。' }),
  P('saigokuji', 'onomichi', '西國寺', 'shrine', 34.41300, 133.21170, { hours: [8, 17], outdoor: true, stay: 35, address: '広島県尾道市西久保町29-27', url: ONONAVI, desc: '巨大なわらじが掛かる仁王門と、山の上の三重塔の寺。' }),
  P('jodoji', 'onomichi', '浄土寺', 'shrine', 34.40860, 133.21570, { hours: [9, 16.5], stay: 35, address: '広島県尾道市東久保町20-28', url: ONONAVI, desc: '国宝の本堂と多宝塔をもつ古刹。' }),
  P('suido-shore', 'onomichi', '尾道水道の海岸通り', 'view', 34.40500, 133.20100, { always: true, hours: null, outdoor: true, stay: 20, address: '広島県尾道市土堂1丁目', url: ONONAVI, desc: '渡船や行き交う船を眺められる海沿いの道。' }),
  P('u2', 'onomichi', 'ONOMICHI U2', 'shop', 34.40330, 133.18910, { hours: [9, 21], stay: 50, address: '広島県尾道市西御所町5-11', url: 'https://onomichi-u2.com/', desc: '海沿いの倉庫を改装した、サイクリストのための複合施設。' }),
  P('goto-kosen', 'onomichi', '後藤鉱泉所', 'sweets', 34.39790, 133.20370, { hours: [9, 17], stay: 15, address: '広島県尾道市向島町755-2', url: ONONAVI, desc: '向島で瓶入りのラムネやサイダーを作り続ける小さな工場。' }),
  P('green-hill', 'onomichi', 'グリーンヒルホテル尾道', 'stay', 34.40410, 133.19450, { hours: null, always: true, stay: 600, address: '広島県尾道市東御所町9-1', desc: '尾道駅前のホテル。このアプリでは、夜遅くに尾道へ移された推しが泊まる宿として扱う。' }),

  // ---- 広島県三原市 ----
  P('mihara-st', 'mihara', '三原駅', 'station', 34.40070, 133.07900, { always: true, hours: null, stay: 5, address: '広島県三原市城町1丁目', desc: '山陽新幹線と山陽本線の駅。駅の北側に三原城の天主台跡がある。' }),
  P('mihara-castle', 'mihara', '三原城跡（天主台跡）', 'history', 34.40190, 133.07840, { always: true, hours: null, outdoor: true, stay: 30, address: '広島県三原市城町1丁目', url: MIHARA_NAVI, desc: '小早川隆景が築いた、海に浮かぶように見えた「浮城」。天主台の石垣と堀が残る。' }),
  P('funairi', 'mihara', '三原城跡 船入櫓跡', 'history', 34.39990, 133.08110, { always: true, hours: null, outdoor: true, stay: 15, address: '広島県三原市館町1丁目', url: MIHARA_NAVI, desc: '海城だったころの船の出入り口の櫓の跡。' }),
  P('takakage-statue', 'mihara', '小早川隆景像', 'history', 34.40030, 133.07980, { always: true, hours: null, outdoor: true, stay: 10, address: '広島県三原市城町1丁目（三原駅前）', url: MIHARA_NAVI, desc: '三原駅前に立つ、城を築いた小早川隆景の像。' }),
  P('mihara-port', 'mihara', '三原港', 'view', 34.39700, 133.08300, { always: true, hours: null, outdoor: true, stay: 20, address: '広島県三原市城町3丁目', url: MIHARA_NAVI, desc: '瀬戸内の島々へ船が出る港。潮の流れが見える。' }),
  P('sokoji', 'mihara', '宗光寺', 'shrine', 34.40480, 133.08460, { hours: [8, 17], stay: 25, address: '広島県三原市中之町（デモのため番地は載せません）', url: MIHARA_NAVI, desc: '小早川隆景が菩提寺とした寺。山門は三原城から移したと伝わる。' }),
  P('saigoku-kaido', 'mihara', '西国街道の町並み', 'view', 34.40400, 133.07950, { always: true, hours: null, outdoor: true, stay: 20, address: '広島県三原市本町', url: MIHARA_NAVI, desc: '城下を通っていた西国街道沿いの、古い家並みが残る通り。' }),
  P('sakurayama', 'mihara', '桜山', 'view', 34.40900, 133.07950, { always: true, hours: null, outdoor: true, stay: 40, address: '広島県三原市本町', url: MIHARA_NAVI, desc: '城下の北にそびえる山。山頂から三原の町と海が見わたせる。' }),
  P('popolo', 'mihara', '三原市芸術文化センター ポポロ', 'history', 34.40420, 133.08800, { hours: [9, 21], stay: 40, address: '広島県三原市宮浦2丁目1-1', desc: 'ホールとギャラリーのある文化センター。' }),
  P('mihara-library', 'mihara', '三原市立中央図書館', 'library', 34.40360, 133.07450, { hours: [9.5, 19], stay: 70, address: '広島県三原市（デモのため番地は載せません）', desc: '三原市の中央図書館。' }),
  P('mihara-hotel', 'mihara', '三原国際ホテル', 'stay', 34.40030, 133.08060, { hours: null, always: true, stay: 600, address: '広島県三原市城町1丁目（デモのため番地は載せません）', desc: '三原駅前のホテル。このアプリでは、夜遅くに三原へ移された推しが泊まる宿として扱う。' }),
];

/* ---- 架空の自宅（推しの家）。行き先の候補にはならない ---- */
const HOMES = [
  P('home-arisa', 'osaka', 'ありさの家', 'home', 34.68620, 135.48720, { fictional: true, noRoute: true, hours: null, always: true, stay: 0, address: '（架空の場所のため番地はありません）', desc: '京町堀の路地の奥の、古い長屋を直した家。作中の設定による架空の場所です。' }),
  P('home-nagi', 'osaka', '凪の家', 'home', 34.67150, 135.48620, { fictional: true, noRoute: true, hours: null, always: true, stay: 0, address: '（架空の場所のため番地はありません）', desc: '北堀江の祖母の家。作中の設定による架空の場所です。' }),
  P('home-takakage', 'mihara', '隆景の屋敷', 'home', 34.40250, 133.07700, { fictional: true, noRoute: true, hours: null, always: true, stay: 0, address: '（架空の場所のため番地はありません）', desc: '三原城の近くの屋敷という空想上の住まい。架空の場所です。' }),
  P('home-musashi', 'onomichi', '武蔵の仮住まい', 'home', 34.40700, 133.19700, { fictional: true, noRoute: true, hours: null, always: true, stay: 0, address: '（架空の場所のため番地はありません）', desc: '土堂の古い長屋の一間を借りた、武者修行の仮の住まい。架空の場所です。' }),
  P('home-gumi', 'osaka', 'GUMIの部屋', 'home', 34.67230, 135.49280, { fictional: true, noRoute: true, hours: null, always: true, stay: 0, address: '（架空の場所のため番地はありません）', desc: '南堀江の、古着屋の上のマンション。設定による架空の場所です。' }),
  P('home-moyashi', 'osaka', 'もやしペンギンの地下倉庫', 'home', 34.68380, 135.48420, { fictional: true, noRoute: true, hours: null, always: true, stay: 0, address: '（架空の場所のため番地はありません）', desc: 'N西市の地下水路のそばの、ひんやり暗い倉庫。設定による架空の場所です。' }),
];

/* ---- 宮本武蔵だけが訪れる架空の道場とジム（8施設）。実在の施設に迷惑がかからないよう架空にする ---- */
const DOJO_PLACES = [
  P('dojo-awaza-kendo', 'osaka', '西区剣友会 道場', 'dojo', 34.68000, 135.48450, { hours: [6, 21], stay: 90, trait: 'dojo' }),
  P('dojo-utsubo-karate', 'osaka', '靱空手道場', 'dojo', 34.68700, 135.49100, { hours: [9, 21], stay: 80, trait: 'karate' }),
  P('gym-horie-boxing', 'osaka', '堀江ボクシングジム', 'dojo', 34.67150, 135.49300, { hours: [10, 22], stay: 75, trait: 'boxing' }),
  P('gym-namba-fight', 'osaka', '難波格闘技ジム', 'dojo', 34.66800, 135.49700, { hours: [10, 22], stay: 75, trait: 'boxing' }),
  P('dojo-onomichi-kendo', 'onomichi', '尾道一刀流 道場', 'dojo', 34.40770, 133.19880, { hours: [6, 20], stay: 90, trait: 'dojo' }),
  P('dojo-mukai-karate', 'onomichi', '向島空手道場', 'dojo', 34.39880, 133.19800, { hours: [9, 20], stay: 80, trait: 'karate' }),
  P('gym-kubo-boxing', 'onomichi', '久保ボクシングジム', 'dojo', 34.40760, 133.20900, { hours: [10, 21], stay: 75, trait: 'boxing' }),
  P('dojo-mihara-kendo', 'mihara', '浮城剣道場', 'dojo', 34.40300, 133.08200, { hours: [6, 20], stay: 90, trait: 'dojo' }),
].map(p => Object.assign(p, {
  fictional: true, onlyFor: ['musashi'], noRoute: true,
  address: '（架空の場所のため番地はありません）',
  desc: 'デモ用に作った架空の道場・ジムです。実在しません。宮本武蔵だけが訪れる。',
}));

/* ---- デモ用の架空のスポット（tools/build-spots.js の生成物） ---- */
function loadExtraPlaces() {
  const file = path.join(__dirname, 'extra-places.json');
  if (!fs.existsSync(file)) return [];
  let list;
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.warn('extra-places.json を読めません', e.message); return []; }
  // ジャンルの雛形（data/spot-sources.js）から、過ごし方の描写を付ける
  const { GENRES } = require('./spot-sources');
  return list.map(p => Object.assign({}, p, { doing: (GENRES[p.trait] || {}).doing || [] }));
}

const ALL_PLACES = [...PLACES, ...HOMES, ...DOJO_PLACES, ...loadExtraPlaces()];

/* ---------------------------------------------------------------- 公共交通 */
// mode: train / subway / bus / ferry / ropeway / shinkansen。wait は平均の待ち時間（分）。
// seg は隣の乗り場までの乗車時間（分）。geom は線の形の作り方（rail: 線路、road: 道路、straight: 直線）。
// 所要時間は目安で、時刻表には基づかない。
const TRANSIT = [
  { id: 'ekimae-ferry', name: '駅前渡船', mode: 'ferry', wait: 5, geom: 'straight', hours: [6, 22],
    stops: ['ekimae-pier', 'tomihama-pier'], seg: [4] },
  { id: 'ropeway', name: '千光寺山ロープウェイ', mode: 'ropeway', wait: 7, geom: 'straight', hours: [9, 17.25],
    stops: ['rw-bottom', 'rw-top'], seg: [3] },
  { id: 'onomichi-bus', name: 'おのみちバス（東行き）', mode: 'bus', wait: 10, geom: 'road', hours: [7, 20],
    stops: ['onomichi-st', 'bus-nagaeguchi', 'bus-jodojishita'], seg: [5, 5],
    extraStops: [
      { id: 'bus-nagaeguchi', name: '長江口バス停', lat: 34.40760, lng: 133.20310 },
      { id: 'bus-jodojishita', name: '浄土寺下バス停', lat: 34.40750, lng: 133.21580 },
    ] },
  { id: 'sanyo-line', name: 'JR山陽本線', mode: 'train', wait: 12, geom: 'straight', hours: [5, 24],
    stops: ['mihara-st', 'onomichi-st'], seg: [13] },
  { id: 'sennichimae', name: '大阪メトロ千日前線', mode: 'subway', wait: 4, geom: 'rail', hours: [5, 24],
    stops: ['awaza-st', 'nishinagahori-st', 'sakuragawa-st', 'namba-st'], seg: [2, 2, 2] },
  { id: 'yotsubashi', name: '大阪メトロ四つ橋線', mode: 'subway', wait: 4, geom: 'rail', hours: [5, 24],
    stops: ['nishiumeda-st', 'higobashi-st', 'hommachi-st', 'yotsubashi-st', 'namba-st'], seg: [2, 2, 2, 2] },
  { id: 'shinkansen', name: '山陽新幹線と在来線', mode: 'shinkansen', wait: 15, geom: 'straight', hours: [6, 22],
    stops: ['osaka-st', 'mihara-st'], seg: [95],
    note: '大阪駅から新大阪駅への乗り換えと新幹線をまとめて扱う。線は実際の線路ではなく、つながりを示す直線。' },
];

// 千光寺山の斜面。道路データに高さがないので、この範囲を歩く時間を6倍に見積もる。
const SLOPES = [
  { id: 'senkoji-yama', factor: 6, polygon: [[34.4087, 133.1955], [34.4087, 133.2050], [34.4145, 133.2050], [34.4145, 133.1955]] },
  { id: 'sakurayama', factor: 4, polygon: [[34.4065, 133.0760], [34.4065, 133.0830], [34.4110, 133.0830], [34.4110, 133.0760]] },
];

/* ---------------------------------------------------------------- キャラ */
// 行動の数値。stride: 歩幅(m)、speed: 分速(m)、active: 活動時間、vehicle: 乗り物好き(0〜1)、
// curiosity: 好奇心、range: 距離の許容(m。この距離を歩くと1点下がる)、interests: 場所の種類への関心(0〜1)、
// favorites: よく通う場所と重み。公式設定の詳しい内容は data/canon.js。
const CHARACTERS = [
  {
    id: 'arisa', name: '京町 ありさ', short: 'ありさ', workId: 'meguru', initial: true,
    homeAreas: ['osaka'], home: 'home-arisa', tagline: 'N西高校写真部の二年生',
    stride: 0.68, speed: 70, active: [8, 20], vehicle: 0.5, curiosity: 0.7, range: 1800,
    interests: { view: 0.95, sweets: 0.75, cafe: 0.6, shop: 0.6, shrine: 0.5, history: 0.4, library: 0.3, food: 0.45, dojo: 0 },
    favorites: [{ id: 'nakanoshima-park', w: 1 }, { id: 'utsubo-park', w: 0.8 }, { id: 'arca', w: 0.8 }, { id: 'orange-st', w: 0.6 }],
    look: { image: 'assets/arisa/arisa-mv.webp', crop: [420, 70, 170, 170], hair: '#5a3a2a', color: '#007190', bg: '#b5decc' },
  },
  {
    id: 'nagi', name: '堀江 凪', short: '凪', workId: 'meguru',
    homeAreas: ['osaka'], home: 'home-nagi', tagline: 'ありさの同級生で図書委員',
    stride: 0.62, speed: 62, active: [7, 20], vehicle: 0.2, curiosity: 0.35, range: 1300,
    interests: { library: 1, history: 0.6, cafe: 0.55, shrine: 0.45, view: 0.35, shop: 0.25, sweets: 0.35, food: 0.3, dojo: 0 },
    favorites: [{ id: 'central-library', w: 1.2 }, { id: 'tosainari', w: 0.5 }],
    // 依頼者から提供されたイラスト（1000×826）。顔が丸の中に収まる部分を切り抜く
    look: { image: 'assets/nagi/nagi.png', size: [1000, 826], crop: [105, 10, 620, 620], hair: '#1f2a44', color: '#3d5a80', bg: '#ffffff', accessory: 'glasses' },
  },
  {
    id: 'takakage', name: '小早川 隆景', short: '隆景', workId: 'sengoku', historical: true,
    homeAreas: ['mihara'], home: 'home-takakage', tagline: '三原城を築いた、毛利の知将',
    stride: 0.70, speed: 66, active: [7, 19], vehicle: 0.65, curiosity: 0.55, range: 2000,
    interests: { history: 1, shrine: 0.8, view: 0.75, library: 0.4, food: 0.35, cafe: 0.3, sweets: 0.2, shop: 0.2, dojo: 0 },
    favorites: [{ id: 'mihara-castle', w: 1.2 }, { id: 'sokoji', w: 0.8 }, { id: 'mihara-port', w: 0.6 }],
    // 絹本著色小早川隆景像（米山寺蔵、1594年）。パブリックドメイン（Wikimedia Commons）。顔の部分を丸に切り抜く
    look: { image: 'assets/takakage/takakage.jpg', size: [299, 383], crop: [85, 15, 160, 160], portrait: true, hair: '#222', color: '#4b3b6b', bg: '#ece4d4', accessory: 'eboshi' },
  },
  {
    id: 'musashi', name: '宮本 武蔵', short: '武蔵', workId: 'sengoku', historical: true, initial: true,
    homeAreas: ['onomichi'], home: 'home-musashi', tagline: '道場とジムをめぐり、決闘を求める剣豪',
    stride: 0.80, speed: 84, active: [5, 21], vehicle: 0, curiosity: 0.4, range: 3200,
    interests: { dojo: 1.6, view: 0.45, shrine: 0.3, food: 0.4, history: 0.1, cafe: 0.05, sweets: 0, shop: 0.05, library: 0 },
    favorites: [{ id: 'dojo-onomichi-kendo', w: 1 }, { id: 'dojo-awaza-kendo', w: 0.8 }],
    camp: true,
    // 宮本武蔵の自画像と伝わる肖像（島田美術館蔵、17世紀前半）。パブリックドメイン（Wikimedia Commons）。顔の部分を丸に切り抜く
    look: { image: 'assets/musashi/musashi.jpg', size: [960, 2005], crop: [375, 50, 340, 340], portrait: true, hair: '#2a2a2a', color: '#3a3a3a', bg: '#e6e1d6', accessory: 'swords' },
  },
  {
    id: 'gumi', name: 'GUMI', short: 'GUMI', workId: 'mellowblue',
    homeAreas: ['osaka'], home: 'home-gumi', tagline: 'MELLOW BLUEのセンター、若者のカリスマ',
    stride: 0.66, speed: 76, active: [11, 23], vehicle: 0.6, curiosity: 0.95, range: 1600,
    interests: { shop: 1, cafe: 0.85, view: 0.8, sweets: 0.7, food: 0.45, history: 0.4, shrine: 0.25, library: 0.1, dojo: 0 },
    favorites: [{ id: 'orange-st', w: 1.2 }, { id: 'arca', w: 0.7 }, { id: 'nakanoshima-park', w: 0.6 }, { id: 'nmao', w: 0.5 }],
    // 写真のうち、顔が丸の中に収まる部分（元の絵は 1600×1066）
    look: { image: 'assets/gumi/gumi.webp', size: [1600, 1066], crop: [600, 60, 720, 720], hair: '#efe6d2', color: '#5b8fd8', bg: '#dbe8f8' },
  },
  {
    id: 'moyashi', name: 'もやしペンギン', short: 'もやしペンギン', workId: 'nnishi',
    homeAreas: ['osaka'], home: 'home-moyashi', tagline: 'N西市の公式キャラクター。雨の日だけ元気',
    stride: 0.32, speed: 38, active: [8, 17], vehicle: 0.1, curiosity: 0.5, range: 900,
    interests: { food: 0.9, view: 0.8, library: 0.7, history: 0.55, shrine: 0.35, shop: 0.3, cafe: 0.3, sweets: 0.2, dojo: 0 },
    favorites: [{ id: 'enoco', w: 1 }, { id: 'nmao', w: 0.8 }, { id: 'nakanoshima-park', w: 0.6 }, { id: 'central-library', w: 0.5 }],
    // 雨の日は外の場所を選び、晴れた日は日なたを避ける（lib/simulator.js と lib/planner.js）
    rainLover: true,
    // 全身が丸の中に収まる部分（元の絵は 768×768。右下の作者名は丸の外）
    look: { image: 'assets/moyashi/moyashi-penguin.png', size: [768, 768], crop: [130, 100, 560, 560], hair: '#222', color: '#ffffff', bg: '#ffffff' },
  },
];

/* ---------------------------------------------------------------- 獲得コード */
// サーバでのみ照合し、画面へは送らない。大文字小文字と前後の空白は無視する。
const CODES = [
  { code: 'MINI-TAKAKAGE-1T5M', type: 'character', id: 'takakage' },
  { code: 'MINI-MUSASHI-6D2N', type: 'character', id: 'musashi' },
  { code: 'MINI-NAGI-7K2F', type: 'character', id: 'nagi' },
  { code: 'MINI-GUMI-9B4R', type: 'character', id: 'gumi' },
  { code: 'MINI-MOYASHI-3P7E', type: 'character', id: 'moyashi' },
  { code: 'AREA-OSAKA-6N1K', type: 'area', id: 'osaka' },
  { code: 'AREA-ONOMICHI-2H8D', type: 'area', id: 'onomichi' },
  { code: 'AREA-MIHARA-3B8Y', type: 'area', id: 'mihara' },
];

module.exports = { WORKS, AREAS, CATEGORIES, PLACES: ALL_PLACES, REAL_PLACES: PLACES, HOMES, DOJO_PLACES, TRANSIT, SLOPES, CHARACTERS, CODES };
