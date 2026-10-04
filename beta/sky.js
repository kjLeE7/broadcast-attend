// 하늘방송국 (PC 전용, 실시간 없음, 아이소메트릭 시점): 1층 로비(안내 NPC) → 계단 → 2층 성우팀 · 3층 아나운서팀 · 4층 엔지니어팀·운영진 → 각자 사무실(방명록)
// 방은 바닥 칸(gx, gy)으로 만들고 비스듬히(2:1) 그림. 뒤쪽 두 벽(gy=0 벽, gx=0 벽)만 세움. 가구는 직육면체(윗면·두 옆면 명암 + 외곽선)
// 캐릭터는 town.js(Town.drawPerson·withLook)를 같이 씀. 방향키·WASD = 화면 기준 위아래좌우로 걷기, 클릭 = 그 칸으로, Space·Enter·클릭 = 말 걸기·들어가기
//   Sky.mount(상자, { load: () => Promise<sky.load 결과>, onGuest: (사람) => 방명록 열기 })
(function () {
const TW = 32, TH = 16, WALL = 58, SPEED = 3.2;   // 칸 폭·높이(px), 벽 높이, 걷는 빠르기(칸/초)
const FLOORS = { 2: '2층 · 성우팀', 3: '3층 · 아나운서팀', 4: '4층 · 엔지니어팀 · 운영진' };
const NPC_SAY = ['하늘방송국에 오신 걸 환영해요! 😊', '2층은 성우분들이 모여 계시고요~', '3층은 아나운서분들이 계세요~',
  '4층에는 엔지니어분들과 과장·부과장님 등 운영진분들이 쓰시는 사무실이 있습니다!', '오른쪽 안쪽 계단으로 올라가시면 돼요. 사무실에 들르면 방명록도 남길 수 있어요 📮'];
const OL = '#2a2228';
const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16), f = v => Math.max(0, Math.min(255, Math.round(v * k))); return '#' + [n >> 16, n >> 8 & 255, n & 255].map(v => f(v).toString(16).padStart(2, '0')).join(''); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let host, cv, ctx, off, oc, talkBox, data = null, opts = {}, scene = null, me = null, keys = {}, target = null, running = false, lastTs = 0, t = 0, scale = 3, cam = [0, 0], near = null;

// ---------- 좌표 ----------
const P = (x, y, z) => [(x - y) * TW / 2, (x + y) * TH / 2 - (z || 0)];          // 칸 좌표 → 그림 좌표
const toGrid = (sx, sy) => [sy / TH + sx / TW, sy / TH - sx / TW];               // 그림 좌표(바닥) → 칸 좌표
function poly(c, pts, fill, stroke) {
  c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
  c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
}
// 직육면체: 윗면 밝게, 앞왼쪽(+gy 면) 중간, 앞오른쪽(+gx 면) 어둡게. z0 = 바닥에서 띄운 높이
function cube(c, x, y, w, d, h, col, z0) {
  z0 = z0 || 0;
  const a = (X, Y, Z) => P(X, Y, Z + z0);
  poly(c, [a(x, y + d, 0), a(x + w, y + d, 0), a(x + w, y + d, h), a(x, y + d, h)], shade(col, .86), OL);
  poly(c, [a(x + w, y, 0), a(x + w, y + d, 0), a(x + w, y + d, h), a(x + w, y, h)], shade(col, .7), OL);
  poly(c, [a(x, y, h), a(x + w, y, h), a(x + w, y + d, h), a(x, y + d, h)], shade(col, 1.12), OL);
}
// 면 위 무늬: 앞왼쪽 면(gy = y+d)에 u(가로)·v(높이) 범위로 사각형
const onFront = (c, x, y, d, u0, u1, v0, v1, col) => poly(c, [P(x + u0, y + d, v0), P(x + u1, y + d, v0), P(x + u1, y + d, v1), P(x + u0, y + d, v1)], col);
const onRight = (c, x, y, w, u0, u1, v0, v1, col) => poly(c, [P(x + w, y + u0, v0), P(x + w, y + u1, v0), P(x + w, y + u1, v1), P(x + w, y + u0, v1)], col);
// 벽 위 무늬: 뒷벽(gy=0, 가로 gx) / 왼벽(gx=0, 가로 gy)
const onBack = (c, u0, u1, v0, v1, col, st) => poly(c, [P(u0, 0, v0), P(u1, 0, v0), P(u1, 0, v1), P(u0, 0, v1)], col, st);
const onLeft = (c, u0, u1, v0, v1, col, st) => poly(c, [P(0, u0, v0), P(0, u1, v0), P(0, u1, v1), P(0, u0, v1)], col, st);

// ---------- 소품 (그리기 함수 + 차지하는 칸) ----------
const PROPS = {
  desk: (c, x, y) => { cube(c, x, y, 2, 1, 12, '#a8714a'); cube(c, x + .55, y + .15, .7, .25, 9, '#3a3740', 12); onFront(c, x + .55, y + .15, .25, .08, .62, 13, 20, '#7fc6e0'); cube(c, x + .2, y + .55, .25, .25, 3, '#f2f0ea', 12); },
  chair: (c, x, y) => { cube(c, x, y, .6, .6, 7, '#3a3740'); cube(c, x, y - .05, .6, .12, 16, '#3a3740'); },
  shelf: (c, x, y) => { cube(c, x, y, .7, 2, 44, '#8a5a3b'); const cols = ['#b56576', '#3d7ea6', '#e9c46a', '#4f772d', '#e07a5f', '#6d597a', '#efe6d8'];
    for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) onRight(c, x, y, .7, .1 + i * .2, .25 + i * .2, 4 + r * 10, 11 + r * 10 - (i % 3 === 1 ? 2 : 0), cols[(i + r * 3) % cols.length]); },
  sofa: (c, x, y, col) => { col = col || '#4f772d'; cube(c, x, y, 2, .9, 8, col); cube(c, x, y, 2, .3, 18, shade(col, .9)); cube(c, x - .05, y, .3, .9, 12, shade(col, .85)); cube(c, x + 1.75, y, .3, .9, 12, shade(col, .85)); },
  plant: (c, x, y) => { cube(c, x + .2, y + .2, .6, .6, 9, '#b5673f'); cube(c, x + .05, y + .05, .9, .9, 14, '#4f8243', 9); cube(c, x + .25, y + .25, .5, .5, 8, '#6b9f55', 22); },
  lamp: (c, x, y) => { cube(c, x + .35, y + .35, .3, .3, 2, '#55505e'); cube(c, x + .45, y + .45, .1, .1, 30, '#55505e', 2); cube(c, x + .15, y + .15, .7, .7, 9, '#f2d8a0', 30); },
  mic: (c, x, y) => { cube(c, x + .3, y + .3, .4, .4, 2, '#55505e'); cube(c, x + .45, y + .45, .1, .1, 26, '#3a3740', 2); cube(c, x + .32, y + .32, .36, .36, 8, '#34323e', 26); },
  book: (c, x, y) => { cube(c, x + .2, y + .2, .6, .6, 16, '#5a4636'); cube(c, x + .1, y + .1, .8, .7, 3, '#f7f3e8', 16); cube(c, x + .6, y + .3, .06, .06, 7, '#e8584a', 19); },
  counter: (c, x, y) => { cube(c, x, y, 3, 1, 11, '#7a4f33'); onFront(c, x, y, 1, .2, 2.8, 3, 8, '#a8714a'); cube(c, x + .4, y + .2, .6, .25, 8, '#3a3740', 11); onFront(c, x + .4, y + .2, .25, .06, .54, 12, 18, '#7fc6e0'); },
  stairs: (c, x, y) => { for (let i = 4; i >= 0; i--) cube(c, x, y + (4 - i) * .5, 2, .5, 6 + i * 8, i % 2 ? '#a6977f' : '#b5a68e'); cube(c, x + 1.85, y, .15, 2.5, 46, '#6e4630'); },
  rug: (c, x, y, w, d, a, b) => { poly(c, [P(x, y, 0), P(x + w, y, 0), P(x + w, y + d, 0), P(x, y + d, 0)], a, OL); poly(c, [P(x + .3, y + .3, 0), P(x + w - .3, y + .3, 0), P(x + w - .3, y + d - .3, 0), P(x + .3, y + d - .3, 0)], b); poly(c, [P(x + .45, y + .45, 0), P(x + w - .45, y + .45, 0), P(x + w - .45, y + d - .45, 0), P(x + .45, y + d - .45, 0)], a); },
  table: (c, x, y, w, d) => { w = w || 1.2; d = d || .8; cube(c, x + .08, y + .08, .1, .1, 7, '#5e3c27'); cube(c, x + w - .18, y + d - .18, .1, .1, 7, '#5e3c27'); cube(c, x, y, w, d, 3, '#a8714a', 7); cube(c, x + .2, y + .2, .25, .25, 4, '#f2f0ea', 10); cube(c, x + w - .55, y + .25, .35, .25, 1, '#3d7ea6', 10); },
  cooler: (c, x, y) => { cube(c, x + .2, y + .2, .6, .6, 20, '#e8eef5'); onFront(c, x + .2, y + .2, .6, .35, .5, 12, 15, '#3d7ea6'); cube(c, x + .3, y + .3, .4, .4, 11, '#9fd0e8', 20); },
  bin: (c, x, y) => { cube(c, x + .3, y + .3, .4, .4, 7, '#6b8f71'); cube(c, x + .33, y + .33, .34, .34, 1, '#4f6f55', 7); },
  rack: (c, x, y) => { cube(c, x + .4, y + .4, .2, .2, 2, '#5e3c27'); cube(c, x + .47, y + .47, .06, .06, 32, '#5e3c27', 2); cube(c, x + .3, y + .45, .25, .1, 12, '#b56576', 20); cube(c, x + .5, y + .3, .1, .3, 9, '#3d7ea6', 22); },
  bench: (c, x, y, w) => { w = w || 1.6; cube(c, x + .1, y + .1, .1, .4, 5, '#55505e'); cube(c, x + w - .2, y + .1, .1, .4, 5, '#55505e'); cube(c, x, y, w, .6, 2, '#a8714a', 5); },
  trophy: (c, x, y) => { cube(c, x, y, .6, 1.8, 28, '#7a4f33'); for (let i = 0; i < 3; i++) { onRight(c, x, y, .6, .15 + i * .55, .55 + i * .55, 6, 24, '#d9e6ee'); onRight(c, x, y, .6, .28 + i * .55, .42 + i * .55, 12, 18, ['#e9c46a', '#cfc9bf', '#c98f5a'][i]); } },
  tv: (c, x, y) => { cube(c, x, y, .5, 1.6, 8, '#3a3740'); cube(c, x + .15, y + .1, .15, 1.4, 16, '#1f1b20', 8); onRight(c, x + .15, y + .1, .15, .08, 1.32, 10, 22, '#3d6e8f'); onRight(c, x + .15, y + .1, .15, .2, .7, 17, 21, '#7fc6e0'); },
  // ----- 방송국 장비 -----
  console: (c, x, y, w) => { w = w || 2.4;   // 믹싱 콘솔: 경사진 판 + 페이더 줄 + 노브 + 작은 화면
    cube(c, x, y, w, 1.1, 12, '#3a3740'); poly(c, [P(x, y + .1, 12), P(x + w, y + .1, 12), P(x + w, y + 1, 16), P(x, y + 1, 16)], '#4a4652', OL);
    for (let i = 0; i < Math.floor(w / .2); i++) { const fx = x + .12 + i * .2; poly(c, [P(fx, y + .45, 14.5), P(fx + .05, y + .45, 14.5), P(fx + .05, y + .9, 16), P(fx, y + .9, 16)], '#1f1b20');
      cube(c, fx - .02, y + .55 + ((i * 7) % 5) * .06, .09, .07, 1.5, i % 4 ? '#cfc9bf' : '#e8584a', 15); cube(c, fx, y + .2, .06, .06, 1.5, ['#e9c46a', '#7aa6e8', '#9cc75f'][i % 3], 13); }
    cube(c, x + w / 2 - .35, y + .05, .7, .12, 8, '#1f1b20', 12); onFront(c, x + w / 2 - .35, y + .05, .12, .05, .65, 13, 19, '#3d6e8f'); },
  server: (c, x, y) => { cube(c, x, y, .8, .8, 40, '#2f2c36');   // 장비 랙: 깜빡이는 불빛
    for (let r = 0; r < 7; r++) { onFront(c, x, y, .8, .08, .72, 4 + r * 5, 8 + r * 5, '#3f3b48'); for (let i = 0; i < 4; i++) onFront(c, x, y, .8, .12 + i * .1, .17 + i * .1, 5.5 + r * 5, 6.5 + r * 5, (Math.floor(t * 3 + r * 1.7 + i * 2.3) % 3) ? ['#9cc75f', '#e9c46a', '#e8584a', '#7fc6e0'][(r + i) % 4] : '#24212a'); } },
  speaker: (c, x, y) => { cube(c, x + .2, y + .2, .55, .5, 26, '#2a2730'); onFront(c, x + .2, y + .2, .5, .14, .41, 15, 23, '#55505e'); onFront(c, x + .2, y + .2, .5, .2, .35, 17, 21, '#1f1b20'); onFront(c, x + .2, y + .2, .5, .19, .36, 5, 12, '#1f1b20'); },
  camera: (c, x, y) => { for (const [a, b] of [[.15, .7], [.8, .7], [.48, .2]]) cube(c, x + a, y + b, .06, .06, 22, '#3a3740');   // 삼각대 + 카메라
    cube(c, x + .25, y + .3, .5, .45, 10, '#2a2730', 22); cube(c, x + .32, y + .75, .3, .25, 6, '#1f1b20', 24); cube(c, x + .38, y + .98, .18, .06, 4, '#7fc6e0', 25); cube(c, x + .6, y + .35, .08, .08, 2, '#e8584a', 32); },
  softbox: (c, x, y) => { cube(c, x + .45, y + .45, .1, .1, 30, '#55505e'); cube(c, x + .35, y + .4, .3, .2, 2, '#55505e'); cube(c, x + .05, y + .3, .9, .4, 16, '#f7f3e8', 30); onFront(c, x + .05, y + .3, .4, .1, .8, 32, 44, '#fffdf2'); },
  prompter: (c, x, y) => { cube(c, x + .4, y + .4, .2, .2, 20, '#3a3740'); cube(c, x + .1, y + .35, .8, .3, 12, '#1f1b20', 20); onFront(c, x + .1, y + .35, .3, .08, .72, 22, 30, '#24384a'); for (let i = 0; i < 3; i++) onFront(c, x + .1, y + .35, .3, .14, .5 - i * .08, 27 - i * 2, 27.6 - i * 2, '#e9f2f7'); },
  newsdesk: (c, x, y) => { cube(c, x, y, 3, 1, 14, '#2f4858'); onFront(c, x, y, 1, .3, 2.7, 3, 11, '#3d6e8f'); onFront(c, x, y, 1, 1.2, 1.8, 5, 9, '#e9c46a'); cube(c, x + .6, y + .2, .5, .3, 1, '#f7f3e8', 14); cube(c, x + 1.9, y + .3, .14, .14, 6, '#34323e', 14); },
  stand: (c, x, y) => { cube(c, x + .45, y + .45, .1, .1, 22, '#55505e'); cube(c, x + .15, y + .3, .7, .1, 10, '#3a3740', 18); cube(c, x + .2, y + .35, .6, .04, 8, '#f7f3e8', 20); },   // 대본 보면대
  phones: (c, x, y) => { cube(c, x + .3, y + .3, .4, .2, 3, '#34323e', 12); cube(c, x + .32, y + .28, .1, .25, 4, '#e8584a', 13); cube(c, x + .58, y + .28, .1, .25, 4, '#e8584a', 13); },
  glass: (c, x, y, w, d, h) => { h = h || 44;   // 유리 칸막이 (녹음 부스)
    const fr = '#55505e', g = 'rgba(170,215,235,.32)';
    if (w > d) { poly(c, [P(x, y + d, 0), P(x + w, y + d, 0), P(x + w, y + d, h), P(x, y + d, h)], g, fr); for (let u = 0; u <= w; u += 1) cube(c, x + u - .04, y, .08, d, h, fr); }
    else { poly(c, [P(x + w, y, 0), P(x + w, y + d, 0), P(x + w, y + d, h), P(x + w, y, h)], g, fr); for (let u = 0; u <= d; u += 1) cube(c, x, y + u - .04, w, .08, h, fr); }
    cube(c, x, y, w, d, 2, fr, h); },
  cable: (c, x, y, w) => { poly(c, [P(x, y, 0), P(x + w, y + .1, 0), P(x + w, y + .16, 0), P(x, y + .06, 0)], '#1f1b20'); },
  foam: (c, x, y) => {},
  mat: (c, x, y) => poly(c, [P(x, y, 0), P(x + 1.6, y, 0), P(x + 1.6, y + .8, 0), P(x, y + .8, 0)], '#b5533f', OL),
};
// 소품 하나: { k, x, y, w, d, solid, args }
const prop = (k, x, y, w, d, args, solid) => ({ k, x, y, w, d, args: args || [], solid: solid !== false });

