// =====================================================================
// 방예과 동네지도 (town.js)
// 과원이 '일정상' 지금 어디서 무엇을 하는지 도트 캐릭터로 보여주는 그림판.
// 실제 위치가 아니라 일정(모임·녹음·업무·사명자 일정·고정일정) 기준이에요.
//
// 쓰는 법:
//   Town.mount(상자요소, { load: () => Promise<데이터>, refreshMs: 180000 })
//   데이터 = { date, people:[{id,name,team,role}], segs:[{pid,from,to,place,ext,type,title,detail,lead}] }
//   from/to = 그날 0시부터 몇 분째인지 (한국 시간)
//   place = 장소 코드 (sdam-living, codeone ... / outside / work / lounge)
// 미리보기용: { clock: () => 분, maskDetail: () => true|false } 를 넘기면 시계·권한을 흉내 냄
// =====================================================================
(function () {
'use strict';
const W = 512, H = 328, T = 4, GW = W / T, GH = H / T;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
const bgC = mk(), b = bgC.getContext('2d');
const fgC = mk(), F = fgC.getContext('2d');
const wC = mk(), w = wC.getContext('2d');
const R = (c, col, x, y, ww, hh) => { c.fillStyle = col; c.fillRect(x, y, ww, hh); };
const both = fn => { fn(b); fn(F); };
let seed = 11;
const rnd = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

const P = {
  ol:'#2b2023', cap:'#3d2f2c', wall:'#e6d6b8', wallS:'#cdb994', trim:'#a7865f',
  deskT:'#a8714a', deskE:'#c08559', deskF:'#7a4c32', deskL:'#5e3a26',
  leaf1:'#5c9a4a', leaf2:'#3f7336', leaf3:'#7cbc5e', pot:'#b5653d',
  metal:'#9aa0a6', metalD:'#6b7077', dark:'#2d3340', glass:'#a9d8e3',
  pave1:'#5a5460', pave2:'#524c58'
};
const SOFA = { green:['#4f9282','#3a7466','#69ab9b'], mustard:['#d6ad5e','#b98f45','#e6c47c'], blue:['#5c7fb0','#486891','#7898c4'], rose:['#b5707a','#965a63','#c98c95'] };

// ---------- 걸을 수 있는 칸 ----------
const walk = new Uint8Array(GW * GH);
function carve(x, y, ww, hh, v = 1) {
  const x0 = Math.floor(x / T), y0 = Math.floor(y / T), x1 = Math.ceil((x + ww) / T), y1 = Math.ceil((y + hh) / T);
  for (let j = Math.max(0, y0); j < Math.min(GH, y1); j++) for (let i = Math.max(0, x0); i < Math.min(GW, x1); i++) walk[j * GW + i] = v;
}
function block(x, y, ww, hh) {
  for (let j = 0; j < GH; j++) { const cy = j * T + 2; if (cy < y || cy >= y + hh) continue;
    for (let i = 0; i < GW; i++) { const cx = i * T + 2; if (cx >= x && cx < x + ww) walk[j * GW + i] = 0; } }
}
const occs = [];
const occ = (x, y, ww, hh, sy) => occs.push({ x, y, w: ww, h: hh, sy: sy == null ? y + hh : sy });

// ---------- 바닥·벽 ----------
const FL = {
  wood:['#c9a173','#bf9668','#a57d50'], lightwood:['#dcc195','#d3b688','#bc9c6c'], hall:['#8d5d4b','#835545','#6f463a'],
  carpet:['#6f7b8d','#677386'], studio:['#5c5768','#544f60'], red:['#9b4a45','#8f433f'], grass:['#6a9a4c','#5f8d43','#80b45c']
};
function floor(x, y, ww, hh, k) {
  const f = FL[k];
  if (k === 'carpet' || k === 'studio' || k === 'red') {
    R(b, f[0], x, y, ww, hh); b.fillStyle = f[1];
    for (let yy = 0; yy < hh; yy += 2) for (let xx = (yy / 2 % 2) * 2; xx < ww; xx += 4) b.fillRect(x + xx, y + yy, 1, 1);
  } else if (k === 'grass') {
    R(b, f[0], x, y, ww, hh);
    for (let n = 0; n < ww * hh / 16; n++) { const xx = Math.floor(rnd() * ww), yy = Math.floor(rnd() * hh); R(b, rnd() < .55 ? f[1] : f[2], x + xx, y + yy, 1, rnd() < .4 ? 2 : 1); }
  } else {
    for (let yy = 0; yy < hh; yy += 4) { const r = yy / 4, hgt = Math.min(4, hh - yy);
      R(b, r % 2 ? f[1] : f[0], x, y + yy, ww, hgt);
      for (let xx = (r % 3) * 9 + 3; xx < ww; xx += 24) R(b, f[2], x + xx, y + yy, 1, hgt); }
  }
}
function roomBox(x, y, ww, hh, o) {
  R(b, P.ol, x, y, ww, hh); R(b, P.cap, x + 1, y + 1, ww - 2, hh - 2);
  if (o.yard) {
    R(b, '#3f6b35', x + 4, y + 3, ww - 8, 9);
    for (let xx = x + 4; xx < x + ww - 4; xx += 6) { R(b, '#4f8243', xx + 1, y + 3, 4, 3); R(b, '#5f9650', xx + 2, y + 3, 2, 1); R(b, '#355c2d', xx, y + 10, 6, 2); }
  } else {
    R(b, o.wall || P.wall, x + 4, y + 3, ww - 8, 8);
    R(b, o.wallS || P.wallS, x + 4, y + 10, ww - 8, 1);
    R(b, o.trim || P.trim, x + 4, y + 11, ww - 8, 1);
  }
  floor(x + 4, y + 12, ww - 8, hh - 16, o.floor);
  if (!o.yard) { R(b, 'rgba(0,0,0,.18)', x + 4, y + 12, ww - 8, 2); R(b, 'rgba(0,0,0,.08)', x + 4, y + 14, ww - 8, 1); }
  carve(x + 4, y + 12, ww - 8, hh - 16);
  const d = o.door;
  if (d && d.side === 'bottom') {
    floor(x + d.dx, y + hh - 4, 8, 4, o.floor); R(b, 'rgba(0,0,0,.22)', x + d.dx, y + hh - 1, 8, 1);
    carve(x + d.dx, y + hh - 4, 8, 4);
  } else if (d && d.side === 'top') {
    R(b, '#6b4a38', x + d.dx - 1, y + 1, 10, 11); R(b, '#2a1c17', x + d.dx, y + 2, 8, 10); R(b, '#3e2b22', x + d.dx, y + 2, 8, 2);
    carve(x + d.dx, y, 8, 12);
  }
  return d ? (d.side === 'bottom' ? [x + d.dx + 4, y + hh + 3] : [x + d.dx + 4, y - 3]) : null;
}
const winW = (x, y, ww) => { R(b, P.trim, x - 1, y, ww + 2, 8); R(b, '#9fd0de', x, y + 1, ww, 6); R(b, '#c8e7ed', x, y + 1, ww, 2); R(b, P.trim, x + (ww >> 1), y + 1, 1, 6); R(b, '#e9dcc0', x - 1, y + 7, ww + 2, 1); };
const whiteboard = (x, y, ww) => { R(b, P.ol, x - 1, y - 1, ww + 2, 9); R(b, '#f3f1ea', x, y, ww, 7); R(b, '#5b8bd0', x + 3, y + 2, 9, 1); R(b, '#d0605a', x + 3, y + 4, 14, 1); R(b, '#5b8bd0', x + 20, y + 2, 6, 1); R(b, '#888', x + ww - 10, y + 5, 7, 1); };
const picture = (x, y) => { R(b, P.ol, x - 1, y - 1, 10, 8); R(b, '#c49a5b', x, y, 8, 6); R(b, '#7fb3c9', x + 1, y + 1, 6, 4); R(b, '#6a9a4c', x + 1, y + 3, 6, 2); };
const wallClock = (x, y) => { R(b, P.ol, x - 1, y - 1, 7, 7); R(b, '#f3f1ea', x, y, 5, 5); R(b, P.ol, x + 2, y + 1, 1, 2); R(b, P.ol, x + 2, y + 2, 2, 1); };

// ---------- 가구 (바닥 그림 + 앞가림 그림 둘 다) ----------
function desk(x, y, ww, hh, o = {}) {
  both(c => {
    R(c, P.ol, x - 1, y - 1, ww + 2, hh + 2);
    R(c, o.top || P.deskT, x, y, ww, hh - 3); R(c, o.edge || P.deskE, x, y, ww, 1);
    R(c, P.deskL, x, y + hh - 4, ww, 1); R(c, o.front || P.deskF, x, y + hh - 3, ww, 3);
    if (o.paper) { R(c, '#efe6d0', x + ww - 8, y + 2, 5, 3); R(c, '#cfc3a8', x + ww - 7, y + 3, 3, 1); }
    if (o.books) { R(c, '#d0605a', x + 4, y + 2, 4, 3); R(c, '#5b8bd0', x + 9, y + 2, 3, 3); R(c, '#efe6d0', x + ww - 12, y + 2, 7, 4); R(c, '#cfc3a8', x + ww - 9, y + 2, 1, 4); }
    if (o.mon) { const mx = o.mon === 'r' ? x + ww - 8 : x + 2;
      R(c, P.ol, mx - 1, y - 5, 8, 7); R(c, P.dark, mx, y - 4, 6, 5); R(c, '#46506a', mx + 1, y - 3, 4, 2); R(c, P.metalD, mx + 2, y + 1, 2, 1);
      R(c, '#3a3f4c', mx + 7, y + 2, 4, 2); }
    if (o.console) { const cols = ['#e8584a', '#f2b84b', '#6cc4a1', '#7aa6e8'];
      for (let i = 0; i < ww - 4; i += 3) { R(c, '#2d2a33', x + 2 + i, y + 2, 2, 3); R(c, cols[(i / 3) % 4], x + 2 + i, y + 2 + ((i * 7) % 3), 2, 1); }
      R(c, P.ol, x + 3, y - 5, ww - 6, 6); R(c, '#2d3340', x + 4, y - 4, ww - 8, 4); }
  });
  occ(x - 1, y - 6, ww + 2, hh + 7, y + hh); block(x, y, ww, hh);
}
function sofa(x, y, ww, hh, col) {
  both(c => {
    R(c, P.ol, x - 1, y - 1, ww + 2, hh + 2);
    R(c, col[1], x, y, ww, 5); R(c, col[2], x + 1, y + 1, ww - 2, 1);
    R(c, col[0], x + 3, y + 5, ww - 6, hh - 8);
    for (let s = x + 3 + 9; s < x + ww - 4; s += 9) R(c, col[1], s, y + 5, 1, hh - 8);
    R(c, col[1], x, y + hh - 3, ww, 3); R(c, col[1], x, y, 3, hh); R(c, col[1], x + ww - 3, y, 3, hh);
    R(c, col[2], x, y, 3, 1); R(c, col[2], x + ww - 3, y, 3, 1);
  });
  occ(x - 1, y - 1, ww + 2, 6, y + 5); occ(x - 1, y - 1, 4, hh + 2, y + hh); occ(x + ww - 3, y - 1, 4, hh + 2, y + hh); occ(x - 1, y + hh - 3, ww + 2, 4, y + hh);
  block(x, y, ww, hh);
}
function plant(x, y) {
  both(c => {
    const leaves = [[x - 2, y - 3, 10, 7], [x, y - 6, 6, 4], [x - 4, y, 4, 4], [x + 6, y, 4, 4]];
    for (const l of leaves) R(c, P.ol, l[0] - 1, l[1] - 1, l[2] + 2, l[3] + 2);
    R(c, P.ol, x - 1, y + 5, 8, 7);
    for (const l of leaves) R(c, P.leaf2, l[0], l[1], l[2], l[3]);
    R(c, P.leaf1, x - 1, y - 3, 8, 4); R(c, P.leaf1, x + 1, y - 5, 4, 2); R(c, P.leaf3, x + 1, y - 2, 3, 1); R(c, P.leaf3, x - 3, y + 1, 2, 1);
    R(c, P.pot, x, y + 6, 6, 5); R(c, '#cf7c50', x, y + 6, 6, 1);
  });
  occ(x - 5, y - 7, 16, 19, y + 11); block(x, y + 6, 6, 5);
}
function shelf(x, y, ww, hh) {
  both(c => {
    R(c, P.ol, x - 1, y - 1, ww + 2, hh + 2); R(c, '#7a4f33', x, y, ww, hh); R(c, '#5c3a25', x + 1, y + 1, ww - 2, hh - 2);
    const bc = ['#d0605a', '#5b8bd0', '#e9c46a', '#6cc4a1', '#b56576', '#efe6d0', '#7a5c9e'];
    for (let sy = y + 1; sy < y + hh - 3; sy += 6) {
      let bx = x + 1;
      while (bx < x + ww - 2) { const bw = 1 + Math.floor(rnd() * 2), bh = 3 + Math.floor(rnd() * 2);
        R(c, bc[Math.floor(rnd() * bc.length)], bx, sy + (5 - bh), bw, bh); bx += bw + (rnd() < .2 ? 1 : 0); }
      R(c, '#8f5f3e', x + 1, sy + 5, ww - 2, 1);
    }
  });
  occ(x - 1, y - 1, ww + 2, hh + 2, y + hh); block(x, y + hh - 8, ww, 8);
}
function micStand(x, base) {
  both(c => {
    R(c, P.ol, x - 3, base - 1, 7, 3); R(c, P.metalD, x - 2, base, 5, 1);
    R(c, P.ol, x - 1, base - 11, 3, 11); R(c, P.metal, x, base - 10, 1, 10);
    R(c, P.ol, x - 2, base - 15, 5, 5); R(c, '#5a5f66', x - 1, base - 14, 3, 3); R(c, '#c9ced3', x - 1, base - 14, 1, 1);
  });
  occ(x - 3, base - 15, 7, 18, base + 1);
}
function glassWall(x, y, hh) {
  both(c => { R(c, P.ol, x - 1, y, 4, hh + 1); R(c, P.glass, x, y, 2, hh); R(c, '#e3f4f7', x, y + 2, 1, 4); R(c, '#e3f4f7', x + 1, y + 9, 1, 3); });
  occ(x - 1, y, 4, hh + 1, y + hh); block(x - 1, y, 4, hh);
}
function podium(x, y) {
  both(c => { R(c, P.ol, x - 1, y - 1, 12, 10); R(c, '#8a5a3b', x, y, 10, 8); R(c, '#a8714a', x, y, 10, 2); R(c, '#e9c46a', x + 3, y + 4, 4, 2); R(c, P.ol, x + 6, y - 4, 1, 3); R(c, '#5a5f66', x + 5, y - 5, 3, 2); });
  occ(x - 1, y - 6, 12, 15, y + 8); block(x, y, 10, 8);
}
function chairUp(x, fy) {
  R(b, P.ol, x - 4, fy - 5, 9, 5); R(b, '#8f5d3c', x - 3, fy - 4, 7, 3);
  both(c => { R(c, P.ol, x - 4, fy - 1, 9, 4); R(c, '#7a4c32', x - 3, fy, 7, 2); R(c, '#9a6644', x - 3, fy, 7, 1); });
  occ(x - 4, fy - 1, 9, 4, fy + 2);
}
function pew(x, y, ww) {
  R(b, P.ol, x - 1, y - 1, ww + 2, 5); R(b, '#9a6644', x, y, ww, 3);
  both(c => { R(c, P.ol, x - 1, y + 3, ww + 2, 4); R(c, '#7a4c32', x, y + 4, ww, 2); R(c, '#a8714a', x, y + 4, ww, 1); });
  occ(x - 1, y + 3, ww + 2, 4, y + 7); block(x, y + 4, ww, 2);
}
function tree(x, y) {
  both(c => {
    R(c, P.ol, x - 2, y + 10, 5, 10); R(c, '#7a4f33', x - 1, y + 11, 3, 9);
    const cn = [[x - 10, y - 2, 21, 12], [x - 7, y - 7, 15, 6], [x - 5, y + 9, 11, 3]];
    for (const l of cn) R(c, P.ol, l[0] - 1, l[1] - 1, l[2] + 2, l[3] + 2);
    for (const l of cn) R(c, P.leaf2, l[0], l[1], l[2], l[3]);
    R(c, P.leaf1, x - 8, y - 4, 14, 9); R(c, P.leaf3, x - 5, y - 5, 6, 2); R(c, P.leaf3, x + 2, y - 1, 3, 2);
  });
  occ(x - 12, y - 9, 25, 30, y + 20); block(x - 2, y + 12, 5, 8);
}
function vending(x, y) {
  both(c => { R(c, P.ol, x - 1, y - 1, 14, 22); R(c, '#c9473f', x, y, 12, 20); R(c, '#2d3340', x + 2, y + 3, 6, 10);
    const dc = ['#e9c46a', '#6cc4a1', '#efe6d0', '#7aa6e8'];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) R(c, dc[(r + k) % 4], x + 3 + k * 2, y + 4 + r * 3, 1, 2);
    R(c, '#efe6d0', x + 9, y + 4, 2, 3); R(c, '#1b1a22', x + 2, y + 16, 6, 2); });
  occ(x - 1, y - 1, 14, 22, y + 20); block(x, y + 10, 12, 10);
}
function smallBox(x, y, ww, hh, top, front) {
  both(c => { R(c, P.ol, x - 1, y - 1, ww + 2, hh + 2); R(c, top, x, y, ww, hh - 3); R(c, front, x, y + hh - 3, ww, 3); });
  occ(x - 1, y - 1, ww + 2, hh + 2, y + hh); block(x, y, ww, hh);
}
function bench(x, y, ww) {
  R(b, P.ol, x - 1, y - 1, ww + 2, 8); R(b, '#8f5d3c', x, y, ww, 2); R(b, '#a8714a', x, y + 3, ww, 3); R(b, '#6e4630', x + 1, y + 6, 1, 2); R(b, '#6e4630', x + ww - 2, y + 6, 1, 2);
}
function rug(x, y, ww, hh, c1, c2) { R(b, c2, x, y, ww, hh); R(b, c1, x + 2, y + 2, ww - 4, hh - 4); for (let i = x + 4; i < x + ww - 4; i += 4) R(b, c2, i, y + (hh >> 1), 2, 1); }

// ---------- 거리와 건물 ----------
const buildings = {};
function building(id, x, ww, floors, o) {
  const fh = 5, top = 56 - floors * fh;
  R(b, P.ol, x - 1, top - 4, ww + 2, 56 - top + 4);
  R(b, o.roof, x, top - 3, ww, 3); R(b, o.roofL, x, top - 3, ww, 1);
  R(b, o.wall, x, top, ww, 56 - top);
  const rows = {};
  for (let f = 1; f <= floors; f++) {
    const fy = 56 - f * fh; R(b, o.line, x, fy + fh - 1, ww, 1);
    const xs = []; for (let wx = x + 3; wx + 3 <= x + ww - 2; wx += 6) { if (f === 1 && Math.abs(wx + 1 - (x + ww / 2)) < 5) continue; xs.push(wx); }
    rows[f] = { y: fy + 1, xs };
  }
  R(b, P.ol, x + (ww >> 1) - 4, 50, 8, 6); R(b, '#3a2a24', x + (ww >> 1) - 3, 51, 6, 5); R(b, o.awn || '#e9c46a', x + (ww >> 1) - 5, 49, 10, 2);
  buildings[id] = { x, ww, floors, top, rows, name: o.name };
}

function street() {
  R(b, '#b3ab9c', 0, 56, W, 8);
  for (let x = 0; x < W; x += 8) R(b, '#a59d8e', x, 56, 1, 8);
  R(b, '#a59d8e', 0, 60, W, 1); R(b, '#8f887b', 0, 63, W, 1);
  R(b, '#46434d', 0, 64, W, 16);
  for (let x = 4; x < W; x += 16) R(b, '#e2c25a', x, 71, 8, 1);
  for (let y = 65; y < 79; y += 3) R(b, '#e8e2d4', 238, y, 18, 2);
  R(b, '#b3ab9c', 0, 80, W, 4); R(b, '#8f887b', 0, 80, W, 1);
  carve(0, 56, W, 28);
  for (const lx of LAMPS) { R(b, P.ol, lx - 1, 38, 3, 20); R(b, '#5a5f66', lx, 39, 1, 18); R(b, P.ol, lx - 3, 36, 7, 3); R(b, '#e9dcc0', lx - 2, 37, 5, 1); }
  // 지하철 입구
  R(b, P.ol, 459, 42, 42, 15); R(b, '#3e8f8a', 460, 43, 40, 4); R(b, '#5fb3ad', 460, 43, 40, 1); R(b, '#2a1c17', 466, 47, 28, 9);
  for (let s = 0; s < 4; s++) R(b, '#7d7684', 467, 48 + s * 2, 26, 1);
}
const LAMPS = [66, 128, 246, 352, 452];

// ---------- 장소 ----------
const PL = {};
function place(id, o) { PL[id] = Object.assign({ id, spots: [], owner: [] }, o); return PL[id]; }
const S = (pl, x, y, tags, pose, face) => { pl.spots.push({ x, y, tags, pose, face }); pl.owner.push(null); };

function build() {
  R(b, '#1d1a22', 0, 84, W, H - 84);
  R(b, P.pave1, 252, 84, W - 252, H - 84);
  for (let y = 84; y < H; y += 4) for (let x = 252 + ((y / 4) % 2) * 4; x < W; x += 8) R(b, P.pave2, x, y, 4, 4);
  carve(252, 84, 8, H - 84); carve(336, 84, 8, 164); carve(420, 84, 8, H - 84); carve(504, 84, 8, H - 84);
  carve(252, 84, W - 252, 4); carve(252, 160, W - 252, 8); carve(252, 240, 168, 8); carve(504, 240, 8, 8); carve(252, 320, W - 252, 8);

  street();
  building('sdam', 12, 48, 4, { name:'스담 건물', roof:'#5a4a5e', roofL:'#7a6a7e', wall:'#c9b38f', line:'#b39c78', awn:'#e07a5f' });
  building('codeone', 78, 44, 9, { name:'코드원 빌딩', roof:'#3d4a5a', roofL:'#5d6a7a', wall:'#8fa1b3', line:'#7d8fa1', awn:'#7aa6e8' });
  building('smc', 136, 46, 2, { name:'SMC', roof:'#6b3b36', roofL:'#8b5b56', wall:'#b0624c', line:'#9a5440', awn:'#e9c46a' });
  building('work', 190, 46, 7, { name:'직장', roof:'#3a4250', roofL:'#5a6270', wall:'#6f8296', line:'#5d7084', awn:'#a3a0a8' });
  building('chonghoe', 276, 60, 4, { name:'총회 건물', roof:'#4a4e3a', roofL:'#6a6e5a', wall:'#d8c9a8', line:'#c2b28f', awn:'#6cc4a1' });
  building('seongjeon', 368, 72, 10, { name:'과천 성전', roof:'#4b3d55', roofL:'#6b5d75', wall:'#e8e0d0', line:'#d2c8b4', awn:'#d98ad6' });
  place('work', { name:'직장', group:'일상', where:'각자 직장에서 근무 중', rect:[190, 20, 46, 36], door:[213, 60], hiddenOnly:true });

  // ===== 스담 4층 =====
  R(b, P.ol, 4, 88, 248, 236); R(b, P.cap, 5, 89, 246, 234);
  floor(8, 196, 240, 16, 'wood'); R(b, 'rgba(0,0,0,.15)', 8, 196, 240, 2); carve(8, 196, 240, 16);
  floor(248, 200, 4, 8, 'wood'); carve(248, 200, 8, 8);
  const W4 = '인덕원 · 4층 건물 4층';

  let pl = place('sdam-living', { name:'거실', group:'스담', where:W4, rect:[4, 88, 124, 108], bld:'sdam', fl:4,
    door: roomBox(4, 88, 124, 108, { floor:'wood', door:{ side:'bottom', dx:56 } }) });
  winW(16, 91, 26); winW(52, 91, 18); wallClock(78, 92);
  rug(14, 130, 54, 24, '#b2604f', '#8e4a3d');
  sofa(18, 112, 36, 12, SOFA.green); for (const sx of [27, 36, 45]) S(pl, sx, 122, ['sofa', 'sit'], 'sit', 'down');
  sofa(62, 112, 14, 12, SOFA.mustard); S(pl, 69, 122, ['sofa', 'sit'], 'sit', 'down');
  desk(24, 136, 30, 8, { top:'#8a5a3b', edge:'#a8714a', front:'#6e4630', paper:true });
  shelf(92, 92, 26, 22); plant(12, 168);
  for (const [sx, sy] of [[34, 166], [50, 172], [66, 164], [82, 176], [98, 166], [106, 182], [82, 150], [100, 140]]) S(pl, sx, sy, ['stand'], 'stand', 'down');

  pl = place('sdam-meeting', { name:'회의실', group:'스담', where:W4, rect:[128, 88, 124, 108], bld:'sdam', fl:4,
    door: roomBox(128, 88, 124, 108, { floor:'hall', door:{ side:'bottom', dx:56 } }) });
  whiteboard(164, 91, 46); wallClock(226, 92);
  for (const cx of [162, 180, 198, 216]) { R(b, P.ol, cx - 4, 120, 9, 8); R(b, '#5c7fb0', cx - 3, 121, 7, 6); }
  desk(152, 130, 76, 14, { top:'#b98a5e', edge:'#d0a070', front:'#7a4c32', paper:true });
  for (const cx of [162, 180, 198, 216]) S(pl, cx, 133, ['seat', 'sit'], 'sit', 'down');
  for (const cx of [162, 180, 198, 216]) { chairUp(cx, 156); S(pl, cx, 156, ['seat', 'sit'], 'sit', 'up'); }
  S(pl, 140, 142, ['lead'], 'stand', 'right');
  plant(236, 104);
  for (const [sx, sy] of [[236, 180], [150, 178], [176, 182], [204, 178]]) S(pl, sx, sy, ['stand'], 'stand', 'up');

  pl = place('sdam-office', { name:'사무실', group:'스담', where:W4, rect:[4, 212, 84, 112], bld:'sdam', fl:4,
    door: roomBox(4, 212, 84, 112, { floor:'carpet', door:{ side:'top', dx:38 } }) });
  winW(14, 215, 20); winW(58, 215, 20);
  for (const [dx, dy] of [[12, 240], [54, 240], [12, 276], [54, 276]]) { desk(dx, dy, 24, 10, { mon:'l', paper:true }); S(pl, dx + 15, dy + 3, ['desk', 'seat', 'sit'], 'sit', 'down'); }
  smallBox(10, 304, 10, 12, '#9aa0a6', '#7d838a'); smallBox(66, 306, 12, 9, '#d8d4cc', '#a8a49c');
  S(pl, 44, 300, ['stand'], 'stand', 'down'); S(pl, 44, 266, ['stand'], 'stand', 'down');

  pl = place('sdam-mirror', { name:'거울방', group:'스담', where:W4, rect:[88, 212, 84, 112], bld:'sdam', fl:4,
    door: roomBox(88, 212, 84, 112, { floor:'lightwood', door:{ side:'top', dx:66 } }) });
  R(b, '#8a9aa0', 92, 214, 60, 10); R(b, '#cfe9ee', 93, 215, 58, 8);
  for (let i = 0; i < 4; i++) { R(b, '#f2fbfd', 100 + i * 14, 216, 1, 6); R(b, '#f2fbfd', 101 + i * 14, 216, 1, 3); }
  R(b, P.metalD, 92, 228, 60, 1); R(b, P.metal, 92, 227, 60, 1);
  smallBox(158, 310, 9, 9, '#3a3740', '#2a2830');
  S(pl, 126, 240, ['lead'], 'stand', 'down');
  for (const sy of [256, 272, 288, 304]) for (const sx of [100, 114, 128, 142, 156]) S(pl, sx, sy, ['stand'], 'stand', 'up');

  pl = place('sdam-lab', { name:'연구실', group:'스담', where:W4, rect:[172, 212, 80, 112], bld:'sdam', fl:4,
    door: roomBox(172, 212, 80, 112, { floor:'wood', door:{ side:'top', dx:34 } }) });
  shelf(178, 214, 26, 22); shelf(220, 214, 26, 22);
  desk(188, 264, 48, 14, { books:true });
  for (const cx of [198, 212, 226]) S(pl, cx, 267, ['seat', 'desk', 'sit'], 'sit', 'down');
  for (const cx of [198, 212, 226]) { chairUp(cx, 290); S(pl, cx, 290, ['seat', 'sit'], 'sit', 'up'); }
  plant(238, 302); S(pl, 186, 306, ['stand'], 'stand', 'up'); S(pl, 200, 246, ['stand'], 'stand', 'down');

  // ===== 오른쪽 장소들 =====
  pl = place('codeone', { name:'코드원 스튜디오', group:'인덕원', where:'인덕원 · 9층 건물 8층', rect:[260, 88, 76, 72], bld:'codeone', fl:8, onair:[312, 91],
    door: roomBox(260, 88, 76, 72, { floor:'studio', wall:'#5b4f6b', wallS:'#4e4360', trim:'#3d3350', door:{ side:'bottom', dx:34 } }) });
  for (let i = 0; i < 6; i++) R(b, '#4e4360', 266 + i * 5, 93, 3, 5);
  R(b, '#4a4558', 264, 100, 32, 30);
  for (let yy = 100; yy < 130; yy += 3) for (let xx = 264 + (yy % 2) * 2; xx < 296; xx += 4) R(b, '#433e51', xx, yy, 2, 2);
  glassWall(297, 100, 28);
  micStand(274, 124); S(pl, 274, 121, ['mic'], 'stand', 'down');
  micStand(288, 124); S(pl, 288, 121, ['mic'], 'stand', 'down');
  desk(302, 112, 28, 10, { console:true, top:'#3a3740', edge:'#55505e', front:'#2a2830' }); S(pl, 316, 115, ['console', 'desk'], 'sit', 'down');
  sofa(266, 138, 24, 10, SOFA.rose); S(pl, 274, 146, ['sofa', 'sit'], 'sit', 'down'); S(pl, 283, 146, ['sofa', 'sit'], 'sit', 'down');
  S(pl, 312, 142, ['stand'], 'stand', 'down'); S(pl, 324, 148, ['stand'], 'stand', 'down');

  pl = place('jamun', { name:'자문회실', group:'인덕원', where:'인덕원 · 9층 건물 8층', rect:[344, 88, 76, 72], bld:'codeone', fl:8,
    door: roomBox(344, 88, 76, 72, { floor:'hall', wall:'#e2cfa8', door:{ side:'bottom', dx:34 } }) });
  winW(354, 91, 22); picture(394, 92);
  desk(362, 116, 44, 12, { top:'#b98a5e', edge:'#d0a070', front:'#7a4c32', books:true });
  for (const cx of [370, 384, 398]) S(pl, cx, 119, ['seat', 'sit'], 'sit', 'down');
  for (const cx of [370, 384, 398]) { chairUp(cx, 140); S(pl, cx, 140, ['seat', 'sit'], 'sit', 'up'); }
  S(pl, 354, 128, ['lead'], 'stand', 'right');
  plant(408, 140); S(pl, 354, 148, ['stand'], 'stand', 'up');

  pl = place('smc', { name:'SMC', group:'인덕원', where:'인덕원 · 2층 건물 2층', rect:[428, 88, 76, 72], bld:'smc', fl:2, onair:[476, 91],
    door: roomBox(428, 88, 76, 72, { floor:'studio', wall:'#4f5a6b', wallS:'#435060', trim:'#334050', door:{ side:'bottom', dx:34 } }) });
  R(b, '#46505e', 468, 100, 32, 30);
  for (let yy = 100; yy < 130; yy += 3) for (let xx = 468 + (yy % 2) * 2; xx < 500; xx += 4) R(b, '#3e4856', xx, yy, 2, 2);
  glassWall(466, 100, 28);
  desk(434, 112, 28, 10, { console:true, top:'#3a3740', edge:'#55505e', front:'#2a2830' }); S(pl, 448, 115, ['console', 'desk'], 'sit', 'down');
  micStand(478, 124); S(pl, 478, 121, ['mic'], 'stand', 'down');
  micStand(492, 124); S(pl, 492, 121, ['mic'], 'stand', 'down');
  sofa(474, 138, 24, 10, SOFA.blue); S(pl, 482, 146, ['sofa', 'sit'], 'sit', 'down'); S(pl, 491, 146, ['sofa', 'sit'], 'sit', 'down');
  S(pl, 440, 142, ['stand'], 'stand', 'down'); S(pl, 452, 148, ['stand'], 'stand', 'down');

  pl = place('chonghoe', { name:'총회 대회의실', group:'정부과천청사역', where:'정부과천청사역 · 4층 건물 4층', rect:[260, 168, 76, 72], bld:'chonghoe', fl:4,
    door: roomBox(260, 168, 76, 72, { floor:'red', wall:'#e2cfa8', door:{ side:'bottom', dx:34 } }) });
  R(b, P.ol, 279, 170, 38, 9); R(b, '#7a2e2e', 280, 171, 36, 7); R(b, '#e9c46a', 282, 173, 32, 1); R(b, '#e9c46a', 282, 176, 32, 1);
  podium(293, 192); S(pl, 298, 191, ['lead'], 'stand', 'down');
  for (const fy of [214, 230]) for (const cx of [272, 285, 298, 311, 324]) { chairUp(cx, fy); S(pl, cx, fy, ['seat', 'sit'], 'sit', 'up'); }

  pl = place('seongjeon', { name:'과천 성전 10층', group:'정부과천청사역', where:'정부과천청사역 · 10층 건물 10층', rect:[344, 168, 76, 72], bld:'seongjeon', fl:10,
    door: roomBox(344, 168, 76, 72, { floor:'lightwood', wall:'#8e3b3b', wallS:'#7a3030', trim:'#5e2424', door:{ side:'bottom', dx:34 } }) });
  for (let i = 0; i < 12; i++) R(b, '#a24848', 350 + i * 6, 171, 2, 8);
  R(b, '#c98f5a', 348, 180, 68, 12); R(b, '#d9a26c', 348, 180, 68, 1); R(b, '#8a5a3b', 348, 192, 68, 3); R(b, P.ol, 348, 195, 68, 1);
  micStand(382, 193); S(pl, 382, 190, ['lead', 'mic'], 'stand', 'down');
  S(pl, 362, 188, ['stand'], 'stand', 'down'); S(pl, 402, 188, ['stand'], 'stand', 'down');
  for (const py of [206, 222]) { pew(351, py, 26); pew(387, py, 26); for (const cx of [357, 370, 393, 406]) S(pl, cx, py + 4, ['seat', 'sit'], 'sit', 'up'); }

  // 외부 (세로로 긴 마당)
  pl = place('outside', { name:'외부', group:'그 밖', where:'센터·야외 등 그때그때 장소', rect:[428, 168, 76, 152],
    door: roomBox(428, 168, 76, 152, { floor:'grass', yard:true, door:{ side:'bottom', dx:34 } }) });
  for (let i = 0; i < 18; i++) { const fx = 434 + Math.floor(rnd() * 64), fy = 186 + Math.floor(rnd() * 126); R(b, ['#f2b84b', '#efe6d0', '#d98ad6'][i % 3], fx, fy, 1, 1); }
  for (let y = 236; y < 316; y += 7) R(b, '#9a9284', 462 + ((y / 7) % 2) * 3, y, 5, 3);
  tree(486, 184); tree(442, 290);
  bench(438, 214, 22); S(pl, 444, 220, ['sit', 'sofa'], 'sit', 'down'); S(pl, 454, 220, ['sit', 'sofa'], 'sit', 'down');
  both(c => { R(c, P.ol, 439, 183, 22, 9); R(c, '#efe6d0', 440, 184, 20, 7); R(c, '#a8714a', 442, 186, 12, 1); R(c, '#a8714a', 442, 188, 8, 1); R(c, P.ol, 449, 192, 3, 6); R(c, '#7a4f33', 450, 192, 1, 5); });
  occ(439, 183, 22, 15, 198); block(449, 192, 3, 6);
  R(b, '#a24848', 470, 248, 30, 22); for (let yy = 248; yy < 270; yy += 4) for (let xx = 470 + ((yy / 4) % 2) * 4; xx < 500; xx += 8) R(b, '#efe6d0', xx, yy, 4, 4);
  for (const cx of [476, 486, 496]) S(pl, cx, 262, ['sit', 'seat'], 'sit', 'down');
  for (const [sx, sy] of [[468, 214], [494, 216], [458, 232], [482, 232], [446, 248], [460, 280], [476, 286], [492, 280], [470, 300], [486, 306], [458, 306], [496, 296]]) S(pl, sx, sy, ['stand'], 'stand', 'down');

  // 휴게실 (넓게)
  pl = place('lounge', { name:'휴게실', group:'그 밖', where:'지금 일정이 없는 사람', rect:[260, 248, 160, 72], cap:8,
    door: roomBox(260, 248, 160, 72, { floor:'wood', door:{ side:'bottom', dx:76 } }) });
  winW(272, 251, 22); winW(306, 251, 22); wallClock(344, 252);
  rug(282, 280, 60, 20, '#6b8fa8', '#4f7088');
  sofa(270, 264, 34, 11, SOFA.green); for (const sx of [279, 287, 295]) S(pl, sx, 273, ['sofa', 'sit'], 'sit', 'down');
  sofa(316, 264, 26, 11, SOFA.blue); for (const sx of [324, 333]) S(pl, sx, 273, ['sofa', 'sit'], 'sit', 'down');
  smallBox(300, 288, 18, 6, '#8a5a3b', '#6e4630');
  smallBox(362, 260, 24, 10, '#c4b49a', '#8e7f68');
  both(c => { R(c, P.ol, 365, 252, 9, 9); R(c, '#3a3740', 366, 253, 7, 7); R(c, '#e8584a', 367, 254, 2, 1); R(c, P.ol, 377, 255, 6, 6); R(c, '#efe6d0', 378, 256, 4, 4); });
  occ(365, 252, 18, 9, 262);
  vending(398, 254);
  sofa(352, 292, 13, 10, SOFA.mustard); S(pl, 358, 300, ['sofa', 'sit'], 'sit', 'down');
  sofa(370, 292, 13, 10, SOFA.mustard); S(pl, 376, 300, ['sofa', 'sit'], 'sit', 'down');
  plant(266, 300); plant(404, 300);
  for (const [sx, sy] of [[288, 308], [322, 310], [342, 284], [392, 286]]) S(pl, sx, sy, ['stand'], 'stand', 'down');
}
build();
occs.sort((a, c) => a.sy - c.sy);

// ---------- 길찾기 ----------
function nearestWalk(i, j) {
  if (i >= 0 && j >= 0 && i < GW && j < GH && walk[j * GW + i]) return [i, j];
  for (let r = 1; r < 10; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const a = i + di, c = j + dj; if (a >= 0 && c >= 0 && a < GW && c < GH && walk[c * GW + a]) return [a, c];
  }
  return [i, j];
}
function astar(sx, sy, gx, gy) {
  const N = GW * GH, g = new Float32Array(N).fill(1e9), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const hp = []; const push = (f, n) => { hp.push([f, n]); let k = hp.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (hp[p][0] <= hp[k][0]) break; [hp[p], hp[k]] = [hp[k], hp[p]]; k = p; } };
  const pop = () => { const top = hp[0], last = hp.pop(); if (hp.length) { hp[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < hp.length && hp[l][0] < hp[m][0]) m = l; if (r < hp.length && hp[r][0] < hp[m][0]) m = r; if (m === k) break; [hp[m], hp[k]] = [hp[k], hp[m]]; k = m; } } return top; };
  const s = sy * GW + sx, goal = gy * GW + gx; g[s] = 0; push(Math.abs(sx - gx) + Math.abs(sy - gy), s);
  while (hp.length) {
    const cur = pop()[1]; if (cur === goal) break; if (closed[cur]) continue; closed[cur] = 1;
    const ci = cur % GW, cj = (cur / GW) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
      const n = nj * GW + ni; if (!walk[n] || closed[n]) continue;
      const ng = g[cur] + 1; if (ng < g[n]) { g[n] = ng; came[n] = cur; push(ng + Math.abs(ni - gx) + Math.abs(nj - gy), n); }
    }
  }
  if (came[goal] === -1 && goal !== s) return null;
  const cells = []; for (let n = goal; n !== -1; n = came[n]) { cells.push(n); if (n === s) break; }
  cells.reverse();
  const pts = []; let prevDir = null;
  for (let k = 0; k < cells.length; k++) {
    const n = cells[k], pt = [(n % GW) * T + 2, ((n / GW) | 0) * T + 2];
    if (k > 0 && k < cells.length - 1) { const nx = cells[k + 1], dir = (nx - n); if (dir === prevDir) { prevDir = dir; continue; } prevDir = dir; }
    else if (k === 0 && cells.length > 1) prevDir = cells[1] - n;
    pts.push(pt);
  }
  return pts;
}

