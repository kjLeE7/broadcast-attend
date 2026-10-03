// =====================================================================
// 방송예술과 미니앱 베타 — Supabase(문지기 api)만 사용
// 지금은 출결만. 기존 앱(../app.js, 구글시트)과는 완전히 분리되어 있음.
// =====================================================================
var API = 'https://bundxpidywrcrwhhgclv.supabase.co/functions/v1/api';
var RANK = { MEMBER: 10, GROUP_LEADER: 20, INSTRUCTOR: 30, TEAM_LEADER: 40 };
var WD = ['일', '월', '화', '수', '목', '금', '토'];
var STATUSES = ['참석', '불참', '지각', '조퇴'];

var tg = (window.Telegram && Telegram.WebApp) ? Telegram.WebApp : null;
var initData = tg ? (tg.initData || '') : '';
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#F4F1EC'); tg.setBackgroundColor('#F4F1EC'); } catch (e) {}
}

var S = {
  me: null,          // { profile, positions, teams }
  team: null,        // { id, name, rank }
  sessions: [],      // 모임 회차
  att: {},           // session_id → 출결 기록 배열
  types: [],         // 모임 유형 (교관 이상)
  members: null,     // 팀원 목록 (조장 이상)
  current: null      // 열어둔 모임
};

// ---------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------
function api(action, payload) {
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
    body: JSON.stringify({ action: action, payload: payload || {} })
  }).then(function (res) { return res.json(); })
    .then(function (j) { if (!j.ok) throw new Error(j.error || '알 수 없는 오류'); return j.data; });
}
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function setMsg(id, text, err) { var el = $(id); el.textContent = text || ''; el.classList.toggle('err', !!err); }
function haptic(t) { try { if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(t); } catch (e) {} }
function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function parseDate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function hm(t) { return t ? String(t).slice(0, 5) : ''; }
function todayStr() { return ymd(new Date()); }
function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
function sessionName(s) { return s.title || (s.meeting_types && s.meeting_types.name) || '모임'; }
function timePlace(s) {
  var t = hm(s.start_time) + (s.end_time ? '~' + hm(s.end_time) : '');
  return [t, s.location].filter(Boolean).join(' · ');
}
function myRow(sessionId) {
  var rows = S.att[sessionId] || [];
  for (var i = 0; i < rows.length; i++) if (rows[i].person_id === S.me.profile.id) return rows[i];
  return null;
}
function chip(status) {
  if (!status) return '<span class="st st-none">미제출</span>';
  return '<span class="st st-' + esc(status) + '">' + esc(status) + '</span>';
}
function showState(title, desc) {
  $('stateBox').style.display = 'block';
  $('stateBox').innerHTML = '<b>' + esc(title) + '</b>' + esc(desc || '');
  $('listView').style.display = 'none';
  $('detailView').style.display = 'none';
}

// ---------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------
function boot() {
  if (!initData) {
    $('who').textContent = '게스트';
    showState('텔레그램 안에서 열어주세요', '베타는 텔레그램 미니앱으로 열었을 때만 동작해요');
    return;
  }
  api('me').then(function (me) {
    S.me = me;
    var name = me.profile.name;
    $('avatar').textContent = String(name).slice(-2);
    var top = me.positions.slice().sort(function (a, b) { return (b.rank || 0) - (a.rank || 0); })[0];
    $('who').textContent = name + '님' + (top ? ' · ' + top.unit + ' ' + top.position : '');
    if (!me.teams.length) { showState('아직 소속 팀이 없어요', '팀장님께 팀 배정을 요청해주세요'); return; }
    $('tabbar').classList.remove('b-off');
    renderTeamTabs();
    selectTeam(me.teams[0].id);
  }).catch(function (err) {
    showState('들어갈 수 없어요', err.message);
  });
}

function renderTeamTabs() {
  var teams = S.me.teams;
  if (teams.length < 2) { $('teamTabs').style.display = 'none'; return; }
  $('teamTabs').style.display = 'flex';
  $('teamTabs').innerHTML = teams.map(function (t) {
    return '<button class="subtab" data-team="' + esc(t.id) + '" onclick="selectTeam(\'' + esc(t.id) + '\')">' + esc(t.name) + '</button>';
  }).join('');
}

function selectTeam(id) {
  S.team = S.me.teams.filter(function (t) { return t.id === id; })[0];
  S.members = null; S.types = []; S.att = {}; S.sessions = [];
  document.querySelectorAll('#teamTabs .subtab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-team') === id); });
  showState('불러오는 중...', S.team.name + ' 모임을 가져오고 있어요');
  loadTeam().then(showList).catch(function (err) { showState('불러오지 못했어요', err.message); });
}