// ---------- 장면 ----------
function people(floor) { return data.people.filter(p => p.floor === floor); }
function makeScene(id, arg) {
  if (id === 'lobby') return { id, W: 14, D: 10, floorA: '#e9dfcb', floorB: '#e1d4bb', wall: '#cfd9e6', panel: '#8fa3b8', spawn: arg || [7, 9.3],
    props: [prop('rug', 1.2, 4.6, 4.6, 3.6, [4.6, 3.6, '#2f4858', '#e9c46a'], false), prop('rug', 6, 4.4, 2, 5, [2, 5, '#b5533f', '#e9c46a'], false),
      prop('counter', 5.5, 2.2, 3, 1), prop('sofa', 1.5, 4.8, 2, .9, ['#6b8fa8']), prop('sofa', 1.5, 7.2, 2, .9, ['#6b8fa8']), prop('table', 2, 6.1, 1.2, .8),
      prop('trophy', .1, 1.4, .6, 1.8), prop('cooler', .1, 3.4, 1, 1), prop('plant', .1, .2, 1, 1), prop('plant', .1, 8.9, 1, 1), prop('plant', 9.4, .2, 1, 1),
      prop('lamp', 4.2, 4.6, 1, 1), prop('bench', 10.4, 6.2, 1.8, .6), prop('bench', 10.4, 7.8, 1.8, .6), prop('plant', 12.9, 8.9, 1, 1), prop('bin', 9.1, 3.5, 1, 1),
      prop('stairs', 11.8, .2, 2, 2.5), prop('mat', 6.2, 9.2, 1.6, .8, [], false)],
    deco: c => { win(c, 'L', 5.4, 7.4); win(c, 'B', 9.6, 11.2); for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) screen(c, 1 + i * 1.1, 2 + i * 1.1, 24 + j * 13, 36 + j * 13, i * 2 + j + 3); poster(c, 'B', 3.4, '#e9c46a', '#3d7ea6'); board(c, 'L', 1.4, 3.2); clock(c, 'B', 9.0); onAir(c, 'B', 6.5);
      onBack(c, 5.2, 8.8, 30, 48, '#2f4858', OL); onBack(c, 5.35, 8.65, 32, 46, '#f7f3e8'); onBack(c, 5.5, 5.75, 41, 44, '#e8584a'); },
    npc: [7, 1.6], acts: [ { x: 7, y: 3.6, r: 1.3, label: '안내 데스크', npc: true, act: () => talk(NPC_SAY) }, { x: 12.8, y: 3.1, r: 1.1, label: '계단', act: stairs } ] };
  if (id === 'floor') {
    const list = people(arg.floor), W = Math.max(12, 5 + list.length * 3.2);
    const dx = i => 5 + i * 3.2;
    const doors = list.map((p, i) => ({ x: dx(i), y: .7, r: 1, label: p.name + ' 사무실', p, act: () => go('office', { p, back: { floor: arg.floor, x: dx(i) } }) }));
    const props = [prop('stairs', .2, .2, 2, 2.5), prop('rug', 0, 2.6, W, 1.4, [W, 1.4, '#2f4858', '#e9c46a'], false), prop('cooler', W - 1.1, .1, 1, 1), prop('plant', W - 1.1, 4, 1, 1)];
    list.forEach((p, i) => { if (i < list.length - 1) props.push(i % 2 ? prop('plant', dx(i) + 1.1, .1, 1, 1) : prop('bench', dx(i) + .8, .15, 1.6, .6)); });
    return { id, W, D: 5, floorA: '#c9a073', floorB: '#bd9468', wall: '#efe6d4', panel: '#a8794f', fl: arg.floor, list, spawn: arg.at || [2.8, 3.4], props,
      deco: c => { doors.forEach(a => door(c, a.x, a.p)); win(c, 'L', 2.8, 4.4); list.forEach((p, i) => { if (i % 2 === 0 && i < list.length - 1) poster(c, 'B', dx(i) + 1.05, ['#e07a5f', '#3d7ea6', '#4f772d'][i % 3], '#f7f3e8', .5); }); list.forEach((p, i) => { if (i < list.length - 1) wallLamp(c, dx(i) + 1.6); }); board(c, 'B', 2.6, 3.8); },
      acts: [{ x: 1.4, y: 3.2, r: 1.1, label: '계단', act: stairs }].concat(doors) };
  }
  const o = arg.p, mine = o.id === data.me, fl = arg.back.floor;
  // 사무실 공통: 책장·책상·소파·방명록·옷걸이·화분. 층(팀)마다 방송국 장비가 다름
  const base = [prop('rug', 1.6, 4.4, 4.2, 3, [4.2, 3, '#6d597a', '#e9c46a'], false), prop('shelf', .1, .4, .7, 2), prop('shelf', .1, 2.6, .7, 2),
    prop('desk', 3.6, 1.1, 2, 1), prop('chair', 4.3, .4, .6, .6, [], false), prop('plant', 2.6, .2, 1, 1), prop('bin', 5.8, 1.3, 1, 1),
    prop('sofa', 2.2, 7.4, 2.2, .9, ['#4f772d']), prop('table', 2.7, 6.1, 1.2, .8), prop('lamp', 1.2, 7.5, 1, 1),
    prop('book', 9.9, 5.6, 1, 1), prop('rack', 9.9, 7.9, 1, 1), prop('plant', .1, 7.9, 1, 1), prop('mat', 4.7, 8.2, 1.6, .8, [], false)];
  const theme = {
    2: { name: '녹음 부스', props: [prop('glass', 7, 3.4, 4, .1, [4, .1], true), prop('glass', 6.9, 0, .1, 3.5, [.1, 3.5], true),
        prop('mic', 8.4, .9, 1, 1), prop('mic', 9.7, .9, 1, 1), prop('stand', 8.4, 1.8, 1, 1), prop('stand', 9.7, 1.8, 1, 1), prop('console', 6.9, 4.4, 2.2, 1.1, [2.2]),
        prop('speaker', 6.4, 4.2, 1, 1), prop('speaker', 9.1, 4.2, 1, 1), prop('cable', 7.5, 2.8, 2, .2, [2], false)],
      deco: c => { for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) onBack(c, 7.2 + i * .75, 7.85 + i * .75, 20 + j * 14, 32 + j * 14, j === i % 2 ? '#3a3740' : '#55505e', OL); onAir(c, 'B', 9.1); } },
    3: { name: '뉴스 스튜디오', props: [prop('newsdesk', 7, 1, 3, 1), prop('chair', 8.2, .35, .6, .6, [], false), prop('camera', 8, 4.2, 1, 1), prop('camera', 9.7, 3.6, 1, 1),
        prop('softbox', 6.6, 3.6, 1, 1), prop('softbox', 10, 2.2, 1, 1), prop('prompter', 8.3, 3, 1, 1), prop('cable', 7.2, 4.9, 2.6, .2, [2.6], false)],
      deco: c => { for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) screen(c, 7.2 + i * 1.15, 7.2 + i * 1.15 + 1, 22 + j * 15, 35 + j * 15, i + j); onAir(c, 'B', 10.2); } },
    4: { name: '주조정실', props: [prop('console', 6.8, 2, 3, 1.1, [3]), prop('chair', 7.6, 3.3, .6, .6, [], false), prop('chair', 8.8, 3.3, .6, .6, [], false),
        prop('server', 10, .2, .8, .8), prop('server', 10, 1.1, .8, .8), prop('speaker', 6.3, 1.8, 1, 1), prop('speaker', 9.8, 2.2, 1, 1), prop('phones', 7.4, 2.2, 1, 1, [], false),
        prop('cable', 9.2, 1.4, 1, .2, [1], false)],
      deco: c => { for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) screen(c, 6.6 + i * .95, 6.6 + i * .95 + .85, 24 + j * 14, 36 + j * 14, i * 2 + j); onAir(c, 'B', 6.0); } },
  }[fl] || null;
  return { id, W: 11, D: 9, floorA: '#b98a5e', floorB: '#ad7f55', wall: '#f3e6cc', panel: '#a8794f', owner: o, back: arg.back, spawn: [5.5, 8.4], theme: theme && theme.name,
    props: base.concat(theme ? theme.props : []),
    deco: c => { win(c, 'L', 5, 6.8, '#b56576'); clock(c, 'B', 2.6); (o.badges || []).slice(0, 5).forEach((ic, i) => poster(c, 'B', 3.4 + i * .62, '#f7f1e3', null, .5));
      if (theme) theme.deco(c); onLeft(c, 1.2, 2.3, 26, 44, '#2f4858', OL); onLeft(c, 1.3, 2.2, 28, 42, '#e9c46a'); },   // 왼벽 방송국 포스터
    who: mine ? null : [4.6, .2],
    acts: [ { x: 5.5, y: 8.6, r: .9, label: '나가기', act: () => go('floor', { floor: fl, at: [arg.back.x, 1.8] }) },
      { x: 10.3, y: 6.1, r: 1, label: '방명록', act: () => opts.onGuest && opts.onGuest(o) } ].concat(mine ? [] : [
      { x: 4.6, y: 2.6, r: 1, label: o.name + '님', act: () => talk([(o.title ? o.title + ' ' : '') + o.name + '님의 사무실이에요.', (theme ? theme.name + '도 함께 쓰는 방이에요. ' : '') + '오른쪽 방명록에 한마디 남겨 보세요 📮']) }]) };
}
// 벽 화면 (모니터 월): 화면마다 다른 색 막대가 천천히 움직임
function screen(c, u0, u1, v0, v1, k) {
  onBack(c, u0, u1, v0, v1, '#1f1b20', OL);
  const cols = ['#3d6e8f', '#4f772d', '#6d597a', '#b5533f', '#2f4858', '#7a4f33'], bg = cols[k % cols.length];
  onBack(c, u0 + .05, u1 - .05, v0 + 1, v1 - 1, bg);
  const ph = (t * .6 + k * .37) % 1;
  onBack(c, u0 + .1, u0 + .1 + (u1 - u0 - .2) * (.3 + .6 * ph), v0 + 2, v0 + 3, '#e9f2f7');
  onBack(c, u0 + .1, u1 - .3, v1 - 4, v1 - 3, 'rgba(255,255,255,.5)');
}
// ON AIR 등 (천천히 깜빡임)
function onAir(c, side, u) {
  const f = side === 'B' ? onBack : onLeft, on = Math.floor(t * 1.2) % 2 === 0;
  f(c, u, u + .9, 50, 56, '#2a2228', OL); f(c, u + .05, u + .85, 51, 55, on ? '#ff5a48' : '#7a2e2e');
  if (on) poly(c, [P(u - .2, 0, 46), P(u + 1.1, 0, 46), P(u + .85, 0, 51), P(u + .05, 0, 51)], 'rgba(255,90,72,.18)');
}
function board(c, side, u0, u1) {
  const f = side === 'B' ? onBack : onLeft;
  f(c, u0, u1, 24, 46, '#8a5a3b', OL); f(c, u0 + .06, u1 - .06, 26, 44, '#c9a26b');
  const n = Math.floor((u1 - u0) / .35);
  for (let i = 0; i < n; i++) f(c, u0 + .12 + i * .33, u0 + .36 + i * .33, i % 2 ? 30 : 33, i % 2 ? 40 : 42, ['#f7f3e8', '#f2d8a0', '#cfe3c3', '#f3d1cc'][i % 4]);
}
function clock(c, side, u) { const f = side === 'B' ? onBack : onLeft; f(c, u, u + .5, 40, 50, '#f7f3e8', OL); f(c, u + .23, u + .27, 43, 47, OL); f(c, u + .25, u + .38, 44.5, 45.5, OL); }
function wallLamp(c, u) { onBack(c, u - .15, u + .15, 34, 40, '#f2d8a0', OL); c.fillStyle = 'rgba(255,226,150,.18)'; poly(c, [P(u - .45, 0, 18), P(u + .45, 0, 18), P(u + .15, 0, 34), P(u - .15, 0, 34)], 'rgba(255,226,150,.18)'); }
function win(c, side, u0, u1, curtain) {
  const f = side === 'B' ? onBack : onLeft;
  f(c, u0 - .08, u1 + .08, 20, 50, '#f4efe4', OL); f(c, u0, u1, 22, 48, '#9fd0e8'); f(c, u0, u1, 36, 48, '#b7dcec');
  f(c, (u0 + u1) / 2 - .03, (u0 + u1) / 2 + .03, 22, 48, '#f4efe4'); f(c, u0 + .2, u0 + .5, 41, 43, '#ffffff');
  if (curtain) { f(c, u0 - .25, u0 + .05, 18, 52, curtain, OL); f(c, u1 - .05, u1 + .25, 18, 52, curtain, OL); }
}
function poster(c, side, u, col, inner, w) {
  w = w || .8; const f = side === 'B' ? onBack : onLeft;
  f(c, u, u + w, 30, 46, '#7a4f33', OL); f(c, u + .07, u + w - .07, 32, 44, col); if (inner) f(c, u + .2, u + w - .2, 35, 41, inner);
}
function door(c, x, p) {
  onBack(c, x - .6, x + .6, 0, 40, '#5a4636', OL); onBack(c, x - .5, x + .5, 0, 38, '#8a6a4f'); onBack(c, x - .3, x + .3, 24, 33, '#bfe3ec');
  onBack(c, x + .32, x + .4, 16, 19, '#e9c46a'); onBack(c, x - .75, x + .75, 42, 50, '#2f4858', OL);
  if (p.id === data.me) poly(c, [P(x - .6, .05, 0), P(x + .6, .05, 0), P(x + .6, .3, 0), P(x - .6, .3, 0)], '#f2b84b');
}
function go(id, arg) {
  scene = makeScene(id, arg);
  me.x = scene.spawn[0]; me.y = scene.spawn[1]; me.moving = false; target = null; closeTalk();
  host.querySelector('.sky-where').textContent = id === 'lobby' ? '1층 · 로비' : id === 'floor' ? FLOORS[scene.fl] : scene.owner.name + '님 사무실 · ' + FLOORS[scene.back.floor].split(' · ')[0];
}
function stairs() {
  const cur = scene.id === 'lobby' ? 1 : scene.fl;
  talk(['몇 층으로 갈까요?'], [1, 2, 3, 4].filter(f => f !== cur).map(f => [f === 1 ? '1층 로비' : FLOORS[f], () => f === 1 ? go('lobby', [12.6, 3.4]) : go('floor', { floor: f })]));
}