const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = v => Math.max(0, Math.min(255, Math.round(v * k))); return '#' + [n >> 16, n >> 8 & 255, n & 255].map(v => f(v).toString(16).padStart(2, '0')).join(''); };
const OUT = P.ol, SHOE = '#2a2228', EYE = '#2a1e22', BLUSH = '#ec9b8d', PHONES = '#34323e';
function parts(p, face, seated, legA, phones) {
  const L = p.look, A = [], add = (x, y, ww, hh, c, leg) => A.push([x, y, ww, hh, c, leg]);
  if (!seated) {
    const l1 = legA === 1 ? 2 : 3, l2 = legA === -1 ? 2 : 3;
    add(3, 12, 2, l1, L.pants, 1); add(5, 12, 2, l2, L.pants, 1); add(3, 12 + l1, 2, 1, SHOE, 1); add(5, 12 + l2, 2, 1, SHOE, 1);
  }
  add(2, 7, 6, 5, L.shirt); add(2, 7, 6, 1, shade(L.shirt, 1.12));
  if (face === 'left' || face === 'right') { const ax = face === 'left' ? 3 : 5; add(ax, 8, 2, 3, L.shirt2); add(ax, 11, 2, 1, L.skin); }
  else { add(1, 8, 1, 3, L.shirt2); add(8, 8, 1, 3, L.shirt2); add(1, 11, 1, 1, L.skin); add(8, 11, 1, 1, L.skin); }
  add(1, 0, 8, 7, L.skin);
  const hc = L.hair, st = L.style;
  if (face === 'up') {
    add(1, 0, 8, st === 'long' ? 9 : 6, hc);
  } else {
    add(1, 0, 8, 2, hc);
    if (face === 'down') {
      add(1, 2, 1, 3, hc); add(8, 2, 1, 3, hc); add(2, 2, 2, 1, hc);
      if (st === 'bob') { add(1, 2, 1, 5, hc); add(8, 2, 1, 5, hc); add(6, 2, 2, 1, hc); }
      if (st === 'long') { add(1, 2, 1, 8, hc); add(8, 2, 1, 8, hc); }
      add(3, 4, 1, 1, EYE); add(6, 4, 1, 1, EYE);
      if (L.blush) { add(2, 5, 1, 1, BLUSH); add(7, 5, 1, 1, BLUSH); }
    } else if (face === 'left') {
      add(4, 2, 5, 3, hc); if (st === 'long' || st === 'bob') add(6, 2, 3, st === 'long' ? 8 : 5, hc); add(2, 4, 1, 1, EYE);
    } else {
      add(1, 2, 5, 3, hc); if (st === 'long' || st === 'bob') add(1, 2, 3, st === 'long' ? 8 : 5, hc); add(7, 4, 1, 1, EYE);
    }
  }
  if (st === 'bun') { add(3, -2, 4, 2, hc); add(4, -3, 2, 1, hc); }
  if (st === 'cap') { add(1, -1, 8, 3, L.capc); add(2, -1, 3, 1, shade(L.capc, 1.3));
    if (face === 'down') add(1, 2, 8, 1, shade(L.capc, .8)); else if (face === 'left') add(-1, 2, 4, 1, shade(L.capc, .8)); else if (face === 'right') add(6, 2, 4, 1, shade(L.capc, .8)); }
  if (phones) { add(1, -1, 8, 1, PHONES); add(0, 2, 1, 4, PHONES); add(9, 2, 1, 4, PHONES); }
  return A;
}
function drawPerson(c, p, t) {
  const x = Math.round(p.x), y = Math.round(p.y);
  const pose = p.spot ? p.spot.s.pose : 'stand';
  const seated = !p.moving && pose === 'sit';
  const hgt = seated ? 12 : 16, ox = x - 5, oy = y - hgt;
  let bob = 0, legA = 0;
  if (p.moving) { const f = Math.floor(t * 8 + p.id) % 4; legA = f === 1 ? 1 : f === 3 ? -1 : 0; bob = f % 2 ? -1 : 0; }
  else if (!reduce && (p.seg.type === '연습' || (p.seg.type === '수업' && p.seg.lead) || p.seg.type === '사회')) bob = Math.floor(t * 2.4 + p.id * .7) % 2 ? -1 : 0;
  else if (!reduce && seated) bob = (Math.floor(t * .7 + p.id) % 5 === 0) ? -1 : 0;
  if (!seated) { R(c, 'rgba(20,16,24,.28)', x - 4, y - 1, 8, 2); }
  const A = parts(p, p.face, seated, legA, p.seg.type === '녹음' && !p.moving);
  c.fillStyle = OUT;
  for (const q of A) c.fillRect(ox + q[0] - 1, oy + q[1] + (q[5] ? 0 : bob) - 1, q[2] + 2, q[3] + 2);
  for (const q of A) { c.fillStyle = q[4]; c.fillRect(ox + q[0], oy + q[1] + (q[5] ? 0 : bob), q[2], q[3]); }
  p._top = oy + bob; p._seated = seated;
}
function drawFx(c, p, t) {
  if (p.moving) return;
  const x = Math.round(p.x), y = Math.round(p.y), ht = p._top, ty = p.seg.type, s = p.spot && p.spot.s;
  const tags = s ? s.tags : [];
  const ph = reduce ? 0 : t;
  const bubble = (txt) => {
    const bx = x + 3, by = ht - 9;
    R(c, OUT, bx - 1, by - 1, 11, 8); R(c, '#fbf5e8', bx, by, 9, 6); R(c, OUT, bx + 1, by + 7, 2, 2); R(c, '#fbf5e8', bx + 1, by + 6, 1, 1);
    if (txt === 'note') { R(c, OUT, bx + 4, by + 1, 1, 4); R(c, OUT, bx + 3, by + 4, 1, 1); R(c, OUT, bx + 5, by + 1, 2, 1); }
    else { const n = Math.floor(ph * 3) % 4; for (let k = 0; k < Math.max(1, n); k++) R(c, OUT, bx + 2 + k * 2, by + 3, 1, 1); }
  };
  if (ty === '녹음' && tags.includes('mic')) {
    const n = Math.floor(ph * 4) % 3;
    for (let k = 0; k <= n; k++) { const ax = x + 7 + k * 2, len = 2 + k * 2; R(c, '#fff3c4', ax, ht + 4 - (len >> 1), 1, len); }
  }
  const typing = p._seated && (tags.includes('desk') || tags.includes('console')) && (ty === '근무' || ty === '행정' || ty === '녹음' || ty === '편집');
  if (typing) { const f = Math.floor(ph * 6 + p.id) % 2; R(c, p.look.skin, x - 3, y - 2 - f, 2, 1); R(c, p.look.skin, x + 1, y - 3 + f, 2, 1); }
  if (ty === '스터디' && p._seated) { R(c, OUT, x - 4, y - 3, 8, 3); R(c, '#fbf5e8', x - 3, y - 2, 3, 1); R(c, '#efe6d0', x + 1, y - 2, 2, 1); }
  if (ty === '사회') { R(c, OUT, x + 3, ht + 6, 3, 5); R(c, '#5a5f66', x + 4, ht + 7, 1, 3); }
  if (ty === '촬영' && p.face !== 'up') { R(c, OUT, x + 3, ht + 6, 6, 5); R(c, '#3a3740', x + 4, ht + 7, 4, 3); R(c, '#7fc6e0', x + 5, ht + 8, 1, 1); }
  const talkCycle = Math.floor(ph * 1.2 + p.id) % 3 !== 0;
  if ((p.seg.lead || ty === '사회') && talkCycle) bubble('dots');
  else if (ty === '연습' && talkCycle) bubble('note');
  else if (ty === '회의' && Math.floor(ph * .8 + p.id * 1.7) % 6 === 0) bubble('dots');
  if (ty === '휴식' && p._seated) {
    R(c, OUT, x + 3, y - 6, 4, 4); R(c, '#fbf5e8', x + 4, y - 5, 2, 2);
    const zc = (ph * .5 + p.id * .37) % 4;
    if (zc < 1.4) { const zy = ht - 2 - Math.floor(zc * 4); R(c, '#fbf5e8', x + 4, zy, 3, 1); R(c, '#fbf5e8', x + 5, zy + 1, 1, 1); R(c, '#fbf5e8', x + 4, zy + 2, 3, 1); }
  }
}