function loadTeam() {
  var jobs = [api('sessions.list', { team_id: S.team.id, from: addDays(-14), to: addDays(60) })];
  if (S.team.rank >= RANK.INSTRUCTOR) jobs.push(api('meeting_types.list', { team_id: S.team.id }));
  return Promise.all(jobs).then(function (r) {
    S.sessions = r[0] || [];
    S.types = r[1] || [];
    // 모임마다 출결 (팀원은 본인 것만, 조장 이상은 전체가 돌아옴)
    return Promise.all(S.sessions.map(function (s) {
      return api('attendance.list', { session_id: s.id }).then(function (rows) { S.att[s.id] = rows || []; });
    }));
  });
}

// ---------------------------------------------------------------------
// 모임 목록
// ---------------------------------------------------------------------
function showList() {
  S.current = null;
  $('stateBox').style.display = 'none';
  $('detailView').style.display = 'none';
  $('listView').style.display = 'block';
  $('createCard').style.display = S.team.rank >= RANK.INSTRUCTOR ? 'block' : 'none';
  if (S.team.rank >= RANK.INSTRUCTOR) fillTypeSelect();

  var today = todayStr();
  var up = S.sessions.filter(function (s) { return s.session_date >= today; });
  var past = S.sessions.filter(function (s) { return s.session_date < today; }).reverse();
  $('upCount').textContent = up.length ? up.length + '개' : '';
  $('upList').innerHTML = up.length ? up.map(sessionCard).join('')
    : '<div class="empty"><b>예정된 모임이 없어요</b>' + (S.team.rank >= RANK.INSTRUCTOR ? '위에서 새로 만들 수 있어요' : '모임이 잡히면 여기에 보여요') + '</div>';
  $('pastList').innerHTML = past.length ? past.map(sessionCard).join('')
    : '<div class="empty"><b>최근 지난 모임이 없어요</b></div>';
  window.scrollTo(0, 0);
}

function sessionCard(s) {
  var d = parseDate(s.session_date);
  var isToday = s.session_date === todayStr();
  var past = s.session_date < todayStr();
  var cancelled = s.status === '취소';
  var mine = myRow(s.id);
  var side = cancelled ? chip('취소') : chip(mine && mine.status);
  if (S.team.rank >= RANK.GROUP_LEADER && !cancelled) {
    var n = (S.att[s.id] || []).filter(function (r) { return r.status; }).length;
    side += '<small>제출 ' + n + '명</small>';
  }
  return '<button class="b-session' + (past ? ' b-past' : '') + (cancelled ? ' b-cancel' : '') + '" onclick="openSession(\'' + esc(s.id) + '\')">' +
    '<div class="b-date' + (isToday ? ' today' : '') + '"><b>' + d.getDate() + '</b><span>' + (d.getMonth() + 1) + '월 ' + WD[d.getDay()] + '</span></div>' +
    '<div class="b-info"><b>' + esc(sessionName(s)) + '</b><span>' + esc(timePlace(s) || '시간·장소 미정') + '</span></div>' +
    '<div class="b-side">' + side + '</div></button>';
}

// ---------------------------------------------------------------------
// 모임 회차 만들기 (교관 이상)
// ---------------------------------------------------------------------
function toggleCreate() {
  var f = $('createForm'), open = f.style.display === 'none';
  f.style.display = open ? 'block' : 'none';
  $('createChev').classList.toggle('open', open);
  if (open && !$('cDate').value) $('cDate').value = todayStr();
}
function fillTypeSelect() {
  var sel = $('cType'), keep = sel.value;
  sel.innerHTML = '<option value="">모임 유형을 고르세요</option>' + S.types.map(function (t) {
    return '<option value="' + esc(t.id) + '">' + esc(t.name) + (t.target_desc ? ' (' + esc(t.target_desc) + ')' : '') + '</option>';
  }).join('');
  sel.value = keep;
}
function applyTypeDefaults() {
  var t = S.types.filter(function (x) { return x.id === $('cType').value; })[0];
  if (!t) return;
  if (t.default_start && !$('cStart').value) $('cStart').value = hm(t.default_start);
  if (t.default_end && !$('cEnd').value) $('cEnd').value = hm(t.default_end);
  if (t.default_location && !$('cPlace').value) $('cPlace').value = t.default_location;
}
function createSession() {
  var p = {
    team_id: S.team.id,
    meeting_type_id: $('cType').value || null,
    title: $('cTitle').value.trim() || null,
    session_date: $('cDate').value,
    start_time: $('cStart').value || null,
    end_time: $('cEnd').value || null,
    location: $('cPlace').value.trim() || null
  };
  if (!p.meeting_type_id && !p.title) { setMsg('cMsg', '모임 유형을 고르거나 제목을 적어주세요!', true); return; }
  if (!p.session_date) { setMsg('cMsg', '날짜를 골라주세요!', true); return; }
  if (p.start_time && p.end_time && p.end_time <= p.start_time) { setMsg('cMsg', '끝나는 시간이 시작보다 늦어야 해요!', true); return; }
  var btn = $('cBtn'); btn.disabled = true; setMsg('cMsg', '만드는 중...');
  api('sessions.create', p).then(function (s) {
    S.sessions.push(s);
    S.sessions.sort(function (a, b) { return a.session_date < b.session_date ? -1 : a.session_date > b.session_date ? 1 : 0; });
    S.att[s.id] = [];
    ['cTitle', 'cStart', 'cEnd', 'cPlace'].forEach(function (id) { $(id).value = ''; });
    $('cType').value = '';
    setMsg('cMsg', '만들었어요!');
    haptic('success');
    btn.disabled = false;
    showList();
    setTimeout(function () { setMsg('cMsg', ''); toggleCreate(); }, 900);
  }).catch(function (err) { setMsg('cMsg', err.message, true); haptic('error'); btn.disabled = false; });
}

