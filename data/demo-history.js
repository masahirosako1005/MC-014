/**
 * data/demo-history.js
 * 京町ありさと宮本武蔵が「すでに色々なエリアを旅している」ための、創作の履歴。
 * 最初は一か月分だったが、スポットを増やしたのに合わせて約3か月分（92日）に増やした（2026-11-09）。
 *
 * 持つのは「何日前の何時に、神の手がどのエリアへ連れて行ったか（移したか）」だけで、足あとは通常の計算で作る。
 * 日数は利用者を作った日を基準にするので、いつ開いても約3か月分になる。
 * - hour を省いた行は朝5時（起きる前）
 * - areaId が null の行は「家に帰した」
 * 昼間の移動、夜遅くの移動（時間の感覚で、帰る・泊まる・夜を明かす）、家に帰す日をときどき入れてある。
 * 何曜日にあたるかは開いた日で変わるので、学校の前の夜なら帰り、休みの前の夜なら泊まる、のように結果も変わる。
 */
'use strict';

const DEMO_HISTORY_VERSION = 4;

const DEMO_HISTORY = {
  arisa: [
    { daysAgo: 92, areaId: 'osaka' },
    { daysAgo: 86, hour: 10.5, areaId: 'onomichi' },   // 夏休みの尾道
    { daysAgo: 84, hour: 21, areaId: 'osaka' },        // 夜、地元へ
    { daysAgo: 79, hour: 9, areaId: 'onomichi' },
    { daysAgo: 77, hour: 16, areaId: null },
    { daysAgo: 76, hour: 8.5, areaId: 'osaka' },
    { daysAgo: 70, hour: 20.8, areaId: 'onomichi' },   // 夜遅くに遠くへ（次の日しだいで帰るか泊まる）
    { daysAgo: 68, hour: 11, areaId: 'osaka' },
    { daysAgo: 62, hour: 14, areaId: 'onomichi' },
    { daysAgo: 60, hour: 7, areaId: 'osaka' },         // 学校の日の朝早く
    { daysAgo: 55, hour: 12.5, areaId: 'onomichi' },
    { daysAgo: 53, hour: 19.5, areaId: 'osaka' },
    { daysAgo: 47, hour: 10, areaId: 'onomichi' },
    { daysAgo: 45, hour: 18, areaId: null },
    { daysAgo: 44, hour: 9, areaId: 'osaka' },
    { daysAgo: 39, hour: 21.2, areaId: 'onomichi' },
    { daysAgo: 37, hour: 10, areaId: 'osaka' },
    { daysAgo: 33, areaId: 'osaka' },
    { daysAgo: 28, hour: 13.5, areaId: 'onomichi' },   // 昼間に尾道へ（知らない土地を楽しむ）
    { daysAgo: 27, hour: 10, areaId: 'osaka' },
    { daysAgo: 22, hour: 20.6, areaId: 'onomichi' },   // 夜遅くに尾道へ（次の日しだいで帰るか泊まる）
    { daysAgo: 20, hour: 9, areaId: 'osaka' },
    { daysAgo: 16, hour: 17, areaId: null },           // 家に帰した
    { daysAgo: 15, hour: 9.5, areaId: 'osaka' },
    { daysAgo: 11, hour: 11, areaId: 'onomichi' },
    { daysAgo: 9, hour: 6.2, areaId: 'osaka' },        // 学校の日の朝早く（学校に間に合う電車を探す）
    { daysAgo: 5, hour: 15, areaId: 'onomichi' },
    { daysAgo: 4, hour: 19.8, areaId: 'osaka' },       // 夜、地元へ（近ければ帰る）
  ],
  musashi: [
    { daysAgo: 92, areaId: 'onomichi' },
    { daysAgo: 88, hour: 9.5, areaId: 'osaka' },
    { daysAgo: 83, hour: 22, areaId: 'onomichi' },     // 夜遅く（駅で夜を明かす）
    { daysAgo: 78, hour: 13, areaId: 'osaka' },
    { daysAgo: 74, hour: 17, areaId: null },
    { daysAgo: 73, areaId: 'onomichi' },
    { daysAgo: 67, hour: 10, areaId: 'osaka' },
    { daysAgo: 61, hour: 21.5, areaId: 'onomichi' },
    { daysAgo: 56, hour: 8, areaId: 'osaka' },
    { daysAgo: 50, hour: 15, areaId: 'onomichi' },
    { daysAgo: 46, hour: 19, areaId: null },
    { daysAgo: 45, areaId: 'onomichi' },
    { daysAgo: 40, hour: 11, areaId: 'osaka' },
    { daysAgo: 36, hour: 21, areaId: 'onomichi' },
    { daysAgo: 34, areaId: 'onomichi' },
    { daysAgo: 29, hour: 10, areaId: 'osaka' },
    { daysAgo: 24, hour: 21.6, areaId: 'onomichi' },   // 夜遅く（宿がなければ駅で夜を明かす）
    { daysAgo: 19, hour: 18, areaId: null },
    { daysAgo: 18, areaId: 'onomichi' },
    { daysAgo: 13, hour: 13, areaId: 'osaka' },
    { daysAgo: 10, hour: 22, areaId: 'onomichi' },
    { daysAgo: 6, hour: 9, areaId: 'osaka' },
    { daysAgo: 2, hour: 16, areaId: 'onomichi' },
  ],
};

module.exports = { DEMO_HISTORY, DEMO_HISTORY_VERSION };