const mixHex = (a, c, k) => { const pa = parseInt(a.slice(1), 16), pc = parseInt(c.slice(1), 16); const ch = s => Math.round(((pa >> s) & 255) * (1 - k) + ((pc >> s) & 255) * k); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; };
function sky(tm) {
  const h = tm / 60, day = ['#86bfd4', '#c4e2e3'], dusk = ['#5b5a8c', '#e8a073'], night = ['#151a33', '#2d2f55'];
  const mx = (A, B, k) => [mixHex(A[0], B[0], k), mixHex(A[1], B[1], k)];
  if (h < 17) return [mixHex(day[0], day[0], 0), mixHex(day[1], day[1], 0)];
  if (h < 18.5) return mx(day, dusk, (h - 17) / 1.5);
  if (h < 20) return mx(dusk, night, (h - 18.5) / 1.5);
  return [mixHex(night[0], night[0], 0), mixHex(night[1], night[1], 0)];
}
const nightK = tm => { const h = tm / 60; return h < 17.5 ? 0 : h < 20 ? (h - 17.5) / 2.5 : 1; };
const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };

function rgbToHex(s) { const n = s.match(/\d+/g).map(Number); return '#' + n.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join(''); }
function car(x, y, col, dir, nk) {
  x = Math.round(x); R(w, P.ol, x - 1, y - 1, 18, 8); R(w, col, x, y, 16, 6); R(w, shade(col, .8), x, y + 4, 16, 2);
  R(w, '#9fd0de', dir > 0 ? x + 9 : x + 3, y + 1, 4, 2); R(w, '#2a2228', x + 2, y + 6, 3, 1); R(w, '#2a2228', x + 11, y + 6, 3, 1);
  if (nk > .3) { w.fillStyle = `rgba(255,236,170,${(0.35 * nk).toFixed(3)})`; w.fillRect(dir > 0 ? x + 16 : x - 10, y + 1, 10, 4); }
}