// ---------- 말풍선(아래 대화 상자) ----------
let talkQ = null;
function talk(lines, choices) { talkQ = { lines, i: 0, choices }; drawTalk(); }
function drawTalk() {
  if (!talkQ) { talkBox.hidden = true; return; }
  const last = talkQ.i >= talkQ.lines.length - 1;
  talkBox.hidden = false;
  talkBox.innerHTML = '<p>' + esc(talkQ.lines[talkQ.i]) + '</p>' + (last && talkQ.choices ? '<div class="sky-ch">' + talkQ.choices.map((c, i) => '<button type="button" data-i="' + i + '">' + esc(c[0]) + '</button>').join('') + '</div>'
    : '<small>' + (last ? '닫기' : '다음') + ' · Space</small>');
}
function nextTalk() { if (!talkQ) return; if (talkQ.i < talkQ.lines.length - 1) { talkQ.i++; drawTalk(); } else if (!talkQ.choices) closeTalk(); }
function closeTalk() { talkQ = null; if (talkBox) talkBox.hidden = true; }

// ---------- 그리기 ----------
function room(c) {
  const { W, D } = scene;
  // 바닥 (판자 느낌: 칸마다 두 색 + 가는 줄)
  for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
    poly(c, [P(x, y, 0), P(x + 1, y, 0), P(x + 1, y + 1, 0), P(x, y + 1, 0)], (x + y * 2) % 3 ? scene.floorA : scene.floorB);
    for (let k = 1; k < 4; k++) poly(c, [P(x, y + k / 4, 0), P(x + 1, y + k / 4, 0), P(x + 1, y + k / 4 + .025, 0), P(x, y + k / 4 + .025, 0)], shade(scene.floorA, .9));
    poly(c, [P(x + ((y * 4) % 2 ? .5 : 0), y, 0), P(x + ((y * 4) % 2 ? .52 : .02), y, 0), P(x + ((y * 4) % 2 ? .52 : .02), y + .25, 0), P(x + ((y * 4) % 2 ? .5 : 0), y + .25, 0)], shade(scene.floorA, .86));
  }
  poly(c, [P(0, 0, 0), P(W, 0, 0), P(W, D, 0), P(0, D, 0)], 'rgba(0,0,0,0)', OL);
  // 뒷벽(gy=0)·왼벽(gx=0): 위 벽지 + 아래 판넬 + 걸레받이
  poly(c, [P(0, 0, 0), P(W, 0, 0), P(W, 0, WALL), P(0, 0, WALL)], scene.wall, OL);
  poly(c, [P(0, 0, 0), P(0, D, 0), P(0, D, WALL), P(0, 0, WALL)], shade(scene.wall, .92), OL);
  onBack(c, 0, W, 0, 16, scene.panel); onLeft(c, 0, D, 0, 16, shade(scene.panel, .92));
  onBack(c, 0, W, 15, 17, shade(scene.panel, 1.2)); onLeft(c, 0, D, 15, 17, shade(scene.panel, 1.1));
  onBack(c, 0, W, 0, 3, shade(scene.panel, .6)); onLeft(c, 0, D, 0, 3, shade(scene.panel, .55));
  for (let x = .25; x < W; x += .5) onBack(c, x, x + .2, 17, WALL, shade(scene.wall, .97));
  for (let y = .25; y < D; y += .5) onLeft(c, y, y + .2, 17, WALL, shade(scene.wall, .9));
  for (let x = .5; x < W; x += 1) onBack(c, x - .01, x + .01, 3, 15, shade(scene.panel, .85));
  poly(c, [P(0, 0, WALL), P(W, 0, WALL), P(W, -.25, WALL), P(-.25, -.25, WALL), P(-.25, D, WALL), P(0, D, WALL)], shade(scene.panel, .7), OL);   // 벽 윗단
  scene.deco(c);
}
function person(c, p, gx, gy, face, moving, dir) {
  const s = P(gx, gy, 0);
  Town.drawPerson(c, { id: p.id, look: Town.withLook(p.id, p.look), seed: (p.seed = p.seed || (p.id.charCodeAt(0) + p.id.charCodeAt(5)) % 97), x: s[0], y: s[1], face, moving, dir, spot: null, seg: { type: '휴식' }, hidden: false }, t);
}
const NPC = { id: 'npc-sky-guide', look: { gender: 'f', style: 'bun', hair: '#4a2f22', shirt: '#2f4858', pants: '#2f4858', bottom: 'skirt', hat: 'phones' } };
function frame(ts) {
  if (!running) return;
  const dt = Math.min(.05, lastTs ? (ts - lastTs) / 1000 : 0); lastTs = ts; t += dt;
  if (host && host.offsetParent !== null && data) { step(dt); draw(); }
  requestAnimationFrame(frame);
}
function blocked(x, y) {
  if (x < .3 || y < .45 || x > scene.W - .3 || y > scene.D - .2) return true;
  return scene.props.some(p => p.solid && x > p.x - .15 && x < p.x + p.w + .15 && y > p.y - .15 && y < p.y + p.d + .15);
}
function step(dt) {
  // 화면 기준 방향키 → 칸 방향 (오른쪽 = +gx -gy, 아래 = +gx +gy)
  const sx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0), sy = (keys.d ? 1 : 0) - (keys.u ? 1 : 0);
  let dx = sx + sy, dy = sy - sx;
  if (sx || sy) target = null;
  else if (target) { const ex = target.x - me.x, ey = target.y - me.y, d = Math.hypot(ex, ey); if (d < .12) { const a = target.act; target = null; if (a) a.act(); } else { dx = ex / d; dy = ey / d; } }
  me.moving = !!(dx || dy) && !talkQ;
  if (me.moving) {
    const k = SPEED * dt / (Math.hypot(dx, dy) || 1), nx = me.x + dx * k, ny = me.y + dy * k;
    if (!blocked(nx, ny)) { me.x = nx; me.y = ny; } else if (!blocked(nx, me.y)) me.x = nx; else if (!blocked(me.x, ny)) me.y = ny; else if (target) target = null;
    const vx = dx - dy, vy = dx + dy;   // 그림 기준 움직임
    me.face = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : (vy > 0 ? 'down' : 'up'); if (vx) me.dir = vx > 0 ? 1 : -1;
  }
  near = scene.acts.find(a => Math.hypot(a.x - me.x, a.y - me.y) < a.r) || null;
}
function draw() {
  const vw = Math.ceil(cv.width / scale), vh = Math.ceil(cv.height / scale);
  const mp = P(me.x, me.y, 0), lo = P(0, scene.D, 0)[0], hi = P(scene.W, 0, 0)[0], top = -WALL - 10, bot = P(scene.W, scene.D, 0)[1] + 10;
  cam[0] = hi - lo < vw ? (lo + hi) / 2 - vw / 2 : Math.max(lo - 10, Math.min(hi + 10 - vw, mp[0] - vw / 2));
  cam[1] = bot - top < vh ? (top + bot) / 2 - vh / 2 : Math.max(top, Math.min(bot - vh, mp[1] - vh / 2));
  oc.setTransform(1, 0, 0, 1, 0, 0); oc.fillStyle = '#3b3a44'; oc.fillRect(0, 0, off.width, off.height);
  oc.setTransform(1, 0, 0, 1, -Math.round(cam[0]), -Math.round(cam[1]));
  room(oc);
  const list = [];
  for (const p of scene.props) { const fn = PROPS[p.k]; if (p.solid) list.push({ z: p.x + p.w + p.y + p.d - .5, f: () => fn(oc, p.x, p.y, ...p.args) }); else fn(oc, p.x, p.y, ...p.args); }
  if (scene.npc) list.push({ z: scene.npc[0] + scene.npc[1], f: () => person(oc, NPC, scene.npc[0], scene.npc[1], 'down', false, 1) });
  if (scene.who) list.push({ z: scene.who[0] + scene.who[1], f: () => person(oc, scene.owner, scene.who[0], scene.who[1], 'down', false, 1) });
  list.push({ z: me.x + me.y, f: () => person(oc, data.meP, me.x, me.y, me.face, me.moving, me.dir) });
  list.sort((a, b) => a.z - b.z).forEach(o => o.f());
  ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(off, 0, 0, vw, vh, 0, 0, vw * scale, vh * scale);
  labels();
}
function labels() {
  const k = scale, S = (x, y, z) => { const p = P(x, y, z); return [(p[0] - cam[0]) * k, (p[1] - cam[1]) * k]; }, fs = Math.max(11, k * 3.6);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tag = (txt, at, col, bgc, size) => { size = size || fs; ctx.font = `700 ${size}px Pretendard, sans-serif`; const w = ctx.measureText(txt).width + 10; ctx.fillStyle = bgc || 'rgba(23,21,29,.82)'; ctx.fillRect(at[0] - w / 2, at[1] - size * .7, w, size * 1.4); ctx.fillStyle = col || '#f1e8d9'; ctx.fillText(txt, at[0], at[1]); };
  const skewed = (txt, side, u0, u1, z, size, col, font) => {   // 벽에 비스듬히 붙은 글자
    const a = side === 'B' ? S(u0, 0, z) : S(0, u0, z), b = side === 'B' ? S(u1, 0, z) : S(0, u1, z);
    ctx.save(); ctx.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); ctx.transform(1, (b[1] - a[1]) / (b[0] - a[0]), 0, 1, 0, 0);
    ctx.font = `${font || 700} ${size}px ${font ? "'Gowun Batang', serif" : 'Pretendard, sans-serif'}`; ctx.fillStyle = col; ctx.fillText(txt, 0, 0); ctx.restore();
  };
  if (scene.id === 'lobby') skewed('하늘방송국', 'B', 5.5, 8.5, 38, k * 6.5, '#2f4858', 800);
  if (scene.id === 'floor') for (const a of scene.acts) if (a.p) { skewed(a.p.name, 'B', a.x - .7, a.x + .7, 46, fs * .85, a.p.id === data.me ? '#f2b84b' : '#f1e8d9');
    if (a.p.title) tag(a.p.title, S(a.x, 0, 60), '#f2b84b', 'rgba(23,21,29,.7)', fs * .78); }
  if (scene.id === 'office') { (scene.owner.badges || []).slice(0, 5).forEach((ic, i) => skewed(ic, 'B', 5 + i * .62, 5.5 + i * .62, 38, k * 7, '#000'));
    tag((scene.owner.title ? scene.owner.title + ' · ' : '') + scene.owner.name + '님 사무실' + (scene.theme ? ' · ' + scene.theme : ''), S(4, 0, WALL + 8), '#f1e8d9', 'rgba(23,21,29,.8)'); }
  if (near && !talkQ) tag((near.npc ? '💬 ' : '') + near.label + ' · Space', S(near.x, near.y, 34), '#17151d', '#f2b84b');
  tag('나', S(me.x, me.y, -6), '#17151d', '#f2b84b', fs * .75);
}

