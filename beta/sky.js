// 하늘방송국 (PC 전용, 실시간 없음): 1층 로비(안내 NPC) → 계단 → 2층 성우팀 · 3층 아나운서팀 · 4층 엔지니어팀·운영진 → 각자 사무실(방명록)
// 캐릭터 그리기는 town.js(Town.drawPerson·withLook)를 같이 씀. 키보드(방향키·WASD)로 걷고, 화면을 눌러도 그쪽으로 걸어감. Space·Enter·클릭 = 말 걸기·들어가기
//   Sky.mount(상자, { load: () => Promise<sky.load 결과>, onGuest: (사람) => 방명록 열기 })
(function () {
const H = 150, SPEED = 52;
const FLOORS = { 2: '2층 · 성우팀', 3: '3층 · 아나운서팀', 4: '4층 · 엔지니어팀 · 운영진' };
const NPC_SAY = ['하늘방송국에 오신 걸 환영해요! 😊', '2층은 성우분들이 모여 계시고요~', '3층은 아나운서분들이 계세요~',
  '4층에는 엔지니어분들과 과장·부과장님 등 운영진분들이 쓰시는 사무실이 있습니다!', '오른쪽 계단으로 올라가시면 돼요. 사무실에 들르면 방명록도 남길 수 있어요 📮'];
const R = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };

let host, cv, ctx, off, oc, box, data = null, opts = {}, scene = null, me = null, keys = {}, target = null, running = false, lastTs = 0, t = 0, scale = 4, camX = 0, near = null;

// ---------- 장면 ----------
function people(floor) { return data.people.filter(p => p.floor === floor); }
function makeScene(id, arg) {
  if (id === 'lobby') return { id, W: 320, floor: [70, 140], spawn: arg || [160, 128], acts: [
    { x: 160, y: 84, r: 18, label: '안내 데스크', npc: true, act: () => talk(NPC_SAY) },
    { x: 296, y: 92, r: 18, label: '계단', act: stairs } ] };
  if (id === 'floor') {
    const list = people(arg.floor), W = Math.max(320, 90 + list.length * 46 + 30);
    const doors = list.map((p, i) => ({ x: 96 + i * 46, y: 72, r: 16, label: p.name + ' 사무실', p, act: () => go('office', { p, back: { floor: arg.floor, x: 96 + i * 46 } }) }));
    return { id, W, floor: [70, 140], fl: arg.floor, list, spawn: arg.at || [40, 120], acts: [{ x: 34, y: 92, r: 18, label: '계단', act: stairs }].concat(doors) };
  }
  if (id === 'office') return { id, W: 240, floor: [70, 140], owner: arg.p, back: arg.back, spawn: [120, 132], acts: [
    { x: 120, y: 142, r: 14, label: '나가기', act: () => go('floor', { floor: arg.back.floor, at: [arg.back.x, 84] }) },
    { x: 196, y: 92, r: 16, label: '방명록', act: () => opts.onGuest && opts.onGuest(arg.p) } ].concat(arg.p.id === data.me ? [] : [
    { x: 92, y: 88, r: 16, label: arg.p.name + '님', act: () => talk([(arg.p.title ? arg.p.title + ' ' : '') + arg.p.name + '님의 사무실이에요.', '오른쪽 방명록에 한마디 남겨 보세요 📮']) }]) };
}
function go(id, arg) {
  scene = makeScene(id, arg);
  me.x = scene.spawn[0]; me.y = scene.spawn[1]; me.moving = false; target = null; closeTalk();
  host.querySelector('.sky-where').textContent = id === 'lobby' ? '1층 · 로비' : id === 'floor' ? FLOORS[scene.fl] : scene.owner.name + '님 사무실 · ' + FLOORS[scene.back.floor].split(' · ')[0];
}
function stairs() {
  const cur = scene.id === 'lobby' ? 1 : scene.fl;
  talk(['몇 층으로 갈까요?'], [1, 2, 3, 4].filter(f => f !== cur).map(f => [f === 1 ? '1층 로비' : FLOORS[f], () => f === 1 ? go('lobby', [286, 100]) : go('floor', { floor: f })]));
}

// ---------- 말풍선(아래 대화 상자) ----------
let talkQ = null;
function talk(lines, choices) { talkQ = { lines, i: 0, choices }; drawTalk(); }
function drawTalk() {
  if (!talkQ) { box.hidden = true; return; }
  const last = talkQ.i >= talkQ.lines.length - 1;
  box.hidden = false;
  box.innerHTML = '<p>' + esc(talkQ.lines[talkQ.i]) + '</p>' + (last && talkQ.choices ? '<div class="sky-ch">' + talkQ.choices.map((c, i) => '<button type="button" data-i="' + i + '">' + esc(c[0]) + '</button>').join('') + '</div>'
    : '<small>' + (last ? '닫기' : '다음') + ' · Space</small>');
}
function nextTalk() { if (!talkQ) return; if (talkQ.i < talkQ.lines.length - 1) { talkQ.i++; drawTalk(); } else if (!talkQ.choices) closeTalk(); }
function closeTalk() { talkQ = null; if (box) box.hidden = true; }
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 그리기 ----------
// ---------- 소품 (진한 외곽선 + 위쪽 밝은 면 + 아래 그림자: 동네지도와 같은 도트 말투) ----------
const OL = '#2a2228';
const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16), f = v => Math.max(0, Math.min(255, Math.round(v * k))); return '#' + [n >> 16, n >> 8 & 255, n & 255].map(v => f(v).toString(16).padStart(2, '0')).join(''); };
function pbox(c, x, y, w, h, col, o) {   // 외곽선 상자 (o.top 윗면 높이, o.noShadow)
  o = o || {};
  if (!o.noShadow) { c.fillStyle = 'rgba(40,25,20,.22)'; c.fillRect(x + 1, y + h, w, 2); }
  R(c, OL, x - 1, y - 1, w + 2, h + 2); R(c, col, x, y, w, h);
  if (o.top) R(c, shade(col, 1.18), x, y, w, o.top);
  R(c, shade(col, .82), x, y + h - 1, w, 1);
}
function plant(c, x, y, big) {
  pbox(c, x, y + 10, 10, 8, '#b5673f', { top: 2 });
  const g = ['#3f6b35', '#4f8243', '#6b9f55'];
  R(c, OL, x - 3, y - (big ? 8 : 1), 16, big ? 20 : 12); R(c, g[0], x - 2, y - (big ? 7 : 0), 14, big ? 18 : 10);
  R(c, g[1], x, y - (big ? 5 : 1), 6, 6); R(c, g[2], x + 6, y + (big ? -2 : 2), 4, 4); if (big) R(c, g[2], x + 1, y + 3, 4, 3);
}
function pframe(c, x, y, w, h, inner) { pbox(c, x, y, w, h, '#7a4f33', { noShadow: 1 }); R(c, inner || '#f7f1e3', x + 2, y + 2, w - 4, h - 4); }
function windowArt(c, x, y, w, h, curtain) {
  pbox(c, x, y, w, h, '#f4efe4', { noShadow: 1 });
  const sky = ['#9fd0e8', '#b7dcec', '#cde6ef'];
  for (let i = 0; i < 3; i++) R(c, sky[i], x + 2, y + 2 + i * Math.floor((h - 4) / 3), w - 4, Math.ceil((h - 4) / 3));
  R(c, '#ffffff', x + 6, y + 6, 8, 2); R(c, '#ffffff', x + 9, y + 4, 4, 2);                    // 구름
  R(c, '#f4efe4', x + Math.floor(w / 2) - 1, y, 2, h); R(c, '#f4efe4', x, y + Math.floor(h / 2), w, 2);
  R(c, '#d9cbae', x - 2, y + h, w + 4, 3);                                                      // 창틀
  if (curtain) { R(c, curtain, x - 4, y - 2, 5, h + 4); R(c, curtain, x + w - 1, y - 2, 5, h + 4); R(c, shade(curtain, .8), x - 2, y - 2, 1, h + 4); R(c, shade(curtain, .8), x + w + 1, y - 2, 1, h + 4); }
}
function books(c, x, y, w) { const cols = ['#b56576', '#3d7ea6', '#e9c46a', '#4f772d', '#e07a5f', '#6d597a', '#efe6d8']; for (let i = 0, bx = x; bx < x + w - 2; i++) { const bw = 2 + (i % 3 === 0 ? 1 : 0), bh = 7 - (i % 4 === 1 ? 2 : 0); R(c, cols[i % cols.length], bx, y + 8 - bh, bw, bh); bx += bw + 1; } }
function shelf(c, x, y, w, h) { pbox(c, x, y, w, h, '#8a5a3b', { top: 2 }); for (let sy = y + 3; sy < y + h - 6; sy += 11) { R(c, '#5e3c27', x + 2, sy, w - 4, 9); books(c, x + 3, sy + 1, w - 6); R(c, '#a8714a', x + 2, sy + 9, w - 4, 1); } }
function rug(c, x, y, w, h, a, b) { R(c, OL, x - 1, y - 1, w + 2, h + 2); R(c, a, x, y, w, h); R(c, b, x + 3, y + 3, w - 6, h - 6); R(c, a, x + 5, y + 5, w - 10, h - 10); for (let i = x + 8; i < x + w - 8; i += 8) R(c, shade(a, 1.15), i, y + h / 2, 3, 1); }
function lamp(c, x, y) { R(c, OL, x, y, 2, 30); R(c, '#55505e', x, y + 28, 6, 2); pbox(c, x - 5, y - 8, 12, 8, '#f2d8a0', { top: 2, noShadow: 1 }); c.fillStyle = 'rgba(255,226,150,.18)'; c.fillRect(x - 10, y, 22, 30); }
function sofa(c, x, y, w, col) { pbox(c, x, y, w, 10, shade(col, .85), { noShadow: 1 }); pbox(c, x, y + 8, w, 8, col, { top: 2 }); pbox(c, x - 3, y + 4, 4, 12, shade(col, .8)); pbox(c, x + w - 1, y + 4, 4, 12, shade(col, .8)); R(c, shade(col, 1.2), x + 3, y + 9, w / 2 - 4, 2); R(c, shade(col, 1.2), x + w / 2 + 1, y + 9, w / 2 - 4, 2); }
function micStand(c, x, y) { R(c, OL, x, y, 2, 26); R(c, '#55505e', x - 4, y + 25, 10, 2); pbox(c, x - 2, y - 7, 6, 8, '#3a3740', { noShadow: 1 }); R(c, '#9aa0a6', x - 1, y - 6, 4, 2); R(c, 'rgba(60,60,70,.35)', x + 4, y - 9, 7, 9); }
function plank(c, x, y, w, h, a, b) { R(c, a, x, y, w, h); for (let yy = y, r = 0; yy < y + h; yy += 6, r++) { for (let xx = x - (r % 2) * 14; xx < x + w; xx += 28) { R(c, (r + xx / 28) % 3 < 1 ? b : a, Math.max(x, xx), yy, Math.min(27, x + w - Math.max(x, xx)), 5); } R(c, shade(a, .85), x, yy + 5, w, 1); } }