// ---------- 화면 크기 ----------

// ---------- 업무유형 ----------
const TYPES = {
  '녹음':{ c:'#e8584a', gated:true }, '사회':{ c:'#d98ad6', gated:true },
  '수업':{ c:'#6cc4a1' }, '연습':{ c:'#f2b84b' }, '회의':{ c:'#7aa6e8' }, '스터디':{ c:'#b4a0f0' }, '모임':{ c:'#9cc75f' },
  '촬영':{ c:'#f08a4b' }, '편집':{ c:'#5fc2d6', label:'음향편집' }, '행정':{ c:'#b9c6cc' }, '기타':{ c:'#c7a98a' },
  '근무':{ c:'#8e8a96', label:'직장' }, '휴식':{ c:'#d7c7a4', label:'일정 없음' }
};
const typeOf = k => TYPES[k] || TYPES['기타'];
const typeLabel = k => (TYPES[k] && TYPES[k].label) || k;

// ---------- 캐릭터 생김새 (사람 id로 늘 같은 모습) ----------
function strHash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const SKINS = ['#f2c9a0', '#e8b48a', '#d9a07a', '#f5d2b0'];
const HAIRS = ['#2b1d16', '#1d1d24', '#4a2f22', '#6b4426', '#8a5a3a', '#2b1d16'];
const STYLES = ['short', 'short', 'long', 'bob', 'bun', 'cap', 'long', 'short'];
const SHIRTS = ['#b56576', '#3d7ea6', '#4f772d', '#e9c46a', '#e07a5f', '#81b29a', '#6d597a', '#355070', '#c06c84', '#f2cc8f', '#6b8f71', '#b07d4f', '#7aa6e8', '#efe6d8', '#5a6270', '#8a6fa8'];
const PANTS = ['#3a3a4a', '#4b3b2f', '#2f3e46'];
const CAPS = ['#2f4858', '#a24848', '#4f772d', '#355070'];
function lookFor(id) {
  const h = strHash(id), pick = (arr, k) => arr[(h >>> k) % arr.length];
  const shirt = pick(SHIRTS, 3);
  return { skin:pick(SKINS, 0), hair:pick(HAIRS, 5), style:pick(STYLES, 9), shirt, shirt2:shade(shirt, .8), pants:pick(PANTS, 13), blush:((h >>> 17) & 3) === 0, capc:pick(CAPS, 19) };
}

