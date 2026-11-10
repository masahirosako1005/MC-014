// public/js/route-flow.js
// 観光ルートを「地点 → 移動 → 地点 → 移動 …」の並びにする（routeFlow）。
// 地点は、観光の目的地（spot）と、公共交通機関の乗る駅と降りる駅（station）。
// 駅やバス停は観光の場所ではないが、移動の目的地になるので1つの地点として扱う。
// 降りた駅でそのまま次の乗り物に乗るときは、乗り換えとして1つの地点にまとめる。
// 結果の画面の一覧と、一緒に出かける画面の場面は、どちらもこの並びを使う。

export function routeFlow(r, stops = []) {
  const out = [];
  out.push({ type: 'station', start: true, name: r.startName, at: r.startAt, departAt: r.startAt, lat: (r.stops[0] && r.stops[0].access[0] && r.stops[0].access[0].coords[0] || [])[0], lng: (r.stops[0] && r.stops[0].access[0] && r.stops[0].access[0].coords[0] || [])[1], rides: [] });
  r.stops.forEach((s, i) => {
    for (const a of s.access || []) {
      if (a.mode === 'walk' || a.mode === 'taxi') {
        out.push({ type: 'move', mode: a.mode, name: a.name, meters: a.meters, minutes: a.minutes, waitMin: a.waitMin, startAt: a.startAt, endAt: a.endAt, coords: a.coords, to: null, stop: i });
        continue;
      }
      // 乗る駅（前が同じ駅で降りたところなら乗り換え）
      const prev = out[out.length - 1];
      const fromC = a.coords[0], toC = a.coords[a.coords.length - 1];
      if (prev && prev.type === 'station' && prev.name === a.from && !prev.start) { prev.rides.push({ kind: 'board', line: a.name, mode: a.rawMode || a.mode }); prev.transfer = true; prev.departAt = a.startAt + a.waitMin * 60000; }
      else out.push({ type: 'station', name: a.from, stopId: a.fromId, at: a.startAt, departAt: a.startAt + a.waitMin * 60000, lat: fromC[0], lng: fromC[1], rides: [{ kind: 'board', line: a.name, mode: a.rawMode || a.mode }] });
      out.push({ type: 'move', mode: a.rawMode || a.mode, name: a.name, from: a.from, to: a.to, meters: a.meters, minutes: a.minutes, waitMin: a.waitMin, startAt: a.startAt, endAt: a.endAt, coords: a.coords, stop: i });
      out.push({ type: 'station', name: a.to, stopId: a.toId, at: a.endAt, departAt: a.endAt, lat: toC[0], lng: toC[1], rides: [{ kind: 'alight', line: a.name, mode: a.rawMode || a.mode }] });
    }
    out.push({ type: 'spot', index: i, stop: s, name: s.name, at: s.arriveAt, departAt: s.leaveAt, lat: s.lat, lng: s.lng });
  });
  // 名前の合う駅の印（/api/state の stops）があれば、場所の詳細を開けるようにする
  for (const x of out) if (x.type === 'station') { const st = stops.find(s => s.name === x.name); if (st) x.placeId = st.placeId; }
  // 移動の行き先の名前
  for (let k = 0; k < out.length; k++) if (out[k].type === 'move') { const nx = out.slice(k + 1).find(x => x.type !== 'move'); out[k].toName = nx ? nx.name : ''; }
  return out;
}