function bg(c) {
  const W = scene.W;
  if (scene.id === 'lobby') {
    R(c, '#cfd9e6', 0, 0, W, 70); for (let x = 0; x < W; x += 32) R(c, '#c4cfdd', x, 0, 16, 52);   // 하늘색 줄무늬 벽
    R(c, '#8fa3b8', 0, 52, W, 18); R(c, '#a7b8ca', 0, 52, W, 2); R(c, '#6f8399', 0, 68, W, 2);         // 아래 판넬·걸레받이
    R(c, '#2f4858', 102, 8, 116, 26); R(c, OL, 101, 7, 118, 1); R(c, '#f7f3e8', 105, 11, 110, 20); R(c, '#e8584a', 108, 14, 4, 4);   // 간판 + ON AIR 등
    windowArt(c, 18, 10, 44, 34, '#e07a5f'); windowArt(c, 232, 10, 30, 34, '#e07a5f');
    pframe(c, 76, 18, 18, 22, '#e9c46a'); R(c, '#3d7ea6', 80, 24, 10, 10); pframe(c, 226 - 2, 46, 0, 0);   // 포스터
    plank(c, 0, 70, W, 80, '#e9dfcb', '#e1d4bb');
    rug(c, 104, 100, 112, 34, '#2f4858', '#e9c46a');                                               // 로비 카펫
    sofa(c, 22, 86, 36, '#6b8fa8'); plant(c, 8, 74, true); plant(c, 70, 74, true); lamp(c, 250, 70);
    for (const px of [96, 224]) { pbox(c, px, 0, 8, 70, '#e8eef5', { noShadow: 1 }); R(c, '#cfd9e6', px + 2, 0, 2, 70); }   // 기둥
    stairsArt(c, 270); pbox(c, 136, 142, 48, 8, '#b5533f', { top: 2 });                              // 입구 매트
  } else if (scene.id === 'floor') {
    R(c, '#efe6d4', 0, 0, W, 70); R(c, '#e3d7bf', 0, 0, W, 6);
    R(c, '#a8794f', 0, 46, W, 22); R(c, '#bf8f62', 0, 46, W, 2); R(c, '#6e4630', 0, 66, W, 4);        // 나무 판넬·걸레받이
    plank(c, 0, 70, W, 80, '#c9a073', '#bd9468');
    R(c, OL, 0, 103, W, 22); R(c, '#2f4858', 0, 104, W, 20); R(c, '#e9c46a', 0, 106, W, 1); R(c, '#e9c46a', 0, 121, W, 1);   // 복도 러너
    stairsArt(c, 10);
    const ds = scene.acts.filter(a => a.p);
    ds.forEach((a, i) => { if (i < ds.length - 1) { const lx = a.x + 23; pbox(c, lx - 3, 10, 6, 6, '#f2d8a0', { noShadow: 1 }); c.fillStyle = 'rgba(255,226,150,.16)'; c.fillRect(lx - 8, 16, 16, 30); if (i % 2) plant(c, lx - 4, 78); } });
    for (const a of ds) door(c, a.x, a.p);
    windowArt(c, W - 34, 10, 26, 30, '#6b8fa8');
  } else {
    const o = scene.owner;
    R(c, '#f3e6cc', 0, 0, W, 70); for (let x = 0; x < W; x += 12) R(c, '#efdfc1', x, 0, 6, 46);     // 줄무늬 벽지
    R(c, '#a8794f', 0, 46, W, 22); R(c, '#bf8f62', 0, 46, W, 2); for (let x = 6; x < W; x += 18) R(c, '#966b44', x, 50, 12, 14);   // 판넬
    R(c, '#6e4630', 0, 66, W, 4);
    plank(c, 0, 70, W, 80, '#b98a5e', '#ad7f55');
    shelf(c, 4, 18, 30, 62);                                                                         // 책장
    windowArt(c, 44, 10, 46, 32, '#b56576');
    (o.badges || []).slice(0, 5).forEach((ic, i) => pframe(c, 104 + i * 20, 12, 16, 18));             // 배지 액자 (아이콘은 글자로)
    if (!(o.badges || []).length) { pframe(c, 120, 14, 30, 20, '#9fd0e8'); R(c, '#4f772d', 124, 26, 22, 6); }
    micStand(c, 210, 46); R(c, '#34323e', 222, 30, 8, 2); R(c, '#34323e', 222, 30, 2, 8); R(c, '#34323e', 228, 30, 2, 8);   // 마이크 + 헤드폰 걸이
    rug(c, 48, 98, 120, 30, '#6d597a', '#e9c46a');
    pbox(c, 70, 74, 12, 10, '#3a3740', { top: 2 });                                                    // 의자 등받이 (사람 뒤)
    sofa(c, 150, 110, 40, '#4f772d');
    lamp(c, 228, 74); plant(c, 6, 124, true); plant(c, 196, 76);
    pbox(c, 186, 82, 22, 14, '#5a4636', { top: 3 }); R(c, '#f7f3e8', 189, 84, 16, 7); R(c, '#e8584a', 196, 77, 2, 7); R(c, OL, 191, 86, 12, 1); R(c, OL, 191, 88, 9, 1);   // 방명록 받침대 + 깃펜
    pbox(c, 106, 140, 28, 10, '#4a3a2c', { noShadow: 1 }); R(c, '#e9c46a', 128, 144, 2, 2);            // 나가는 문
  }
}
function stairsArt(c, x) { for (let i = 0; i < 6; i++) pbox(c, x + i * 4, 40 + i * 10, 28 - i * 4, 10, '#a6977f', { top: 2, noShadow: 1 }); R(c, '#6e4630', x + 26, 20, 2, 30); R(c, '#6e4630', x, 20, 28, 2); }
function door(c, x, p) {
  pbox(c, x - 13, 26, 26, 40, '#5a4636', { noShadow: 1 });
  R(c, '#8a6a4f', x - 10, 29, 20, 37); R(c, '#9c7a5c', x - 8, 31, 16, 14); R(c, '#9c7a5c', x - 8, 48, 16, 16);   // 문 판넬
  R(c, '#bfe3ec', x - 5, 33, 10, 8); R(c, '#e9c46a', x + 6, 50, 2, 3);                                // 작은 창·손잡이
  pbox(c, x - 15, 15, 30, 9, '#2f4858', { noShadow: 1 });                                              // 이름표
  if (p.id === data.me) { R(c, '#f2b84b', x - 13, 66, 26, 2); R(c, '#e8584a', x - 2, 70, 4, 3); }
}
function person(c, p, x, y, face, moving, dir) {
  Town.drawPerson(c, { id: p.id, look: Town.withLook(p.id, p.look), seed: (p.seed = p.seed || (p.id.charCodeAt(0) + p.id.charCodeAt(5)) % 97), x, y, face, moving, dir, spot: null, seg: { type: '휴식' }, hidden: false }, t);
}
function frame(ts) {
  if (!running) return;
  const dt = Math.min(.05, lastTs ? (ts - lastTs) / 1000 : 0); lastTs = ts; t += dt;
  if (host.offsetParent !== null && data) { step(dt); draw(); }
  requestAnimationFrame(frame);
}
function step(dt) {
  let dx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0), dy = (keys.d ? 1 : 0) - (keys.u ? 1 : 0);
  if (dx || dy) target = null;
  else if (target) { const ex = target.x - me.x, ey = target.y - me.y, d = Math.hypot(ex, ey); if (d < 2) { const a = target.act; target = null; if (a) a.act(); } else { dx = ex / d; dy = ey / d; } }
  me.moving = !!(dx || dy) && !talkQ;
  if (me.moving) {
    const k = SPEED * dt / (Math.hypot(dx, dy) || 1);
    me.x = Math.max(8, Math.min(scene.W - 8, me.x + dx * k)); me.y = Math.max(scene.floor[0] + 4, Math.min(scene.floor[1], me.y + dy * k));
    me.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'); if (dx) me.dir = dx > 0 ? 1 : -1;
  }
  near = scene.acts.find(a => Math.hypot(a.x - me.x, a.y - me.y) < a.r + 6) || null;
}
function draw() {
  const vw = Math.ceil(cv.width / scale);
  camX = Math.max(0, Math.min(scene.W - vw, me.x - vw / 2)); if (scene.W < vw) camX = -(vw - scene.W) / 2;
  oc.setTransform(1, 0, 0, 1, 0, 0); oc.clearRect(0, 0, off.width, off.height); R(oc, '#1f1e1a', 0, 0, off.width, off.height);
  oc.setTransform(1, 0, 0, 1, -Math.round(camX), 0);
  bg(oc);
  const list = [];
  if (scene.id === 'lobby') {
    list.push({ y: 80, f: () => person(oc, NPC, 160, 80, 'down', false, 1) });
    list.push({ y: 98, f: () => { R(oc, '#7a4f33', 128, 84, 64, 14); R(oc, '#a8714a', 128, 84, 64, 3); R(oc, '#3a3740', 136, 78, 10, 6); R(oc, '#7fc6e0', 137, 79, 8, 4); } });   // 안내 데스크(사람 앞)
  }
  if (scene.id === 'office') {
    if (scene.owner.id !== data.me) list.push({ y: 80, f: () => person(oc, scene.owner, 92, 80, 'down', false, 1) });
    list.push({ y: 96, f: () => { R(oc, '#7a4f33', 66, 82, 56, 12); R(oc, '#a8714a', 66, 82, 56, 3); R(oc, '#3a3740', 104, 76, 14, 8); R(oc, '#7fc6e0', 105, 77, 12, 6); } });   // 책상·모니터(사람 앞)
  }
  list.push({ y: me.y, f: () => person(oc, data.meP, me.x, me.y, me.face, me.moving, me.dir) });
  list.sort((a, b) => a.y - b.y).forEach(o => o.f());
  ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(off, 0, 0, vw, H, 0, 0, vw * scale, H * scale);
  labels();
}
function labels() {
  const k = scale, X = x => (x - camX) * k, fs = Math.max(11, k * 2.6);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tag = (txt, x, y, col, bgc, size) => { ctx.font = `700 ${size || fs}px Pretendard, sans-serif`; const w = ctx.measureText(txt).width + 10; ctx.fillStyle = bgc || 'rgba(23,21,29,.82)'; ctx.fillRect(x - w / 2, y - (size || fs) * .7, w, (size || fs) * 1.4); ctx.fillStyle = col || '#f1e8d9'; ctx.fillText(txt, x, y); };
  if (scene.id === 'lobby') { ctx.font = `800 ${k * 9}px 'Gowun Batang', serif`; ctx.fillStyle = '#2f4858'; ctx.fillText('하늘방송국', X(160), 21 * k); }
  if (scene.id === 'floor') for (const a of scene.acts) if (a.p) { tag(a.p.name, X(a.x), 22 * k, a.p.id === data.me ? '#f2b84b' : '#f1e8d9', 'rgba(0,0,0,0)', fs * .95); if (a.p.title) tag(a.p.title, X(a.x), 12 * k, '#f2b84b', 'rgba(23,21,29,.7)', fs * .8); }
  if (scene.id === 'office') { (scene.owner.badges || []).slice(0, 5).forEach((ic, i) => { ctx.font = `${k * 9}px sans-serif`; ctx.fillText(ic, X(112 + i * 20), 21.5 * k); });
    tag((scene.owner.title ? scene.owner.title + ' · ' : '') + scene.owner.name + '님 사무실', X(120), 52 * k, '#f1e8d9', 'rgba(23,21,29,.8)'); }
  if (near && !talkQ) tag((near.npc ? '💬 ' : '') + near.label + ' · Space', X(near.x), (near.y - 30) * k, '#17151d', '#f2b84b');
  tag('나', X(me.x), (me.y + 5) * k, '#17151d', '#f2b84b', fs * .8);
}
const NPC = { id: 'npc-sky-guide', look: { gender: 'f', style: 'bun', hair: '#4a2f22', shirt: '#2f4858', pants: '#2f4858', bottom: 'skirt', hat: 'phones' } };

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
  const r = cv.getBoundingClientRect(), wx = (e.clientX - r.left) * (cv.width / r.width) / scale + camX, wy = (e.clientY - r.top) * (cv.height / r.height) / scale;
  const hit = scene.acts.find(a => Math.abs(a.x - wx) < a.r && wy > a.y - 50 && wy < a.y + 20);
  const y = Math.max(scene.floor[0] + 4, Math.min(scene.floor[1], hit ? a_y(hit) : wy));
  target = { x: hit ? hit.x : wx, y, act: hit };
}
const a_y = a => a.y + 6;
function fit() {
  const w = host.querySelector('.sky-stage').clientWidth, h = Math.min(window.innerHeight - 220, w * .55);
  scale = Math.max(2, Math.floor(h / H)); cv.width = w; cv.height = H * scale; cv.style.height = H * scale + 'px';
  off.width = Math.ceil(w / scale) + 2; off.height = H;
}