// ---------- 사람 상태 ----------
let people = [], byId = new Map(), dataVer = 0;
let viewMin = 0, lastAssignMin = -1, lastAssignVer = -1;
let maskDetail = () => false;

function segFor(p, t) {
  for (const s of p.segs) if (s.from <= t && t < s.to) return s;
  return { place:'lounge', type:'휴식', title:'', detail:'' };
}
const segKey = s => s.place + '|' + s.type + '|' + (s.from == null ? '' : s.from) + '|' + (s.lead ? 1 : 0) + '|' + (s.ext || '');
function prefTags(s, p) {
  if (s.type === '녹음') return /엔지니어/.test(p.team) ? ['console', 'desk', 'seat', 'stand'] : ['mic', 'stand'];
  if (s.lead) return ['lead', 'stand'];
  switch (s.type) {
    case '수업': case '모임': return ['seat', 'stand', 'sit', 'sofa'];
    case '연습': return ['stand', 'sofa'];
    case '회의': return ['seat', 'sit', 'stand'];
    case '스터디': return ['seat', 'desk', 'sit', 'stand'];
    case '사회': return ['lead', 'mic', 'stand'];
    case '촬영': return ['stand'];
    case '편집': return ['console', 'desk', 'seat'];
    case '행정': return ['desk', 'seat'];
    case '휴식': return rnd() < .5 ? ['sofa', 'sit', 'stand'] : ['stand', 'sofa', 'sit'];
    default: return ['stand', 'seat', 'sit'];
  }
}
function placeOf(code) { return PL[code] || PL.outside; }
function freeSpot(p) { if (p.spot && p.spot.i >= 0) { const pl = PL[p.spot.place]; if (pl && pl.owner[p.spot.i] === p.id) pl.owner[p.spot.i] = null; } p.spot = null; }
function pickSpot(pl, tags, random) {
  for (const tg of tags) {
    const c = []; pl.spots.forEach((s, i) => { if (!pl.owner[i] && s.tags.includes(tg)) c.push(i); });
    if (c.length) return random ? c[Math.floor(rnd() * c.length)] : c[0];
  }
  return pl.owner.findIndex(o => !o);
}
function visibleCount(pl) { let n = 0; for (const q of people) if (q.spot && q.spot.place === pl.id && q.spot.i >= 0) n++; return n; }
function goTo(p, instant) {
  const pl = placeOf(p.seg.place);
  const prevPlace = p.spot ? p.spot.place : null;
  freeSpot(p);
  let i = -1;
  if (!pl.hiddenOnly && !(pl.cap && visibleCount(pl) >= pl.cap)) i = pickSpot(pl, prefTags(p.seg, p), p.seg.type === '휴식');
  let tx, ty, hideAtEnd = false;
  if (i >= 0) { pl.owner[i] = p.id; const s = pl.spots[i]; p.spot = { place:pl.id, i, s }; tx = s.x; ty = s.y; }
  else { p.spot = { place:pl.id, i:-1, s:{ x:pl.door[0], y:pl.door[1], pose:'stand', face:'up', tags:[] } }; tx = pl.door[0]; ty = pl.door[1]; hideAtEnd = true; }
  if (p.hidden) { // 건물 안에 있던 사람은 그 문에서 나옴
    const from = PL[prevPlace]; if (from && from.door) { p.x = from.door[0]; p.y = from.door[1]; }
    p.hidden = false;
  }
  p.hideAtEnd = hideAtEnd;
  if (instant || reduce) { p.x = tx; p.y = ty; p.path = []; p.moving = false; p.face = p.spot.s.face; p.hidden = hideAtEnd; return; }
  const [si, sj] = nearestWalk(Math.floor(p.x / T), Math.floor(p.y / T));
  const [gi, gj] = nearestWalk(Math.floor(tx / T), Math.floor((ty - 1) / T));
  const pts = astar(si, sj, gi, gj);
  p.path = (pts || []).concat([[tx, ty]]);
  p.moving = true;
}
function wander(p, now) {
  if (p.seg.type !== '휴식' || p.moving || p.hidden || !p.spot || p.spot.i < 0 || p.spot.s.pose !== 'stand' || now < p.wanderAt) return;
  p.wanderAt = now + 5 + rnd() * 7;
  if (rnd() < .45) goTo(p, false);
}
function setData(d, first) {
  const segsBy = new Map();
  for (const s of d.segs || []) { if (!segsBy.has(s.pid)) segsBy.set(s.pid, []); segsBy.get(s.pid).push(s); }
  const next = [];
  for (const raw of d.people || []) {
    let p = byId.get(raw.id);
    if (!p) { p = { id:raw.id, x:0, y:0, path:[], seg:null, key:'', spot:null, face:'down', moving:false, hidden:false, wanderAt:0, isNew:true }; }
    p.name = raw.name; p.team = raw.team || ''; p.role = raw.role || ''; p.look = raw.look || lookFor(raw.id);
    p.segs = segsBy.get(raw.id) || [];
    next.push(p);
  }
  for (const p of people) if (!next.includes(p)) freeSpot(p);
  people = next; byId = new Map(people.map(p => [p.id, p]));
  dataVer++;
  assignAll(true);
}
function assignAll(dataChanged) {
  const t = Math.floor(viewMin);
  let changed = false;
  for (const p of people) {
    const s = segFor(p, t), k = segKey(s);
    if (k !== p.key || p.isNew) {
      p.seg = s; p.key = k;
      if (p.isNew) { // 처음 보는 사람: 바로 그 자리에
        if (lastAssignVer < 0) goTo(p, true);
        else { const L = PL.lounge; p.x = L.door[0]; p.y = L.door[1]; goTo(p, false); }
        p.isNew = false;
      } else goTo(p, false);
      changed = true;
    } else p.seg = s;   // 제목·내용만 바뀐 경우
  }
  lastAssignMin = t; lastAssignVer = dataVer;
  if (changed || dataChanged) renderPanel();
}