// ---------------------------------------------------------------------
// 모임 하나 (내 출결 + 조장 이상 현황)
// ---------------------------------------------------------------------
function openSession(id) {
  var s = S.sessions.filter(function (x) { return x.id === id; })[0];
  if (!s) return;
  S.current = s;
  $('listView').style.display = 'none';
  $('detailView').style.display = 'block';
  var d = parseDate(s.session_date);
  $('dHead').innerHTML = '<div class="b-dhead"><h1>' + esc(sessionName(s)) + '</h1><p>' +
    (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')' + (timePlace(s) ? ' · ' + esc(timePlace(s)) : '') +
    (s.status === '취소' ? ' · <b>취소된 모임</b>' : '') + '</p></div>';

  var mine = myRow(s.id);
  var st = (mine && mine.status) || '참석';
  document.querySelectorAll('input[name="st"]').forEach(function (r) { r.checked = r.value === st; });
  $('reason').value = (mine && mine.reason) || '';
  $('saveBtn').textContent = mine ? '출결 수정' : '출결 제출';
  $('saveBtn').disabled = s.status === '취소';
  setMsg('myMsg', mine ? '제출한 내용이에요. 바꾸려면 고치고 다시 눌러주세요.' : '');

  var lead = S.team.rank >= RANK.GROUP_LEADER;
  $('boardWrap').style.display = lead ? 'block' : 'none';
  if (lead) loadBoard();
  window.scrollTo(0, 0);
}

function saveMine() {
  var s = S.current; if (!s) return;
  var status = document.querySelector('input[name="st"]:checked').value;
  var reason = $('reason').value.trim();
  if (status !== '참석' && !reason) { setMsg('myMsg', status + ' 사유를 적어주세요!', true); return; }
  var btn = $('saveBtn'); btn.disabled = true; setMsg('myMsg', '저장 중...');
  api('attendance.saveMine', { session_id: s.id, status: status, reason: reason || null }).then(function (row) {
    upsertAtt(s.id, row);
    setMsg('myMsg', '저장했어요! 수고하셨어요 🙌');
    $('saveBtn').textContent = '출결 수정';
    haptic('success');
    btn.disabled = false;
    if (S.team.rank >= RANK.GROUP_LEADER) renderBoard();
  }).catch(function (err) { setMsg('myMsg', err.message, true); haptic('error'); btn.disabled = false; });
}

function upsertAtt(sessionId, row) {
  var rows = S.att[sessionId] || (S.att[sessionId] = []);
  for (var i = 0; i < rows.length; i++) if (rows[i].person_id === row.person_id) { rows[i] = Object.assign({}, rows[i], row); return; }
  rows.push(row);
}

// ----- 출결 현황 (조장 이상) -----
function loadBoard() {
  $('board').innerHTML = '<div class="b-group-sep">불러오는 중...</div>';
  var p = S.members ? Promise.resolve(S.members) : api('team.members', { team_id: S.team.id }).then(function (m) { S.members = m; return m; });
  p.then(renderBoard).catch(function (err) { $('board').innerHTML = '<div class="b-group-sep">' + esc(err.message) + '</div>'; });
}

function renderBoard() {
  var s = S.current; if (!s || !S.members) return;
  var rows = S.att[s.id] || [];
  var byPerson = {};
  rows.forEach(function (r) { byPerson[r.person_id] = r; });
  var done = S.members.filter(function (m) { return byPerson[m.id] && byPerson[m.id].status; }).length;
  $('boardCount').textContent = '제출 ' + done + ' / ' + S.members.length + '명';

  var html = '', lastGroup = '§';
  S.members.forEach(function (m) {
    var g = m.group || '조 배정 없음';
    if (g !== lastGroup) { html += '<div class="b-group-sep">' + esc(g) + '</div>'; lastGroup = g; }
    var r = byPerson[m.id];
    var cur = (r && r.status) || '';
    html += '<div class="b-prow" id="row-' + esc(m.id) + '">' +
      '<div class="nm"><b>' + esc(m.name) + '</b><span>' + esc(m.position || '') + '</span></div>' +
      '<div class="select-wrap"><select onchange="saveFor(\'' + esc(m.id) + '\', this.value)"' + (s.status === '취소' ? ' disabled' : '') + '>' +
        '<option value=""' + (cur ? '' : ' selected') + ' disabled>미제출</option>' +
        STATUSES.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + '>' + v + '</option>'; }).join('') +
      '</select></div>' +
      (r && r.reason ? '<div class="rs">' + esc(r.reason) + '</div>' : '') +
    '</div>';
  });
  $('board').innerHTML = html || '<div class="b-group-sep">팀원이 없어요</div>';
}

