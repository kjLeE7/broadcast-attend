// =====================================================================
// 방송예술과 미니앱 베타 — Supabase(문지기 api)만 사용
// 기존 앱(../app.js, 구글시트)과는 완전히 분리되어 있음.
// 텔레그램 미니앱으로 열면 initData로, PC 브라우저로 열면 '텔레그램으로 로그인' 버튼으로 확인.
// =====================================================================
var API = 'https://bundxpidywrcrwhhgclv.supabase.co/functions/v1/api';
var RANK = { MEMBER: 10, GROUP_LEADER: 20, INSTRUCTOR: 30, TEAM_LEADER: 40 };
var WD = ['일', '월', '화', '수', '목', '금', '토'];
var STATUSES = ['참석', '불참', '지각', '조퇴'];

var tg = (window.Telegram && Telegram.WebApp) ? Telegram.WebApp : null;
var initData = tg ? (tg.initData || '') : '';
var LOGIN_KEY = 'beta_tg_login';  // PC 브라우저 로그인 정보 (7일 유지)
var loginRaw = '';
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
  var headers = { 'Content-Type': 'application/json' };
  if (initData) headers['x-telegram-init-data'] = initData;
  else if (loginRaw) headers['x-telegram-login'] = loginRaw;
  return fetch(API, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ action: action, payload: payload || {} })
  }).then(function (res) {
    return res.json().then(function (j) {
      if (j.ok) return j.data;
      var e = new Error(j.error || '알 수 없는 오류');
      e.status = res.status;
      // 브라우저 로그인이 만료·위조면 로그인 화면으로
      if (res.status === 401 && !initData && loginRaw) { forgetLogin(); showLogin(e.message); }
      throw e;
    });
  });
}
function isWide() { return window.matchMedia('(min-width: 1000px)').matches; }
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
  $('loginBox').style.display = 'none';
  $('stateBox').style.display = 'block';
  $('stateBox').innerHTML = '<b>' + esc(title) + '</b>' + esc(desc || '');
  ['homeView', 'listView', 'detailView', 'noticeView', 'taskView', 'weeklyView'].forEach(function (id) { $(id).style.display = 'none'; });
}

// ---------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------
function boot() {
  if (!initData) {
    var saved = getLogin();
    if (!saved) { showLogin(); return; }
    loginRaw = loginQuery(saved);
  }
  showState('불러오는 중...', '잠시만 기다려주세요');
  api('me').then(function (me) {
    S.me = me;
    var name = me.profile.name;
    $('avatar').textContent = String(name).slice(-2);
    var top = me.positions.slice().sort(function (a, b) { return (b.rank || 0) - (a.rank || 0); })[0];
    $('who').textContent = name + '님' + (top ? ' · ' + top.unit + ' ' + top.position : '');
    if (!me.teams.length) { showState('아직 소속 팀이 없어요', '팀장님께 팀 배정을 요청해주세요'); return; }
    $('tabbar').classList.remove('b-off');
    document.body.classList.add('b-nav');
    renderTeamTabs();
    if (curTab === 'home') $('teamTabs').style.display = 'none';
    selectTeam(me.teams[0].id);
  }).catch(function (err) {
    if (err.status === 401 && !initData) return;   // 로그인 화면으로 이미 넘어감
    showState('들어갈 수 없어요', err.message + (initData ? '' : ' (다른 텔레그램 계정이면 오른쪽 위 동그라미를 눌러 로그아웃)'));
  });
}

// ---------------------------------------------------------------------
// PC 브라우저 로그인 (텔레그램 로그인 버튼)
// ---------------------------------------------------------------------
function getLogin() { try { return JSON.parse(localStorage.getItem(LOGIN_KEY) || 'null'); } catch (e) { return null; } }
function forgetLogin() { loginRaw = ''; try { localStorage.removeItem(LOGIN_KEY); } catch (e) {} }
function loginQuery(u) {
  // 텔레그램이 준 값을 그대로 (서버가 이 값들로 서명을 다시 계산함)
  var q = new URLSearchParams();
  Object.keys(u).forEach(function (k) { if (u[k] !== undefined && u[k] !== null) q.append(k, String(u[k])); });
  return q.toString();
}
function showLogin(msg) {
  ['stateBox', 'homeView', 'listView', 'detailView', 'weeklyView', 'noticeView', 'taskView', 'teamTabs'].forEach(function (id) { $(id).style.display = 'none'; });
  $('tabbar').classList.add('b-off');
  document.body.classList.remove('b-nav');
  $('who').textContent = '게스트';
  $('avatar').textContent = '?';
  $('loginBox').style.display = 'block';
  setMsg('loginMsg', msg || '', !!msg);
  if ($('tgWidget').getAttribute('data-ready')) return;
  api('public.bot').then(function (b) {
    if (!b.username) throw new Error('봇 정보를 가져오지 못했어요');
    var sc = document.createElement('script');
    sc.async = true;
    sc.src = 'https://telegram.org/js/telegram-widget.js?22';
    sc.setAttribute('data-telegram-login', b.username);
    sc.setAttribute('data-size', 'large');
    sc.setAttribute('data-radius', '14');
    sc.setAttribute('data-onauth', 'onTgAuth(user)');
    $('tgWidget').innerHTML = '';
    $('tgWidget').appendChild(sc);
    $('tgWidget').setAttribute('data-ready', '1');
  }).catch(function (err) { $('tgWidget').innerHTML = '<span class="b-wait">' + esc(err.message) + '</span>'; });
}
window.onTgAuth = function (user) {
  try { localStorage.setItem(LOGIN_KEY, JSON.stringify(user)); } catch (e) {}
  loginRaw = loginQuery(user);
  $('loginBox').style.display = 'none';
  boot();
};
function onAvatar() {
  if (initData || !loginRaw) return;  // 미니앱에선 로그아웃 없음
  if (!confirm('로그아웃할까요? 다음에 다시 텔레그램으로 로그인해야 해요.')) return;
  forgetLogin();
  location.reload();
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
  N.list = null; A.list = null; A.current = null; C.list = []; dashData = null;
  document.querySelectorAll('#teamTabs .subtab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-team') === id); });
  showState('불러오는 중...', S.team.name + ' 정보를 가져오고 있어요');
  loadTeam().then(function () {
    $(VIEWS[curTab]).style.display = '';
    if (curTab === 'attend') showList(); else { $('stateBox').style.display = 'none'; refreshTab(); }
  }).catch(function (err) { showState('불러오지 못했어요', err.message); });
}