// ---------- 한 장면 그리기 ----------
function occupancy() {
  const all = {}, hid = {};
  for (const p of people) {
    const id = placeOf(p.seg.place).id;
    (all[id] = all[id] || []).push(p);
    if (p.hidden || (p.hideAtEnd)) (hid[id] = hid[id] || []).push(p);
  }
  return { all, hid };
}
function drawWorld(t) {
  const [s0, s1] = sky(viewMin), nk = nightK(viewMin);
  const h0 = rgbToHex(s0), h1 = rgbToHex(s1);
  for (let y = 0; y < 56; y += 4) R(w, mixHex(h0, h1, y / 56), 0, y, W, 4);
  R(w, '#17151d', 0, 56, W, H - 56);
  w.drawImage(bgC, 0, 0);
  const oc = occupancy(), litFloors = {};
  for (const id in oc.all) { const pl = PL[id]; if (pl && pl.bld && oc.all[id].some(p => !p.moving)) (litFloors[pl.bld] = litFloors[pl.bld] || {})[pl.fl] = true; }
  const workN = (oc.all.work || []).filter(p => p.hidden).length;
  for (const id in buildings) { const bd = buildings[id]; let workLeft = workN;
    for (let f = 1; f <= bd.floors; f++) { const r = bd.rows[f]; const on = litFloors[id] && litFloors[id][f];
      r.xs.forEach(wx => {
        const lit = id === 'work' ? (workLeft-- > 0) : on;
        const rnL = !lit && hash(wx * 31 + r.y * 7) < .3 * nk;
        R(w, lit ? '#ffd77a' : rnL ? '#e3c072' : nk > .5 ? '#2b3448' : '#4d6070', wx, r.y, 3, 3);
        if (!lit && !rnL && nk < .5) R(w, '#7d92a2', wx, r.y, 1, 1);
        if (lit) R(w, '#fff1c2', wx, r.y, 1, 1);
      });
    } }
  if (!reduce) { const cx1 = ((t * 22) % (W + 60)) - 30, cx2 = W + 30 - ((t * 16 + 200) % (W + 60)); car(cx1, 66, '#e9c46a', 1, nk); car(cx2, 73, '#5c7fb0', -1, nk); }
  for (const id of ['codeone', 'smc']) { const pl = PL[id]; const rec = people.some(p => !p.moving && !p.hidden && p.seg.place === id && p.seg.type === '녹음');
    const [ax, ay] = pl.onair; R(w, P.ol, ax - 1, ay - 1, 15, 7); R(w, rec ? '#e8584a' : '#5a3a3a', ax, ay, 13, 5); if (rec) R(w, '#ffd6cf', ax + 2, ay + 2, 9, 1); }
  const list = [];
  for (const o of occs) list.push({ y:o.sy, o });
  for (const p of people) if (!p.hidden) list.push({ y:p.y + .5, p });
  list.sort((a, c) => a.y - c.y);
  for (const it of list) { if (it.o) { const o = it.o; w.drawImage(fgC, o.x, o.y, o.w, o.h, o.x, o.y, o.w, o.h); } else drawPerson(w, it.p, t); }
  for (const p of people) if (!p.hidden) drawFx(w, p, t);
  for (const id of [hoverId, (selId && t < selUntil) ? selId : null]) { const p = id && byId.get(id); if (!p || p.hidden) continue;
    const x = Math.round(p.x), y = Math.round(p.y), pulse = reduce ? 0 : Math.floor(t * 4) % 2, top = p._top != null ? p._top : y - 16;
    w.fillStyle = '#f2b84b'; w.fillRect(x - 6 - pulse, y, 12 + pulse * 2, 1); w.fillRect(x - 7 - pulse, y - 1, 1, 1); w.fillRect(x + 6 + pulse, y - 1, 1, 1);
    w.fillRect(x - 1, top - 5 - pulse, 3, 2); w.fillRect(x, top - 3 - pulse, 1, 1); }
  if (nk > 0) {
    w.fillStyle = `rgba(14,16,44,${(0.42 * nk).toFixed(3)})`;
    w.fillRect(0, 0, W, 86); w.fillRect(252, 86, 8, H - 86); w.fillRect(336, 86, 8, 162); w.fillRect(420, 86, 8, H - 86); w.fillRect(504, 86, 8, H - 86);
    w.fillRect(260, 160, 244, 8); w.fillRect(260, 240, 160, 8); w.fillRect(260, 320, 244, 8); w.fillRect(432, 180, 68, 136);
    for (const lx of LAMPS) { w.fillStyle = `rgba(255,215,122,${(0.22 * nk).toFixed(3)})`; w.fillRect(lx - 6, 39, 13, 17); w.fillStyle = `rgba(255,232,170,${(0.9 * nk).toFixed(3)})`; w.fillRect(lx - 2, 39, 5, 1); }
    for (const id in buildings) { const bd = buildings[id]; let workLeft = workN;
      for (let f = 1; f <= bd.floors; f++) { const r = bd.rows[f]; r.xs.forEach(wx => { const lit = id === 'work' ? (workLeft-- > 0) : (litFloors[id] && litFloors[id][f]); if (lit) R(w, '#ffd77a', wx, r.y, 3, 3); }); } }
  }
  return oc;
}

// ---------- 화면 (캔버스·글자·툴팁·패널) ----------
let root = null, cv = null, ctx = null, tip = null, placesEl = null, legendEl = null;
let dev = 2, hoverId = null, hoverRegion = null, selId = null, selUntil = 0, clockT = 0, lastTs = 0, running = false;
let regions = [];
const DISPLAY = "'Gowun Batang','Apple SD Gothic Neo','Malgun Gothic',serif";