function saveFor(personId, status) {
  var s = S.current; if (!s || !status) return;
  var el = $('row-' + personId); if (el) el.classList.add('saving');
  api('attendance.saveFor', { session_id: s.id, person_id: personId, status: status }).then(function (row) {
    upsertAtt(s.id, row);
    haptic('success');
    renderBoard();
    if (personId === S.me.profile.id) openSessionKeepBoard();
  }).catch(function (err) {
    alertMsg(err.message);
    renderBoard();
  });
}
function openSessionKeepBoard() {
  var mine = myRow(S.current.id);
  if (!mine) return;
  document.querySelectorAll('input[name="st"]').forEach(function (r) { r.checked = r.value === mine.status; });
}
function alertMsg(m) { try { if (tg && tg.showAlert) { tg.showAlert(m); return; } } catch (e) {} alert(m); }

// =====================================================================
// 하단 탭
// =====================================================================
var curTab = 'attend';
function goTab(t) {
  if (t === curTab) return;
  if (curTab === 'weekly' && W.dirty && !confirm('저장하지 않은 칸이 있어요. 그래도 넘어갈까요?')) return;
  curTab = t;
  document.querySelectorAll('#tabbar .tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === t); });
  var weekly = t === 'weekly';
  $('weeklyView').style.display = weekly ? 'block' : 'none';
  $('teamTabs').style.display = !weekly && S.me && S.me.teams.length > 1 ? 'flex' : 'none';
  if (weekly) {
    $('listView').style.display = 'none';
    $('detailView').style.display = 'none';
    $('stateBox').style.display = 'none';
    S.current = null;
    try { if (tg && tg.BackButton) tg.BackButton.hide(); } catch (e) {}
    if (!W.data) openWeekly('next');
  } else {
    showList();
  }
  window.scrollTo(0, 0);
}

// =====================================================================
// 주간 녹음가능 (월~일, 30분 칸. 칸 번호 0 = 00:00~00:30 … 47 = 23:30~24:00)
// =====================================================================
var W = {
  which: 'next', data: null, mine: {}, dirty: false,
  view: 'mine', board: null, team: '', sel: '', fixed: [], fixedOpen: false
};
var FX_DAYS = [[1, '월'], [2, '화'], [3, '수'], [4, '목'], [5, '금'], [6, '토'], [0, '일']];

function mondayOf(which) {
  var d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));     // 이번 주 월요일
  if (which === 'next') d.setDate(d.getDate() + 7);
  return ymd(d);
}
function pad2(n) { return ('0' + n).slice(-2); }
function slotHm(s) { return pad2(Math.floor(s / 2)) + ':' + (s % 2 ? '30' : '00'); }
function shortD(s) { var d = parseDate(s); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')'; }
function markWkDirty() { W.dirty = true; $('wkSaveBtn').classList.add('dirty'); }

function openWeekly(which) {
  if (W.dirty && W.which !== which && !confirm('저장하지 않은 칸이 있어요. 그래도 넘어갈까요?')) return;
  W.which = which; W.dirty = false; W.board = null; W.sel = ''; W.team = '';
  document.querySelectorAll('.wk-which').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-wk') === which); });
  $('wkTitle').textContent = '불러오는 중...';
  $('wkMeta').textContent = '';
  $('wkGrid').innerHTML = '';
  $('wkQuick').innerHTML = '';
  setMsg('wkMsg', '');
  var ws = mondayOf(which);
  api('weekly.load', { week_start: ws }).then(function (d) {
    if (W.which !== which) return;   // 그새 다른 주를 눌렀으면 무시
    W.data = d; W.mine = {};
    Object.keys(d.mine.slots).forEach(function (di) { d.mine.slots[di].forEach(function (s) { W.mine[di + '-' + s] = true; }); });
    $('wkMemo').value = d.mine.memo || '';
    W.fixed = groupFixedRows(d.fixed);
    $('wkViewTabs').style.display = d.can_view ? 'flex' : 'none';
    switchWk('mine');
    if (!d.mine.submitted) setMsg('wkMsg', which === 'next'
      ? '가능한 칸을 칠하고 저장하면 제출돼요. 되는 시간이 없으면 빈 채로 저장해도 돼요.'
      : '이번 주도 바뀐 일정이 있으면 고쳐서 저장해주세요.');
  }).catch(function (err) {
    $('wkTitle').textContent = '불러오지 못했어요';
    $('wkMeta').textContent = err.message;
  });
}