// ---------- 입력 ----------
const KEY = { ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r', ArrowUp: 'u', w: 'u', W: 'u', ArrowDown: 'd', s: 'd', S: 'd' };
function onKey(e) {
  if (!host || host.offsetParent === null) return;
  const tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA' || document.body.classList.contains('modal-open')) return;
  const k = KEY[e.key];
  if (k) { keys[k] = e.type === 'keydown'; e.preventDefault(); return; }
  if (e.type !== 'keydown') return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (talkQ) nextTalk(); else if (near) near.act(); }
  if (e.key === 'Escape' && talkQ) closeTalk();
}
function onClick(e) {
  if (talkQ && !talkQ.choices) { nextTalk(); return; }
  const r = cv.getBoundingClientRect(), sx = (e.clientX - r.left) * (cv.width / r.width) / scale + cam[0], sy = (e.clientY - r.top) * (cv.height / r.height) / scale + cam[1];
  // 소품·문·사람을 눌렀는지: 바닥 지점 위로 조금 높은 곳까지
  const hit = scene.acts.find(a => { const p = P(a.x, a.y, 0); return Math.abs(p[0] - sx) < 18 && sy > p[1] - 48 && sy < p[1] + 10; });
  if (hit) { target = { x: hit.x, y: Math.min(scene.D - .3, hit.y + (hit.y < 1.5 ? .5 : 0)), act: hit }; return; }
  const g = toGrid(sx, sy); target = { x: Math.max(.4, Math.min(scene.W - .4, g[0])), y: Math.max(.5, Math.min(scene.D - .3, g[1])) };
}
function fit() {
  const w = host.querySelector('.sky-stage').clientWidth, h = Math.max(360, Math.min(window.innerHeight - 220, w * .58));
  scale = 2;   // 픽셀은 작게, 방은 넓게 (조밀하게)
  cv.width = w; cv.height = Math.floor(h); cv.style.height = Math.floor(h) + 'px';
  off.width = Math.ceil(w / scale) + 2; off.height = Math.ceil(h / scale) + 2;
}