let fillMode = false, mainEl = null, stageEl = null, panelEl = null;
function fit() {
  if (!cv) return;
  // 보통: 상자 너비에 맞춤. fill: 화면 높이까지 고려해 가장 크게 (남는 폭은 가운데 정렬)
  const avail = fillMode ? mainEl.clientWidth - 6 : stageEl.clientWidth;
  if (!avail || avail < 50) return;
  let cssW = avail;
  if (fillMode) {
    const maxH = window.innerHeight - stageEl.getBoundingClientRect().top - 44;
    if (maxH > 240) cssW = Math.min(avail, maxH * W / H);
  }
  const dpr = window.devicePixelRatio || 1;
  dev = cssW * dpr / W;
  cv.width = Math.round(W * dev); cv.height = Math.round(H * dev);
  cv.style.width = (cv.width / dpr) + 'px'; cv.style.height = (cv.height / dpr) + 'px';
  ctx.imageSmoothingEnabled = false;
  if (fillMode && panelEl) panelEl.style.maxHeight = Math.max(320, stageEl.offsetHeight + 34) + 'px';
}
function pill(txt, cx, top, fs, col, dot, placed) {
  ctx.font = `${fs}px ${DISPLAY}`;
  const tw = ctx.measureText(txt).width, pad = fs * .35, dw = dot ? fs * .55 : 0;
  const ww = tw + pad * 2 + dw, hh = fs * 1.25, x = Math.round(cx - ww / 2);
  let y = Math.round(top);
  if (placed) {
    for (let tries = 0; tries < 3; tries++) { const hr = placed.find(r => x < r[0] + r[2] && x + ww > r[0] && y < r[1] + r[3] && y + hh > r[1]); if (!hr) break; y = Math.round(hr[1] + hr[3] + 1); }
    placed.push([x, y, ww, hh]);
  }
  ctx.fillStyle = 'rgba(23,21,29,.84)'; ctx.fillRect(x, y, ww, hh);
  if (dot) { ctx.fillStyle = dot; ctx.fillRect(x + pad * .8, y + hh / 2 - fs * .18, fs * .36, fs * .36); }
  ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.fillText(txt, x + pad + dw, y + hh / 2 + fs * .04);
  return [x, y, ww, hh];
}
function tag(parts, x, y, fs, align, bg) {
  ctx.font = `${fs}px ${DISPLAY}`;
  const pad = fs * .4, hh = fs * 1.3; let tw = 0; for (const p of parts) tw += ctx.measureText(p[0]).width;
  const ww = tw + pad * 2, x0 = Math.round(align === 'right' ? x - ww : align === 'center' ? x - ww / 2 : x), y0 = Math.round(y);
  ctx.fillStyle = bg || 'rgba(23,21,29,.86)'; ctx.fillRect(x0, y0, ww, hh);
  ctx.textBaseline = 'middle'; let cx = x0 + pad;
  for (const p of parts) { ctx.fillStyle = p[1]; ctx.fillText(p[0], cx, y0 + hh / 2 + fs * .04); cx += ctx.measureText(p[0]).width; }
  return [x0, y0, ww, hh];
}
function drawText(oc) {
  const k = dev, dpr = window.devicePixelRatio || 1, cssK = k / dpr;
  const fs = Math.max(11, Math.min(14, cssK * 5.4)) * dpr;
  regions = [];
  const toW = r => [r[0] / k, r[1] / k, r[2] / k, r[3] / k];
  ctx.font = `${fs * .9}px ${DISPLAY}`; ctx.fillStyle = 'rgba(255,255,255,.95)';
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 1 * dpr; ctx.textBaseline = 'middle';
  for (const id in buildings) { if (id === 'work') continue; const bd = buildings[id]; const tw = ctx.measureText(bd.name).width; ctx.fillText(bd.name, (bd.x + bd.ww / 2) * k - tw / 2, Math.max(5, bd.top - 8) * k); }
  ctx.shadowOffsetY = 0;
  // 직장 건물 팻말
  const wb = buildings.work, workers = (oc.all.work || []).filter(p => p.hidden);
  tag([['직장 ', '#f1e8d9'], [workers.length + '명', '#f2b84b']], (wb.x + wb.ww / 2) * k, Math.max(1, wb.top - 13) * k, fs * .9, 'center');
  regions.push({ kind:'work', rect:[wb.x - 2, wb.top - 14, wb.ww + 4, 56 - wb.top + 14], list:workers });
  ctx.font = `${fs * 1.15}px ${DISPLAY}`;
  for (const [nm, x0] of [['인덕원', 6], ['정부과천청사역', 262]]) { const tw = ctx.measureText(nm).width, pd = fs * .4;
    ctx.fillStyle = 'rgba(23,21,29,.8)'; ctx.fillRect(x0 * k, 66 * k, tw + pd * 2, 12 * k); ctx.fillStyle = '#f2b84b'; ctx.fillText(nm, x0 * k + pd, 72 * k); }
  // 방 이름표 + 안에 더 있는 사람 수
  for (const id in PL) { const pl = PL[id]; if (pl.hiddenOnly) continue; const r = pl.rect;
    let nm = pl.name;
    if (id === 'outside') { const e = (oc.all.outside || []).find(p => p.seg.ext); if (e) nm = '외부 · ' + e.seg.ext; }
    const n = (oc.all[id] || []).length;
    tag(n ? [[nm, '#f1e8d9'], ['  ' + n + '명', '#f2b84b']] : [[nm, '#a89f92']], (r[0] + 2) * k, (r[1] + 1.5) * k, fs * .92);
    const hid = (oc.hid[id] || []);
    if (hid.length) { const rr = tag([['+' + hid.length + '명 더', '#17151d']], (r[0] + r[2] - 3) * k, (r[1] + r[3] - 4) * k - fs * 1.3, fs * .88, 'right', '#f2b84b');
      regions.push({ kind:'more', rect:toW(rr), list:hid, place:pl }); }
  }
  ctx.font = `${fs * .92}px ${DISPLAY}`; ctx.fillStyle = 'rgba(241,232,217,.85)'; ctx.fillText('스담 · 4층 복도', 10 * k, 204 * k);
  if (showNames) { const placed = [], vis = {};
    for (const p of people) if (!p.hidden && !p.moving) { const id = placeOf(p.seg.place).id; vis[id] = (vis[id] || 0) + 1; }
    // 한 방에 9명 이상 모이면 이름표가 겹쳐서 숨김 (마우스를 올리면 보임)
    for (const p of [...people].filter(p => !p.hidden && (p.moving || (vis[placeOf(p.seg.place).id] || 0) <= 8)).sort((a, c) => a.y - c.y)) pill(p.name, p.x * k, (p.y + 1.5) * k, fs * .86, '#f1e8d9', typeOf(p.seg.type).c, placed); }
}
let showNames = true;

// ---------- 패널 ----------
const ORDER = [['스담 · 인덕원 4층 건물 4층', ['sdam-living', 'sdam-meeting', 'sdam-office', 'sdam-mirror', 'sdam-lab']], ['인덕원', ['codeone', 'jamun', 'smc']], ['정부과천청사역', ['chonghoe', 'seongjeon']], ['그 밖', ['outside', 'work', 'lounge']]];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const FLOOR_TAG = { codeone:'8층', jamun:'8층', smc:'2층', chonghoe:'4층' };
function renderPanel() {
  if (!placesEl) return;
  let html = '';
  for (const [town, ids] of ORDER) {
    html += `<div class="tw-town"><h3>${esc(town)}</h3>`;
    for (const id of ids) { const pl = PL[id]; const here = people.filter(p => placeOf(p.seg.place).id === id);
      html += `<div class="tw-place${here.length ? '' : ' tw-empty'}"><div class="tw-nm">${esc(pl.name)}${FLOOR_TAG[id] ? `<small>${FLOOR_TAG[id]}</small>` : ''}</div><div class="tw-ct">${here.length}</div>`;
      if (here.length) html += `<div class="tw-chips">${here.map(p => `<button type="button" class="tw-chip${p.moving ? ' moving' : ''}" data-id="${esc(p.id)}" title="${esc(typeLabel(p.seg.type))}${p.moving ? ' · 이동 중' : ''}"><i class="tw-dot" style="--c:${typeOf(p.seg.type).c}"></i>${esc(p.name)}</button>`).join('')}</div>`;
      html += '</div>'; }
    html += '</div>';
  }
  placesEl.innerHTML = html;
  if (legendEl) { const cnt = {}; for (const p of people) cnt[p.seg.type] = (cnt[p.seg.type] || 0) + 1;
    legendEl.innerHTML = Object.keys(TYPES).filter(k => cnt[k]).map(k => `<span><i class="tw-dot" style="--c:${TYPES[k].c}"></i>${esc(typeLabel(k))} <b>${cnt[k]}</b></span>`).join('') || '<span>표시할 사람이 없어요</span>'; }
}

// ---------- 툴팁 ----------
const fmt = v => String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
function personTip(p) {
  const s = p.seg, ty = typeOf(s.type), pl = placeOf(s.place);
  let detail = '';
  if (ty.gated) detail = s.detail && !maskDetail() ? esc(s.detail) : '<span class="tw-lock">구체적인 내용은 교관 이상에게만 보여요</span>';
  else if (s.title) detail = esc(s.title);
  const plName = pl.id === 'outside' && s.ext ? '외부 · ' + s.ext : (pl.group === '스담' ? '스담 ' + pl.name : pl.name);
  return `<div class="tw-t-name">${esc(p.name)}<span>${esc(p.team)}${p.role ? ' · ' + esc(p.role) : ''}</span></div>`
    + `<div class="tw-t-type"><i class="tw-dot" style="--c:${ty.c}"></i>${esc(typeLabel(s.type))}${p.moving ? ' · 이동 중' : ''}${s.lead ? ' · 진행' : ''}</div>`
    + `<div class="tw-t-place">${esc(plName)}<small>${esc(pl.where)}</small></div>`
    + (s.from != null ? `<div class="tw-t-time">${fmt(s.from)}–${fmt(Math.min(s.to, 1440))}</div>` : '')
    + (detail ? `<div class="tw-t-detail">${detail}</div>` : '');
}
function groupTip(rg) {
  const byTeam = new Map(); for (const p of rg.list) { const k = p.team || '기타'; if (!byTeam.has(k)) byTeam.set(k, []); byTeam.get(k).push(p.name); }
  const head = rg.kind === 'work' ? `직장에서 근무 중 · ${rg.list.length}명` : `${esc(rg.place.name)} 안에 ${rg.list.length}명 더`;
  const body = rg.list.length ? [...byTeam].map(([t, ns]) => `<div class="tw-t-grp"><b>${esc(t)}</b> ${ns.map(esc).join(', ')}</div>`).join('') : '<div class="tw-t-grp">지금은 아무도 없어요</div>';
  return `<div class="tw-t-name tw-t-small">${head}</div>${body}`;
}
function placeTip(html, wx, wy) {
  const r = cv.getBoundingClientRect();
  tip.innerHTML = html; tip.hidden = false;
  const sx = wx / W * r.width, sy = wy / H * r.height, half = tip.offsetWidth / 2;
  tip.style.left = Math.max(half + 4, Math.min(r.width - half - 4, sx)) + 'px';
  tip.style.top = Math.max(tip.offsetHeight + 4, sy) + 'px';
}
function showPersonTip(p) { placeTip(personTip(p), p.x, (p._top != null ? p._top : p.y - 16) - 6); tip._id = p.id; tip._rg = null; }
function hideTip() { if (tip) { tip.hidden = true; tip._id = null; tip._rg = null; } }
function onMove(e) {
  const r = cv.getBoundingClientRect(), wx = (e.clientX - r.left) / r.width * W, wy = (e.clientY - r.top) / r.height * H;
  let hit = null;
  for (const p of [...people].filter(p => !p.hidden).sort((a, c) => c.y - a.y)) { const top = p._top != null ? p._top : p.y - 16; if (wx >= p.x - 6 && wx <= p.x + 6 && wy >= top - 2 && wy <= p.y + 4) { hit = p; break; } }
  hoverId = hit ? hit.id : null;
  let rg = null; if (!hit) rg = regions.find(g => wx >= g.rect[0] && wx <= g.rect[0] + g.rect[2] && wy >= g.rect[1] && wy <= g.rect[1] + g.rect[3]) || null;
  hoverRegion = rg;
  cv.classList.toggle('tw-hover', !!(hit || rg));
  if (hit) showPersonTip(hit);
  else if (rg) { placeTip(groupTip(rg), rg.rect[0] + rg.rect[2] / 2, rg.rect[1]); tip._rg = rg.kind; tip._id = null; }
  else if (!(selId && clockT < selUntil)) hideTip();
}