function loadTeam() {
  var jobs = [
    api('sessions.list', { team_id: S.team.id, from: addDays(-14), to: addDays(60) }),
    api('checkins.list', { team_id: S.team.id }),
    api('team.groups', { team_id: S.team.id }),
    S.team.rank >= RANK.INSTRUCTOR ? api('meeting_types.list', { team_id: S.team.id }) : Promise.resolve([])
  ];
  return Promise.all(jobs).then(function (r) {
    S.sessions = r[0] || [];
    C.list = r[1] || [];
    S.groups = r[2] || [];
    S.types = r[3] || [];
    fillTargets();
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
  $('attendWrap').classList.remove('split');
  $('createCard').style.display = S.team.rank >= RANK.INSTRUCTOR ? 'block' : 'none';
  $('ciCreateCard').style.display = S.team.rank >= RANK.INSTRUCTOR ? 'block' : 'none';
  if (S.team.rank >= RANK.INSTRUCTOR) fillTypeSelect();
  renderList();
  renderCheckins();
  window.scrollTo(0, 0);
}

function renderList() {
  var today = todayStr();
  var up = S.sessions.filter(function (s) { return s.session_date >= today; });
  var past = S.sessions.filter(function (s) { return s.session_date < today; }).reverse();
  $('upCount').textContent = up.length ? up.length + '개' : '';
  $('upList').innerHTML = up.length ? up.map(sessionCard).join('')
    : '<div class="empty"><b>예정된 모임이 없어요</b>' + (S.team.rank >= RANK.INSTRUCTOR ? '위에서 새로 만들 수 있어요' : '모임이 잡히면 여기에 보여요') + '</div>';
  $('pastList').innerHTML = past.length ? past.map(sessionCard).join('')
    : '<div class="empty"><b>최근 지난 모임이 없어요</b></div>';
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
  var selected = S.current && S.current.id === s.id;
  return '<button class="b-session' + (past ? ' b-past' : '') + (cancelled ? ' b-cancel' : '') + (selected ? ' b-sel' : '') + '" onclick="openSession(\'' + esc(s.id) + '\')">' +
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
  var wide = isWide();   // 넓은 화면: 목록은 두고 오른쪽에 상세
  $('listView').style.display = wide ? 'block' : 'none';
  $('attendWrap').classList.toggle('split', wide);
  if (wide) renderList();
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
  if (!wide) window.scrollTo(0, 0);
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
    if ($('attendWrap').classList.contains('split')) renderList();
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
    if ($('attendWrap').classList.contains('split')) renderList();
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
var curTab = 'home';
var VIEWS = { home: 'homeView', attend: 'attendWrap', notice: 'noticeView', task: 'taskView', weekly: 'weeklyView' };
function goTab(t) {
  if (t === curTab) return;
  if (curTab === 'weekly' && W.dirty && !confirm('저장하지 않은 칸이 있어요. 그래도 넘어갈까요?')) return;
  curTab = t;
  document.querySelectorAll('#tabbar .tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === t); });
  Object.keys(VIEWS).forEach(function (k) { $(VIEWS[k]).style.display = k === t ? '' : 'none'; });
  $('teamTabs').style.display = t !== 'weekly' && t !== 'home' && S.me && S.me.teams.length > 1 ? 'flex' : 'none';
  $('stateBox').style.display = 'none';
  S.current = null;
  try { if (tg && tg.BackButton) tg.BackButton.hide(); } catch (e) {}
  refreshTab();
  window.scrollTo(0, 0);
}
// 지금 탭의 내용을 (팀이 바뀌었으면 새로) 그림
function refreshTab() {
  if (curTab === 'home') loadDashboard();
  else if (curTab === 'attend') showList();
  else if (curTab === 'notice') loadNotices();
  else if (curTab === 'task') loadTasks();
  else if (curTab === 'weekly' && !W.data) openWeekly('next');
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
  $('wkResult').style.display = v === 'result' ? '' : 'none';
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

// =====================================================================
// 공통: 대상(조) 고르기, 접었다 펴기, 날짜·시간 표시
// =====================================================================
var N = { list: null, open: null };                  // 공지
var A = { list: null, current: null, subs: null, openSub: null };   // 과제
var C = { list: [], open: null };                     // 체크인
S.groups = [];

function toggleBox(formId, chevId) {
  var f = $(formId), open = f.style.display === 'none';
  f.style.display = open ? 'block' : 'none';
  $(chevId).classList.toggle('open', open);
  if (open && formId === 'ciForm' && !$('ciDate').value) $('ciDate').value = todayStr();
}
function fillTargets() {
  var h = '<option value="">팀 전체</option>' + S.groups.map(function (g) {
    return '<option value="' + esc(g.id) + '">' + esc(g.name) + '만</option>';
  }).join('');
  document.querySelectorAll('.b-target').forEach(function (sel) { sel.innerHTML = h; });
}
function groupName(id) { var g = S.groups.filter(function (x) { return x.id === id; })[0]; return g ? g.name : ''; }
function hmOf(iso) { var d = new Date(iso); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function mdOf(iso) { var d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')'; }
function dtLabel(iso) { return mdOf(iso) + ' ' + hmOf(iso); }
function loadMembers() {
  return S.members ? Promise.resolve(S.members)
    : api('team.members', { team_id: S.team.id }).then(function (m) { S.members = m; return m; });
}
// 대상이 특정 조면 그 조 사람만
function targetMembers(targetId) {
  var mem = S.members || [];
  if (!targetId) return mem;
  var gname = groupName(targetId);
  return mem.filter(function (m) { return m.group === gname; });
}
function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

// =====================================================================
// 체크인 (기상·출발·도착) — 출결 탭 위쪽
// =====================================================================
var CI_EMOJI = { '기상': '☀️', '출발': '🚗', '도착': '📍' };

function renderCheckins() {
  if (!S.team) return;
  var today = todayStr(), tmr = addDays(1);
  var mine = C.list.filter(function (c) { return c.check_date === today || c.check_date === tmr; })
    .sort(function (a, b) { return a.check_date < b.check_date ? -1 : 1; });
  $('ciArea').innerHTML = mine.map(ciCard).join('');
  var lead = S.team.rank >= RANK.GROUP_LEADER;
  $('ciBoardWrap').style.display = lead && C.list.length ? 'block' : 'none';
  if (!lead || !C.list.length) return;
  if (S.members) { $('ciBoard').innerHTML = C.list.map(ciBoardCard).join(''); return; }
  $('ciBoard').innerHTML = '<div class="empty inner"><b>불러오는 중...</b></div>';
  loadMembers().then(renderCheckins).catch(function (err) { $('ciBoard').innerHTML = '<div class="empty inner">' + esc(err.message) + '</div>'; });
}

function ciCard(c) {
  var isToday = c.check_date === todayStr();
  return '<div class="ci-card"><div class="ci-head"><span class="hero-chip"><i></i>' +
      (isToday ? '오늘의 체크인' : '내일 체크인 · ' + shortD(c.check_date)) + '</span><b>' + esc(c.title) + '</b></div>' +
    '<div class="ci-btns">' + c.items.map(function (it) {
      var m = c.mine[it];
      return '<button class="ci-btn' + (m ? ' done' : '') + '" onclick="tapCheckin(\'' + esc(c.id) + '\',\'' + it + '\')">' +
        '<span class="ci-emoji">' + CI_EMOJI[it] + '</span><span class="ci-label">' + it + '</span>' +
        '<span class="ci-time">' + (m ? hmOf(m.at) + (m.note ? ' → ' + esc(m.note) : '') : '누르면 기록') + '</span></button>';
    }).join('') + '</div>' +
    '<div class="ci-eta" id="eta-' + esc(c.id) + '" style="display:none;"><label>도착 예정 시간 <small>(모르면 비워두세요)</small></label>' +
      '<div class="ci-eta-row"><input type="time" id="etaIn-' + esc(c.id) + '"><button onclick="sendCheckin(\'' + esc(c.id) + '\',\'출발\')">출발했어요</button></div></div>' +
    '<div class="msg" id="ciMsg-' + esc(c.id) + '"></div>' +
    '<div class="ci-tip">잘못 눌렀으면 기록된 칸을 한 번 더 눌러 지울 수 있어요</div></div>';
}

function tapCheckin(id, item) {
  var c = byId(C.list, id); if (!c) return;
  if (c.mine[item]) {
    if (confirm(item + ' 기록(' + hmOf(c.mine[item].at) + ')을 지울까요?')) unCheckin(id, item);
    return;
  }
  if (item === '출발') { var b = $('eta-' + id); b.style.display = b.style.display === 'none' ? 'block' : 'none'; return; }
  sendCheckin(id, item);
}

function sendCheckin(id, item) {
  var note = '';
  if (item === '출발') { var inp = $('etaIn-' + id); note = inp && inp.value ? inp.value + ' 도착 예정' : ''; }
  setMsg('ciMsg-' + id, '기록 중...');
  api('checkins.report', { checkin_id: id, item: item, note: note }).then(function (r) {
    var c = byId(C.list, id);
    c.mine[item] = { at: r.reported_at, note: r.note };
    if (c.reports) {
      c.reports = c.reports.filter(function (x) { return !(x.person_id === r.person_id && x.item === item); });
      c.reports.push(Object.assign({ name: S.me.profile.name }, r));
    }
    haptic('success');
    renderCheckins();
    setMsg('ciMsg-' + id, CI_EMOJI[item] + ' ' + item + ' ' + hmOf(r.reported_at) + ' 기록했어요!');
  }).catch(function (err) { setMsg('ciMsg-' + id, err.message, true); haptic('error'); });
}

function unCheckin(id, item) {
  api('checkins.unreport', { checkin_id: id, item: item }).then(function () {
    var c = byId(C.list, id);
    delete c.mine[item];
    if (c.reports) c.reports = c.reports.filter(function (x) { return !(x.person_id === S.me.profile.id && x.item === item); });
    renderCheckins();
  }).catch(function (err) { alertMsg(err.message); });
}

function toggleCiBoard(id) { C.open = C.open === id ? null : id; renderCheckins(); }

function ciBoardCard(c) {
  var target = targetMembers(c.target_unit_id);
  var reps = c.reports || [];
  var counts = c.items.map(function (it) {
    var n = reps.filter(function (r) { return r.item === it; }).length;
    return '<span class="chip">' + CI_EMOJI[it] + ' ' + it + ' ' + n + '/' + target.length + '</span>';
  }).join('');
  var open = C.open === c.id;
  var html = '<div class="card ci-board"><div class="ci-board-head" onclick="toggleCiBoard(\'' + esc(c.id) + '\')"><div>' +
    '<div class="ci-board-title">' + esc(c.title) + '</div><div class="b-sub">' + shortD(c.check_date) +
    (c.target_unit_id ? ' · ' + esc(groupName(c.target_unit_id)) + '만' : '') + '</div></div>' +
    '<span class="b-chev' + (open ? ' open' : '') + '">›</span></div><div class="b-chips">' + counts + '</div>';
  if (open) {
    html += '<div class="table-scroll"><table class="sched ci-table"><thead><tr><th>이름</th>' +
      c.items.map(function (it) { return '<th>' + CI_EMOJI[it] + it + '</th>'; }).join('') + '</tr></thead><tbody>' +
      target.map(function (m) {
        return '<tr><td class="c-who"><b>' + esc(m.name) + '</b><span>' + esc(m.group || m.position || '') + '</span></td>' +
          c.items.map(function (it) {
            var r = reps.filter(function (x) { return x.person_id === m.id && x.item === it; })[0];
            return '<td class="' + (r ? 'ci-ok' : 'ci-miss') + '">' + (r ? hmOf(r.reported_at) + (r.note ? '<small>' + esc(r.note) + '</small>' : '') : '–') + '</td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      (S.team.rank >= RANK.INSTRUCTOR ? '<button class="ghost-btn b-danger" onclick="deleteCheckin(\'' + esc(c.id) + '\')">이 체크인 지우기</button>' : '');
  }
  return html + '</div>';
}

function createCheckin() {
  var items = [].slice.call(document.querySelectorAll('#ciItems input:checked')).map(function (x) { return x.value; });
  var p = { team_id: S.team.id, title: $('ciTitle').value.trim(), check_date: $('ciDate').value, items: items, target_unit_id: $('ciTarget').value || null };
  if (!p.title) { setMsg('ciMsg', '제목을 적어주세요!', true); return; }
  if (!p.check_date) { setMsg('ciMsg', '날짜를 골라주세요!', true); return; }
  if (!items.length) { setMsg('ciMsg', '받을 항목을 하나 이상 골라주세요!', true); return; }
  var btn = $('ciBtn'); btn.disabled = true; setMsg('ciMsg', '만드는 중...');
  api('checkins.create', p).then(function (c) {
    c.mine = {}; c.reports = S.team.rank >= RANK.GROUP_LEADER ? [] : null;
    C.list.unshift(c);
    C.list.sort(function (a, b) { return a.check_date < b.check_date ? 1 : -1; });
    $('ciTitle').value = '';
    btn.disabled = false; haptic('success');
    setMsg('ciMsg', '만들었어요! 대상자에게 체크인 버튼이 보여요.');
    renderCheckins();
    setTimeout(function () { setMsg('ciMsg', ''); toggleBox('ciForm', 'ciChev'); }, 1200);
  }).catch(function (err) { setMsg('ciMsg', err.message, true); btn.disabled = false; });
}

function deleteCheckin(id) {
  if (!confirm('이 체크인과 기록을 모두 지울까요?')) return;
  api('checkins.delete', { id: id }).then(function () {
    C.list = C.list.filter(function (c) { return c.id !== id; });
    renderCheckins();
  }).catch(function (err) { alertMsg(err.message); });
}

// =====================================================================
// 공지
// =====================================================================
function loadNotices() {
  if (!S.team) return;
  $('annCreateCard').style.display = S.team.rank >= RANK.INSTRUCTOR ? 'block' : 'none';
  $('annScopeWrap').style.display = S.team.rank >= RANK.TEAM_LEADER ? 'block' : 'none';
  if (N.list) { renderNotices(); return; }
  $('annList').innerHTML = '<div class="empty"><b>불러오는 중...</b></div>';
  api('notices.list', { team_id: S.team.id }).then(function (l) { N.list = l; renderNotices(); })
    .catch(function (err) { $('annList').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function onAnnScope() { $('annTargetWrap').style.display = $('annScope').value === 'team' ? 'block' : 'none'; }
function toggleNotice(id) { N.open = N.open === id ? null : id; renderNotices(); }

function renderNotices() {
  if (!N.list.length) { $('annList').innerHTML = '<div class="empty"><b>아직 공지가 없어요</b>공지가 올라오면 여기에 보여요</div>'; return; }
  $('annList').innerHTML = N.list.map(function (n) {
    var open = N.open === n.id;
    var canDel = n.mine || (n.scope === 'team' && S.team.rank >= RANK.INSTRUCTOR);
    var long = n.body && (n.body.length > 90 || n.body.split('\n').length > 3);
    return '<div class="ann' + (n.is_pinned ? ' pinned' : '') + '" onclick="toggleNotice(\'' + esc(n.id) + '\')">' +
      '<div class="ann-top">' + (n.is_pinned ? '<span class="chip dark">📌 고정</span>' : '') +
        '<span class="chip">' + (n.scope === 'section' ? '방송예술과 전체' : esc(S.team.name)) + '</span>' +
        (n.target_unit_id ? '<span class="chip">' + esc(groupName(n.target_unit_id)) + '만</span>' : '') +
        '<span class="ann-date">' + mdOf(n.published_at) + '</span></div>' +
      '<div class="ann-title">' + esc(n.title) + '</div>' +
      (n.body ? '<div class="ann-body' + (open ? '' : ' clamp') + '">' + esc(n.body) + '</div>' : '') +
      '<div class="ann-foot"><span>' + esc(n.author || '') + '</span>' +
        (long && !open ? '<span class="ann-more">더보기</span>' : '') +
        (canDel ? '<button class="ann-hide" onclick="event.stopPropagation();deleteNotice(\'' + esc(n.id) + '\')">삭제</button>' : '') +
      '</div></div>';
  }).join('');
}

function createNotice() {
  var scope = S.team.rank >= RANK.TEAM_LEADER ? $('annScope').value : 'team';
  var p = { team_id: S.team.id, scope: scope, title: $('annTitle').value.trim(), body: $('annBody').value.trim(),
    is_pinned: $('annPinned').checked, target_unit_id: scope === 'team' ? ($('annTarget').value || null) : null };
  if (!p.title) { setMsg('annMsg', '제목을 적어주세요!', true); return; }
  var btn = $('annBtn'); btn.disabled = true; setMsg('annMsg', '올리는 중...');
  api('notices.create', p).then(function (n) {
    N.list = null;   // 고정·순서 반영해서 새로 받기
    ['annTitle', 'annBody'].forEach(function (id) { $(id).value = ''; });
    $('annPinned').checked = false;
    btn.disabled = false; haptic('success');
    setMsg('annMsg', '공지를 올렸어요!');
    loadNotices();
    setTimeout(function () { setMsg('annMsg', ''); toggleBox('annForm', 'annChev'); }, 1000);
  }).catch(function (err) { setMsg('annMsg', err.message, true); btn.disabled = false; });
}

function deleteNotice(id) {
  if (!confirm('이 공지를 지울까요?')) return;
  api('notices.delete', { id: id }).then(function () {
    N.list = N.list.filter(function (n) { return n.id !== id; });
    renderNotices();
  }).catch(function (err) { alertMsg(err.message); });
}

// =====================================================================
// 과제
// =====================================================================
function loadTasks() {
  if (!S.team) return;
  $('hwCreateCard').style.display = S.team.rank >= RANK.INSTRUCTOR ? 'block' : 'none';
  if (A.current) { openTask(A.current.id); return; }
  $('taskDetail').style.display = 'none';
  $('taskList').style.display = 'block';
  if (A.list) { renderTasks(); return; }
  $('hwOpen').innerHTML = '<div class="empty"><b>불러오는 중...</b></div>';
  $('hwPast').innerHTML = '';
  api('assignments.list', { team_id: S.team.id }).then(function (l) { A.list = l; renderTasks(); })
    .catch(function (err) { $('hwOpen').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}

function taskState(a) {
  if (a.my) return a.my.feedback ? { t: '피드백 도착', c: 'st-지각' } : { t: '제출 완료', c: 'st-참석' };
  if (a.due_at && new Date(a.due_at).getTime() < Date.now()) return { t: '마감 지남', c: 'st-불참' };
  return { t: '미제출', c: 'st-none' };
}
function isOpenTask(a) { return !a.due_at || new Date(a.due_at).getTime() >= Date.now(); }

function taskCard(a) {
  var st = taskState(a);
  return '<button class="b-session b-task" onclick="openTask(\'' + esc(a.id) + '\')"><div class="b-info">' +
      (a.category ? '<span class="chip b-cat">' + esc(a.category) + '</span>' : '') +
      '<b>' + esc(a.title) + '</b><span>' + (a.due_at ? '마감 ' + dtLabel(a.due_at) : '마감 없음') +
      (a.target_unit_id ? ' · ' + esc(groupName(a.target_unit_id)) + '만' : '') + '</span></div>' +
    '<div class="b-side"><span class="st ' + st.c + '">' + st.t + '</span>' +
      (a.submitted_count != null ? '<small>제출 ' + a.submitted_count + '명</small>' : '') + '</div></button>';
}

function renderTasks() {
  var open = A.list.filter(isOpenTask).sort(function (a, b) {
    return (a.due_at || '9999') < (b.due_at || '9999') ? -1 : 1;
  });
  var past = A.list.filter(function (a) { return !isOpenTask(a); });
  $('hwOpenCount').textContent = open.length ? open.length + '개' : '';
  $('hwOpen').innerHTML = open.length ? open.map(taskCard).join('')
    : '<div class="empty"><b>지금 진행 중인 과제가 없어요</b>과제가 나오면 여기에 보여요</div>';
  $('hwPast').innerHTML = past.length ? past.map(taskCard).join('') : '<div class="empty"><b>최근 지난 과제가 없어요</b></div>';
}

function createTask() {
  var due = $('hwDue').value;
  var p = { team_id: S.team.id, category: $('hwCat').value.trim() || null, title: $('hwTitle').value.trim(),
    description: $('hwDesc').value.trim() || null, due_at: due ? new Date(due).toISOString() : null,
    needs_feedback: $('hwFeedback').checked, target_unit_id: $('hwTarget').value || null };
  if (!p.title) { setMsg('hwMsg', '과제 제목을 적어주세요!', true); return; }
  var btn = $('hwBtn'); btn.disabled = true; setMsg('hwMsg', '올리는 중...');
  api('assignments.create', p).then(function (a) {
    a.my = null; a.submitted_count = S.team.rank >= RANK.GROUP_LEADER ? 0 : null;
    A.list.unshift(a);
    ['hwTitle', 'hwDesc', 'hwDue'].forEach(function (id) { $(id).value = ''; });
    btn.disabled = false; haptic('success');
    setMsg('hwMsg', '과제를 냈어요!');
    renderTasks();
    setTimeout(function () { setMsg('hwMsg', ''); toggleBox('hwForm', 'hwChev'); }, 1000);
  }).catch(function (err) { setMsg('hwMsg', err.message, true); btn.disabled = false; });
}

function openTask(id) {
  var a = byId(A.list || [], id); if (!a) return;
  if (!A.current || A.current.id !== id) { A.subs = null; A.openSub = null; }
  A.current = a;
  $('taskList').style.display = 'none';
  $('taskDetail').style.display = 'block';
  var st = taskState(a);
  $('tdHead').innerHTML = '<div class="b-dhead">' + (a.category ? '<span class="chip b-cat">' + esc(a.category) + '</span>' : '') +
    '<h1>' + esc(a.title) + '</h1><p>' + (a.due_at ? '마감 ' + dtLabel(a.due_at) : '마감 없음') +
    (a.target_unit_id ? ' · ' + esc(groupName(a.target_unit_id)) + '만' : '') + ' · <span class="st ' + st.c + '">' + st.t + '</span></p>' +
    (a.description ? '<div class="card b-desc">' + esc(a.description) + '</div>' : '') + '</div>';
  $('tdContent').value = (a.my && a.my.content) || '';
  $('tdLink').value = (a.my && a.my.file_url) || '';
  $('tdBtn').textContent = a.my ? '다시 제출' : '제출';
  setMsg('tdMsg', a.my ? dtLabel(a.my.submitted_at) + '에 제출했어요. 고쳐서 다시 낼 수 있어요.' : '');
  $('tdFeedback').innerHTML = a.my && a.my.feedback ? '<div class="b-feedback"><b>💬 피드백</b>' + esc(a.my.feedback) + '</div>' : '';
  var lead = S.team.rank >= RANK.GROUP_LEADER;
  $('tdBoardWrap').style.display = lead ? 'block' : 'none';
  if (lead) loadTaskBoard();
  try { if (tg && tg.BackButton) tg.BackButton.show(); } catch (e) {}
  window.scrollTo(0, 0);
}

function closeTask() {
  A.current = null; A.subs = null;
  $('taskDetail').style.display = 'none';
  $('taskList').style.display = 'block';
  try { if (tg && tg.BackButton) tg.BackButton.hide(); } catch (e) {}
  if (A.list) renderTasks();
}

function submitTask() {
  var a = A.current; if (!a) return;
  var content = $('tdContent').value.trim(), link = $('tdLink').value.trim();
  if (!content && !link) { setMsg('tdMsg', '내용이나 링크를 넣어주세요!', true); return; }
  var btn = $('tdBtn'); btn.disabled = true; setMsg('tdMsg', '제출 중...');
  api('submissions.saveMine', { assignment_id: a.id, content: content, file_url: link }).then(function (r) {
    var first = !a.my;
    a.my = r;
    if (first && a.submitted_count != null) a.submitted_count++;
    btn.disabled = false; haptic('success');
    $('tdBtn').textContent = '다시 제출';
    setMsg('tdMsg', '제출했어요! 수고하셨어요 🙌');
    if (A.subs) { A.subs = A.subs.filter(function (x) { return x.person_id !== r.person_id; }); A.subs.push(Object.assign({ name: S.me.profile.name }, r)); renderTaskBoard(); }
  }).catch(function (err) { setMsg('tdMsg', err.message, true); btn.disabled = false; haptic('error'); });
}

// ----- 제출 현황·피드백 (조장 이상) -----
function loadTaskBoard() {
  $('tdBoard').innerHTML = '<div class="b-group-sep">불러오는 중...</div>';
  var id = A.current.id;
  Promise.all([loadMembers(), api('submissions.list', { assignment_id: id })]).then(function (r) {
    if (!A.current || A.current.id !== id) return;
    A.subs = r[1] || [];
    renderTaskBoard();
  }).catch(function (err) { $('tdBoard').innerHTML = '<div class="b-group-sep">' + esc(err.message) + '</div>'; });
}

function toggleSub(personId) { A.openSub = A.openSub === personId ? null : personId; renderTaskBoard(); }

function renderTaskBoard() {
  var a = A.current; if (!a || !A.subs) return;
  var target = targetMembers(a.target_unit_id);
  var byPerson = {};
  A.subs.forEach(function (x) { byPerson[x.person_id] = x; });
  $('tdBoardCount').textContent = '제출 ' + target.filter(function (m) { return byPerson[m.id]; }).length + ' / ' + target.length + '명';
  $('tdBoard').innerHTML = target.map(function (m) {
    var sub = byPerson[m.id], open = A.openSub === m.id && sub;
    var chipHtml = sub ? (sub.feedback ? '<span class="st st-지각">피드백 완료</span>' : '<span class="st st-참석">제출</span>') : '<span class="st st-none">미제출</span>';
    var html = '<div class="b-prow b-sub-row"' + (sub ? ' onclick="toggleSub(\'' + esc(m.id) + '\')"' : '') + '>' +
      '<div class="nm"><b>' + esc(m.name) + '</b><span>' + esc(m.group || m.position || '') + '</span></div>' + chipHtml;
    if (open) {
      html += '<div class="rs b-subbody" onclick="event.stopPropagation()">' +
        '<div class="b-subtime">' + dtLabel(sub.submitted_at) + ' 제출</div>' +
        (sub.content ? '<div class="b-subtext">' + esc(sub.content) + '</div>' : '') +
        (sub.file_url ? '<a class="b-sublink" href="' + esc(sub.file_url) + '" target="_blank" rel="noopener">🔗 ' + esc(sub.file_url) + '</a>' : '') +
        (a.needs_feedback ? '<label class="field-label">피드백' + (sub.feedback_name ? ' <span class="hint">' + esc(sub.feedback_name) + '</span>' : '') + '</label>' +
          '<textarea id="fb-' + esc(sub.id) + '" rows="3" maxlength="2000" placeholder="잘한 점, 고칠 점을 적어주세요">' + esc(sub.feedback || '') + '</textarea>' +
          '<button class="btn-primary b-small" onclick="saveFeedback(\'' + esc(sub.id) + '\')">피드백 저장</button>' +
          '<div class="msg" id="fbMsg-' + esc(sub.id) + '"></div>' : '') +
      '</div>';
    }
    return html + '</div>';
  }).join('') + (S.team.rank >= RANK.INSTRUCTOR ? '<div class="b-pad b-top"><button class="ghost-btn b-danger" onclick="deleteTask()">이 과제 지우기</button></div>' : '');
}

function saveFeedback(subId) {
  var text = $('fb-' + subId).value.trim();
  setMsg('fbMsg-' + subId, '저장 중...');
  api('submissions.feedback', { id: subId, feedback: text }).then(function (r) {
    A.subs.forEach(function (x) { if (x.id === subId) { x.feedback = r.feedback; x.feedback_at = r.feedback_at; x.feedback_name = r.feedback ? S.me.profile.name : null; } });
    haptic('success');
    renderTaskBoard();
    setMsg('fbMsg-' + subId, r.feedback ? '피드백을 저장했어요!' : '피드백을 지웠어요.');
  }).catch(function (err) { setMsg('fbMsg-' + subId, err.message, true); });
}

function deleteTask() {
  var a = A.current; if (!a) return;
  if (!confirm('이 과제와 제출 내용을 모두 지울까요?')) return;
  api('assignments.delete', { id: a.id }).then(function () {
    A.list = A.list.filter(function (x) { return x.id !== a.id; });
    closeTask();
  }).catch(function (err) { alertMsg(err.message); });
}

// =====================================================================
// 홈 대시보드 — 지금 앱(app.js)의 홈 화면과 같은 동작. 데이터만 Supabase에서
// =====================================================================
var dashData = null;
var teamFilter = '';
var lastDashAt = 0;
var TASK_ICON = { '녹음': '🎙', '사회': '🎤', '촬영': '🎥', '음향편집': '🎚' };
var SCHED_HOLIDAYS = { '10-03': '개천절', '10-09': '한글날', '12-25': '성탄절', '01-01': '신정', '03-01': '삼일절', '05-05': '어린이날', '06-06': '현충일', '08-15': '광복절' };
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
// 보기 방식 (이 폰에 기억): 사명자 일정 = PC는 캘린더, 모바일은 목록 / 프로젝트 = 한 줄 목록
var schedView = lsGet('schedView') || (window.innerWidth >= 1000 ? 'cal' : 'list');
var projView = lsGet('projView') || 'list';

function hmD(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function mdw(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')'; }
function hmMs(ms) { return hmD(new Date(ms)); }
function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }
function ddayText(start) {
  var a = new Date(); a.setHours(0, 0, 0, 0);
  var b = new Date(start.getTime()); b.setHours(0, 0, 0, 0);
  var diff = Math.round((b - a) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  return 'D-' + diff;
}
function setSeg(id, v) { document.querySelectorAll('#' + id + ' button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); }); }

function loadDashboard() {
  if (!S.team) return;
  lastDashAt = Date.now();
  var d = new Date();
  $('todayText').textContent = d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + WD[d.getDay()] + '요일';
  if (dashData) renderDashboard();   // 그려둔 것 먼저, 새 내용은 뒤에서
  var teamId = S.team.id;
  return api('dashboard.load', { team_id: teamId }).then(function (r) {
    if (!S.team || S.team.id !== teamId) return;
    dashData = r;
    renderDashboard();
  }).catch(function (err) {
    if (dashData) return;
    $('scheduleArea').innerHTML = '<div class="empty"><b>대시보드를 불러오지 못했어요</b>' + esc(err.message) + '</div>';
    ['taskNowArea', 'taskUpArea', 'projectArea', 'tribeArea'].forEach(function (id) { $(id).innerHTML = ''; });
  });
}

function renderDashboard() {
  renderTeamFilter();
  renderManager();
  renderWeeklyBanner();
  var t = dashData.tribes;
  $('tribeTotal').textContent = t.filled ? '총 ' + t.total + '명' : '';
  $('tribeArea').innerHTML = tribeMapHtml(t);
}

// 팀 필터 칩은 과에 있는 팀으로
function renderTeamFilter() {
  var teams = dashData.teams || [];
  if (teamFilter && teams.indexOf(teamFilter) === -1) teamFilter = '';
  $('teamFilter').innerHTML = [''].concat(teams).map(function (t) {
    return '<button class="fchip' + (t === teamFilter ? ' active' : '') + '" data-team="' + esc(t) + '">' + (t ? esc(t) : '전체') + '</button>';
  }).join('');
}

function renderManager() {
  var d = dashData;
  if (!d) return;
  var pillNow = $('pillNow');
  pillNow.querySelector('b').innerHTML = d.tasksNow.length + '<small>건</small>';
  pillNow.classList.toggle('now', d.tasksNow.length > 0);
  $('dStatUp').innerHTML = d.tasksUpcoming.length + '<small>건</small>';
  $('dStatProj').innerHTML = d.projects.length + '<small>개</small>';
  $('taskLiveDot').classList.toggle('on', d.tasksNow.length > 0);

  renderSchedule();

  // 1. 진행 중 업무
  $('taskNowArea').innerHTML = d.tasksNow.length
    ? d.tasksNow.map(function (t) { return dashTaskCard(t, true); }).join('')
    : '<div class="empty"><b>지금 진행 중인 업무가 없어요</b>녹음·사회·촬영·음향편집이 시작되면 여기에 떠요</div>';

  // 2. 예정 업무 (팀 필터)
  var ups = d.tasksUpcoming.filter(function (t) { return !teamFilter || t.team === teamFilter; });
  $('taskUpCount').textContent = ups.length + '건';
  $('taskUpArea').innerHTML = ups.length
    ? ups.map(function (t) { return dashTaskCard(t, false); }).join('')
    : '<div class="empty"><b>예정된 업무가 없어요</b>' + (teamFilter ? teamFilter + ' 업무가 없어요' : '업무가 등록되면 여기에 보여요') + '</div>';

  renderProjects();
}

// 주간 녹음가능 알림: 이번 주 미제출(빨강) > 주일에 다음 주 미제출
function renderWeeklyBanner() {
  var w = dashData.weekly, el = $('weeklyBanner');
  var b = function (which, urgent, title, sub) {
    return '<div class="poll-banner' + (urgent ? ' urgent' : '') + '" onclick="goWeekly(\'' + which + '\')"><span class="pb-i">🎙</span>' +
      '<div><b>' + title + '</b><small>' + sub + '</small></div><span class="pb-go">›</span></div>';
  };
  var label = function (ws) { var m = parseDate(ws), e = parseDate(ws); e.setDate(e.getDate() + 6); return (m.getMonth() + 1) + '/' + m.getDate() + '~' + (e.getMonth() + 1) + '/' + e.getDate(); };
  if (!w.this.submitted) {
    el.innerHTML = b('this', true, '이번 주 녹음 가능시간 미제출', label(w.this.week_start) + ' · 지금이라도 입력해주세요');
  } else if (!w.next.submitted && (w.isSunday || Date.now() > w.next.due)) {
    el.innerHTML = b('next', Date.now() > w.next.due, '다음 주 녹음 가능시간을 입력해주세요', label(w.next.week_start) + ' · 마감 ' + mdw(w.next.due) + ' ' + hmMs(w.next.due));
  } else el.innerHTML = '';
}
function goWeekly(which) { goTab('weekly'); if (W.which !== which || !W.data) openWeekly(which); }

// ----- 0. 사명자 일정: 2주 캘린더 / 목록 -----
function schedKind(cat) {
  var c = String(cat || '');
  if (/회의/.test(c)) return 'meet';
  if (/수업|스터디|교육|연습/.test(c)) return 'class';
  if (/녹음/.test(c)) return 'rec';
  if (/촬영|편집/.test(c)) return 'shoot';
  return 'etc';
}
function renderSchedule() {
  var d = dashData; if (!d) return;
  setSeg('schedSeg', schedView);
  var sa = $('scheduleArea');
  $('schedSub').textContent = schedView === 'cal' ? '이번 주 · 다음 주' : '오늘부터 2주';
  if (schedView === 'cal') { sa.innerHTML = scheduleCalendarHtml(d.schedules); return; }
  var today0 = new Date(); today0.setHours(0, 0, 0, 0);
  var rows = d.schedules.filter(function (r) { return r.start >= today0.getTime(); });   // 목록은 오늘부터
  if (!rows.length) {
    sa.innerHTML = '<div class="empty"><b>2주 안에 등록된 일정이 없어요</b>모임 회차나 사명자 일정이 등록되면 여기에 보여요</div>';
    return;
  }
  var today = Date.now(), prevDay = null;
  sa.innerHTML = '<div class="card table-card"><table class="sched"><thead><tr><th>날짜·시간</th><th>일정</th><th>주관자</th><th>참여자</th></tr></thead><tbody>' +
    rows.map(function (r) {
      var showDate = prevDay === null || !sameDay(prevDay, r.start);
      prevDay = r.start;
      return '<tr class="' + (sameDay(r.start, today) ? 'today' : '') + '">' +
        '<td class="c-date">' + (showDate ? mdw(r.start) : '') +
          '<span class="c-time">' + hmMs(r.start) + (r.end ? '~' + hmMs(r.end) : '') + '</span></td>' +
        '<td class="c-what"><b>' + esc(r.title) + '</b><span>' +
          esc([r.category, r.place].filter(Boolean).join(' · ')) + '</span></td>' +
        '<td class="c-who"><b>' + esc(r.name) + '</b><span>' + esc(r.role) + '</span></td>' +
        '<td class="c-part">' + (r.participants ? esc(r.participants) : '–') + '</td>' +
      '</tr>';
    }).join('') + '</tbody></table></div>';
}
function scheduleCalendarHtml(rows) {
  var now = new Date(), today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var start = new Date(today0); start.setDate(start.getDate() - start.getDay()); // 이번 주 일요일
  var byDay = {};
  (rows || []).forEach(function (r) { var k = new Date(r.start).toDateString(); (byDay[k] = byDay[k] || []).push(r); });
  var cells = '';
  for (var i = 0; i < 14; i++) {
    var d = new Date(start); d.setDate(start.getDate() + i);
    var key = d.toDateString(), isToday = key === today0.toDateString();
    var hol = SCHED_HOLIDAYS[pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())];
    var evs = (byDay[key] || []).sort(function (a, b) { return a.start - b.start; });
    cells += '<div class="day' + (d < today0 ? ' past' : '') + (isToday ? ' today' : '') + (hol ? ' holiday' : '') + '">' +
      '<div class="dnum"><span class="n">' + ((i === 0 || d.getDate() === 1) ? (d.getMonth() + 1) + '/' : '') + d.getDate() + '</span>' +
      (isToday ? '<small>오늘</small>' : hol ? '<small class="hol">' + hol + '</small>' : '') + '</div>' +
      evs.map(function (r) {
        return '<button type="button" class="ev ' + schedKind(r.category) + '" data-k="' + esc(key) + '" data-s="' + r.start + '">' +
          '<span class="t">' + hmMs(r.start) + (r.end ? '~' + hmMs(r.end) : '') + '</span><span class="n">' + esc(r.title) + '</span></button>';
      }).join('') + '</div>';
  }
  return '<div class="cal">' +
    '<div class="cal-head"><div>일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div>토</div></div>' +
    '<div class="cal-body">' + cells + '</div>' +
    '<div class="cal-foot"><span class="lg"><i class="meet"></i>회의</span><span class="lg"><i class="class"></i>수업</span>' +
    '<span class="lg"><i class="rec"></i>녹음</span><span class="lg"><i class="shoot"></i>촬영</span>' +
    '<div class="detail" id="schedDetail"><span>일정을 누르면 여기에 자세히 보여요</span></div></div></div>';
}

// ----- 3. 진행 중 프로젝트: 한 줄 목록 / 작은 타일 -----
function renderProjects() {
  var d = dashData; if (!d) return;
  setSeg('projSeg', projView);
  $('projCount').textContent = d.projects.length + '개';
  var pa = $('projectArea');
  if (!d.projects.length) { pa.innerHTML = '<div class="empty"><b>진행 중인 프로젝트가 없어요</b></div>'; return; }
  pa.innerHTML = projView === 'grid'
    ? '<div class="pgrid">' + d.projects.map(projectTile).join('') + '</div>'
    : '<div class="plist">' + d.projects.map(projectRow).join('') + '</div>';
}
function projDue(p) {
  return p.due ? '<span class="due">' + ddayText(new Date(p.due)) + ' · ' + mdw(p.due) + '</span>' : esc(p.status || '');
}
function projectRow(p) {
  return '<div class="prow">' +
    '<span class="chip dark">' + esc(p.channel || '프로젝트') + '</span>' +
    '<div class="pt">' + esc(p.title) + (p.desc ? '<small>' + esc(p.desc) + '</small>' : '') + '</div>' +
    '<div class="pp"><b>담당</b>' + esc(p.owner || '미정') + (p.mc ? ' &nbsp;<b>MC</b>' + esc(p.mc) : '') + '</div>' +
    '<div class="bar">' + (p.progress !== null && p.progress !== undefined ? '<i style="width:' + Math.min(100, p.progress) + '%"></i>' : '') + '</div>' +
    '<div class="pd">' + projDue(p) + '</div>' +
  '</div>';
}
function projectTile(p) {
  return '<div class="ptile">' +
    '<div class="top"><span class="chip dark">' + esc(p.channel || '프로젝트') + '</span><span class="pd">' + projDue(p) + '</span></div>' +
    '<div class="tt">' + esc(p.title) + '</div>' +
    '<div class="pp"><b>담당</b>' + esc(p.owner || '미정') + (p.mc ? '<br><b>MC</b>' + esc(p.mc) : '') + '</div>' +
    (p.progress !== null && p.progress !== undefined ? '<div class="bar"><i style="width:' + Math.min(100, p.progress) + '%"></i></div>' : '') +
  '</div>';
}

function dashTaskCard(t, live) {
  var when = t.start ? '<b>' + (live ? hmMs(t.start) : ddayText(new Date(t.start))) + '</b>' + (live ? (t.end ? '~' + hmMs(t.end) : '') : mdw(t.start) + ' ' + hmMs(t.start)) : '<b>미정</b>';
  return '<div class="tcard' + (live ? ' live' : '') + '">' +
    '<div class="t-icon">' + (TASK_ICON[t.type] || '📌') + '</div>' +
    '<div class="t-body">' +
      '<div class="t-top">' +
        (t.type ? '<span class="chip' + (live ? '' : ' dark') + '">' + esc(t.type) + '</span>' : '') +
        (t.team ? '<span class="chip">' + esc(t.team) + '</span>' : '') +
      '</div>' +
      '<div class="t-title">' + esc(t.title) + '</div>' +
      '<div class="t-meta">' + esc([t.owner && '담당 ' + t.owner, t.place, t.dept && '요청 ' + t.dept].filter(Boolean).join(' · ')) + '</div>' +
    '</div>' +
    '<div class="t-when">' + when + '</div>' +
  '</div>';
}

// ----- 12지파 인원현황 (남한 지도: ../krmap.js 의 KR_MAP·TRIBES) -----
function tribeMapHtml(d) {
  if (typeof KR_MAP === 'undefined' || typeof TRIBES === 'undefined') return '<div class="empty inner"><b>지도 파일(krmap.js)을 못 읽었어요</b></div>';
  var count = {};
  (d.list || []).forEach(function (t) { count[String(t.name).trim()] = t.count; });
  var byRegion = {};
  TRIBES.forEach(function (t) { (t.region || []).forEach(function (r) { byRegion[r] = t; }); });
  function cntText(t) { var c = count[t.name]; return c === null || c === undefined ? '–' : c + '명'; }

  var svg = [];
  Object.keys(KR_MAP).forEach(function (r) {
    var t = byRegion[r];
    svg.push('<path class="rg" fill="' + (t ? t.color : '#D9CFBF') + '" d="' + KR_MAP[r] + '"><title>' +
      esc(r + (t ? ' · ' + t.name + ' ' + cntText(t) : '')) + '</title></path>');
  });
  TRIBES.forEach(function (t) {
    if (t.pin) svg.push('<circle class="pin" cx="' + t.pin.x + '" cy="' + t.pin.y + '" r="6" fill="' + t.color + '"><title>' + esc(t.name + ' ' + cntText(t)) + '</title></circle>');
  });
  TRIBES.forEach(function (t) {
    var l = t.label; if (!l) return;
    var left = l.side === 'L';
    svg.push('<line class="ld" x1="' + (left ? -4 : 400) + '" y1="' + l.y + '" x2="' + l.px + '" y2="' + l.py + '"/>' +
      '<circle cx="' + l.px + '" cy="' + l.py + '" r="2.6" class="lp"/>' +
      '<text class="lbl" x="' + (left ? -8 : 404) + '" y="' + (l.y + 4) + '" text-anchor="' + (left ? 'end' : 'start') + '">' +
      esc(t.name) + ' <tspan class="c">' + cntText(t) + '</tspan></text>');
  });

  var list = TRIBES.slice().sort(function (a, b) { return (count[b.name] || 0) - (count[a.name] || 0); }).map(function (t) {
    var c = count[t.name];
    return '<div class="trow' + (c ? '' : ' zero') + '"><i style="background:' + t.color + '"></i><span>' + esc(t.name) +
      '<small>' + esc(t.area || '') + '</small></span><b>' + (c === null || c === undefined ? '–' : c + '<small>명</small>') + '</b></div>';
  }).join('');

  return '<div class="tribe-wrap">' +
    '<svg class="map" viewBox="-118 0 620 540" role="img" aria-label="12지파 지경 지도">' + svg.join('') + '</svg>' +
    '<div class="tlist">' + list + '</div></div>' +
    (d.filled ? '' : '<div class="tribe-hint">지파별 인원을 입력하면 여기에 보여요</div>');
}

// 보기 방식 전환·일정 상세·팀 필터 (화면에 처음부터 있는 요소라 한 번만 연결)
$('schedSeg').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b) return;
  schedView = b.getAttribute('data-v'); lsSet('schedView', schedView); renderSchedule();
});
$('projSeg').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b) return;
  projView = b.getAttribute('data-v'); lsSet('projView', projView); renderProjects();
});
$('scheduleArea').addEventListener('click', function (e) {
  var b = e.target.closest('.ev'); if (!b || !dashData) return;
  var r = dashData.schedules.filter(function (x) { return String(x.start) === b.getAttribute('data-s') && new Date(x.start).toDateString() === b.getAttribute('data-k'); })[0];
  if (!r) return;
  document.querySelectorAll('#scheduleArea .ev.sel').forEach(function (x) { x.classList.remove('sel'); });
  b.classList.add('sel');
  $('schedDetail').innerHTML = '<b>' + esc(r.title) + '</b>' +
    '<span>' + mdw(r.start) + ' ' + hmMs(r.start) + (r.end ? '~' + hmMs(r.end) : '') + '</span>' +
    (r.place ? '<span>' + esc(r.place) + '</span>' : '') +
    '<span>주관 <b>' + esc(r.name || '') + '</b>' + (r.role ? ' ' + esc(r.role) : '') + '</span>' +
    (r.participants ? '<span>참여 ' + esc(r.participants) + '</span>' : '');
});
$('teamFilter').addEventListener('click', function (e) {
  var b = e.target.closest('.fchip');
  if (!b) return;
  teamFilter = b.getAttribute('data-team');
  document.querySelectorAll('#teamFilter .fchip').forEach(function (x) { x.classList.toggle('active', x === b); });
  renderManager();
});
// 5분마다 새로고침 (홈을 보고 있을 때만)
setInterval(function () {
  if (document.visibilityState === 'visible' && curTab === 'home' && S.team) loadDashboard();
}, 5 * 60 * 1000);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && curTab === 'home' && S.team && Date.now() - lastDashAt > 5 * 60 * 1000) loadDashboard();
});

// 텔레그램 뒤로가기 버튼: 모임·과제 상세에서 누르면 목록으로
if (tg && tg.BackButton) {
  tg.BackButton.onClick(function () {
    if (curTab === 'task' && A.current) closeTask();
    else if (S.current) showList();
  });
  var _open = openSession, _list = showList;
  openSession = function (id) { _open(id); try { tg.BackButton.show(); } catch (e) {} };
  showList = function () { _list(); try { tg.BackButton.hide(); } catch (e) {} };
}

boot();