function mount(el, o) {
  unmount(); host = el; opts = o || {};
  host.innerHTML = '<div class="sky"><div class="sky-top"><b class="sky-where">불러오는 중...</b><small>방향키·WASD로 걷고, Space로 말 걸기·들어가기 · 화면을 눌러도 돼요</small></div>' +
    '<div class="sky-stage"><canvas></canvas><div class="sky-talk" hidden></div></div></div>';
  cv = host.querySelector('canvas'); ctx = cv.getContext('2d'); box = host.querySelector('.sky-talk');
  off = document.createElement('canvas'); oc = off.getContext('2d');
  box.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { const c = talkQ.choices[+b.getAttribute('data-i')]; closeTalk(); c[1](); } else nextTalk(); });
  cv.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKey);
  window.addEventListener('resize', fit); fit();
  me = { x: 160, y: 128, face: 'up', moving: false, dir: 1 };
  Promise.resolve(opts.load()).then(d => {
    data = d; data.meP = d.people.find(p => p.id === d.me) || { id: d.me, look: null, name: '나' };
    go('lobby'); setTimeout(() => talk(['어서 오세요! 안내 데스크에 다가와 말을 걸어 보세요 😊']), 300);
  }).catch(err => { host.querySelector('.sky-where').textContent = '불러오지 못했어요 · ' + (err && err.message || ''); });
  running = true; lastTs = 0; requestAnimationFrame(frame);
}
function unmount() {
  running = false; document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKey); window.removeEventListener('resize', fit);
  keys = {}; data = null; if (host) host.innerHTML = ''; host = null;
}
window.Sky = { mount, unmount, mounted: () => !!host, go: (id, arg) => data && go(id, arg) };
})();