// ---------- 반복 ----------
let clockFn = null;
function kstMinute() { const d = new Date(Date.now() + 9 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60; }
function step(dt) {
  viewMin = clockFn ? clockFn() : kstMinute();
  if (Math.floor(viewMin) !== lastAssignMin) assignAll(false);
  let arrived = false;
  for (const p of people) {
    if (p.moving && p.path.length) {
      let left = 30 * dt;
      while (left > 0 && p.path.length) {
        const [tx, ty] = p.path[0], dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
        if (Math.abs(dx) > .3 || Math.abs(dy) > .3) p.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        if (d <= left) { p.x = tx; p.y = ty; p.path.shift(); left -= d; } else { p.x += dx / d * left; p.y += dy / d * left; left = 0; }
      }
      if (!p.path.length) { p.moving = false; p.face = p.spot ? p.spot.s.face : 'down'; if (p.hideAtEnd) p.hidden = true; arrived = true; }
    } else if (p.moving) { p.moving = false; if (p.hideAtEnd) p.hidden = true; arrived = true; }
    wander(p, clockT);
  }
  if (arrived) renderPanel();
}
function loop(ts) {
  if (!running) return;
  const dt = Math.min(.05, lastTs ? (ts - lastTs) / 1000 : 0); lastTs = ts; clockT += dt;
  if (root && root.offsetParent !== null) {
    step(dt);
    const oc = drawWorld(clockT);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(wC, 0, 0, W, H, 0, 0, cv.width, cv.height);
    drawText(oc);
    if (!tip.hidden && tip._id && byId.get(tip._id)) showPersonTip(byId.get(tip._id));
  }
  requestAnimationFrame(loop);
}

// ---------- 붙이기 ----------
const CSS = `
.tw{--tw-ink:#17151d;--tw-panel:#211e29;--tw-panel2:#2a2634;--tw-line:#3b3647;--tw-fg:#f1e8d9;--tw-muted:#a89f92;--tw-lamp:#f2b84b;
  display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:12px;align-items:start;color:var(--tw-fg);font-family:'Gowun Batang','Apple SD Gothic Neo','Malgun Gothic',serif;font-size:14px;line-height:1.5}
.tw.tw-nopanel{grid-template-columns:minmax(0,1fr)}
.tw.tw-fill{grid-template-columns:minmax(0,1fr) 300px}
.tw.tw-fill .tw-stage{width:fit-content;justify-self:center}
.tw.tw-fill .tw-legend{justify-content:center}
@media (max-width:1180px){.tw,.tw.tw-fill{grid-template-columns:minmax(0,1fr)}}
.tw-main{min-width:0;display:grid;gap:8px}
.tw-stage{position:relative;background:#0e0c12;border:3px solid var(--tw-line);border-radius:6px;box-shadow:0 0 0 3px #0e0c12,0 14px 30px rgba(0,0,0,.35);overflow:hidden;line-height:0}
.tw-stage canvas{display:block;image-rendering:pixelated;image-rendering:crisp-edges}
.tw-stage canvas.tw-hover{cursor:pointer}
.tw-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--tw-muted)}
.tw-legend span{display:inline-flex;align-items:center;gap:6px}
.tw-legend b{font-weight:600;color:inherit;font-variant-numeric:tabular-nums}
.tw-dot{width:9px;height:9px;border:1px solid #2b2023;background:var(--c);display:inline-block;flex:none}
.tw-tip{position:absolute;z-index:3;transform:translate(-50%,-100%);min-width:180px;max-width:260px;background:#f4ead7;color:#2b2023;border:2px solid #2b2023;box-shadow:3px 3px 0 #2b2023;padding:8px 10px;line-height:1.4;pointer-events:none;font-size:12px}
.tw-t-name{font-family:'Gowun Batang',serif;font-weight:700;font-size:18px;line-height:1.1}
.tw-t-name.tw-t-small{font-size:15px;margin-bottom:4px}
.tw-t-name span{font-family:inherit;font-size:11px;color:#6b5a50;margin-left:6px}
.tw-tip .tw-t-name span{font-weight:400}
.tw-t-type{display:flex;align-items:center;gap:6px;margin-top:5px;font-weight:600}
.tw-t-place small{display:block;color:#6b5a50;font-size:11px}
.tw-t-time{font-variant-numeric:tabular-nums;color:#6b5a50;font-size:11px}
.tw-t-detail{margin-top:5px;padding-top:5px;border-top:1px dashed #b9a88f}
.tw-t-grp{margin-top:3px}
.tw-lock{color:#8a6f5c}
.tw-panel{background:var(--tw-panel);border:1px solid var(--tw-line);border-radius:6px;padding:12px;display:grid;gap:8px;min-width:0;max-height:82vh;overflow:auto}
.tw-panel h2{font-family:'Gowun Batang',serif;font-weight:700;font-size:19px;margin:0;color:var(--tw-fg)}
.tw-town{display:grid;gap:4px}
.tw-town h3{margin:6px 0 2px;font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--tw-muted)}
.tw-place{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px;padding:6px 8px;border-radius:4px;background:var(--tw-panel2)}
.tw-place.tw-empty{background:transparent;opacity:.55}
.tw-nm{font-weight:500;font-size:13px;min-width:0}
.tw-nm small{color:var(--tw-muted);font-weight:400;font-size:11px;margin-left:5px}
.tw-ct{font-family:'Gowun Batang',serif;font-weight:700;font-size:16px;color:var(--tw-lamp);font-variant-numeric:tabular-nums;line-height:1.2}
.tw-chips{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px}
.tw-chip{display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12px;color:var(--tw-fg);background:#1b1922;border:1px solid var(--tw-line);border-radius:3px;padding:1px 7px 1px 5px;cursor:pointer}
.tw-chip.moving{border-style:dashed;color:var(--tw-muted)}
.tw-chip:focus-visible{outline:2px solid var(--tw-lamp);outline-offset:2px}
.tw-note{margin:0;font-size:12px;color:var(--tw-muted);line-height:1.6}
`;
function ensureAssets() {
  if (!document.getElementById('tw-css')) { const st = document.createElement('style'); st.id = 'tw-css'; st.textContent = CSS; document.head.appendChild(st); }
}
let loadFn = null, refreshTimer = 0, roObs = null;
function refresh() {
  if (!loadFn) return Promise.resolve();
  return Promise.resolve(loadFn()).then(d => { if (d) setData(d); }).catch(e => { if (window.console) console.warn('동네지도 불러오기 실패', e); });
}
function mount(host, opts) {
  opts = opts || {};
  ensureAssets();
  unmount();
  clockFn = opts.clock || null; maskDetail = opts.maskDetail || (() => false); loadFn = opts.load || null;
  showNames = opts.names !== false;
  fillMode = !!opts.fill;
  host.innerHTML = `<div class="tw${opts.panel === false ? ' tw-nopanel' : ''}${fillMode ? ' tw-fill' : ''}"><div class="tw-main"><div class="tw-stage"><canvas aria-label="과원 위치 지도"></canvas><div class="tw-tip" hidden></div></div><div class="tw-legend"></div></div>`
    + (opts.panel === false ? '' : `<aside class="tw-panel"><h2>장소별 현황</h2><div class="tw-places"></div><p class="tw-note">캐릭터나 숫자 팻말에 마우스를 올리면 자세히 보여요. 한 방에 9명 이상이면 이름표는 숨겨져요. 일정이 없는 사람은 휴게실, 직장 근무 시간인 사람은 직장 건물에 들어가 있어요.</p></aside>`) + `</div>`;
  root = host.firstElementChild; cv = root.querySelector('canvas'); ctx = cv.getContext('2d'); tip = root.querySelector('.tw-tip');
  mainEl = root.querySelector('.tw-main'); stageEl = root.querySelector('.tw-stage'); panelEl = root.querySelector('.tw-panel');
  placesEl = root.querySelector('.tw-places'); legendEl = root.querySelector('.tw-legend');
  cv.addEventListener('mousemove', onMove);
  cv.addEventListener('mouseleave', () => { hoverId = null; hoverRegion = null; cv.classList.remove('tw-hover'); hideTip(); });
  if (placesEl) placesEl.addEventListener('click', e => { const bt = e.target.closest('.tw-chip'); if (!bt) return; const p = byId.get(bt.getAttribute('data-id')); if (!p) return;
    selId = p.id; selUntil = clockT + 4;
    if (p.hidden) { const pl = placeOf(p.seg.place); placeTip(personTip(p), pl.door[0], pl.door[1] - 6); tip._id = null; } else showPersonTip(p);
    setTimeout(() => { if (hoverId == null && !hoverRegion) hideTip(); }, 3500); });
  roObs = new ResizeObserver(fit); roObs.observe(fillMode ? mainEl : stageEl); fit();
  window.addEventListener('resize', fit);
  viewMin = clockFn ? clockFn() : kstMinute();
  if (opts.data) setData(opts.data); else renderPanel();
  if (loadFn) { refresh(); refreshTimer = setInterval(refresh, opts.refreshMs || 180000); }
  running = true; lastTs = 0;
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(loop));
}
function unmount() {
  running = false; clearInterval(refreshTimer); refreshTimer = 0;
  if (roObs) { roObs.disconnect(); roObs = null; }
  window.removeEventListener('resize', fit);
  root = null; cv = null; ctx = null; tip = null; placesEl = null; legendEl = null; mainEl = null; stageEl = null; panelEl = null;
}
window.Town = {
  mount, unmount, refresh,
  setData: d => setData(d),
  setNames: v => { showNames = !!v; },
  rerender: () => { if (tip && !tip.hidden && tip._id && byId.get(tip._id)) showPersonTip(byId.get(tip._id)); },
  types: TYPES
};
})();
