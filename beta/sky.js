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
function bg(c) {
  const W = scene.W;
  if (scene.id === 'lobby') {
    R(c, '#cfd8e3', 0, 0, W, 70); R(c, '#b9c4d1', 0, 62, W, 8);                         // 하늘색 벽
    for (let x = 0; x < W; x += 40) R(c, '#c3cedb', x, 0, 2, 62);
    R(c, '#2f4858', 104, 10, 112, 22); R(c, '#f2f0ea', 106, 12, 108, 18);                // 간판
    R(c, '#e9dfcb', 0, 70, W, 80); for (let y = 70; y < 150; y += 10) for (let x = (y / 10 % 2) * 10; x < W; x += 20) R(c, '#e1d5bd', x, y, 10, 10);   // 바닥 체크
    plant(c, 20, 60); plant(c, 236, 60);
    stairsArt(c, 278); R(c, '#b5533f', 140, 140, 40, 10); R(c, '#e07a5f', 142, 141, 36, 8);   // 입구 매트
  } else if (scene.id === 'floor') {
    R(c, '#e8e0d0', 0, 0, W, 70); R(c, '#d2c8b4', 0, 64, W, 6);
    R(c, '#c9b38f', 0, 70, W, 80); for (let x = 0; x < W; x += 16) R(c, '#bfa883', x, 70, 1, 80);   // 나무 복도
    R(c, '#6b8fa8', 0, 108, W, 14); R(c, '#5f8299', 0, 108, W, 2);                       // 복도 카펫
    stairsArt(c, 16);
    for (const a of scene.acts) if (a.p) door(c, a.x, a.p);
  } else {
    const o = scene.owner;
    R(c, '#efe6d0', 0, 0, W, 70); R(c, '#d9cbae', 0, 64, W, 6);
    R(c, '#b98a5e', 0, 70, W, 80); for (let y = 70; y < 150; y += 8) R(c, '#a8794f', 0, y, W, 1);
    R(c, '#6b8fa8', 20, 10, 50, 30); R(c, '#bfe3ec', 22, 12, 46, 26); R(c, '#e9dfcb', 44, 12, 2, 26);   // 창문
    (o.badges || []).slice(0, 6).forEach((ic, i) => { R(c, '#7a4f33', 92 + i * 22, 14, 18, 18); R(c, '#f7f1e3', 94 + i * 22, 16, 14, 14); });   // 배지 액자
    R(c, '#5a4636', 188, 74, 18, 20); R(c, '#f2f0ea', 190, 76, 14, 10); R(c, '#e8584a', 196, 70, 2, 6);   // 방명록 받침대
    plant(c, 214, 58); R(c, '#4a3a2c', 108, 140, 24, 10);                                // 나가는 문
  }
}
function plant(c, x, y) { R(c, '#8a5a3b', x, y + 10, 10, 8); R(c, '#4f772d', x - 2, y, 14, 11); R(c, '#6b8f4e', x + 1, y + 2, 6, 5); }
function stairsArt(c, x) { for (let i = 0; i < 6; i++) { R(c, '#9a8b74', x + i * 4, 40 + i * 10, 28 - i * 4, 10); R(c, '#b5a68e', x + i * 4, 40 + i * 10, 28 - i * 4, 2); } }
function door(c, x, p) {
  R(c, '#5a4636', x - 11, 28, 22, 36); R(c, '#8a6a4f', x - 9, 30, 18, 34); R(c, '#e9c46a', x + 5, 46, 2, 2);
  R(c, '#2f4858', x - 14, 18, 28, 8);   // 이름표 자리
  if (p.id === data.me) R(c, '#f2b84b', x - 11, 64, 22, 2);
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
  if (scene.id === 'office') { (scene.owner.badges || []).slice(0, 6).forEach((ic, i) => { ctx.font = `${k * 10}px sans-serif`; ctx.fillText(ic, X(101 + i * 22), 23.5 * k); });
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