function switchWk(v) {
  W.view = v;
  document.querySelectorAll('.wk-view').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-v') === v); });
  $('wkMine').style.display = v === 'mine' ? 'block' : 'none';
  $('wkResult').style.display = v === 'result' ? 'block' : 'none';
  $('fxCard').style.display = v === 'mine' ? 'block' : 'none';
  renderWkHead();
  if (v === 'mine') { renderWkQuick(); renderWkGrid(); renderFx(); }
  else loadWkBoard();
}

function renderWkHead() {
  var d = W.data; if (!d) return;
  $('wkTitle').textContent = (W.which === 'next' ? '다음 주 ' : '이번 주 ') + shortD(d.dates[0]) + ' ~ ' + shortD(d.dates[6]);
  var due = parseDate(d.week_start); due.setDate(due.getDate() - 1); due.setHours(22, 0, 0, 0);
  var late = !d.mine.submitted && Date.now() > due.getTime();
  $('wkMeta').innerHTML = (d.mine.submitted ? '<span class="chip dark">제출 완료</span> '
      : '<span class="chip' + (late ? ' bad' : '') + '">' + (late ? '미제출 · 마감 지남' : '미제출') + '</span> ') +
    '마감 ' + (due.getMonth() + 1) + '/' + due.getDate() + '(' + WD[due.getDay()] + ') 22:00';
}

function renderWkQuick() {
  var h = '';
  if (W.data.prev.has) h += '<button type="button" class="qbtn main" onclick="copyPrevWeek()">↺ 지난주와 같아요</button>';
  h += '<button type="button" class="qbtn" onclick="openFx()">⚙ 고정 일정 ' + (W.fixed.length ? '수정' : '설정') + '</button>';
  $('wkQuick').innerHTML = h;
}

function copyPrevWeek() {
  var p = W.data.prev;
  if (Object.keys(W.mine).length && !confirm('지금 칠한 칸을 지우고 지난주 입력으로 바꿀까요?')) return;
  W.mine = {};
  Object.keys(p.slots).forEach(function (di) { p.slots[di].forEach(function (s) { W.mine[di + '-' + s] = true; }); });
  if (!$('wkMemo').value.trim() && p.memo) $('wkMemo').value = p.memo;
  markWkDirty();
  renderWkGrid();
  setMsg('wkMsg', '지난주 입력을 불러왔어요. 바뀐 곳만 고치고 저장을 눌러주세요.');
}

// 그 칸(날짜·30분)에 걸리는 고정 일정 이름
function busyLabel(di, s) {
  if (!W.data || s < 0) return '';
  var wd = parseDate(W.data.dates[di]).getDay();
  var from = slotHm(s), to = slotHm(s + 1);
  for (var i = 0; i < W.fixed.length; i++) {
    var f = W.fixed[i];
    if (f.weekdays.indexOf(wd) !== -1 && f.start < (to === '00:00' ? '24:00' : to) && f.end > from) return f.title;
  }
  return '';
}

function gridHead(dates) {
  return '<div></div>' + dates.map(function (s) {
    var d = parseDate(s), w = d.getDay();
    return '<div class="gh' + (w === 0 ? ' sun' : w === 6 ? ' sat' : '') + '"><b>' + (d.getMonth() + 1) + '/' + d.getDate() + '</b>' + WD[w] + '</div>';
  }).join('');
}

function renderWkGrid() {
  var d = W.data, h = d.hours, anyBusy = false;
  var html = '<div class="tgrid half" style="grid-template-columns: 34px repeat(7, 1fr);">' + gridHead(d.dates);
  for (var s = h.from * 2; s < h.to * 2; s++) {
    var top = s % 2 === 0;
    html += '<div class="gt' + (top ? ' hr' : '') + '">' + (top ? (s / 2) + '시' : '') + '</div>';
    for (var di = 0; di < 7; di++) {
      var key = di + '-' + s;
      var bl = busyLabel(di, s);
      if (bl) anyBusy = true;
      var blTop = bl && bl !== busyLabel(di, s - 1);
      html += '<div class="gc' + (top ? ' hr' : '') + (W.mine[key] ? ' on' : '') + (bl ? ' busy' : '') + '" data-k="' + key + '"' +
        (bl ? ' title="' + esc(bl) + '"' : '') + '>' + (blTop ? '<span class="bl">' + esc(bl) + '</span>' : '') + '</div>';
    }
  }
  html += '</div>';
  $('wkGrid').innerHTML = html;
  $('wkBusyLegend').style.display = anyBusy ? 'flex' : 'none';
  bindPaint($('wkGrid').firstChild);
}