function mount(el, o) {
  unmount(); host = el; opts = o || {};
  host.innerHTML = '<div class="sky"><div class="sky-top"><b class="sky-where">불러오는 중...</b><small>방향키·WASD로 걷고, Space로 말 걸기·들어가기 · 화면을 눌러도 돼요</small></div>' +
    '<div class="sky-stage"><canvas></canvas><div class="sky-talk" hidden></div></div></div>';
  cv = host.querySelector('canvas'); ctx = cv.getContext('2d'); talkBox = host.querySelector('.sky-talk');
  off = document.createElement('canvas'); oc = off.getContext('2d');
  talkBox.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { const c = talkQ.choices[+b.getAttribute('data-i')]; closeTalk(); c[1](); } else nextTalk(); });
  cv.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKey);
  window.addEventListener('resize', fit); fit();
  me = { x: 5, y: 7, face: 'up', moving: false, dir: 1 };
  Promise.resolve(opts.load()).then(d => {
    data = d; data.meP = d.people.find(p => p.id === d.me) || { id: d.me, look: null, name: '나' };
    go('lobby'); setTimeout(() => talk(['어서 오세요! 안내 데스크에 다가와 말을 걸어 보세요 😊']), 300);
  }).catch(err => { if (host) host.querySelector('.sky-where').textContent = '불러오지 못했어요 · ' + (err && err.message || ''); });
  running = true; lastTs = 0; requestAnimationFrame(frame);
}
function unmount() {
  running = false; document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKey); window.removeEventListener('resize', fit);
  keys = {}; data = null; if (host) host.innerHTML = ''; host = null;
}
window.Sky = { mount, unmount, mounted: () => !!host, go: (id, arg) => data && go(id, arg) };
})();