// 칸 칠하기
// - 손가락: 탭 = 한 칸, 꾹(0.3초) 누른 채 쓸기 = 여러 칸, 그냥 쓸기 = 화면 스크롤
// - 마우스: 누른 채 끌면 바로 칠하기
function bindPaint(grid) {
  var mode = null, hold = null, sx = 0, sy = 0, startEl = null;
  function cellAt(x, y) {
    var el = document.elementFromPoint(x, y);
    if (el && el.classList && el.classList.contains('bl')) el = el.parentNode;
    return el && el.classList && el.classList.contains('gc') && grid.contains(el) ? el : null;
  }
  function paint(el) {
    if (!el) return;
    var k = el.getAttribute('data-k');
    if (!!W.mine[k] === mode) return;
    if (mode) W.mine[k] = true; else delete W.mine[k];
    el.classList.toggle('on', mode);
    markWkDirty();
  }
  function begin(el) { mode = !W.mine[el.getAttribute('data-k')]; paint(el); grid.classList.add('painting'); }
  function end() { clearTimeout(hold); hold = null; startEl = null; mode = null; grid.classList.remove('painting'); }
  grid.addEventListener('pointerdown', function (e) {
    var el = cellAt(e.clientX, e.clientY);
    if (!el) return;
    if (e.pointerType === 'mouse') { e.preventDefault(); begin(el); return; }
    sx = e.clientX; sy = e.clientY; startEl = el;
    hold = setTimeout(function () {
      hold = null;
      if (!startEl) return;
      try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light'); } catch (x) {}
      begin(startEl);
    }, 300);
  });
  grid.addEventListener('pointermove', function (e) {
    if (mode !== null) { paint(cellAt(e.clientX, e.clientY)); return; }
    if (hold && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) { clearTimeout(hold); hold = null; startEl = null; }
  });
  grid.addEventListener('pointerup', function () {
    if (hold && startEl) { clearTimeout(hold); hold = null; mode = !W.mine[startEl.getAttribute('data-k')]; paint(startEl); }
    end();
  });
  grid.addEventListener('pointercancel', end);
  grid.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') end(); });
  grid.addEventListener('touchmove', function (e) { if (mode !== null && e.cancelable) e.preventDefault(); }, { passive: false });
  grid.addEventListener('contextmenu', function (e) { e.preventDefault(); });
}

function clearWk() {
  if (!Object.keys(W.mine).length) return;
  W.mine = {}; markWkDirty(); renderWkGrid();
}

function saveWk() {
  var d = W.data; if (!d) return;
  var slots = {};
  Object.keys(W.mine).forEach(function (k) {
    var p = k.split('-');
    (slots[p[0]] = slots[p[0]] || []).push(+p[1]);
  });
  var memo = $('wkMemo').value.trim();
  var btn = $('wkSaveBtn'); btn.disabled = true; setMsg('wkMsg', '저장 중...');
  api('weekly.save', { week_start: d.week_start, slots: slots, memo: memo }).then(function (r) {
    W.dirty = false; btn.classList.remove('dirty'); btn.disabled = false;
    d.mine.submitted = true; d.mine.memo = memo;
    W.board = null;
    renderWkHead();
    haptic('success');
    setMsg('wkMsg', r.count ? r.count + '칸 저장했어요! 마감 전까지 언제든 고칠 수 있어요.'
      : (memo ? '특이사항을 저장했어요.' : '가능한 시간이 없다고 저장했어요.'));
  }).catch(function (err) { btn.disabled = false; setMsg('wkMsg', err.message, true); haptic('error'); });
}

// ----- 모아보기 (조장 이상) -----
function loadWkBoard() {
  if (W.board) { renderWkResult(); return; }
  $('wkBest').innerHTML = '<div class="empty inner"><b>불러오는 중...</b></div>';
  $('wkResGrid').innerHTML = ''; $('wkMemos').innerHTML = ''; $('wkWho').innerHTML = ''; $('wkTeamChips').innerHTML = '';
  api('weekly.board', { week_start: W.data.week_start }).then(function (b) {
    W.board = b; renderWkResult();
  }).catch(function (err) { $('wkBest').innerHTML = '<div class="empty inner"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function pickWkTeam(t) { W.team = t; W.sel = ''; renderWkResult(); }
function pickCell(k) { W.sel = W.sel === k ? '' : k; renderWkResult(); }

function renderWkResult() {
  var b = W.board, h = b.hours;
  var chips = b.teams.length > 1 ? [''].concat(b.teams) : [];
  $('wkTeamChips').style.display = chips.length ? 'flex' : 'none';
  $('wkTeamChips').innerHTML = chips.map(function (t) {
    return '<button type="button" class="wkchip' + (t === W.team ? ' active' : '') + '" onclick="pickWkTeam(\'' + esc(t) + '\')">' + (t ? esc(t) : '전체') + '</button>';
  }).join('');

  var ppl = W.team ? b.people.filter(function (p) { return p.teams.indexOf(W.team) !== -1; }) : b.people;
  var total = ppl.length;
  var who = {};   // 'di-s' → [이름…]
  ppl.forEach(function (p) {
    Object.keys(p.slots).forEach(function (di) { p.slots[di].forEach(function (s) { (who[di + '-' + s] = who[di + '-' + s] || []).push(p.name); }); });
  });

  // 같은 사람들이 되는 연속 칸은 하나로 묶어서 '가장 많이 되는 시간' 3개
  var runs = [];
  for (var di = 0; di < 7; di++) {
    var cur = null;
    for (var s = h.from * 2; s < h.to * 2; s++) {
      var set = (who[di + '-' + s] || []).slice().sort().join(',');
      if (cur && set && cur.set === set) { cur.end = s + 1; continue; }
      if (cur) runs.push(cur);
      cur = set ? { di: di, start: s, end: s + 1, set: set, n: set.split(',').length } : null;
    }
    if (cur) runs.push(cur);
  }
  runs.sort(function (x, y) { return y.n - x.n || (y.end - y.start) - (x.end - x.start) || x.di - y.di || x.start - y.start; });
  $('wkBest').innerHTML = runs.length
    ? '<div class="best"><h3>가장 많이 되는 시간</h3><ol>' + runs.slice(0, 3).map(function (r) {
        return '<li>' + shortD(b.dates[r.di]) + ' ' + slotHm(r.start) + '~' + slotHm(r.end) + ' <small>' + r.n + '/' + total + '명' + (r.n === total ? ' · 전원 가능 ✨' : '') + '</small></li>';
      }).join('') + '</ol></div>'
    : '<div class="empty inner"><b>아직 입력한 사람이 없어요</b>입력이 들어오면 여기에 모여요</div>';

  var html = '<div class="tgrid res half" style="grid-template-columns: 34px repeat(7, 1fr);">' + gridHead(b.dates);
  for (var s2 = h.from * 2; s2 < h.to * 2; s2++) {
    var top = s2 % 2 === 0;
    html += '<div class="gt' + (top ? ' hr' : '') + '">' + (top ? (s2 / 2) + '시' : '') + '</div>';
    for (var d2 = 0; d2 < 7; d2++) {
      var key = d2 + '-' + s2, n = (who[key] || []).length;
      var a = n && total ? 0.15 + 0.85 * n / total : 0;
      html += '<div class="gc' + (top ? ' hr' : '') + (n === total && n > 0 ? ' full' : '') + (W.sel === key ? ' sel' : '') + '"' +
        (n ? ' style="background: rgba(79,78,48,' + a.toFixed(2) + '); border-color: transparent;' + (a > 0.55 ? ' color:#fff;' : '') + '"' : '') +
        ' onclick="pickCell(\'' + key + '\')">' + (n || '') + '</div>';
    }
  }
  $('wkResGrid').innerHTML = html + '</div>';

  if (W.sel) {
    var p2 = W.sel.split('-'), yes = who[W.sel] || [];
    var no = ppl.filter(function (p) { return p.answered && yes.indexOf(p.name) === -1; }).map(function (p) { return p.name; });
    $('wkCellInfo').innerHTML = '<b>' + shortD(b.dates[+p2[0]]) + ' ' + slotHm(+p2[1]) + '~' + slotHm(+p2[1] + 1) + '</b><br>가능 ' + yes.length + '명: ' +
      (yes.length ? esc(yes.join(', ')) : '없음') + (no.length ? '<br>안 됨: ' + esc(no.join(', ')) : '');
  } else $('wkCellInfo').textContent = '칸을 누르면 누가 되는지 보여요';

  var memos = ppl.filter(function (p) { return p.memo; });
  $('wkMemos').innerHTML = memos.length
    ? '<div class="memo-list"><h3>📝 특이사항</h3>' + memos.map(function (p) { return '<div><b>' + esc(p.name) + '</b>' + esc(p.memo) + '</div>'; }).join('') + '</div>' : '';
  var wait = ppl.filter(function (p) { return !p.answered; }).map(function (p) { return p.name; });
  $('wkWho').innerHTML = wait.length
    ? '<div class="who-row">아직 입력 전 <b>' + wait.length + '명</b>: ' + esc(wait.join(', ')) + '</div>'
    : '<div class="who-row"><b>모두 입력했어요 🎉</b></div>';
}

// ----- 고정 일정 -----
function groupFixedRows(rows) {
  var map = {}, out = [];
  (rows || []).forEach(function (r) {
    var st = hm(r.start_time), en = hm(r.end_time), k = r.title + '|' + st + '|' + en;
    if (!map[k]) { map[k] = { title: r.title, weekdays: [], start: st, end: en }; out.push(map[k]); }
    if (map[k].weekdays.indexOf(r.weekday) === -1) map[k].weekdays.push(r.weekday);
  });
  return out;
}
function toggleFx() {
  W.fixedOpen = !W.fixedOpen;
  $('fxBody').style.display = W.fixedOpen ? 'block' : 'none';
  $('fxChev').classList.toggle('open', W.fixedOpen);
  if (W.fixedOpen) renderFx();
}
function openFx() {
  if (!W.fixedOpen) toggleFx();
  $('fxCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function timeOptions(sel) {
  var h = '';
  for (var s = 0; s <= 48; s++) { var v = s === 48 ? '24:00' : slotHm(s); h += '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + v + '</option>'; }
  return h;
}
function renderFx() {
  if (!W.fixedOpen) return;
  var box = $('fxList');
  if (!W.fixed.length) { box.innerHTML = '<div class="empty inner"><b>아직 고정 일정이 없어요</b>예) 직장 월~금 09:00~18:00</div>'; return; }
  box.innerHTML = W.fixed.map(function (f, i) {
    return '<div class="fx-item"><div class="fx-top"><input type="text" class="b-input" maxlength="20" value="' + esc(f.title) + '" placeholder="직장" oninput="W.fixed[' + i + '].title=this.value">' +
      '<button type="button" class="fx-del" onclick="delFx(' + i + ')">삭제</button></div>' +
      '<div class="fx-days">' + FX_DAYS.map(function (d) {
        return '<button type="button" class="fx-day' + (f.weekdays.indexOf(d[0]) !== -1 ? ' on' : '') + '" onclick="fxDay(' + i + ',' + d[0] + ')">' + d[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="range-row"><div class="select-wrap"><select onchange="W.fixed[' + i + '].start=this.value">' + timeOptions(f.start) + '</select></div><span>~</span>' +
      '<div class="select-wrap"><select onchange="W.fixed[' + i + '].end=this.value">' + timeOptions(f.end) + '</select></div></div></div>';
  }).join('');
}
function fxDay(i, d) { var a = W.fixed[i].weekdays, k = a.indexOf(d); if (k === -1) a.push(d); else a.splice(k, 1); renderFx(); }
function addFx() {
  if (W.fixed.length >= 8) { setMsg('fxMsg', '8개까지 넣을 수 있어요', true); return; }
  W.fixed.push(W.fixed.length ? { title: '', weekdays: [], start: '19:00', end: '21:00' }
    : { title: '직장', weekdays: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' });
  renderFx();
}
function delFx(i) { W.fixed.splice(i, 1); renderFx(); }
function saveFx() {
  for (var i = 0; i < W.fixed.length; i++) {
    var f = W.fixed[i];
    if (!String(f.title).trim()) { setMsg('fxMsg', (i + 1) + '번째 일정 이름을 적어주세요 (예: 직장)', true); return; }
    if (!f.weekdays.length) { setMsg('fxMsg', '\'' + f.title + '\' 요일을 골라주세요', true); return; }
    if (f.start >= f.end) { setMsg('fxMsg', '\'' + f.title + '\' 끝나는 시간이 시작보다 늦어야 해요', true); return; }
  }
  var btn = $('fxSaveBtn'); btn.disabled = true; setMsg('fxMsg', '저장 중...');
  api('fixed.save', { list: W.fixed }).then(function (list) {
    W.fixed = list; btn.disabled = false; haptic('success');
    renderFx(); renderWkQuick(); renderWkGrid();
    setMsg('fxMsg', '저장했어요! 칠하는 화면에 음영으로 보여요.');
  }).catch(function (err) { btn.disabled = false; setMsg('fxMsg', err.message, true); });
}

// 텔레그램 뒤로가기 버튼: 모임 상세에서 누르면 목록으로
if (tg && tg.BackButton) {
  tg.BackButton.onClick(function () { if (S.current) showList(); });
  var _open = openSession, _list = showList;
  openSession = function (id) { _open(id); try { tg.BackButton.show(); } catch (e) {} };
  showList = function () { _list(); try { tg.BackButton.hide(); } catch (e) {} };
}

boot();
