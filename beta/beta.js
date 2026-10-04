// =====================================================================
// 방송예술과 미니앱 베타 — Supabase(문지기 api)만 사용
// 기존 앱(../app.js, 구글시트)과는 완전히 분리되어 있음.
// 텔레그램 미니앱으로 열면 initData로, PC 브라우저로 열면 '텔레그램으로 로그인' 버튼으로 확인.
// =====================================================================
var API = 'https://bundxpidywrcrwhhgclv.supabase.co/functions/v1/api';
var RANK = { MEMBER: 10, GROUP_LEADER: 20, INSTRUCTOR: 30, TEAM_LEADER: 40 };
var WD = ['일', '월', '화', '수', '목', '금', '토'];

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
  sessions: [],      // 모임 (모임마다 사전 체크·최종 출결 수, 내 출결 포함)
  types: [],         // 모임 유형 (조장 이상)
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
      e.code = j.code; e.tg_id = j.tg_id; e.tg_name = j.tg_name;
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
function chip(status) {
  if (!status) return '<span class="st st-none">미제출</span>';
  return '<span class="st st-' + esc(status) + '">' + esc(status) + '</span>';
}
// 등록 안 된 사람: 텔레그램 번호를 크게 보여주고, 캡처해서 팀장에게 보내게 함
function showNotRegistered(id, name) {
  showState('', '');
  $('who').textContent = '등록 전';
  $('stateBox').innerHTML =
    '<b>아직 등록되지 않았어요</b>' +
    '<span class="b-nr-desc">이 화면을 캡처해서 팀장님께 보내주세요.<br>등록되면 바로 들어올 수 있어요.</span>' +
    '<div class="b-nr-box"><small>' + (name ? esc(name) + '님의 ' : '내 ') + '텔레그램 번호</small>' +
      '<strong id="nrId">' + esc(id) + '</strong>' +
      '<button type="button" class="b-nr-copy" onclick="copyNrId(this)">번호 복사</button></div>' +
    (initData ? '' : '<span class="b-nr-desc">다른 텔레그램 계정이면 오른쪽 위 동그라미를 눌러 로그아웃해요.</span>');
}
function copyNrId(btn) {
  var t = $('nrId').textContent;
  var done = function () { btn.textContent = '복사했어요'; setTimeout(function () { btn.textContent = '번호 복사'; }, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, function () { prompt('아래 번호를 복사해주세요', t); });
  else prompt('아래 번호를 복사해주세요', t);
}

function showState(title, desc) {
  $('loginBox').style.display = 'none';
  $('stateBox').style.display = 'block';
  $('stateBox').innerHTML = '<b>' + esc(title) + '</b>' + esc(desc || '');
  ['homeView', 'listView', 'detailView', 'reportView', 'noticeView', 'taskView', 'weeklyView', 'recView', 'profileView'].forEach(function (id) { $(id).style.display = 'none'; });
}

// ---------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------
// 봇 알림의 '출결 체크하기' 버튼으로 열면 주소에 ?s=모임id 가 붙어 옴
var DEEP_SESSION = (function () { try { return new URLSearchParams(location.search).get('s'); } catch (e) { return null; } })();
// 업무가능 독촉 알림의 버튼: ?go=weekly&ws=월요일
// 시간취합 알림의 버튼: ?poll=취합id
var DEEP_POLL = (function () { try { return new URLSearchParams(location.search).get('poll'); } catch (e) { return null; } })();
var DEEP_WEEK = (function () { try { var q = new URLSearchParams(location.search); return q.get('go') === 'weekly' ? (q.get('ws') || (new Date().getDay() === 0 ? mondayOf('next') : 'this')) : null; } catch (e) { return null; } })();
// 봇 채팅 답장의 버튼: ?go=attend|notice|poll|profile → 그 탭으로
var DEEP_TAB = (function () { try { var g = new URLSearchParams(location.search).get('go'); return ['attend', 'notice', 'poll', 'profile'].indexOf(g) !== -1 ? g : null; } catch (e) { return null; } })();
function openDeepSession(id) {
  DEEP_SESSION = null;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  api('sessions.board', { session_id: id }).then(function (b) {
    var team = S.me.teams.filter(function (t) { return t.id === b.session.team_id; })[0] || S.me.teams[0];
    setTabUI('attend');
    return selectTeam(team.id).then(function () { if (byId(S.sessions, id)) openSession(id); });
  }).catch(function () {
    if (curTab === 'home') $('teamTabs').style.display = 'none';
    selectTeam(S.me.teams[0].id);
  });
}

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
    setupRecTab();
    setupTownTab();
    document.body.classList.add('b-nav');
    renderTeamTabs();
    if (DEEP_SESSION) openDeepSession(DEEP_SESSION);
    else if (DEEP_ASK) {
      var askId = DEEP_ASK; DEEP_ASK = null;
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
      if (curTab === 'home') $('teamTabs').style.display = 'none';
      Promise.resolve(selectTeam(me.teams[0].id)).then(function () { openAsk(askId); });
    }
    else if (DEEP_REC && recAllowed()) {
      RC.pending = DEEP_REC; DEEP_REC = null;
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
      Promise.resolve(selectTeam(me.teams[0].id)).then(function () { goTab('rec'); });
    }
    else if (DEEP_POLL) {
      var pollId = DEEP_POLL; DEEP_POLL = null;
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
      Promise.resolve(selectTeam(me.teams[0].id)).then(function () { PL.pending = pollId; goTab('poll'); });
    }
    else if (DEEP_TAB) {
      var tab = DEEP_TAB; DEEP_TAB = null;
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
      Promise.resolve(selectTeam(me.teams[0].id)).then(function () { goTab(tab); });
    }
    else if (DEEP_WEEK) {
      var ws = DEEP_WEEK; DEEP_WEEK = null;
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
      Promise.resolve(selectTeam(me.teams[0].id)).then(function () { goWeekly(ws === mondayOf('next') ? 'next' : 'this'); });
    }
    else { if (curTab === 'home') $('teamTabs').style.display = 'none'; selectTeam(me.teams[0].id); }
  }).catch(function (err) {
    if (err.status === 401 && !initData) return;   // 로그인 화면으로 이미 넘어감
    if (err.code === 'not_registered' && err.tg_id) { showNotRegistered(err.tg_id, err.tg_name); return; }
    showState('들어갈 수 없어요', err.message + (initData ? '' : ' (다른 텔레그램 계정이면 오른쪽 위 동그라미를 눌러 로그아웃)'));
  });
}

// ---------------------------------------------------------------------
// PC 브라우저 로그인 (텔레그램 로그인 버튼)
// ---------------------------------------------------------------------
// '이 PC에서 로그인 유지'를 켜면 브라우저에 7일 저장(localStorage), 끄면 창을 닫을 때 지워짐(sessionStorage) — 공용 PC 대비
function getLogin() {
  try { return JSON.parse(sessionStorage.getItem(LOGIN_KEY) || localStorage.getItem(LOGIN_KEY) || 'null'); } catch (e) { return null; }
}
function forgetLogin() {
  loginRaw = '';
  try { localStorage.removeItem(LOGIN_KEY); } catch (e) {}
  try { sessionStorage.removeItem(LOGIN_KEY); } catch (e) {}
}
function loginQuery(u) {
  // 텔레그램이 준 값을 그대로 (서버가 이 값들로 서명을 다시 계산함)
  var q = new URLSearchParams();
  Object.keys(u).forEach(function (k) { if (u[k] !== undefined && u[k] !== null) q.append(k, String(u[k])); });
  return q.toString();
}
function showLogin(msg) {
  ['stateBox', 'homeView', 'listView', 'detailView', 'reportView', 'weeklyView', 'noticeView', 'taskView', 'recView', 'profileView', 'teamTabs'].forEach(function (id) { $(id).style.display = 'none'; });
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
  var keep = $('loginKeep') && $('loginKeep').checked;
  try { (keep ? localStorage : sessionStorage).setItem(LOGIN_KEY, JSON.stringify(user)); } catch (e) {}
  loginRaw = loginQuery(user);
  $('loginBox').style.display = 'none';
  boot();
};
// 오른쪽 위 동그라미: 들어와 있으면 '나의 기록'으로, 아직 못 들어왔으면(PC) 로그아웃
function onAvatar() {
  if (S.me && S.me.teams && S.me.teams.length) { goTab('profile'); return; }
  logout();
}
function logout() {
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
  S.members = null; S.types = []; S.sessions = []; S.current = null;
  M.board = null; M.open = null; stopBoardTimer(); R.data = null; R.open = null;
  N.list = null; A.list = null; A.current = null; C.list = []; dashData = null; CALM.cache = {};
  document.querySelectorAll('#teamTabs .subtab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-team') === id); });
  showState('불러오는 중...', S.team.name + ' 정보를 가져오고 있어요');
  return loadTeam().then(function () {
    if (!TODO.data) refreshTodos(true);   // 처음 들어올 때 배지 숫자
    $(VIEWS[curTab]).style.display = '';
    if (curTab === 'attend') showList(); else { $('stateBox').style.display = 'none'; refreshTab(); }
  }).catch(function (err) { showState('불러오지 못했어요', err.message); });
}

function loadTeam() {
  var jobs = [
    api('sessions.list', { team_id: S.team.id, from: addDays(-14), to: addDays(60) }),
    api('checkins.list', { team_id: S.team.id }),
    api('team.groups', { team_id: S.team.id }),
    S.team.rank >= RANK.GROUP_LEADER ? api('meeting_types.list', { team_id: S.team.id }) : Promise.resolve([])
  ];
  return Promise.all(jobs).then(function (r) {
    S.sessions = r[0] || [];
    C.list = r[1] || [];
    S.groups = r[2] || [];
    S.types = r[3] || [];
    fillTargets();
  });
}

// ---------------------------------------------------------------------
// 모임 목록
// 흐름: 사전 출결체크(본인, 시작 전) → 현장 출결확인(조장 이상) → 마감 → 지각·불참 사유
// ---------------------------------------------------------------------
var M = { board: null, open: null, timer: null };   // 열어둔 모임의 현황
var R = { month: null, data: null, open: null };    // 월간 리포트
var LATE_LIKE = ['지각', '불참', '조퇴'];

// 모임 단계: before(시작 전, 사전 체크) / live(시작 후 마감 전) / closed / cancel
function phaseOf(s) {
  if (s.status === '취소') return 'cancel';
  if (s.closed_at) return 'closed';
  var deadline = s.start_ms != null ? s.start_ms : s.end_ms;
  return Date.now() < deadline ? 'before' : 'live';
}
function planChip(v, small) { return '<span class="st st-plan st-' + esc(v) + (small ? ' sm' : '') + '">사전 ' + esc(v) + '</span>'; }
function nowHm() { return hmD(new Date()); }

function showList() {
  S.current = null; M.board = null; M.open = null; stopBoardTimer();
  $('stateBox').style.display = 'none';
  $('detailView').style.display = 'none';
  $('reportView').style.display = 'none';
  $('listView').style.display = 'block';
  $('attendWrap').classList.remove('split');
  var lead = S.team.rank >= RANK.GROUP_LEADER, inst = S.team.rank >= RANK.INSTRUCTOR;
  $('attFabSess').style.display = lead ? '' : 'none';
  $('attFabCi').style.display = inst ? '' : 'none';
  $('attFab').style.display = lead || inst ? '' : 'none';
  closeFabMenu();
  if (lead) fillTypeSelect();
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
    : '<div class="empty"><b>예정된 모임이 없어요</b>' + (S.team.rank >= RANK.GROUP_LEADER ? '위에서 새로 만들 수 있어요' : '모임이 잡히면 여기에 보여요') + '</div>';
  $('pastList').innerHTML = past.length ? past.map(sessionCard).join('')
    : '<div class="empty"><b>최근 지난 모임이 없어요</b></div>';
  renderNeed();
}

// 위쪽 알림: 지각·불참 사유 미입력 / 아직 사전 체크 안 한 모임
function renderNeed() {
  var h = '';
  S.sessions.forEach(function (s) {
    var m = s.mine;
    if (m && LATE_LIKE.indexOf(m.status) !== -1 && !m.reason) {
      h += needBanner(s, true, m.status + ' 사유를 적어주세요', shortD(s.session_date) + ' ' + sessionName(s));
    }
  });
  var todo = S.sessions.filter(function (s) { return s.is_target && phaseOf(s) === 'before' && !(s.mine && s.mine.planned_status); });
  if (todo.length) {
    h += needBanner(todo[0], false, '출결 체크 안 한 모임 ' + todo.length + '개',
      todo.slice(0, 3).map(function (s) { return shortD(s.session_date) + ' ' + sessionName(s); }).join(', '));
  }
  $('needArea').innerHTML = h;
}
function needBanner(s, urgent, title, sub) {
  return '<div class="poll-banner' + (urgent ? ' urgent' : '') + '" onclick="openSession(\'' + esc(s.id) + '\')"><span class="pb-i">' + (urgent ? '✍️' : '🙋') + '</span>' +
    '<div><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></div><span class="pb-go">›</span></div>';
}

function sessionCard(s) {
  var d = parseDate(s.session_date);
  var ph = phaseOf(s);
  var m = s.mine || {};
  var side;
  if (ph === 'cancel') side = chip('취소');
  else if (m.status) side = chip(m.status);
  else if (m.planned_status) side = planChip(m.planned_status);
  else if (!s.is_target) side = '<span class="st st-none">대상 아님</span>';
  else side = '<span class="st st-none">' + (ph === 'before' ? '미체크' : '확인 전') + '</span>';
  if (ph !== 'cancel') {
    var n = ph === 'before' ? s.planned.참석 + s.planned.지각 + s.planned.불참
      : s.final.참석 + s.final.지각 + s.final.조퇴 + (ph === 'live' ? s.final.불참 : 0);
    side += '<small>' + (ph === 'before' ? '체크 ' : ph === 'live' ? '확인 ' : '출석 ') + n + '/' + s.target_count + '</small>';
  }
  var tag = ph === 'live' ? ' · <em class="b-live">진행 중</em>' : '';
  var target = s.target_label ? ' · ' + esc(s.target_label) : s.target_unit_id ? ' · ' + esc(groupName(s.target_unit_id)) : '';
  var selected = S.current && S.current.id === s.id;
  return '<button class="b-session' + (s.session_date < todayStr() ? ' b-past' : '') + (ph === 'cancel' ? ' b-cancel' : '') + (selected ? ' b-sel' : '') + '" onclick="openSession(\'' + esc(s.id) + '\')">' +
    '<div class="b-date' + (s.session_date === todayStr() ? ' today' : '') + '"><b>' + d.getDate() + '</b><span>' + (d.getMonth() + 1) + '월 ' + WD[d.getDay()] + '</span></div>' +
    '<div class="b-info"><b>' + esc(sessionName(s)) + '</b><span>' + esc(timePlace(s) || '시간·장소 미정') + target + tag + '</span></div>' +
    '<div class="b-side">' + side + '</div></button>';
}

// ---------------------------------------------------------------------
// 모임 만들기 (조장 이상) — 만들면 대상자에게 봇 알림
// ---------------------------------------------------------------------
// ----- 장소: 정해진 목록 + 기타(직접 입력 칸이 스르륵) -----
function placeIsListed(v) { return [].some.call($('cPlaceSel').options, function (o) { return o.value && o.value !== '기타' && o.value === v; }); }
function onPlaceSel() {
  var other = $('cPlaceSel').value === '기타';
  $('cPlaceWrap').classList.toggle('open', other);
  if (other) setTimeout(function () { try { $('cPlace').focus(); } catch (e) {} }, 220);
}
function getPlace() { var v = $('cPlaceSel').value; return v === '기타' ? $('cPlace').value.trim() : v; }
function setPlace(v) {
  v = String(v || '').trim();
  if (!v) { $('cPlaceSel').value = ''; $('cPlace').value = ''; }
  else if (placeIsListed(v)) { $('cPlaceSel').value = v; $('cPlace').value = ''; }
  else { $('cPlaceSel').value = '기타'; $('cPlace').value = v; }
  onPlaceSel();
}

// =====================================================================
// 대상 고르기 (모임·과제·체크인·공지 공통)
// 팀(전체·성우팀·아나운서팀·엔지니어팀) → 조(운영진·1조·2조·3조, 조가 있는 팀만) → (공지는 직책도) → 받는 사람 명단(이름 누르면 빼기)
// 팝업마다 k: c=모임, hw=과제, ci=체크인, ann=공지. 그리는 곳은 #{k}Pick
// =====================================================================
var ROSTER = { teamOf: null, data: null, wait: null };
function loadRoster() {
  var team = S.team.id;
  if (ROSTER.teamOf === team && ROSTER.data) return Promise.resolve(ROSTER.data);
  if (ROSTER.teamOf === team && ROSTER.wait) return ROSTER.wait;
  ROSTER.teamOf = team; ROSTER.data = null;
  ROSTER.wait = api('sessions.audience', { team_id: team }).then(function (d) {
    if (ROSTER.teamOf === team) { ROSTER.data = d; ROSTER.wait = null; }
    return d;
  }, function (e) { if (ROSTER.teamOf === team) { ROSTER.wait = null; ROSTER.teamOf = null; } throw e; });
  return ROSTER.wait;
}
var STAFF = 'staff';   // 운영진 = 그 팀 교관 이상 + 4조
// min: 팀 칩이 보이는 내 서열, all: '전체' 칩이 보이는 서열, pos: 직책 줄, dynAll: 전체를 통째로 고르면 예전처럼 과 전체로(공지)
var PCFG = {
  c: { min: RANK.GROUP_LEADER, all: RANK.TEAM_LEADER },
  hw: { min: RANK.INSTRUCTOR, all: RANK.TEAM_LEADER },
  ci: { min: RANK.INSTRUCTOR, all: RANK.TEAM_LEADER },
  ann: { min: RANK.INSTRUCTOR, all: RANK.TEAM_LEADER, pos: true, dynAll: true },
  tp: { min: RANK.MEMBER, all: RANK.MEMBER, people: true }   // 시간취합: 과 사람 누구나, 언제나 사람 목록으로
};
var PK = {};
function pk(k) { return PK[k] || (PK[k] = { key: '', teamOf: null, subs: [], pos: [], off: {}, pending: null }); }
function pkTeams(k) { return ROSTER.data.teams.filter(function (t) { return t.my_rank >= PCFG[k].min; }); }
function pkCanAll(k) { return ROSTER.data.teams.some(function (t) { return t.my_rank >= PCFG[k].all; }); }
function pkAllTeam(k) {   // '전체'로 만들 때 소속 팀: 지금 팀이 되면 지금 팀
  var ok = ROSTER.data.teams.filter(function (t) { return t.my_rank >= PCFG[k].all; });
  return (ok.filter(function (t) { return t.id === S.team.id; })[0] || ok[0] || {}).id;
}
function pkOpen(k) {
  var P = pk(k), box = $(k + 'Pick');
  if (!ROSTER.data || ROSTER.teamOf !== S.team.id) box.innerHTML = '<div class="b-aud"><b>명단 불러오는 중...</b></div>';
  return loadRoster().then(function () {
    if (P.teamOf !== S.team.id) {   // 처음이거나 팀을 바꿨으면 지금 팀으로
      var ts = pkTeams(k), mine = ts.filter(function (t) { return t.id === S.team.id; })[0] || ts[0];
      P.key = mine ? mine.id : (pkCanAll(k) ? 'all' : ''); P.subs = []; P.pos = []; P.off = {}; P.teamOf = S.team.id;
    }
    pkRender(k); pkApplyPending(k);
  }).catch(function (err) { box.innerHTML = '<div class="b-aud"><b>명단을 불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function pkTeam(k) { var P = pk(k); return P.key === 'all' ? null : ROSTER.data.teams.filter(function (t) { return t.id === P.key; })[0]; }
function pkSubOpts(t) {
  if (!t || !t.groups.length) return [];
  return [{ key: STAFF, name: '운영진' }].concat(t.groups.filter(function (g) { return g.name !== '4조'; }).map(function (g) { return { key: g.id, name: g.name }; }));
}
function pkRank(k, m) { var t = pkTeam(k); return t ? m.ranks[t.id] || 0 : m.rank; }
function pkPosOf(k, m) { var t = pkTeam(k); return (t && m.pos && m.pos[t.id]) || m.position; }
// 팀·조까지 고른 범위
function pkBase(k) {
  var P = pk(k), t = pkTeam(k), list = ROSTER.data.members;
  if (!t) return list;
  list = list.filter(function (m) { return m.ranks[t.id]; });
  if (!P.subs.length) return list;
  return list.filter(function (m) {
    return P.subs.some(function (s) { return s === STAFF ? (m.ranks[t.id] >= RANK.INSTRUCTOR || m.group === '4조') : m.group_id === s; });
  });
}
function pkPosOpts(k) {
  var seen = {}, out = [];
  pkBase(k).slice().sort(function (a, b) { return pkRank(k, b) - pkRank(k, a); }).forEach(function (m) {
    var p = pkPosOf(k, m); if (p && !seen[p]) { seen[p] = 1; out.push(p); }
  });
  return out;
}
function pkPool(k) { var P = pk(k), b = pkBase(k); return P.pos.length ? b.filter(function (m) { return P.pos.indexOf(pkPosOf(k, m)) !== -1; }) : b; }
function pkPicked(k) { var P = pk(k); return pkPool(k).filter(function (m) { return !P.off[m.id]; }); }
function pkLabel(k) {
  var P = pk(k), t = pkTeam(k), off = pkPool(k).length - pkPicked(k).length;
  var whole = P.pos.length ? '' : ' 전체';
  var base = !t ? ROSTER.data.section.name + whole
    : P.subs.length ? t.name + ' · ' + pkSubOpts(t).filter(function (o) { return P.subs.indexOf(o.key) !== -1; }).map(function (o) { return o.name; }).join('·')
    : t.name + whole;
  return base + (P.pos.length ? ' · ' + P.pos.join('·') : '') + (off ? ' (' + off + '명 빼고)' : '');
}
function pkRender(k) {
  var P = pk(k), cfg = PCFG[k], box = $(k + 'Pick');
  if (!ROSTER.data) return;
  var chip = function (on, label, fn) { return '<button type="button" class="b-pick' + (on ? ' on' : '') + '" onclick="' + fn + '">' + esc(label) + '</button>'; };
  var teams = pkTeams(k), canAll = pkCanAll(k);
  if (!teams.length && !canAll) { box.innerHTML = '<div class="b-aud"><b>대상을 고를 수 있는 팀이 없어요</b></div>'; return; }
  var h = '<div class="b-pick-row"><span>팀</span><div class="b-picks">' + (canAll ? chip(P.key === 'all', '전체', "pkSetTeam('" + k + "','all')") : '') +
    teams.map(function (t) { return chip(P.key === t.id, t.name, "pkSetTeam('" + k + "','" + t.id + "')"); }).join('') + '</div></div>';
  var subs = pkSubOpts(pkTeam(k));
  if (subs.length) h += '<div class="b-pick-row"><span>조</span><div class="b-picks">' +
    subs.map(function (o) { return chip(P.subs.indexOf(o.key) !== -1, o.name, "pkToggleSub('" + k + "','" + o.key + "')"); }).join('') + '</div></div>';
  if (cfg.pos) {
    var ps = pkPosOpts(k);
    if (ps.length > 1) h += '<div class="b-pick-row"><span>직책</span><div class="b-picks">' + chip(!P.pos.length, '모두', "pkTogglePos('" + k + "','')") +
      ps.map(function (p) { return chip(P.pos.indexOf(p) !== -1, p, "pkTogglePos('" + k + "','" + esc(p) + "')"); }).join('') + '</div></div>';
  }
  var pool = pkPool(k), n = pkPicked(k).length;
  h += '<div class="b-aud"><b>받는 사람 ' + n + '명</b>' + (pool.length ? '<div class="who">' + pool.map(function (m) {
      return '<button type="button" class="ma-p' + (P.off[m.id] ? ' off' : '') + '" onclick="pkToggleOff(\'' + k + '\',\'' + m.id + '\')">' + esc(m.name) +
        ' <small>' + esc([pkPosOf(k, m), m.group].filter(Boolean).join('·')) + '</small></button>';
    }).join('') + '</div><small class="ma-hint">이름을 누르면 빼거나 다시 넣을 수 있어요</small>' : '<small>이 범위에는 사람이 없어요</small>') + '</div>';
  box.innerHTML = h;
  if (k === 'c') {   // 모임 유형은 지금 보고 있는 팀 것만: 다른 팀 모임이면 제목으로
    var other = P.key !== 'all' && P.key !== S.team.id;
    $('cType').disabled = other; if (other) $('cType').value = '';
  }
}
function pkSetTeam(k, id) { var P = pk(k); P.key = id; P.subs = []; P.pos = []; P.off = {}; pkRender(k); }
function pkToggleSub(k, s) { var P = pk(k), i = P.subs.indexOf(s); if (i === -1) P.subs.push(s); else P.subs.splice(i, 1); P.pos = []; P.off = {}; pkRender(k); }
function pkTogglePos(k, p) { var P = pk(k), i = P.pos.indexOf(p); if (!p) P.pos = []; else if (i === -1) P.pos.push(p); else P.pos.splice(i, 1); P.off = {}; pkRender(k); }
function pkToggleOff(k, id) { var P = pk(k); if (P.off[id]) delete P.off[id]; else P.off[id] = true; pkRender(k); }
function pkReset(k) { var P = pk(k); P.subs = []; P.pos = []; P.off = {}; if (ROSTER.data) pkRender(k); }
// 보낼 대상: { team_id, scope: team|all, target_people?, target_label? } — 팀 하나를 통째로 고르면 예전처럼 팀 대상(사람 목록 없음)
function pkPayload(k) {
  var P = pk(k);
  if (!ROSTER.data || !P.key) return { error: '대상 명단을 불러오는 중이에요. 잠시 뒤 다시 눌러주세요' };
  var picked = pkPicked(k);
  if (!picked.length) return { error: '받는 사람이 없어요. 대상을 다시 골라주세요' };
  var all = P.key === 'all', whole = !P.subs.length && !P.pos.length && picked.length === pkPool(k).length;
  var out = { team_id: all ? pkAllTeam(k) : P.key, scope: all ? 'all' : 'team' };
  if (!whole || (all && !PCFG[k].dynAll) || PCFG[k].people) {
    out.target_people = picked.map(function (m) { return m.id; });
    out.target_label = pkLabel(k);
  }
  return out;
}
function pkTeamName(id) { var t = ROSTER.data && ROSTER.data.teams.filter(function (x) { return x.id === id; })[0]; return t ? t.name : ''; }
// 양식에 담을 대상 / 양식에서 되살리기(명단이 온 뒤, 지금 고를 수 없는 팀이면 건너뜀)
function pkGet(k) { var P = pk(k); return P.key ? { key: P.key, subs: P.subs.slice(), pos: P.pos.slice(), off: Object.keys(P.off) } : null; }
function pkApplyPending(k) {
  var P = pk(k), g = P.pending; if (!g || !ROSTER.data) return;
  P.pending = null;
  var ok = g.key === 'all' ? pkCanAll(k) : pkTeams(k).some(function (t) { return t.id === g.key; });
  if (!ok) { pkRender(k); return; }
  P.key = g.key;
  var opts = pkSubOpts(pkTeam(k)).map(function (o) { return o.key; });
  P.subs = (g.subs || []).filter(function (s) { return opts.indexOf(s) !== -1; });
  P.pos = (g.pos || []).slice();
  P.off = {}; (g.off || []).forEach(function (id) { P.off[id] = true; });
  pkRender(k);
}
// 대상자 명단(제출·체크인 현황용): 사람으로 집었으면 그 사람들, 아니면 팀(조)
function targetList(item) {
  if (item.target_people && item.target_people.length) {
    var pool = (ROSTER.data && ROSTER.data.members) || S.members || [];
    return pool.filter(function (m) { return item.target_people.indexOf(m.id) !== -1; })
      .map(function (m) { return { id: m.id, name: m.name, group: m.group, position: m.position }; });
  }
  return targetMembers(item.target_unit_id);
}
function needRoster(list) { return list.some(function (x) { return x && x.target_people && x.target_people.length; }) ? loadRoster().catch(function () {}) : null; }

// =====================================================================
// 내 양식 (모임·과제·체크인·공지 공통): 지금 입력 상태를 저장해 두고 누르면 그대로 채움 (날짜·마감은 빼고)
// =====================================================================
var TPLK = { c: 'session', hw: 'assignment', ci: 'checkin', ann: 'notice' };
var TPLF = {
  c: {
    get: function () { return { type: $('cType').value, title: $('cTitle').value.trim(), start: $('cStart').value, end: $('cEnd').value,
      place: getPlace(), desc: $('cDesc').value, notify: $('cNotify').checked }; },
    set: function (d) {
      $('cType').value = [].some.call($('cType').options, function (o) { return o.value === d.type; }) ? d.type : '';
      $('cTitle').value = d.title || ''; $('cStart').value = d.start || ''; $('cEnd').value = d.end || '';
      setPlace(d.place); $('cDesc').value = d.desc || ''; $('cNotify').checked = d.notify !== false;
    }, done: '날짜만 확인해주세요.'
  },
  hw: {
    get: function () { return { cat: $('hwCat').value.trim(), title: $('hwTitle').value.trim(), desc: $('hwDesc').value, feedback: $('hwFeedback').checked }; },
    set: function (d) { $('hwCat').value = d.cat || ''; $('hwTitle').value = d.title || ''; $('hwDesc').value = d.desc || ''; $('hwFeedback').checked = d.feedback !== false; },
    done: '마감만 정해주세요.'
  },
  ci: {
    get: function () { return { title: $('ciTitle').value.trim(), items: [].slice.call(document.querySelectorAll('#ciItems input:checked')).map(function (x) { return x.value; }) }; },
    set: function (d) {
      $('ciTitle').value = d.title || '';
      [].forEach.call(document.querySelectorAll('#ciItems input'), function (x) { x.checked = !d.items || d.items.indexOf(x.value) !== -1; });
    }, done: '날짜만 확인해주세요.'
  },
  ann: {
    get: function () { return { title: $('annTitle').value.trim(), body: $('annBody').value, pinned: $('annPinned').checked }; },
    set: function (d) { $('annTitle').value = d.title || ''; $('annBody').value = d.body || ''; $('annPinned').checked = !!d.pinned; },
    done: '내용을 확인하고 올려주세요.'
  }
};
var TPL = {};
function tplLoad(k) {
  var kind = TPLK[k];
  if (TPL[kind]) { tplRender(k); return; }
  $(k + 'TplBar').innerHTML = '';
  api('templates.list', { kind: kind }).then(function (l) { TPL[kind] = l || []; tplRender(k); }).catch(function () {});
}
function tplRender(k) {
  var l = TPL[TPLK[k]] || [];
  $(k + 'TplBar').innerHTML = '<span class="tpl-label">📋 내 양식</span>' + l.map(function (t) {
    return '<span class="tpl-chip"><button type="button" onclick="tplUse(\'' + k + '\',\'' + esc(t.id) + '\')">' + esc(t.name) + '</button>' +
      '<button type="button" class="tpl-x" onclick="tplDel(\'' + k + '\',\'' + esc(t.id) + '\')" aria-label="양식 지우기" title="지우기">×</button></span>';
  }).join('') + '<button type="button" class="tpl-add" onclick="tplToggleSave(\'' + k + '\')">+ 지금 입력한 걸 양식으로</button>';
}
function tplToggleSave(k) {
  var w = $(k + 'TplSave'), open = !w.classList.contains('open');
  w.classList.toggle('open', open);
  if (open) setTimeout(function () { try { $(k + 'TplName').focus(); } catch (e) {} }, 220);
}
function tplSave(k) {
  var kind = TPLK[k], name = $(k + 'TplName').value.trim(), msg = k + 'Msg';
  if (!name) { setMsg(msg, '양식 이름을 적어주세요', true); return; }
  if ((TPL[kind] || []).some(function (t) { return t.name === name; }) && !confirm('\'' + name + '\' 양식을 지금 입력한 걸로 바꿀까요?')) return;
  var data = TPLF[k].get(); data.target = pkGet(k);
  api('templates.save', { kind: kind, name: name, data: data }).then(function (t) {
    TPL[kind] = (TPL[kind] || []).filter(function (x) { return x.id !== t.id && x.name !== t.name; }).concat([t])
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    $(k + 'TplName').value = ''; $(k + 'TplSave').classList.remove('open');
    tplRender(k); haptic('success');
    setMsg(msg, '\'' + name + '\' 양식을 저장했어요. 다음엔 위에서 누르면 그대로 채워져요.');
  }).catch(function (err) { setMsg(msg, err.message, true); });
}
function tplUse(k, id) {
  var t = byId(TPL[TPLK[k]] || [], id); if (!t) return;
  var d = t.data || {};
  TPLF[k].set(d);
  pk(k).pending = d.target || null; pkApplyPending(k);
  setMsg(k + 'Msg', '\'' + t.name + '\' 양식으로 채웠어요. ' + TPLF[k].done);
}
function tplDel(k, id) {
  var kind = TPLK[k], t = byId(TPL[kind] || [], id); if (!t || !confirm('\'' + t.name + '\' 양식을 지울까요?')) return;
  api('templates.delete', { id: id }).then(function () {
    TPL[kind] = TPL[kind].filter(function (x) { return x.id !== id; }); tplRender(k);
  }).catch(function (err) { setMsg(k + 'Msg', err.message, true); });
}

function openSessModal() {
  fillTypeSelect();
  tplLoad('c');
  if (!$('cDate').value) $('cDate').value = todayStr();
  setMsg('cMsg', '');
  openModal('cModal');
  pkOpen('c');
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
  if (t.default_location && !getPlace()) setPlace(t.default_location);
}
function notifyText(r) {
  if (!r) return '';
  var t = '알림 ' + r.sent + '명에게 보냈어요';
  if (r.failed && r.failed.length) t += '\n못 받은 사람: ' + r.failed.join(', ') + ' (봇을 아직 시작하지 않았을 수 있어요)';
  return t;
}
function createSession() {
  var p = {
    team_id: S.team.id,
    meeting_type_id: $('cType').value || null,
    title: $('cTitle').value.trim() || null,
    session_date: $('cDate').value,
    start_time: $('cStart').value || null,
    end_time: $('cEnd').value || null,
    location: getPlace() || null,
    description: $('cDesc').value.trim() || null,
    notify: $('cNotify').checked
  };
  // 팀 하나를 통째로 고르면 예전처럼 팀 모임, 그 밖에는 고른 사람들로
  var tg = pkPayload('c');
  if (tg.error) { setMsg('cMsg', tg.error, true); return; }
  Object.assign(p, tg);
  if (p.team_id !== S.team.id && !p.title) { setMsg('cMsg', '다른 팀 모임은 제목을 적어주세요', true); return; }
  if (!p.meeting_type_id && !p.title) { setMsg('cMsg', '모임 유형을 고르거나 제목을 적어주세요!', true); return; }
  if (!p.session_date) { setMsg('cMsg', '날짜를 골라주세요!', true); return; }
  if (!p.start_time) { setMsg('cMsg', '시작 시간을 넣어주세요! 지각을 판단하는 기준이 돼요.', true); return; }
  if (p.end_time && p.end_time <= p.start_time) { setMsg('cMsg', '끝나는 시간이 시작보다 늦어야 해요!', true); return; }
  var btn = $('cBtn'); btn.disabled = true; setMsg('cMsg', p.notify ? '만들고 알림 보내는 중...' : '만드는 중...');
  api('sessions.create', p).then(function (s) {
    Object.assign(s, {
      start_ms: kstMs(s.session_date, s.start_time), end_ms: s.end_time ? kstMs(s.session_date, s.end_time) : kstMs(s.session_date, s.start_time) + 3 * 3600000,
      target_count: s.target_people ? s.target_people.length : targetMembersCount(s.target_unit_id), is_target: false,
      planned: { 참석: 0, 지각: 0, 불참: 0 }, final: { 참석: 0, 지각: 0, 불참: 0, 조퇴: 0 }, mine: null
    });
    if (s.team_id === S.team.id) S.sessions.push(s);
    S.sessions.sort(function (a, b) { return a.session_date + (a.start_time || '') < b.session_date + (b.start_time || '') ? -1 : 1; });
    ['cTitle', 'cStart', 'cEnd', 'cDesc'].forEach(function (id) { $(id).value = ''; }); setPlace('');
    $('cType').value = ''; pkReset('c');
    btn.disabled = false;
    haptic('success');
    renderList();
    setMsg('cMsg', '만들었어요!' + (s.notify ? '\n' + notifyText(s.notify) : ''));
    setTimeout(function () { setMsg('cMsg', ''); closeModal('cModal'); }, s.notify && s.notify.failed.length ? 6000 : 1500);
    // 대상 인원·내 대상 여부는 서버 기준으로 다시
    refreshSessions();
  }).catch(function (err) { setMsg('cMsg', err.message, true); haptic('error'); btn.disabled = false; });
}
function kstMs(d, t) { return Date.parse(d + 'T' + (String(t).length === 5 ? t + ':00' : t) + '+09:00'); }
function targetMembersCount(groupId) { return S.members ? targetMembers(groupId).length : 0; }
function refreshSessions() {
  return api('sessions.list', { team_id: S.team.id, from: addDays(-14), to: addDays(60) }).then(function (l) {
    S.sessions = l || [];
    if (S.current) S.current = byId(S.sessions, S.current.id) || S.current;
    if ($('listView').style.display !== 'none') renderList();
  }).catch(function () {});
}

// ---------------------------------------------------------------------
// 모임 하나: 내 출결 + 모두가 보는 현황 (+ 조장 이상: 출결확인·마감)
// ---------------------------------------------------------------------
function openSession(id) {
  var s = byId(S.sessions, id);
  if (!s) return;
  S.current = s; M.board = null; M.open = null;
  var wide = isWide();   // 넓은 화면: 목록은 두고 오른쪽에 상세
  $('reportView').style.display = 'none';
  $('listView').style.display = wide ? 'block' : 'none';
  $('attendWrap').classList.toggle('split', wide);
  if (wide) renderList();
  $('detailView').style.display = 'block';
  renderHead();
  $('myCard').style.display = 'block';
  $('myCard').innerHTML = '<div class="b-wait">불러오는 중...</div>';
  ['board', 'boardChips', 'boardActs', 'remindBox'].forEach(function (k) { $(k).innerHTML = ''; });
  $('boardCount').textContent = ''; setMsg('boardMsg', '');
  loadBoard(true);
  if (!wide) window.scrollTo(0, 0);
}

function loadBoard(first) {
  var s = S.current; if (!s) return;
  api('sessions.board', { session_id: s.id }).then(function (b) {
    if (!S.current || S.current.id !== s.id) return;
    M.board = b;
    Object.assign(s, b.session);   // 자동 마감 등 반영
    syncSession();
    renderDetail();
    startBoardTimer();
  }).catch(function (err) {
    if (first) $('myCard').innerHTML = '<div class="msg err">' + esc(err.message) + '</div>';
  });
}

// 현황으로 목록 카드의 숫자·내 상태도 맞춤
function syncSession() {
  var s = S.current, b = M.board; if (!s || !b) return;
  var cnt = function (k, v) { return b.members.filter(function (m) { return m.att && m.att[k] === v; }).length; };
  var me = b.members.filter(function (m) { return m.me; })[0];
  s.target_count = b.members.length;
  s.is_target = !!me;
  s.mine = me ? me.att : null;
  s.planned = { 참석: cnt('planned_status', '참석'), 지각: cnt('planned_status', '지각'), 불참: cnt('planned_status', '불참') };
  s.final = { 참석: cnt('status', '참석'), 지각: cnt('status', '지각'), 불참: cnt('status', '불참'), 조퇴: cnt('status', '조퇴') };
  if ($('listView').style.display !== 'none') renderList();
}

function renderDetail() { renderHead(); renderMine(); renderBoard(); renderRemind(); renderActs(); }

function renderHead() {
  var s = S.current, d = parseDate(s.session_date), ph = phaseOf(s);
  var tag = { cancel: '<span class="st st-취소">취소</span>', closed: '<span class="chip">마감</span>',
    live: '<span class="chip dark">진행 중</span>', before: '<span class="chip">예정</span>' }[ph];
  var lead = S.team.rank >= RANK.GROUP_LEADER;
  var nr = s.notify_result;
  $('dHead').innerHTML = '<div class="b-dhead"><h1>' + esc(sessionName(s)) + '</h1><p>' +
    (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')' + (timePlace(s) ? ' · ' + esc(timePlace(s)) : '') + '</p>' +
    '<div class="b-chips">' + tag + '<span class="chip">' + (s.target_label ? esc(s.target_label) : s.target_unit_id ? esc(groupName(s.target_unit_id)) : esc(S.team.name) + ' 전체') + '</span>' +
    (M.board && M.board.grace_min ? '<span class="chip">시작 후 ' + M.board.grace_min + '분까지 참석</span>' : '') + '</div>' +
    (s.description ? '<div class="card b-desc">' + esc(s.description) + '</div>' : '') +
    (lead && nr ? '<div class="b-notify">📨 ' + esc(notifyText(nr)) + '</div>' : '') + '</div>';
}

function renderMine() {
  var b = M.board, s = S.current, card = $('myCard');
  var me = b.members.filter(function (m) { return m.me; })[0];
  if (!me) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  var a = me.att || {}, ph = phaseOf(s);
  var h = '<div class="b-card-title">내 출결</div>';
  if (ph === 'cancel') {
    h += '<p class="b-note">취소된 모임이에요.</p>';
  } else if (ph === 'before') {
    var st = a.planned_status || '참석';
    h += '<p class="b-note">모임 시작 전까지 바꿀 수 있어요' + (a.planned_at ? ' · ' + dtLabel(a.planned_at) + ' 체크' : '') + '</p>' +
      '<div class="segmented">' + ['참석', '지각', '불참'].map(function (v, i) {
        return '<input type="radio" name="pst" id="pst' + i + '" value="' + v + '"' + (v === st ? ' checked' : '') + ' onchange="onPlanPick()"><label for="pst' + i + '">' + v + '</label>';
      }).join('') + '</div>' +
      '<div id="pReasonWrap"' + (st === '참석' ? ' style="display:none;"' : '') + '>' +
        '<label class="field-label" for="pReason">사유 <span class="hint">지각·불참이면 꼭 적어주세요</span></label>' +
        '<textarea id="pReason" rows="3" maxlength="300" placeholder="예) 회사 야근으로 30분 늦어요">' + esc(a.planned_reason || '') + '</textarea></div>' +
      '<button class="btn-primary" id="planBtn" onclick="savePlan()">' + (a.planned_status ? '체크 수정' : '출결 체크') + '</button>' +
      (a.arrived_at ? '<p class="b-note b-center">' + hmOf(a.arrived_at) + ' 도착 확인됨 ✓</p>' : '');
  } else {
    h += '<div class="b-mine-row"><span>사전 체크</span>' + (a.planned_status ? planChip(a.planned_status) : '<span class="st st-none">안 함</span>') + '</div>' +
      '<div class="b-mine-row"><span>현장 확인</span><span>' + (a.status
        ? chip(a.status) + (a.arrived_at ? ' <small>' + hmOf(a.arrived_at) + (a.checked_by_name ? ' · ' + esc(a.checked_by_name) : '') + '</small>' : '')
        : '<span class="st st-none">' + (ph === 'closed' ? '미확인' : '확인 전') + '</span>') + '</span></div>';
    if (!a.status && ph === 'live') h += '<p class="b-note">도착하면 조장님이 이름을 눌러 출결확인을 해줘요. 시작 시간이 지나서 확인되면 지각으로 기록돼요.</p>';
    if (LATE_LIKE.indexOf(a.status) !== -1) {
      h += '<label class="field-label" for="fReason">' + a.status + ' 사유' + (a.reason ? '' : ' <span class="b-need">입력해주세요</span>') + '</label>' +
        '<textarea id="fReason" rows="3" maxlength="300" placeholder="' + (a.status === '불참' ? '예) 갑자기 야근이 잡혔어요' : '예) 지하철 지연으로 늦었어요') + '">' + esc(a.reason || '') + '</textarea>' +
        '<button class="btn-primary" id="reasonBtn" onclick="saveReason()">사유 저장</button>';
    }
  }
  card.innerHTML = h + '<div class="msg" id="myMsg"></div>';
}

function onPlanPick() {
  var v = document.querySelector('input[name="pst"]:checked').value;
  $('pReasonWrap').style.display = v === '참석' ? 'none' : 'block';
}

function savePlan() {
  var s = S.current; if (!s) return;
  var st = document.querySelector('input[name="pst"]:checked').value;
  var reason = st === '참석' ? '' : $('pReason').value.trim();
  if (st !== '참석' && !reason) { setMsg('myMsg', st + ' 사유를 적어주세요!', true); return; }
  var btn = $('planBtn'); btn.disabled = true; setMsg('myMsg', '저장 중...');
  api('attendance.plan', { session_id: s.id, planned_status: st, planned_reason: reason }).then(function (row) {
    patchMember(S.me.profile.id, row);
    haptic('success');
    setMsg('myMsg', st === '참석' ? '참석으로 체크했어요! 이따 봬요 🙌' : st + '으로 체크했어요. 알려줘서 고마워요!');
    refreshTodos(true);
  }).catch(function (err) { setMsg('myMsg', err.message, true); haptic('error'); btn.disabled = false; });
}

function saveReason(personId) {
  var s = S.current; if (!s) return;
  var mine = !personId;
  var box = mine ? $('fReason') : $('rs-' + personId);
  var msgId = mine ? 'myMsg' : 'amsg-' + personId;
  var reason = box.value.trim();
  if (!reason) { setMsg(msgId, '사유를 적어주세요!', true); return; }
  setMsg(msgId, '저장 중...');
  api('attendance.reason', { session_id: s.id, person_id: personId || null, reason: reason }).then(function (row) {
    patchMember(personId || S.me.profile.id, row);
    haptic('success');
    setMsg(msgId, '사유를 저장했어요!');
    if (mine) refreshTodos(true);
  }).catch(function (err) { setMsg(msgId, err.message, true); });
}

// 한 사람의 출결을 바꾸고 화면 다시 그림
function patchMember(personId, att) {
  var m = M.board && M.board.members.filter(function (x) { return x.id === personId; })[0];
  if (!m) return;
  m.att = Object.assign({}, m.att || {}, att);
  syncSession();
  renderDetail();
}

// ----- 출결 현황 (팀원 모두) -----
function boardCountChip(label, n, cls) { return '<span class="st ' + (cls || 'st-none') + '">' + esc(label) + ' ' + n + '</span>'; }

function renderBoard() {
  var b = M.board, s = S.current, ph = phaseOf(s);
  var list = b.members, total = list.length;
  var count = function (k, v) { return list.filter(function (m) { return m.att && m.att[k] === v; }).length; };
  var chips = '';
  if (ph === 'before') {
    var done = list.filter(function (m) { return m.att && m.att.planned_status; }).length;
    $('boardCount').textContent = '사전 체크 ' + done + ' / ' + total + '명';
    chips = ['참석', '지각', '불참'].map(function (v) { return boardCountChip(v, count('planned_status', v), 'st-plan st-' + v); }).join('') +
      boardCountChip('미체크', total - done);
  } else {
    var fin = list.filter(function (m) { return m.att && m.att.status; }).length;
    $('boardCount').textContent = (ph === 'closed' ? '최종 ' : '현장 확인 ') + fin + ' / ' + total + '명';
    chips = ['참석', '지각', '불참', '조퇴'].filter(function (v) { return v !== '조퇴' || count('status', v); })
      .map(function (v) { return boardCountChip(v, count('status', v), 'st-' + v); }).join('') +
      (total - fin ? boardCountChip('미확인', total - fin) : '');
  }
  $('boardChips').innerHTML = chips;

  var lead = b.can_check && ph !== 'cancel' && s.session_date <= todayStr();   // 출결확인은 모임 당일부터
  var html = '', lastGroup = '§';
  list.forEach(function (m) {
    var g = m.group || (s.target_unit_id ? '' : '조 배정 없음');
    if (g !== lastGroup) { if (g) html += '<div class="b-group-sep">' + esc(g) + '</div>'; lastGroup = g; }
    var a = m.att || {}, open = lead && M.open === m.id;
    var stHtml = ph === 'before'
      ? (a.planned_status ? '<span class="st st-' + esc(a.planned_status) + '">' + esc(a.planned_status) + '</span>' : '<span class="st st-none">미체크</span>')
      : (a.status ? chip(a.status) : '<span class="st st-none">' + (ph === 'closed' ? '미확인' : '확인 전') + '</span>');
    var sub = [];
    if (ph !== 'before' && a.planned_status) sub.push('사전 ' + a.planned_status);
    if (a.arrived_at) sub.push(hmOf(a.arrived_at) + ' 도착');
    if (ph === 'before' && a.planned_reason) sub.push(a.planned_reason);
    if (ph !== 'before' && a.reason) sub.push('사유: ' + a.reason);
    else if (ph !== 'before' && LATE_LIKE.indexOf(a.status) !== -1 && (lead || m.me)) sub.push('사유 미입력');
    html += '<div class="b-prow b-arow' + (lead ? ' tap' : '') + (open ? ' open' : '') + (m.me ? ' me' : '') + '"' +
      (lead ? ' onclick="toggleRow(\'' + esc(m.id) + '\')"' : '') + '>' +
      '<div class="nm"><b>' + esc(m.name) + '</b><span>' + esc(m.position || '') + '</span>' + (m.me ? '<i class="b-me">나</i>' : '') + '</div>' +
      '<div class="b-chs">' + stHtml + (lead ? '<span class="b-chev' + (open ? ' open' : '') + '">›</span>' : '') + '</div>' +
      (sub.length ? '<div class="rs">' + esc(sub.join(' · ')) + '</div>' : '') +
      (open ? actionPanel(m) : '') + '</div>';
  });
  $('board').innerHTML = html || '<div class="b-group-sep">대상자가 없어요</div>';
}

function toggleRow(id) { M.open = M.open === id ? null : id; renderBoard(); }

// 조장 이상: 이름을 누르면 나오는 출결확인 칸
function actionPanel(m) {
  var s = S.current, a = m.att || {}, id = esc(m.id);
  var h = '<div class="b-act" onclick="event.stopPropagation()">';
  if (s.session_date > todayStr()) {
    return h + '<p class="b-note">모임 당일부터 출결확인을 할 수 있어요</p></div>';
  }
  if (!a.arrived_at) {
    h += '<button class="btn-primary b-small" onclick="checkIn(\'' + id + '\')">✓ 출결확인 <small>(지금 ' + nowHm() + ')</small></button>' +
      '<div class="b-at"><span>깜빡하고 늦게 누른다면, 실제 도착 시각</span>' +
      '<div class="b-at-row"><input type="time" id="at-' + id + '"><button type="button" onclick="checkIn(\'' + id + '\', true)">이 시각으로</button></div></div>';
  } else {
    h += '<div class="b-note">' + hmOf(a.arrived_at) + ' 확인' + (a.checked_by_name ? ' · ' + esc(a.checked_by_name) : '') + '</div>' +
      '<button class="ghost-btn" onclick="uncheck(\'' + id + '\')">확인 취소 (잘못 눌렀어요)</button>';
  }
  h += '<label class="field-label">최종 출결 직접 바꾸기 <span class="hint">조퇴·사정 인정 등</span></label><div class="b-stbtns">' +
    ['참석', '지각', '불참', '조퇴'].map(function (v) {
      return '<button type="button" class="b-stbtn' + (a.status === v ? ' on' : '') + '" onclick="setStatus(\'' + id + '\',\'' + v + '\')">' + v + '</button>';
    }).join('') + '</div>';
  if (a.planned_reason) h += '<div class="b-note">사전 사유: ' + esc(a.planned_reason) + '</div>';
  if (LATE_LIKE.indexOf(a.status) !== -1) {
    h += '<label class="field-label" for="rs-' + id + '">' + esc(a.status) + ' 사유 <span class="hint">본인 대신 적을 때</span></label>' +
      '<textarea id="rs-' + id + '" rows="2" maxlength="300">' + esc(a.reason || '') + '</textarea>' +
      '<button class="ghost-btn" onclick="saveReason(\'' + id + '\')">사유 저장</button>';
  }
  return h + '<div class="msg" id="amsg-' + id + '"></div></div>';
}

function memberName(id) { var m = M.board.members.filter(function (x) { return x.id === id; })[0]; return m ? m.name : ''; }

function checkIn(personId, useAt) {
  var s = S.current; if (!s) return;
  var at = null;
  if (useAt) {
    at = $('at-' + personId).value;
    if (!at) { setMsg('amsg-' + personId, '도착 시각을 넣어주세요!', true); return; }
  }
  setMsg('amsg-' + personId, '확인 중...');
  api('attendance.check', { session_id: s.id, person_id: personId, at: at }).then(function (r) {
    M.open = null;
    patchMember(personId, r);
    haptic(r.status === '지각' ? 'warning' : 'success');
    setMsg('boardMsg', '✓ ' + memberName(personId) + ' ' + hmOf(r.arrived_at) + ' ' + r.status + (r.late_min ? ' (' + r.late_min + '분 늦음)' : ''));
  }).catch(function (err) { setMsg('amsg-' + personId, err.message, true); haptic('error'); });
}

function uncheck(personId) {
  if (!confirm(memberName(personId) + '님 출결확인을 취소할까요?')) return;
  api('attendance.uncheck', { session_id: S.current.id, person_id: personId }).then(function (r) {
    r.checked_by_name = null;
    patchMember(personId, r);
    setMsg('boardMsg', memberName(personId) + '님 확인을 취소했어요');
  }).catch(function (err) { setMsg('amsg-' + personId, err.message, true); });
}

function setStatus(personId, status) {
  api('attendance.setStatus', { session_id: S.current.id, person_id: personId, status: status }).then(function (r) {
    patchMember(personId, r);
    haptic('success');
    setMsg('amsg-' + personId, status + '(으)로 바꿨어요');
  }).catch(function (err) { setMsg('amsg-' + personId, err.message, true); });
}

// ----- 사전체크 알림: 교관 이상은 버튼으로 미체크자에게 보냄, 자동 알림(72·24시간 전) 상태도 보여줌 -----
function renderRemind() {
  var s = S.current, b = M.board, box = $('remindBox');
  if (!b || phaseOf(s) !== 'before' || S.team.rank < RANK.INSTRUCTOR) { box.innerHTML = ''; return; }
  var left = b.members.filter(function (m) { return !(m.att && (m.att.planned_status || m.att.status)); });
  var start = s.start_ms, created = s.created_at ? Date.parse(s.created_at) : 0;
  // 자동 알림 한 줄: 보냄 / 예정 / 건너뜀(그 시점 뒤에 만든 모임)
  var auto = function (h, at) {
    if (!start) return '';
    var when = start - h * 3600000, label = h + '시간 전';
    if (at) return '<span class="rm-ok">✓ ' + label + ' 보냄</span>';
    if (created && created >= when) return '<span class="rm-skip">' + label + ' · 만들 때 알림으로 대신</span>';
    if (Date.now() >= when) return '<span class="rm-skip">' + label + ' · 곧 보내요</span>';
    return '<span>' + label + ' · ' + dtLabel(new Date(when).toISOString()) + ' 예정</span>';
  };
  var rr = s.remind_result, last = rr && rr.kind === 'manual'
    ? '<div class="rm-last">마지막: ' + dtLabel(rr.at) + ' ' + esc(rr.by || '') + '님이 ' + rr.sent + '명에게 보냄' +
      (rr.failed && rr.failed.length ? ' · 못 받은 사람 ' + esc(failText(rr)) : '') + '</div>' : '';
  box.innerHTML = '<div class="card b-remind">' +
    '<div class="rm-top"><div><b>🔔 사전체크 알림</b><small>' +
      (left.length ? '아직 체크 안 한 사람 ' + left.length + '명: ' + esc(left.map(function (m) { return m.name; }).join(', ')) : '모두 사전체크를 했어요') + '</small></div>' +
      (left.length ? '<button type="button" class="rm-btn" id="remindBtn" onclick="sendRemind()">미체크 ' + left.length + '명에게 알림</button>' : '') + '</div>' +
    (start ? '<div class="rm-auto">자동 알림 ' + auto(72, s.reminded_72h_at) + auto(24, s.reminded_24h_at) + '</div>' : '') +
    last + '<div class="msg" id="remindMsg"></div></div>';
}
// '신효지(봇과 대화를 시작하지 않음), …'
function failText(r) {
  return r.failed.map(function (n) { return r.why && r.why[n] ? n + '(' + r.why[n] + ')' : n; }).join(', ');
}
function sendRemind() {
  var b = M.board, s = S.current;
  var n = b.members.filter(function (m) { return !(m.att && (m.att.planned_status || m.att.status)); }).length;
  if (!confirm('사전체크 안 한 ' + n + '명에게 텔레그램 알림을 보낼까요?\n(나도 아직 체크 안 했으면 같이 받아요)')) return;
  var btn = $('remindBtn'); btn.disabled = true; setMsg('remindMsg', '보내는 중...');
  api('sessions.remind', { id: s.id }).then(function (r) {
    s.reminded_manual_at = r.reminded_manual_at; s.remind_result = r;
    haptic('success'); renderRemind();
    setMsg('remindMsg', r.sent + '명에게 보냈어요' + (r.failed.length ? '\n못 받은 사람: ' + failText(r) : ''), !r.sent && r.failed.length);
  }).catch(function (err) { btn.disabled = false; setMsg('remindMsg', err.message, true); haptic('error'); });
}

// ----- 마감·취소·지우기 (조장 이상) -----
function renderActs() {
  var s = S.current, ph = phaseOf(s), b = M.board;
  if (!b.can_check || ph === 'cancel') { $('boardActs').innerHTML = ''; return; }
  var left = b.members.filter(function (m) { return !(m.att && m.att.status); }).length;
  var h = '';
  if (ph === 'live') {
    h += '<button class="btn-primary" onclick="closeSess()">출결 마감하기</button>' +
      '<p class="b-note b-center">미확인 ' + left + '명은 불참으로 기록돼요.<br>끝나는 시간(' + hmMs(s.end_ms) + ')이 지나면 자동으로 마감돼요.</p>';
  } else if (ph === 'closed') {
    h += '<p class="b-note b-center">' + dtLabel(s.closed_at) + ' 마감됨 · 늦게 온 사람은 이름을 눌러 출결확인하면 지각으로 바뀌어요</p>';
  } else {
    h += '<p class="b-note b-center">모임 당일 시작 시간(' + hmMs(s.start_ms || s.end_ms) + ')부터 현장 출결확인을 해요.<br>이름을 누르면 출결확인 버튼이 나와요.</p>';
  }
  if (ph !== 'closed') {
    h += '<button class="ghost-btn b-danger" onclick="cancelSess()">모임 취소 (대상자에게 알림)</button>' +
      '<button class="ghost-btn" onclick="deleteSess()">잘못 만들었어요 · 지우기</button>';
  }
  $('boardActs').innerHTML = h;
}

function closeSess() {
  var left = M.board.members.filter(function (m) { return !(m.att && m.att.status); }).length;
  if (!confirm('지금 마감할까요?' + (left ? '\n미확인 ' + left + '명은 불참으로 기록돼요.' : ''))) return;
  api('sessions.close', { session_id: S.current.id }).then(function () {
    haptic('success'); loadBoard();
    setMsg('boardMsg', '마감했어요. 불참인 사람에게 사유 입력 칸이 생겨요.');
  }).catch(function (err) { alertMsg(err.message); });
}
function cancelSess() {
  if (!confirm('이 모임을 취소할까요? 대상자에게 취소 알림이 가요.')) return;
  api('sessions.update', { id: S.current.id, status: '취소' }).then(function (s) {
    Object.assign(S.current, s);
    haptic('success'); renderDetail(); renderList();
    setMsg('boardMsg', '취소했어요.' + (s.notify ? ' ' + notifyText(s.notify) : ''));
  }).catch(function (err) { alertMsg(err.message); });
}
function deleteSess() {
  if (!confirm('이 모임과 체크 기록을 모두 지울까요? (알림은 가지 않아요)')) return;
  var id = S.current.id;
  api('sessions.delete', { id: id }).then(function () {
    S.sessions = S.sessions.filter(function (x) { return x.id !== id; });
    showList();
  }).catch(function (err) { alertMsg(err.message); });
}

// 열어둔 모임은 30초마다 새로 (입력 중이거나 이름을 펼쳐 둔 동안은 쉼)
function startBoardTimer() {
  stopBoardTimer();
  var ph = S.current && phaseOf(S.current);
  if (ph !== 'before' && ph !== 'live') return;
  M.timer = setInterval(function () {
    if (document.visibilityState !== 'visible' || !S.current || M.open) return;
    var ae = document.activeElement;
    if (ae && /TEXTAREA|INPUT/.test(ae.tagName) && $('detailView').contains(ae)) return;
    loadBoard();
  }, 30000);
}
function stopBoardTimer() { if (M.timer) { clearInterval(M.timer); M.timer = null; } }

// =====================================================================
// 월간 출결 리포트 (조장 이상은 팀 전체, 팀원은 본인)
// =====================================================================
function curMonth() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
function monthLabel(m) { var p = m.split('-'); return p[0] + '년 ' + (+p[1]) + '월'; }

function showReport() {
  S.current = null; stopBoardTimer();
  $('listView').style.display = 'none';
  $('detailView').style.display = 'none';
  $('attendWrap').classList.remove('split');
  $('reportView').style.display = 'block';
  if (!R.month) R.month = curMonth();
  try { if (tg && tg.BackButton) tg.BackButton.hide(); } catch (e) {}
  loadReport();
  window.scrollTo(0, 0);
}
function moveMonth(n) {
  var p = R.month.split('-'), d = new Date(+p[0], +p[1] - 1 + n, 1);
  var m = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  if (m > curMonth()) return;
  R.month = m; R.open = null; loadReport();
}
function loadReport() {
  $('rpMonth').textContent = monthLabel(R.month);
  $('rpNext').disabled = R.month >= curMonth();
  $('rpBody').innerHTML = '<div class="empty"><b>불러오는 중...</b></div>';
  var month = R.month, teamId = S.team.id;
  api('reports.monthly', { team_id: teamId, month: month }).then(function (d) {
    if (R.month !== month || S.team.id !== teamId) return;
    R.data = d; renderReport();
  }).catch(function (err) { $('rpBody').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function pctText(v) { return v == null ? '–' : (Math.round(v) === v ? v : v.toFixed(1)) + '%'; }
function toggleRp(id) { R.open = R.open === id ? null : id; renderReport(); }

function renderReport() {
  var d = R.data, team = d.scope === 'team', sm = d.summary;
  $('rpDesc').textContent = team ? S.team.name + ' 팀원마다 한 달 출결을 모아봐요' : '내 한 달 출결이에요';
  var h = '<div class="b-tiles">' +
    tile('모임', d.sessions.closed + '<small>회</small>') +
    tile(team ? '평균 출석률' : '출석률', pctText(sm.attend_rate)) +
    tile('지각', sm.지각 + '<small>건</small>') +
    tile('불참', sm.불참 + '<small>건</small>') +
    '</div>';
  if (d.sessions.open) h += '<p class="b-note">아직 마감 안 된 모임 ' + d.sessions.open + '개는 빠져 있어요.</p>';
  if (sm.missing_reason) h += '<p class="b-note b-need-line">사유 미입력 ' + sm.missing_reason + '건</p>';
  if (!d.people.length) {
    $('rpBody').innerHTML = h + '<div class="empty"><b>' + monthLabel(d.month) + '에 마감된 모임이 없어요</b>모임이 끝나면 여기에 모여요</div>';
    return;
  }
  if (team) {
    h += '<div class="section-head b-gap"><h2>사람별</h2><span class="section-count">' + d.people.length + '명 · 눌러서 사유 보기</span></div>' +
      '<div class="card b-board b-rp">' +
      '<div class="b-rp-row b-rp-head"><span>이름</span><span>출석률</span><span>참석·지각·불참</span><span>평균 지각</span></div>' +
      d.people.map(function (p) {
        var open = R.open === p.id;
        return '<div class="b-rp-row tap' + (open ? ' open' : '') + '" onclick="toggleRp(\'' + esc(p.id) + '\')">' +
          '<span class="nm"><b>' + esc(p.name) + '</b><small>' + esc(p.group || '') + '</small></span>' +
          '<span class="' + rateCls(p.attend_rate) + '">' + pctText(p.attend_rate) + '</span>' +
          '<span>' + p.참석 + ' · ' + p.지각 + ' · ' + p.불참 + (p.조퇴 ? ' <small>조퇴 ' + p.조퇴 + '</small>' : '') + '</span>' +
          '<span>' + (p.avg_late_min != null ? p.avg_late_min + '분' : '–') + '</span>' +
          (open ? '<div class="b-rp-detail">' + personDetail(p) + '</div>' : '') + '</div>';
      }).join('') + '</div>' +
      '<button class="ghost-btn" onclick="copyReport()">📋 텍스트로 복사 (텔레그램에 붙여넣기)</button>' +
      '<div class="msg" id="rpMsg"></div>';
  } else {
    h += '<div class="card b-rp-me">' + personDetail(d.people[0]) + '</div>';
  }
  $('rpBody').innerHTML = h;
}
function tile(label, val) { return '<div class="b-tile"><span>' + label + '</span><b>' + val + '</b></div>'; }
function rateCls(v) { return v == null ? '' : v >= 90 ? 'b-good' : v >= 70 ? 'b-mid' : 'b-low'; }

function personDetail(p) {
  var h = '<div class="b-rp-stats">' +
    '<span>모임 <b>' + p.total + '회</b></span>' +
    '<span>정시 참석 <b>' + pctText(p.on_time_rate) + '</b></span>' +
    '<span>지각률 <b>' + pctText(p.late_rate) + '</b></span>' +
    '<span>불참률 <b>' + pctText(p.absent_rate) + '</b></span>' +
    '<span>사전 체크 <b>' + pctText(p.planned_rate) + '</b></span>' +
    (p.avg_late_min != null ? '<span>평균 지각 <b>' + p.avg_late_min + '분</b></span>' : '') + '</div>';
  if (!p.details.length) return h + '<p class="b-note">지각·불참 없이 모두 참석했어요 👏</p>';
  return h + '<div class="b-rp-list">' + p.details.map(function (x) {
    return '<div class="b-rp-item"><div><span class="b-rp-date">' + shortD(x.date) + '</span> ' + esc(x.title) + '</div>' +
      '<div>' + chip(x.status) + (x.late_min ? ' <small>' + x.late_min + '분</small>' : '') +
      (x.planned_status && x.planned_status !== x.status ? ' <small>(사전 ' + esc(x.planned_status) + ')</small>' : '') + '</div>' +
      '<div class="b-rp-reason' + (x.reason ? '' : ' none') + '">' + (x.reason ? esc(x.reason) : '사유 미입력') + '</div></div>';
  }).join('') + '</div>';
}

function reportText() {
  var d = R.data, sm = d.summary;
  var lines = ['[' + S.team.name + ' ' + monthLabel(d.month) + ' 출결 리포트]',
    '모임 ' + d.sessions.closed + '회 · 평균 출석률 ' + pctText(sm.attend_rate) + ' · 지각 ' + sm.지각 + '건 · 불참 ' + sm.불참 + '건', ''];
  d.people.forEach(function (p) {
    lines.push('▪ ' + p.name + (p.group ? '(' + p.group + ')' : '') + ' — 출석률 ' + pctText(p.attend_rate) +
      ' | 참석 ' + p.참석 + ' · 지각 ' + p.지각 + ' · 불참 ' + p.불참 + (p.조퇴 ? ' · 조퇴 ' + p.조퇴 : '') +
      (p.avg_late_min != null ? ' | 평균 지각 ' + p.avg_late_min + '분' : ''));
    p.details.forEach(function (x) {
      lines.push('   - ' + shortD(x.date) + ' ' + x.title + ' ' + x.status + (x.late_min ? ' ' + x.late_min + '분' : '') + ': ' + (x.reason || '사유 미입력'));
    });
  });
  return lines.join('\n');
}
function copyReport() {
  var text = reportText();
  var done = function () { setMsg('rpMsg', '복사했어요! 텔레그램에 붙여넣으면 돼요.'); haptic('success'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text) ? done() : setMsg('rpMsg', '복사하지 못했어요', true); });
  } else if (fallbackCopy(text)) done(); else setMsg('rpMsg', '복사하지 못했어요', true);
}
function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
  return ok;
}

function alertMsg(m) { try { if (tg && tg.showAlert) { tg.showAlert(m); return; } } catch (e) {} alert(m); }

// =====================================================================
// 하단 탭
// =====================================================================
var curTab = 'home';
var VIEWS = { home: 'homeView', town: 'townView', attend: 'attendWrap', notice: 'noticeView', task: 'taskView', weekly: 'weeklyView', rec: 'recView', profile: 'profileView', poll: 'pollView' };
function goTab(t) {
  if (t === curTab) return;
  if (curTab === 'weekly' && W.dirty && !confirm('저장하지 않은 칸이 있어요. 그래도 넘어갈까요?')) return;
  if (curTab === 'poll' && PL.dirty && !confirm('저장하지 않은 칸이 있어요. 그래도 넘어갈까요?')) return;
  closeModal(); closeFabMenu();
  setTabUI(t);
  refreshTodos();
  $('stateBox').style.display = 'none';
  S.current = null; stopBoardTimer();
  try { if (tg && tg.BackButton) tg.BackButton.hide(); } catch (e) {}
  refreshTab();
  window.scrollTo(0, 0);
}
// 과제·업무가능은 아래 탭에 없음: 과제는 공지 안(또는 프로필 '내 과제'), 업무가능은 프로필 안. 아래 탭은 그 부모가 켜짐
var taskFrom = 'notice';
function parentTab(t) { return t === 'weekly' || t === 'poll' ? 'profile' : t === 'task' ? taskFrom : t; }
function goTask(from) {
  taskFrom = from;
  if (curTab === 'task') { setTabUI('task'); loadTasks(); return; }
  goTab('task');
}
function renderTaskSeg() {
  var seg = taskFrom === 'profile'
    ? [['나의 기록', "goTab('profile')", 0], ['내 과제', '', 1], ['업무가능', "goTab('weekly')", 0], ['시간취합', "goTab('poll')", 0]]
    : [['공지', "goTab('notice')", 0], ['과제', '', 1]];
  $('taskSeg').innerHTML = seg.map(function (x) {
    return '<button class="wkchip' + (x[2] ? ' active' : '') + '"' + (x[1] ? ' onclick="' + x[1] + '"' : '') + '>' + x[0] + '</button>';
  }).join('');
  $('todoAreaTask').style.display = taskFrom === 'profile' ? '' : 'none';
  $('taskDesc').textContent = taskFrom === 'profile' ? '나에게 하달된 과제예요. 눌러서 제출해주세요' : '과제를 눌러 제출하고, 제출 현황을 봐요';
}
function setTabUI(t) {
  curTab = t;
  var pt = parentTab(t);
  document.querySelectorAll('#tabbar .tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === pt); });
  if (t === 'task') renderTaskSeg();
  Object.keys(VIEWS).forEach(function (k) { $(VIEWS[k]).style.display = k === t ? '' : 'none'; });
  $('teamTabs').style.display = t !== 'weekly' && t !== 'poll' && t !== 'home' && t !== 'town' && t !== 'rec' && t !== 'profile' && S.me && S.me.teams.length > 1 ? 'flex' : 'none';
  document.body.classList.toggle('town-mode', t === 'town');
}
// 지금 탭의 내용을 (팀이 바뀌었으면 새로) 그림
function refreshTab() {
  if (curTab === 'home') loadDashboard();
  else if (curTab === 'town') startTown();
  else if (curTab === 'attend') showList();
  else if (curTab === 'notice') loadNotices();
  else if (curTab === 'task') loadTasks();
  else if (curTab === 'weekly' && !W.data) openWeekly('next');
  else if (curTab === 'rec') loadRec();
  else if (curTab === 'profile') loadProfile();
  else if (curTab === 'poll') loadPolls();
}

// =====================================================================
// 주간 업무가능 시간 취합 (월~일, 30분 칸. 칸 번호 0 = 00:00~00:30 … 47 = 23:30~24:00)
// =====================================================================
var W = {
  which: 'next', data: null, mine: {}, dirty: false,
  view: 'mine', board: null, team: '', sel: '', fixed: [], fixedSaved: [], fixedOpen: true
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
    W.fixedSaved = JSON.parse(JSON.stringify(W.fixed));
    $('wkViewTabs').style.display = d.can_view ? 'flex' : 'none';
    switchWk('mine');
    if (!d.mine.submitted) setMsg('wkMsg', which === 'next'
      ? '업무가 가능한 칸을 칠하고 저장하면 제출돼요. 되는 시간이 없으면 빈 채로 저장해도 돼요.'
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
// get: 칠한 칸 저장소를 돌려주는 함수, dirty: 바뀌었을 때 (기본은 업무가능)
function bindPaint(grid, get, dirty) {
  get = get || function () { return W.mine; };
  dirty = dirty || markWkDirty;
  var mode = null, hold = null, sx = 0, sy = 0, startEl = null;
  function cellAt(x, y) {
    var el = document.elementFromPoint(x, y);
    if (el && el.classList && el.classList.contains('bl')) el = el.parentNode;
    return el && el.classList && el.classList.contains('gc') && grid.contains(el) ? el : null;
  }
  function paint(el) {
    if (!el) return;
    var k = el.getAttribute('data-k');
    var st = get();
    if (!!st[k] === mode) return;
    if (mode) st[k] = true; else delete st[k];
    el.classList.toggle('on', mode);
    dirty();
  }
  function begin(el) { mode = !get()[el.getAttribute('data-k')]; paint(el); grid.classList.add('painting'); }
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
    if (hold && startEl) { clearTimeout(hold); hold = null; mode = !get()[startEl.getAttribute('data-k')]; paint(startEl); }
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
    refreshTodos(true);
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
    return '<button type="button" class="wkchip' + (t === W.team ? ' active' : '') + '" data-team="' + esc(t) + '" onclick="pickWkTeam(this.getAttribute(\'data-team\'))">' + (t ? esc(t) : '전체') + '</button>';
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
function openFx() {
  renderFx();
  $('fxCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// 오른쪽: 저장된 고정 일정 목록 (왼쪽에서 고치는 중인 내용이 아니라, 서버에 저장된 것)
function fxDaysText(days) {
  var order = [1, 2, 3, 4, 5, 6, 0], on = order.filter(function (d) { return days.indexOf(d) !== -1; });
  if (on.length === 7) return '매일';
  // 이어지는 요일은 '월~금'처럼 묶음
  var runs = [], cur = null;
  order.forEach(function (d, i) {
    if (days.indexOf(d) !== -1) { if (cur && cur.end === i - 1) cur.end = i; else { cur = { start: i, end: i }; runs.push(cur); } }
  });
  return runs.map(function (r) {
    var a = FX_DAYS[r.start][1], b = FX_DAYS[r.end][1];
    return r.end - r.start >= 2 ? a + '~' + b : r.end > r.start ? a + '·' + b : a;
  }).join('·');
}
function fxHours(f) {
  var m = function (t) { var p = t.split(':'); return +p[0] * 60 + +p[1]; };
  var h = (m(f.end) - m(f.start)) / 60 * f.weekdays.length;
  return Math.round(h * 10) / 10;
}
function renderFxSaved() {
  var l = W.fixedSaved || [];
  $('fxSavedCount').textContent = l.length ? l.length + '개' : '';
  $('fxSaved').innerHTML = l.length ? l.map(function (f) {
    return '<div class="fx-row"><div class="fx-row-top"><b>' + esc(f.title) + '</b><span>' + esc(f.start) + ' ~ ' + esc(f.end) + '</span></div>' +
      '<div class="fx-row-days">' + FX_DAYS.map(function (d) {
        return '<i class="' + (f.weekdays.indexOf(d[0]) !== -1 ? 'on' : '') + '">' + d[1] + '</i>';
      }).join('') + '<small>' + fxDaysText(f.weekdays) + ' · 주 ' + fxHours(f) + '시간</small></div></div>';
  }).join('') : '<div class="empty inner"><b>저장된 고정 일정이 없어요</b>왼쪽에서 추가하고 저장하면 여기에 모여요</div>';
}
function timeOptions(sel) {
  var h = '';
  for (var s = 0; s <= 48; s++) { var v = s === 48 ? '24:00' : slotHm(s); h += '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + v + '</option>'; }
  return h;
}
function renderFx() {
  renderFxSaved();
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
    W.fixed = list; W.fixedSaved = JSON.parse(JSON.stringify(list)); btn.disabled = false; haptic('success');
    renderFx(); renderWkQuick(); renderWkGrid();
    setMsg('fxMsg', '저장했어요! 칠하는 화면에 음영으로 보여요.');
  }).catch(function (err) { btn.disabled = false; setMsg('fxMsg', err.message, true); });
}

// =====================================================================
// 공통: 대상(조) 고르기, 접었다 펴기, 날짜·시간 표시
// =====================================================================
// =====================================================================
// 시간취합 (가능시간 투표): 누구나 만들고, 대상자가 30분 칸을 칠해 다 같이 되는 때를 찾음
// 화면 칸 키 = '날짜번호-30분칸', 서버로는 날짜번호*48 + 30분칸
// =====================================================================
var PL = { list: null, cur: null, mine: {}, dirty: false, view: 'mine', sel: '', fixed: [], pending: null };
function markPlDirty() { PL.dirty = true; $('plSaveBtn').classList.add('dirty'); }
function plKeys(nums) { var m = {}; (nums || []).forEach(function (n) { m[Math.floor(n / 48) + '-' + (n % 48)] = true; }); return m; }

function loadPolls() {
  if (!PL.list) $('pollOpen').innerHTML = '<div class="b-wait">불러오는 중...</div>';
  return api('polls.list').then(function (list) {
    PL.list = list; renderPolls();
    if (PL.pending) { var id = PL.pending; PL.pending = null; openPoll(id); }
  }).catch(function (err) { $('pollOpen').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function pollState(p) {
  if (!p.open) return { t: '마감', c: 'st-none' };
  if (!p.is_target) return { t: '진행 중', c: 'st-none' };
  return p.answered ? { t: '입력 완료', c: 'st-참석' } : { t: '입력 전', c: 'st-불참' };
}
function pollCard(p) {
  var st = pollState(p), sel = PL.cur && PL.cur.id === p.id;
  var days = p.start_date === p.end_date ? shortD(p.start_date) : shortD(p.start_date) + ' ~ ' + shortD(p.end_date);
  return '<button class="b-session b-task' + (sel ? ' b-sel' : '') + '" onclick="openPoll(\'' + esc(p.id) + '\')"><div class="b-info">' +
      (p.is_mine ? '<span class="chip b-cat">내가 만듦</span>' : '') +
      '<b>' + esc(p.title) + '</b><span>' + days + ' · 마감 ' + dtLabel(p.deadline) + (p.is_mine ? '' : ' · ' + esc(p.owner)) + '</span></div>' +
    '<div class="b-side"><span class="st ' + st.c + '">' + st.t + '</span><small>응답 ' + p.responded + '/' + p.count + '명</small></div></button>';
}
function renderPolls() {
  var open = PL.list.filter(function (p) { return p.open; }), past = PL.list.filter(function (p) { return !p.open; });
  $('pollOpenCount').textContent = open.length ? open.length + '개' : '';
  $('pollOpen').innerHTML = open.length ? open.map(pollCard).join('')
    : '<div class="empty"><b>진행 중인 시간취합이 없어요</b>+ 버튼으로 모일 시간을 물어볼 수 있어요</div>';
  $('pollPast').innerHTML = past.length ? past.map(pollCard).join('') : '<div class="empty"><b>최근 마감된 취합이 없어요</b></div>';
}

function openPoll(id) {
  if (PL.dirty && PL.cur && PL.cur.id !== id && !confirm('저장하지 않은 칸이 있어요. 그래도 넘어갈까요?')) return;
  var wide = isWide();
  $('pollList').style.display = wide ? 'block' : 'none';
  $('pollView').classList.toggle('split', wide);
  $('pollDetail').style.display = 'block';
  $('plHead').innerHTML = '<div class="b-dhead"><h1>불러오는 중...</h1></div>';
  $('plGrid').innerHTML = ''; $('plActs').innerHTML = ''; setMsg('plMsg', '');
  try { if (tg && tg.BackButton) tg.BackButton.show(); } catch (e) {}
  if (!wide) window.scrollTo(0, 0);
  return api('polls.get', { id: id }).then(function (d) {
    PL.cur = d; PL.dirty = false; PL.sel = ''; $('plSaveBtn').classList.remove('dirty');
    PL.mine = plKeys(d.mine.slots);
    PL.fixed = groupFixedRows(d.fixed);
    $('plMemo').value = d.mine.memo || '';
    if (PL.list && wide) renderPolls();
    renderPollHead();
    switchPoll(d.is_target && d.open ? 'mine' : 'result');
  }).catch(function (err) {
    $('plHead').innerHTML = '<div class="b-dhead"><h1>열 수 없어요</h1><p>' + esc(err.message) + '</p></div>';
    $('plTabs').style.display = 'none'; $('plMine').style.display = 'none'; $('plResult').style.display = 'none';
  });
}
function closePoll() {
  if (PL.dirty && !confirm('저장하지 않은 칸이 있어요. 그래도 닫을까요?')) return;
  PL.cur = null; PL.dirty = false;
  $('pollView').classList.remove('split');
  $('pollDetail').style.display = 'none';
  $('pollList').style.display = 'block';
  try { if (tg && tg.BackButton) tg.BackButton.hide(); } catch (e) {}
  if (PL.list) renderPolls();
}
function renderPollHead() {
  var d = PL.cur, n = d.people.filter(function (p) { return p.answered; }).length;
  var days = d.dates.length === 1 ? shortD(d.dates[0]) : shortD(d.dates[0]) + ' ~ ' + shortD(d.dates[d.dates.length - 1]);
  $('plHead').innerHTML = '<div class="b-dhead"><h1>' + esc(d.title) + '</h1><p>' + days + ' · ' + d.hour_from + '시~' + d.hour_to + '시 · ' +
    esc(d.owner) + '님이 만듦</p><div class="b-chips">' +
    '<span class="chip' + (d.open ? '' : ' dark') + '">' + (d.open ? '마감 ' + dtLabel(d.deadline) : '마감됨') + '</span>' +
    '<span class="chip">응답 ' + n + '/' + d.people.length + '명</span>' +
    (d.is_target && d.open ? '<span class="chip' + (d.mine.answered ? ' dark' : ' bad') + '">' + (d.mine.answered ? '내 입력 완료' : '아직 입력 전') + '</span>' : '') +
    '</div></div>';
  var tabs = d.is_target && d.open;
  $('plTabs').style.display = tabs ? 'flex' : 'none';
  var a = '';
  if (d.is_mine) {
    var wait = d.people.filter(function (p) { return !p.answered && p.id !== S.me.profile.id; }).length;
    a = '<div class="card b-pad b-gap"><div class="b-card-title">만든 사람 메뉴</div><div class="pd-actions">' +
      (d.open && wait ? '<button class="ghost-btn" type="button" onclick="remindPoll()">🔔 안 한 ' + wait + '명에게 다시 알림</button>' : '') +
      (d.open ? '<button class="ghost-btn" type="button" onclick="closePollNow()">지금 마감</button>' : '') +
      '<button class="ghost-btn b-danger" type="button" onclick="deletePoll()">지우기</button></div><div class="msg" id="plActMsg"></div></div>';
  }
  $('plActs').innerHTML = a;
}
function switchPoll(v) {
  PL.view = v;
  document.querySelectorAll('.pl-v').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-v') === v); });
  $('plMine').style.display = v === 'mine' ? 'block' : 'none';
  $('plResult').style.display = v === 'result' ? '' : 'none';
  if (v === 'mine') renderPollGrid(); else renderPollResult();
}
// 그 칸에 걸리는 내 고정 일정 이름
function plBusy(di, s) {
  if (s < 0) return '';
  var wd = parseDate(PL.cur.dates[di]).getDay(), from = slotHm(s), to = slotHm(s + 1);
  for (var i = 0; i < PL.fixed.length; i++) {
    var f = PL.fixed[i];
    if (f.weekdays.indexOf(wd) !== -1 && f.start < (to === '00:00' ? '24:00' : to) && f.end > from) return f.title;
  }
  return '';
}
function plCols(n) { return 'grid-template-columns: 34px repeat(' + n + ', minmax(' + (n > 7 ? 44 : 0) + 'px, 1fr));'; }
function renderPollGrid() {
  var d = PL.cur, any = false, n = d.dates.length;
  var html = '<div class="tgrid half" style="' + plCols(n) + '">' + gridHead(d.dates);
  for (var s = d.hour_from * 2; s < d.hour_to * 2; s++) {
    var top = s % 2 === 0;
    html += '<div class="gt' + (top ? ' hr' : '') + '">' + (top ? (s / 2) + '시' : '') + '</div>';
    for (var di = 0; di < n; di++) {
      var key = di + '-' + s, bl = plBusy(di, s);
      if (bl) any = true;
      var blTop = bl && (s === d.hour_from * 2 || bl !== plBusy(di, s - 1));   // 보이는 첫 줄에도 이름
      html += '<div class="gc' + (top ? ' hr' : '') + (PL.mine[key] ? ' on' : '') + (bl ? ' busy' : '') + '" data-k="' + key + '"' +
        (bl ? ' title="' + esc(bl) + '"' : '') + '>' + (blTop ? '<span class="bl">' + esc(bl) + '</span>' : '') + '</div>';
    }
  }
  $('plGrid').innerHTML = html + '</div>';
  $('plBusyLegend').style.display = any ? 'flex' : 'none';
  bindPaint($('plGrid').firstChild, function () { return PL.mine; }, markPlDirty);
  if (!d.mine.answered) setMsg('plMsg', '되는 칸을 칠하고 저장해주세요. 되는 시간이 없으면 빈 채로 저장해도 돼요.');
}
function clearPl() { if (!Object.keys(PL.mine).length) return; PL.mine = {}; markPlDirty(); renderPollGrid(); }
function savePoll() {
  var d = PL.cur; if (!d) return;
  var slots = Object.keys(PL.mine).map(function (k) { var p = k.split('-'); return +p[0] * 48 + +p[1]; });
  var memo = $('plMemo').value.trim(), btn = $('plSaveBtn');
  btn.disabled = true; setMsg('plMsg', '저장 중...');
  api('polls.save', { id: d.id, slots: slots, memo: memo }).then(function (r) {
    PL.dirty = false; btn.classList.remove('dirty'); btn.disabled = false; haptic('success');
    var first = !d.mine.answered;
    d.mine = { slots: slots, memo: memo, answered: true };
    d.people.forEach(function (p) { if (p.id === S.me.profile.id) { p.answered = true; p.slots = slots; p.memo = memo; } });
    (PL.list || []).forEach(function (p) { if (p.id === d.id) { if (first) p.responded++; p.answered = true; } });
    renderPollHead(); if (PL.list) renderPolls();
    refreshTodos(true);
    setMsg('plMsg', r.count ? r.count + '칸 저장했어요! 마감 전까지 언제든 고칠 수 있어요.' : (memo ? '특이사항을 저장했어요.' : '되는 시간이 없다고 저장했어요.'));
  }).catch(function (err) { btn.disabled = false; setMsg('plMsg', err.message, true); haptic('error'); });
}
function pickPlCell(k) { PL.sel = PL.sel === k ? '' : k; renderPollResult(); }
function renderPollResult() {
  var d = PL.cur, n = d.dates.length, total = d.people.length, who = {};
  d.people.forEach(function (p) { p.slots.forEach(function (x) { var k = Math.floor(x / 48) + '-' + (x % 48); (who[k] = who[k] || []).push(p.name); }); });
  var runs = [];
  for (var di = 0; di < n; di++) {
    var cur = null;
    for (var s = d.hour_from * 2; s < d.hour_to * 2; s++) {
      var set = (who[di + '-' + s] || []).slice().sort().join(',');
      if (cur && set && cur.set === set) { cur.end = s + 1; continue; }
      if (cur) runs.push(cur);
      cur = set ? { di: di, start: s, end: s + 1, set: set, n: set.split(',').length } : null;
    }
    if (cur) runs.push(cur);
  }
  runs.sort(function (x, y) { return y.n - x.n || (y.end - y.start) - (x.end - x.start) || x.di - y.di || x.start - y.start; });
  $('plBest').innerHTML = runs.length
    ? '<div class="best"><h3>가장 많이 되는 시간</h3><ol>' + runs.slice(0, 3).map(function (r) {
        return '<li>' + shortD(d.dates[r.di]) + ' ' + slotHm(r.start) + '~' + slotHm(r.end) + ' <small>' + r.n + '/' + total + '명' + (r.n === total ? ' · 전원 가능 ✨' : '') + '</small></li>';
      }).join('') + '</ol></div>'
    : '<div class="empty inner"><b>아직 입력한 사람이 없어요</b>입력이 들어오면 여기에 모여요</div>';
  var html = '<div class="tgrid res half" style="' + plCols(n) + '">' + gridHead(d.dates);
  for (var s2 = d.hour_from * 2; s2 < d.hour_to * 2; s2++) {
    var top = s2 % 2 === 0;
    html += '<div class="gt' + (top ? ' hr' : '') + '">' + (top ? (s2 / 2) + '시' : '') + '</div>';
    for (var d2 = 0; d2 < n; d2++) {
      var key = d2 + '-' + s2, c = (who[key] || []).length, a = c && total ? 0.15 + 0.85 * c / total : 0;
      html += '<div class="gc' + (top ? ' hr' : '') + (c === total && c > 0 ? ' full' : '') + (PL.sel === key ? ' sel' : '') + '"' +
        (c ? ' style="background: rgba(79,78,48,' + a.toFixed(2) + '); border-color: transparent;' + (a > 0.55 ? ' color:#fff;' : '') + '"' : '') +
        ' onclick="pickPlCell(\'' + key + '\')">' + (c || '') + '</div>';
    }
  }
  $('plResGrid').innerHTML = html + '</div>';
  if (PL.sel) {
    var p2 = PL.sel.split('-'), yes = who[PL.sel] || [];
    var no = d.people.filter(function (p) { return p.answered && yes.indexOf(p.name) === -1; }).map(function (p) { return p.name; });
    $('plCellInfo').innerHTML = '<b>' + shortD(d.dates[+p2[0]]) + ' ' + slotHm(+p2[1]) + '~' + slotHm(+p2[1] + 1) + '</b><br>가능 ' + yes.length + '명: ' +
      (yes.length ? esc(yes.join(', ')) : '없음') + (no.length ? '<br>안 됨: ' + esc(no.join(', ')) : '');
  } else $('plCellInfo').textContent = '칸을 누르면 누가 되는지 보여요';
  var memos = d.people.filter(function (p) { return p.memo; });
  $('plMemos').innerHTML = memos.length
    ? '<div class="memo-list"><h3>📝 특이사항</h3>' + memos.map(function (p) { return '<div><b>' + esc(p.name) + '</b>' + esc(p.memo) + '</div>'; }).join('') + '</div>' : '';
  var wait = d.people.filter(function (p) { return !p.answered; }).map(function (p) { return p.name; });
  $('plWho').innerHTML = wait.length
    ? '<div class="who-row">아직 입력 전 <b>' + wait.length + '명</b>: ' + esc(wait.join(', ')) + '</div>'
    : '<div class="who-row"><b>모두 입력했어요 🎉</b></div>';
}
function remindPoll() {
  var d = PL.cur; if (!d) return;
  setMsg('plActMsg', '보내는 중...');
  api('polls.remind', { id: d.id }).then(function (r) {
    setMsg('plActMsg', r.sent + '명에게 다시 알렸어요' + (r.failed.length ? ' · 못 받은 사람: ' + r.failed.join(', ') + ' (봇 대화 시작 안 함 등)' : ''));
  }).catch(function (err) { setMsg('plActMsg', err.message, true); });
}
function closePollNow() {
  var d = PL.cur; if (!d || !confirm('지금 마감할까요? 마감하면 더 입력할 수 없어요.')) return;
  api('polls.close', { id: d.id }).then(function () { PL.list = null; loadPolls(); openPoll(d.id); })
    .catch(function (err) { setMsg('plActMsg', err.message, true); });
}
function deletePoll() {
  var d = PL.cur; if (!d || !confirm('「' + d.title + '」 취합과 모든 입력을 지울까요?')) return;
  api('polls.delete', { id: d.id }).then(function () { PL.dirty = false; closePoll(); PL.list = null; loadPolls(); })
    .catch(function (err) { setMsg('plActMsg', err.message, true); });
}

// ----- 만들기 팝업 -----
function tpFromChanged() {
  var f = $('tpFrom').value, t = $('tpTo').value;
  if (f && (!t || t < f)) $('tpTo').value = f;
}
function openTpModal() {
  if (!$('tpH0').options.length) {
    var o = function (a, b, sel) { var h = ''; for (var i = a; i <= b; i++) h += '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + i + '시</option>'; return h; };
    $('tpH0').innerHTML = o(0, 23, 9); $('tpH1').innerHTML = o(1, 24, 22);
  }
  if (!$('tpFrom').value) { $('tpFrom').value = addDays(1); $('tpTo').value = addDays(7); }
  if (!$('tpDue').value) { var d = new Date(); d.setDate(d.getDate() + 1); d.setHours(22, 0, 0, 0); $('tpDue').value = ymd(d) + 'T22:00'; }
  setMsg('tpMsg', '');
  openModal('tpModal');
  pkOpen('tp');
}
function createPoll() {
  var p = { title: $('tpTitle').value.trim(), start_date: $('tpFrom').value, end_date: $('tpTo').value,
    hour_from: +$('tpH0').value, hour_to: +$('tpH1').value, deadline: $('tpDue').value };
  if (!p.title) { setMsg('tpMsg', '무엇을 정하는지 적어주세요!', true); return; }
  if (!p.start_date || !p.end_date) { setMsg('tpMsg', '후보 날짜를 골라주세요!', true); return; }
  if (p.end_date < p.start_date) { setMsg('tpMsg', '끝 날짜가 시작 날짜보다 빨라요', true); return; }
  if ((parseDate(p.end_date) - parseDate(p.start_date)) / 86400000 >= 14) { setMsg('tpMsg', '후보 날짜는 14일 안으로 골라주세요', true); return; }
  if (p.hour_from >= p.hour_to) { setMsg('tpMsg', '시간대를 확인해주세요', true); return; }
  if (!p.deadline) { setMsg('tpMsg', '마감 시각을 골라주세요!', true); return; }
  var t = pkPayload('tp');
  if (t.error) { setMsg('tpMsg', t.error, true); return; }
  Object.assign(p, t);
  var btn = $('tpBtn'); btn.disabled = true; setMsg('tpMsg', '만드는 중...');
  api('polls.create', p).then(function (r) {
    btn.disabled = false; haptic('success');
    $('tpTitle').value = ''; pkReset('tp');
    setMsg('tpMsg', '만들었어요! ' + r.sent + '명에게 알림을 보냈어요.' + (r.failed.length ? ' (못 받은 사람: ' + r.failed.join(', ') + ')' : ''));
    PL.pending = r.id; PL.list = null; loadPolls();
    setTimeout(function () { setMsg('tpMsg', ''); closeModal('tpModal'); }, 1400);
  }).catch(function (err) { btn.disabled = false; setMsg('tpMsg', err.message, true); });
}

var N = { list: null, open: null };                  // 공지
var A = { list: null, current: null, subs: null, openSub: null };   // 과제
var C = { list: [], open: null };                     // 체크인
S.groups = [];

// ----- 만들기 팝업: FAB(+)로 열고 ✕·바깥 누르기·Esc·텔레그램 뒤로가기로 닫음 -----
var MODAL = null;
function openModal(id) {
  if (MODAL && MODAL !== id) closeModal();
  closeFabMenu();
  var m = $(id);
  m.classList.add('show'); m.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  MODAL = id;
  m.querySelector('.b-modal-body').scrollTop = 0;
  try { if (tg && tg.BackButton) tg.BackButton.show(); } catch (e) {}
  // PC에서만 첫 칸에 커서 (폰은 키보드가 바로 올라와 가려서 안 함)
  if (isWide()) setTimeout(function () {
    var f = m.querySelector('.b-modal-body input[type=text], .b-modal-body select, .b-modal-body textarea');
    if (f) try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); }
  }, 60);
}
// id를 주면 그 팝업이 열려 있을 때만 닫음 (저장 뒤 잠깐 기다렸다 닫을 때 다른 팝업을 닫지 않게)
function closeModal(id) {
  if (!MODAL || (id && MODAL !== id)) return;
  var m = $(MODAL);
  m.classList.remove('show'); m.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  MODAL = null;
  try { if (tg && tg.BackButton && !S.current && !A.current && !RC.current && !PL.cur) tg.BackButton.hide(); } catch (e) {}
}
// 출결 FAB: 만들 수 있는 게 하나면 바로 팝업, 둘이면 작은 메뉴를 펼침
function attFabTap() {
  var items = ['attFabCi', 'attFabSess'].filter(function (id) { return $(id).style.display !== 'none'; });
  if (items.length === 1) { items[0] === 'attFabCi' ? openCiModal() : openSessModal(); return; }
  var open = !$('attFab').classList.contains('open');
  $('attFab').classList.toggle('open', open);
  $('attFabDim').classList.toggle('show', open);
}
function closeFabMenu() {
  if (!$('attFab')) return;
  $('attFab').classList.remove('open');
  $('attFabDim').classList.remove('show');
}
function openCiModal() {
  if (!$('ciDate').value) $('ciDate').value = todayStr();
  setMsg('ciMsg', '');
  tplLoad('ci');
  openModal('ciModal');
  pkOpen('ci');
}
function openHwModal() {
  setMsg('hwMsg', '');
  tplLoad('hw');
  openModal('hwModal');
  pkOpen('hw');
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
  Promise.all([loadMembers(), needRoster(C.list)]).then(renderCheckins).catch(function (err) { $('ciBoard').innerHTML = '<div class="empty inner">' + esc(err.message) + '</div>'; });
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
    refreshTodos(true);
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
  var target = targetList(c);
  var reps = c.reports || [];
  var counts = c.items.map(function (it) {
    var n = reps.filter(function (r) { return r.item === it; }).length;
    return '<span class="chip">' + CI_EMOJI[it] + ' ' + it + ' ' + n + '/' + target.length + '</span>';
  }).join('');
  var open = C.open === c.id;
  var html = '<div class="card ci-board"><div class="ci-board-head" onclick="toggleCiBoard(\'' + esc(c.id) + '\')"><div>' +
    '<div class="ci-board-title">' + esc(c.title) + '</div><div class="b-sub">' + shortD(c.check_date) +
    (c.target_label ? ' · ' + esc(c.target_label) : c.target_unit_id ? ' · ' + esc(groupName(c.target_unit_id)) + '만' : '') + '</div></div>' +
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
  var p = { title: $('ciTitle').value.trim(), check_date: $('ciDate').value, items: items };
  if (!p.title) { setMsg('ciMsg', '제목을 적어주세요!', true); return; }
  if (!p.check_date) { setMsg('ciMsg', '날짜를 골라주세요!', true); return; }
  if (!items.length) { setMsg('ciMsg', '받을 항목을 하나 이상 골라주세요!', true); return; }
  var tg = pkPayload('ci');
  if (tg.error) { setMsg('ciMsg', tg.error, true); return; }
  Object.assign(p, tg);
  var btn = $('ciBtn'); btn.disabled = true; setMsg('ciMsg', '만드는 중...');
  api('checkins.create', p).then(function (c) {
    c.mine = {}; c.reports = S.team.rank >= RANK.GROUP_LEADER ? [] : null;
    if (c.team_id === S.team.id || (c.target_people || []).indexOf(S.me.profile.id) !== -1) C.list.unshift(c);
    pkReset('ci');
    C.list.sort(function (a, b) { return a.check_date < b.check_date ? 1 : -1; });
    $('ciTitle').value = '';
    btn.disabled = false; haptic('success');
    setMsg('ciMsg', '만들었어요! 대상자에게 체크인 버튼이 보여요.');
    renderCheckins();
    setTimeout(function () { setMsg('ciMsg', ''); closeModal('ciModal'); }, 1200);
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
  $('annFab').style.display = annTeams().length ? '' : 'none';
  if (N.list) { renderNotices(); return; }
  $('annList').innerHTML = '<div class="empty"><b>불러오는 중...</b></div>';
  api('notices.list', { team_id: S.team.id }).then(function (l) { N.list = l; renderNotices(); })
    .catch(function (err) { $('annList').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function toggleNotice(id) {
  N.open = N.open === id ? null : id;
  if (N.open) { var n = byId(N.list, id); if (n) markRead('notice', n); }
  renderNotices();
}

// ----- 확인 기록: 공지를 펼치거나 과제를 열면 '확인'으로 남음. 쓴 사람·관리자는 '확인 N명'을 눌러 명단을 봄 -----
function markRead(kind, item) {
  if (!item || item.seen) return;
  item.seen = true;   // 화면은 바로 '확인함'으로
  api('reads.mark', { kind: kind, id: item.id }).then(function () { refreshTodos(true); }).catch(function () { item.seen = false; });
}
function readChip(kind, item) {
  if (item.read_count == null) return '';
  return '<button type="button" class="b-readchip" onclick="event.stopPropagation();openReads(\'' + kind + '\',\'' + esc(item.id) + '\')">👀 확인 ' + item.read_count + '명</button>';
}
function openReads(kind, id) {
  var item = byId(kind === 'notice' ? N.list : A.list, id); if (!item) return;
  $('readModalT').textContent = '확인 현황';
  $('readModalSub').textContent = item.title;
  $('readBody').innerHTML = '<div class="b-wait">불러오는 중...</div>';
  openModal('readModal');
  api('reads.list', { kind: kind, id: id }).then(function (r) {
    item.read_count = r.read.length;
    if (kind === 'notice') renderNotices(); else renderTasks();
    var who = function (m, at) {
      return '<div class="rd-row"><span><b>' + esc(m.name) + '</b><small>' + esc([m.position, m.group].filter(Boolean).join(' · ')) + '</small></span>' +
        (at ? '<em>' + dtLabel(at) + '</em>' : '') + '</div>';
    };
    var pct = r.total ? Math.round(r.read.length / r.total * 100) : 0;
    $('readBody').innerHTML =
      '<div class="rd-bar"><div style="width:' + pct + '%"></div></div>' +
      '<p class="rd-sum">받는 사람 ' + r.total + '명 중 <b>' + r.read.length + '명</b>이 확인했어요</p>' +
      '<div class="rd-head">확인했어요 <span>' + r.read.length + '</span></div>' +
      (r.read.length ? r.read.map(function (m) { return who(m, m.at); }).join('') : '<p class="rd-empty">아직 아무도 확인하지 않았어요</p>') +
      '<div class="rd-head">아직 안 봤어요 <span>' + r.unread.length + '</span></div>' +
      (r.unread.length ? r.unread.map(function (m) { return who(m); }).join('') : '<p class="rd-empty">모두 확인했어요 🎉</p>');
  }).catch(function (err) { $('readBody').innerHTML = '<div class="msg err">' + esc(err.message) + '</div>'; });
}

function renderNotices() {
  if (!N.list.length) { $('annList').innerHTML = '<div class="empty"><b>아직 공지가 없어요</b>공지가 올라오면 여기에 보여요</div>'; return; }
  $('annList').innerHTML = N.list.map(function (n) {
    var open = N.open === n.id;
    var canDel = n.mine || (n.scope === 'team' && S.team.rank >= RANK.INSTRUCTOR);
    var long = n.body && (n.body.length > 90 || n.body.split('\n').length > 3);
    return '<div class="ann' + (n.is_pinned ? ' pinned' : '') + (n.seen ? '' : ' unseen') + '" onclick="toggleNotice(\'' + esc(n.id) + '\')">' +
      '<div class="ann-top">' + (n.seen ? '' : '<span class="chip b-new">새 글 · 눌러서 확인</span>') + (n.is_pinned ? '<span class="chip dark">📌 고정</span>' : '') +
        '<span class="chip">' + (n.target_label ? esc(n.target_label) : n.scope === 'section' ? '방송예술과 전체' : esc(S.team.name)) + '</span>' +
        (n.target_names && n.target_names.length ? '<span class="chip">' + esc(n.target_names.join('·')) + '만</span>' : '') +
        (n.target_unit_id ? '<span class="chip">' + esc(groupName(n.target_unit_id)) + '만</span>' : '') +
        '<span class="ann-date">' + mdOf(n.published_at) + '</span></div>' +
      '<div class="ann-title">' + esc(n.title) + '</div>' +
      (n.body ? '<div class="ann-body' + (open ? '' : ' clamp') + '">' + esc(n.body) + '</div>' : '') +
      '<div class="ann-foot"><span>' + esc(n.author || '') + '</span>' + readChip('notice', n) +
        (long && !open ? '<span class="ann-more">더보기</span>' : '') +
        (canDel ? '<button class="ann-hide" onclick="event.stopPropagation();deleteNotice(\'' + esc(n.id) + '\')">삭제</button>' : '') +
      '</div></div>';
  }).join('');
}

// ----- 공지 쓰기: 팀 → 직책 → 조 칩으로 좁히면 받는 사람 명단이 바로 보임 -----
// 팀 공지는 교관 이상인 팀, '전체'(방송예술과)는 팀장 이상일 때만
function annTeams() {
  var mine = S.me.teams.filter(function (t) { return t.rank >= RANK.INSTRUCTOR; });
  var lead = S.me.teams.filter(function (t) { return t.rank >= RANK.TEAM_LEADER; })[0];
  return (lead ? [{ key: 'section', name: '전체', team_id: lead.id, scope: 'section' }] : [])
    .concat(mine.map(function (t) { return { key: t.id, name: t.name, team_id: t.id, scope: 'team' }; }));
}
function openAnnEdit() {
  setMsg('annMsg', '');
  tplLoad('ann');
  openModal('annModal');
  pkOpen('ann');
}
function closeAnnEdit() { closeModal('annModal'); }

function createNotice() {
  var p = { title: $('annTitle').value.trim(), body: $('annBody').value.trim(), is_pinned: $('annPinned').checked };
  if (!p.title) { setMsg('annMsg', '제목을 적어주세요!', true); return; }
  var tg = pkPayload('ann');
  if (tg.error) { setMsg('annMsg', tg.error, true); return; }
  Object.assign(p, tg); p.scope = tg.scope === 'all' ? 'section' : 'team';   // 공지는 과 전체 = section
  var other = p.scope === 'team' && p.team_id !== S.team.id, otherName = pkTeamName(p.team_id);
  var btn = $('annBtn'); btn.disabled = true; setMsg('annMsg', '올리는 중...');
  api('notices.create', p).then(function () {
    N.list = null;   // 고정·순서 반영해서 새로 받기
    ['annTitle', 'annBody'].forEach(function (id) { $(id).value = ''; });
    $('annPinned').checked = false;
    btn.disabled = false; haptic('success');
    setMsg('annMsg', other ? '올렸어요! ' + otherName + ' 탭에서 보여요' : '공지를 올렸어요!');
    pkReset('ann');
    setTimeout(function () { closeAnnEdit(); loadNotices(); }, 1000);
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
  $('hwFab').style.display = S.team.rank >= RANK.INSTRUCTOR && taskFrom === 'notice' ? '' : 'none';
  if (A.current) { openTask(A.current.id); return; }
  $('taskDetail').style.display = 'none';
  $('taskList').style.display = 'block';
  $('taskView').classList.remove('split');
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
  var sel = A.current && A.current.id === a.id;
  return '<button class="b-session b-task' + (sel ? ' b-sel' : '') + (a.seen ? '' : ' unseen') + '" onclick="openTask(\'' + esc(a.id) + '\')"><div class="b-info">' +
      (a.seen ? '' : '<span class="chip b-new">새 과제</span>') + (a.category ? '<span class="chip b-cat">' + esc(a.category) + '</span>' : '') +
      '<b>' + esc(a.title) + '</b><span>' + (a.due_at ? '마감 ' + dtLabel(a.due_at) : '마감 없음') +
      (a.target_label ? ' · ' + esc(a.target_label) : a.target_unit_id ? ' · ' + esc(groupName(a.target_unit_id)) + '만' : '') + '</span></div>' +
    '<div class="b-side"><span class="st ' + st.c + '">' + st.t + '</span>' +
      (a.submitted_count != null ? '<small>제출 ' + a.submitted_count + '명</small>' : '') +
      (a.read_count != null ? '<small>확인 ' + a.read_count + '명</small>' : '') + '</div></button>';
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
  var p = { category: $('hwCat').value.trim() || null, title: $('hwTitle').value.trim(),
    description: $('hwDesc').value.trim() || null, due_at: due ? new Date(due).toISOString() : null,
    needs_feedback: $('hwFeedback').checked };
  if (!p.title) { setMsg('hwMsg', '과제 제목을 적어주세요!', true); return; }
  var tg = pkPayload('hw');
  if (tg.error) { setMsg('hwMsg', tg.error, true); return; }
  Object.assign(p, tg);
  var btn = $('hwBtn'); btn.disabled = true; setMsg('hwMsg', '올리는 중...');
  api('assignments.create', p).then(function (a) {
    a.my = null; a.submitted_count = S.team.rank >= RANK.GROUP_LEADER ? 0 : null; a.read_count = 0; a.seen = true;
    if (a.team_id === S.team.id || (a.target_people || []).indexOf(S.me.profile.id) !== -1) A.list.unshift(a);
    pkReset('hw');
    ['hwTitle', 'hwDesc', 'hwDue'].forEach(function (id) { $(id).value = ''; });
    btn.disabled = false; haptic('success');
    setMsg('hwMsg', '과제를 냈어요!');
    renderTasks();
    setTimeout(function () { setMsg('hwMsg', ''); closeModal('hwModal'); }, 1000);
  }).catch(function (err) { setMsg('hwMsg', err.message, true); btn.disabled = false; });
}

function openTask(id) {
  var a = byId(A.list || [], id); if (!a) return;
  if (!A.current || A.current.id !== id) { A.subs = null; A.openSub = null; }
  A.current = a;
  markRead('assignment', a);
  var wide = isWide();   // 넓은 화면: 목록은 두고 오른쪽에 상세
  $('taskList').style.display = wide ? 'block' : 'none';
  $('taskView').classList.toggle('split', wide);
  if (wide && A.list) renderTasks();
  $('taskDetail').style.display = 'block';
  var st = taskState(a);
  $('tdHead').innerHTML = '<div class="b-dhead">' + (a.category ? '<span class="chip b-cat">' + esc(a.category) + '</span>' : '') +
    '<h1>' + esc(a.title) + '</h1><p>' + (a.due_at ? '마감 ' + dtLabel(a.due_at) : '마감 없음') +
    (a.target_label ? ' · ' + esc(a.target_label) : a.target_unit_id ? ' · ' + esc(groupName(a.target_unit_id)) + '만' : '') + ' · <span class="st ' + st.c + '">' + st.t + '</span></p>' +
    (a.read_count != null ? '<div class="b-chips">' + readChip('assignment', a) + '</div>' : '') +
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
  if (!wide) window.scrollTo(0, 0);
}

function closeTask() {
  A.current = null; A.subs = null;
  $('taskView').classList.remove('split');
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
    refreshTodos(true);
    if (A.subs) { A.subs = A.subs.filter(function (x) { return x.person_id !== r.person_id; }); A.subs.push(Object.assign({ name: S.me.profile.name }, r)); renderTaskBoard(); }
  }).catch(function (err) { setMsg('tdMsg', err.message, true); btn.disabled = false; haptic('error'); });
}

// ----- 제출 현황·피드백 (조장 이상) -----
function loadTaskBoard() {
  $('tdBoard').innerHTML = '<div class="b-group-sep">불러오는 중...</div>';
  var id = A.current.id;
  Promise.all([loadMembers(), api('submissions.list', { assignment_id: id }), needRoster([A.current])]).then(function (r) {
    if (!A.current || A.current.id !== id) return;
    A.subs = r[1] || [];
    renderTaskBoard();
  }).catch(function (err) { $('tdBoard').innerHTML = '<div class="b-group-sep">' + esc(err.message) + '</div>'; });
}

function toggleSub(personId) { A.openSub = A.openSub === personId ? null : personId; renderTaskBoard(); }

function renderTaskBoard() {
  var a = A.current; if (!a || !A.subs) return;
  var target = targetList(a);
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
        (sub.file_url && /^https?:\/\//i.test(sub.file_url) ? '<a class="b-sublink" href="' + esc(sub.file_url) + '" target="_blank" rel="noopener">🔗 ' + esc(sub.file_url) + '</a>' : '') +
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
// 녹음 요청 (세 팀 교관 이상): 요청 올리기(배역) → 회차 제안(시간·장소·사람) → 각자 수락/조율 → 모두 확정되면 녹음 일정
// =====================================================================
var RC = { list: null, people: [], current: null, plan: null, planOpen: false, want: null, day: null, slot: null, sel: null, place: null, pending: null, busy: false, adding: null };
var RCF = { dur: 60, roles: [{ name: '', method: '', people: [] }] };   // 요청 올리기 팝업 입력
var REC_ST = { '접수': 'st-none', '캐스팅중': 'st-지각', '일정확정': 'st-참석', '녹음완료': 'st-참석', '편집완료': 'st-참석', '전달완료': 'st-참석', '보류': 'st-지각', '취소': 'st-취소' };
var SESS_ST = { '조율중': ['조율 중', 'st-지각'], '예정': ['확정', 'st-참석'], '완료': ['녹음 완료', 'st-참석'], '재녹음필요': ['재녹음 필요', 'st-불참'] };
var REC_ROLES = [['voice', '성우'], ['engineer', '엔지니어'], ['director', '감독']];
var KIND_ROLE = { voice: '녹음자', engineer: '엔지니어', director: '감독자' };
var DEEP_REC = (function () { try { return new URLSearchParams(location.search).get('rec'); } catch (e) { return null; } })();
var DEEP_ASK = (function () { try { return new URLSearchParams(location.search).get('ask'); } catch (e) { return null; } })();
function recAllowed() { return !!(S.me && S.me.teams.some(function (t) { return t.rank >= RANK.INSTRUCTOR; })); }
function setupRecTab() { $('recTab').style.display = recAllowed() ? '' : 'none'; }
function recIsOpen(r) { return ['접수', '캐스팅중', '일정확정', '보류'].indexOf(r.status) !== -1; }
function durText(m) { return m === 10 ? '10분 내외' : m >= 120 ? '2시간 이상' : m % 60 ? (m >= 60 ? Math.floor(m / 60) + '시간 ' : '') + (m % 60) + '분' : (m / 60) + '시간'; }
function ddText(ms) { var d = dayDiff(ms); return d < 0 ? '마감 지남' : d === 0 ? '오늘 마감' : 'D-' + d; }
function recPerson(id) { return RC.people.filter(function (p) { return p.id === id; })[0]; }
function pname(id) { var p = recPerson(id); return p ? p.name : ''; }
function activeSess(r) { return (r.sessions || []).filter(function (s) { return s.status !== '취소'; }); }
// 아직 회차에 안 들어간 배역
function freeRoles(r) {
  var live = activeSess(r).map(function (s) { return s.id; });
  return (r.roles || []).filter(function (x) { return !x.session_id || live.indexOf(x.session_id) === -1; });
}

function loadRec() {
  if (!S.team || !recAllowed()) return Promise.resolve();
  if (!RC.list) $('recOpen').innerHTML = '<div class="skeleton row-skel"></div>';
  return api('rec.list', { team_id: S.team.id }).then(function (d) {
    RC.list = d.requests; RC.people = d.people || [];
    renderRecList();
    if (RC.pending) { var id = RC.pending; RC.pending = null; if (byId(RC.list, id)) openRec(id); }
    else if (RC.current) { var c = byId(RC.list, RC.current.id); if (c) { RC.current = c; renderRecHead(); renderRecBoard(); } }
  }).catch(function (err) {
    $('recOpen').innerHTML = '<div class="empty"><b>녹음 요청을 불러오지 못했어요</b>' + esc(err.message) + '</div>';
  });
}

// ----- 진행도 계산: 회차마다 칸(장소·배역·엔지니어·감독)이 확정/대기/조율/고르기 중 무엇인지 -----
function partState(p) { return p.answer === '미선정' ? 'no' : p.answer === '조율' ? 'adj' : p.answer === '수락' ? (p.selected ? 'ok' : 'pick') : 'wait'; }
function sessRoles(r, s) { return (r.roles || []).filter(function (x) { return x.session_id === s.id; }); }
function roleState(s, roleId) {
  var ps = s.people.filter(function (p) { return p.role === '녹음자' && p.role_id === roleId && p.answer !== '미선정'; });
  if (ps.some(function (p) { return p.selected && p.answer === '수락'; })) return 'ok';
  if (ps.some(function (p) { return p.answer === '수락'; })) return 'pick';
  if (!ps.length || ps.every(function (p) { return p.answer === '조율'; })) return 'adj';
  return 'wait';
}
function sessSlots(r, s) {
  var done = s.status === '예정' || s.status === '완료';
  var out = [{ label: '장소', st: 'ok' }];
  sessRoles(r, s).forEach(function (x) { out.push({ label: x.name, st: done ? 'ok' : roleState(s, x.id) }); });
  s.people.filter(function (p) { return p.role !== '녹음자'; }).forEach(function (p) { out.push({ label: (p.role === '감독자' ? '감독 ' : '엔지니어 ') + p.name, st: done ? 'ok' : partState(p) }); });
  return out;
}
function countSt(slots) {
  var c = { ok: 0, wait: 0, adj: 0, pick: 0 };
  slots.forEach(function (x) { c[x.st] = (c[x.st] || 0) + 1; });
  return c;
}
function recProgress(r) {
  var slots = []; activeSess(r).forEach(function (s) { slots = slots.concat(sessSlots(r, s)); });
  var free = freeRoles(r).length;
  return { total: slots.length + free, ok: countSt(slots).ok, c: countSt(slots), free: free };
}

function recCard(r) {
  var sel = RC.current && RC.current.id === r.id, due = r.due_at ? Date.parse(r.due_at) : null;
  var pr = recProgress(r), next = activeSess(r).filter(function (s) { return s.status !== '완료'; })[0];
  var bar = pr.total ? '<div class="rc-mini"><i style="width:' + Math.round(pr.ok / pr.total * 100) + '%"></i></div>' : '';
  return '<button class="b-session b-task' + (sel ? ' b-sel' : '') + '" onclick="openRec(\'' + esc(r.id) + '\')"><div class="b-info">' +
      (r.request_code ? '<span class="chip b-cat">' + esc(r.request_code) + '</span>' : '') +
      '<b>' + esc(r.title || '녹음') + '</b><span>' + (due ? '마감 ' + dtLabel(r.due_at) : '마감 없음') + ' · 배역 ' + (r.roles || []).length + ' · ' + durText(r.duration_min) + '</span>' +
      (next ? '<span class="rc-when">📅 ' + esc(next.title) + ' ' + mdw(next.start) + ' ' + hmMs(next.start) + ' · ' + esc(next.location) + (next.status === '조율중' ? ' (조율 중)' : '') + '</span>' : '') +
      (recIsOpen(r) && pr.total ? bar + '<span class="rc-prog">확정 ' + pr.ok + '/' + pr.total + (pr.c.adj ? ' · 조율 필요 ' + pr.c.adj : '') + (pr.c.wait ? ' · 대기 ' + pr.c.wait : '') + (pr.free ? ' · 배치 전 ' + pr.free : '') + '</span>' : '') +
    '</div><div class="b-side"><span class="st ' + (REC_ST[r.status] || 'st-none') + '">' + esc(r.status) + '</span>' +
      (due && recIsOpen(r) ? '<small class="' + (dayDiff(due) <= 2 ? 'rc-soon' : '') + '">' + ddText(due) + '</small>' : '') + '</div></button>';
}
function renderRecList() {
  var open = RC.list.filter(recIsOpen).sort(function (a, b) { return (a.due_at || '9') < (b.due_at || '9') ? -1 : 1; });
  var past = RC.list.filter(function (r) { return !recIsOpen(r); });
  $('recOpenCount').textContent = open.length ? open.length + '건' : '';
  $('recOpen').innerHTML = open.length ? open.map(recCard).join('')
    : '<div class="empty"><b>진행 중인 녹음 요청이 없어요</b>오른쪽 아래 + 버튼으로 요청을 올려요</div>';
  $('recPast').innerHTML = past.length ? past.map(recCard).join('') : '<div class="empty"><b>최근 지난 요청이 없어요</b></div>';
  renderRecOverview(open);
}

// PC에서 요청을 고르기 전 오른쪽 칸: 다음 녹음 → 손이 필요한 요청 → 2주 녹음 달력
function renderRecOverview(open) {
  var show = isWide() && !RC.current;
  $('recView').classList.toggle('split', isWide());
  $('recView').classList.toggle('ov', show);
  $('recOverview').style.display = show ? 'block' : 'none';
  if (!show) return;
  var now = Date.now(), sess = [];
  open.forEach(function (r) { activeSess(r).forEach(function (s) { sess.push({ r: r, s: s }); }); });
  sess.sort(function (a, b) { return a.s.start - b.s.start; });
  var html = '<div class="b-dhead"><h1>녹음 한눈에</h1><p>요청을 누르면 여기에 자세히 열려요</p></div>';

  var next = sess.filter(function (x) { return x.s.status !== '완료' && (x.s.end || x.s.start) >= now; })[0];
  if (next) {
    var who = next.s.people.filter(function (p) { return p.selected && p.answer === '수락'; }).map(function (p) { return p.name; });
    html += '<button class="card tv-next" onclick="openRec(\'' + esc(next.r.id) + '\')">' +
      '<span class="tv-label">다음 녹음' + (next.s.status === '조율중' ? ' · 조율 중' : '') + '</span>' +
      '<span class="tv-dday">' + ddayText(new Date(next.s.start)) + ' ' + hmMs(next.s.start) + '</span>' +
      '<b>' + esc(next.r.title || '녹음') + (next.s.title ? ' · ' + esc(next.s.title) : '') + '</b>' +
      '<span class="tv-sub">' + mdw(next.s.start) + (next.s.location ? ', ' + esc(next.s.location) : '') + (who.length ? ' · ' + esc(who.join(', ')) : '') + '</span></button>';
  } else if (open.length) {
    html += '<div class="card tv-next tv-done"><span class="tv-label">다음 녹음</span><b>아직 잡힌 녹음 일정이 없어요</b><span class="tv-sub">요청을 눌러 가능한 시간을 찾아보세요</span></div>';
  }

  var needs = open.map(function (r) {
    var c = recProgress(r), tags = [];
    if (c.c.adj) tags.push(['bad', '조율 필요 ' + c.c.adj]);
    if (c.c.pick) tags.push(['warn', '고르기 ' + c.c.pick]);
    if (c.free) tags.push(['warn', '배치 전 ' + c.free]);
    if (c.c.wait) tags.push(['', '답 대기 ' + c.c.wait]);
    return { r: r, tags: tags };
  }).filter(function (x) { return x.tags.length; });
  html += '<div class="card tv-box"><div class="tv-head"><b>손이 필요한 요청</b><span>' + (needs.length ? needs.length + '건' : '') + '</span></div>' +
    (needs.length ? needs.map(function (x) {
      return '<button class="tv-need" onclick="openRec(\'' + esc(x.r.id) + '\')"><span>' + esc(x.r.title || '녹음') + '</span><span class="tv-tags">' +
        x.tags.map(function (t) { return '<em class="' + t[0] + '">' + t[1] + '</em>'; }).join('') + '</span></button>';
    }).join('') : '<p class="tv-empty">' + (open.length ? '모든 요청이 순조롭게 흘러가고 있어요' : '진행 중인 요청이 없어요') + '</p>') + '</div>';

  // 오늘부터 2주: 녹음 회차(확정·조율 중)와 마감
  var start = new Date(), cells = ''; start.setHours(0, 0, 0, 0);
  for (var i = 0; i < 14; i++) {
    var d = new Date(start.getTime() + i * 86400000);
    var day = sess.filter(function (x) { return sameDay(x.s.start, d); });
    var dues = open.filter(function (r) { return r.due_at && sameDay(r.due_at, d); });
    var go = (day[0] && day[0].r) || dues[0];
    var tip = day.map(function (x) { return hmMs(x.s.start) + ' ' + (x.r.title || '녹음'); }).concat(dues.map(function (r) { return (r.title || '녹음') + ' 마감'; })).join('\n');
    cells += '<button class="tv-day' + (i === 0 ? ' today' : '') + (go ? ' has' : '') + '"' +
      (go ? ' title="' + esc(tip) + '" onclick="openRec(\'' + esc(go.id) + '\')"' : ' disabled') + '>' +
      '<small>' + WD[d.getDay()] + '</small><b>' + d.getDate() + '</b><span class="tv-dots">' +
      day.map(function (x) { return '<i class="' + (x.s.status === '조율중' ? 'adj' : 'ok') + '"></i>'; }).join('') +
      dues.map(function () { return '<i class="due"></i>'; }).join('') + '</span></button>';
  }
  html += '<div class="card tv-box"><div class="tv-head"><b>2주 녹음 달력</b><span><i class="tv-dot ok"></i>확정 <i class="tv-dot adj"></i>조율 중 <i class="tv-dot due"></i>마감</span></div>' +
    '<div class="tv-cal">' + cells + '</div></div>';
  $('recOverview').innerHTML = html;
}

// ----- 요청 올리기 팝업: 예상 녹음시간 · 배역(지정/후보/미정) -----
// 마감 날짜 기본값: 일주일 뒤 (올해 연도가 미리 들어가 있게)
function rcDueDefault() { if (!$('rcDueDate').value) $('rcDueDate').value = addDays(7); $('rcDueDate').min = todayStr(); }
function rcNeedVal() { var n = parseInt($('rcNeed').value, 10); return isNaN(n) ? 1 : Math.max(1, Math.min(30, n)); }
function rcNeedStep(d) { $('rcNeed').value = Math.max(1, Math.min(30, rcNeedVal() + d)); rcRolesDraw(); }
function rcNeedInput() { if ($('rcNeed').value !== '') rcRolesDraw(); }   // 지우는 중(빈칸)엔 그대로 둠
function rcNeedFix() { $('rcNeed').value = rcNeedVal(); rcRolesDraw(); }
function openRecModal() {
  setMsg('rcMsg', '');
  rcDueDefault();
  var go = function () { rcRolesDraw(); openModal('recModal'); };
  if (!RC.people.length) loadRec().then(go); else go();
}
function rcRolesDraw() {
  var n = rcNeedVal();
  while (RCF.roles.length < n) RCF.roles.push({ name: '', method: '', people: [] });
  RCF.roles.length = n;
  var voices = RC.people.filter(function (p) { return p.voice; });
  $('rcRoles').innerHTML = RCF.roles.map(function (r, i) {
    return '<div class="rcr" data-i="' + i + '">' +
      '<div class="rcr-top">' + (n > 1 ? '<input type="text" class="b-input rcr-name" maxlength="40" placeholder="배역 ' + (i + 1) + ' 이름 (예: 내레이션)" value="' + esc(r.name) + '">' : '<span class="rcr-one">성우를 미리 정할까요?</span>') +
        '<div class="rcr-seg">' + [['', '미정'], ['지정', '지정'], ['후보', '후보']].map(function (m) {
          return '<button type="button" class="' + (r.method === m[0] ? 'on' : '') + '" data-m="' + m[0] + '">' + m[1] + '</button>';
        }).join('') + '</div></div>' +
      (r.method ? '<div class="b-picks rcr-ppl">' + (voices.length ? voices.map(function (p) {
        return '<button type="button" class="b-pick' + (r.people.indexOf(p.id) !== -1 ? ' on' : '') + '" data-p="' + esc(p.id) + '">' + esc(p.name) + '</button>';
      }).join('') : '<span class="rc-none">성우팀 명단이 없어요</span>') + '</div>' +
      '<small class="rcr-hint">' + (r.method === '지정' ? '한 명만 골라요. 이 사람이 되는 시간만 찾아요' : '여러 명 골라도 돼요. 후보 중 한 명이라도 되는 시간을 찾아요') + '</small>' : '') +
    '</div>';
  }).join('') + '<p class="b-note rc-hint">시간·장소를 정해 \'요청 보내기\'를 누르면 그때 고른 사람에게 알림이 가요</p>';
}
$('rcRoles').addEventListener('click', function (e) {
  var row = e.target.closest('.rcr'); if (!row) return;
  var r = RCF.roles[+row.getAttribute('data-i')];
  var m = e.target.closest('[data-m]'), pp = e.target.closest('[data-p]');
  if (m) { r.method = m.getAttribute('data-m'); if (r.method === '지정' && r.people.length > 1) r.people = r.people.slice(0, 1); rcRolesDraw(); }
  else if (pp) {
    var id = pp.getAttribute('data-p'), at = r.people.indexOf(id);
    if (r.method === '지정') r.people = at === -1 ? [id] : [];
    else if (at === -1) { if (r.people.length < 5) r.people.push(id); } else r.people.splice(at, 1);
    rcRolesDraw();
  }
});
$('rcRoles').addEventListener('input', function (e) {
  if (!e.target.classList.contains('rcr-name')) return;
  RCF.roles[+e.target.closest('.rcr').getAttribute('data-i')].name = e.target.value;
});
$('rcDurs').addEventListener('click', function (e) {
  var b = e.target.closest('[data-v]'); if (!b) return;
  RCF.dur = +b.getAttribute('data-v');
  [].forEach.call($('rcDurs').children, function (x) { x.classList.toggle('on', x === b); });
});
function createRec() {
  var dd = $('rcDueDate').value, due = dd ? dd + 'T' + $('rcDueTime').value : '';
  var p = { team_id: S.team.id, title: $('rcTitle').value.trim(), due_at: due ? new Date(due).toISOString() : null, duration_min: RCF.dur,
    request_dept: $('rcDept').value.trim(), requester_name: $('rcWho').value.trim(), volume_desc: $('rcVol').value.trim(), note: $('rcNote').value.trim(),
    roles: RCF.roles.map(function (r) { return { name: r.name.trim(), method: r.method || null, people: r.method ? r.people : [] }; }) };
  if (!p.title) { setMsg('rcMsg', '녹음 제목을 적어주세요!', true); return; }
  if (!due) { setMsg('rcMsg', '마감 기한을 넣어주세요!', true); return; }
  if (new Date(due).getTime() < Date.now()) { setMsg('rcMsg', '마감 기한이 이미 지났어요', true); return; }
  for (var i = 0; i < p.roles.length; i++) {
    var r = p.roles[i], nm = r.name || (p.roles.length > 1 ? '배역 ' + (i + 1) : '성우');
    if (r.method === '지정' && r.people.length !== 1) { setMsg('rcMsg', "'" + nm + "'은 지정이라 한 명을 골라주세요", true); return; }
    if (r.method === '후보' && !r.people.length) { setMsg('rcMsg', "'" + nm + "' 후보를 한 명 이상 골라주세요", true); return; }
  }
  var btn = $('rcBtn'); btn.disabled = true; setMsg('rcMsg', '올리는 중...');
  api('rec.create', p).then(function (r) {
    (RC.list = RC.list || []).unshift(r);
    ['rcTitle', 'rcDueDate', 'rcDept', 'rcWho', 'rcVol', 'rcNote'].forEach(function (id) { $(id).value = ''; });
    $('rcDueTime').value = '23:59'; rcDueDefault();
    RCF.roles = [{ name: '', method: '', people: [] }]; $('rcNeed').value = '1';
    btn.disabled = false; haptic('success');
    var n = r.notify_result || {};
    setMsg('rcMsg', r.request_code + ' 로 올렸어요! 교관 이상 ' + (n.sent || 0) + '명에게 알림을 보냈어요' + (n.failed && n.failed.length ? ' (못 받음: ' + n.failed.join(', ') + ')' : ''));
    renderRecList();
    setTimeout(function () { setMsg('rcMsg', ''); closeModal('recModal'); openRec(r.id); }, 1400);
  }).catch(function (err) { setMsg('rcMsg', err.message, true); btn.disabled = false; });
}

// ----- 상세 -----
function openRec(id) {
  var r = byId(RC.list || [], id); if (!r) return;
  if (!RC.current || RC.current.id !== id) { RC.plan = null; RC.want = null; RC.day = null; RC.slot = null; RC.sel = null; RC.place = null; RC.adding = null; RC.planOpen = false; }
  RC.current = r;
  if (!activeSess(r).length && freeRoles(r).length && recIsOpen(r) && r.status !== '보류') RC.planOpen = true;
  var wide = isWide();
  $('recListWrap').style.display = wide ? 'block' : 'none';
  $('recView').classList.toggle('split', wide);
  renderRecList();
  $('recOverview').style.display = 'none';
  $('recView').classList.remove('ov');
  $('recDetail').style.display = 'block';
  try { if (tg && tg.BackButton) tg.BackButton.show(); } catch (e) {}
  if (!wide) window.scrollTo(0, 0);
  renderRecHead(); renderRecBoard();
  if (RC.planOpen) loadRecPlan(); else $('rdPlan').innerHTML = '';
}
function closeRec() {
  RC.current = null; RC.plan = null; RC.planOpen = false;
  $('recView').classList.toggle('split', isWide());
  $('recDetail').style.display = 'none';
  $('recListWrap').style.display = 'block';
  try { if (tg && tg.BackButton) tg.BackButton.hide(); } catch (e) {}
  if (RC.list) renderRecList();
}
function renderRecHead() {
  var r = RC.current; if (!r) return;
  var n = r.notify_result, info = [
    ['마감', r.due_at ? dtLabel(r.due_at) + ' · ' + ddText(Date.parse(r.due_at)) : '없음'],
    ['예상', durText(r.duration_min)],
    ['요청', [r.request_dept, r.requester_name].filter(Boolean).join(' · ')],
    ['분량', r.volume_desc],
    ['접수', (r.received_by_name || '') + ' · ' + dtLabel(r.received_at)],
    ['알림', n ? '교관 이상 ' + n.sent + '명' + (n.failed && n.failed.length ? ' · 못 받음 ' + n.failed.join(', ') : '') : '']
  ].filter(function (x) { return x[1]; });
  var acts = r.status === '보류' ? [['다시 진행', '접수']] : recIsOpen(r) && r.status !== '일정확정' ? [['보류', '보류']] : [];
  if (recIsOpen(r)) acts.push(['요청 취소', '취소']);
  var roles = (r.roles || []).map(function (x) {
    var pre = x.pref_method && x.pref_people.length ? ' <small>' + x.pref_method + ' ' + x.pref_people.map(pname).map(esc).join('·') + '</small>' : '';
    return '<span class="rc-role-chip">' + esc(x.name) + pre + '</span>';
  }).join('');
  $('rdHead').innerHTML = '<div class="b-dhead">' + (r.request_code ? '<span class="chip b-cat">' + esc(r.request_code) + '</span>' : '') +
    '<h1>' + esc(r.title || '녹음') + '</h1><p><span class="st ' + (REC_ST[r.status] || 'st-none') + '">' + esc(r.status) + '</span></p></div>' +
    '<div class="card rc-info">' + info.map(function (x) { return '<div class="rc-row"><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') +
      '<div class="rc-row"><span>배역</span><div class="rc-roles">' + roles + '</div></div>' +
      (r.note ? '<p class="rc-note">' + esc(r.note) + '</p>' : '') +
      (acts.length ? '<div class="rc-acts">' + acts.map(function (a) { return '<button type="button" class="rc-act' + (a[1] === '취소' ? ' bad' : '') + '" onclick="setRecStatus(\'' + a[1] + '\')">' + a[0] + '</button>'; }).join('') + '</div>' : '') +
    '</div>';
}
function setRecStatus(st) {
  var r = RC.current; if (!r) return;
  if (st === '취소' && !confirm('이 녹음 요청을 취소할까요?')) return;
  api('rec.update', { id: r.id, status: st }).then(function (x) { r.status = x.status || st; haptic('success'); renderRecList(); renderRecHead(); renderRecBoard(); })
    .catch(function (err) { alertMsg(err.message); });
}

// ----- 인력 배치 현황판: 회차마다 누가 확정·대기·조율 필요인지 한눈에 -----
var ST_TXT = { ok: '✓ 확정', wait: '⋯ 대기', adj: '! 조율 필요', pick: '수락 · 고르기', no: '미선정' };
function renderRecBoard() {
  var r = RC.current; if (!r) return;
  var ss = activeSess(r), free = freeRoles(r);
  var h = '<div class="section-head b-gap"><h2>인력 배치</h2>';
  if (ss.length || free.length) {
    var pr = recProgress(r);
    h += '<span class="section-count">확정 ' + pr.ok + ' / ' + pr.total + (free.length && ss.length ? ' (배치 전 배역 ' + free.length + ' 포함)' : '') + '</span>';
  }
  h += '</div>';
  if (!ss.length && !RC.planOpen) h += '<div class="empty"><b>아직 배치를 시작하지 않았어요</b>아래 \'회차 만들기\'로 시간·장소·사람을 정해 요청을 보내요</div>';
  ss.forEach(function (s) { h += sessCard(r, s); });
  if (free.length && ss.length) h += '<div class="rc-free">배치 전 배역: ' + free.map(function (x) { return '<b>' + esc(x.name) + '</b>'; }).join(' · ') + '</div>';
  if (recIsOpen(r) && r.status !== '보류' && free.length && !RC.planOpen) h += '<button type="button" class="rc-new" data-act="plan">+ 회차 만들기 (배역 ' + free.length + '개)</button>';
  $('rdSession').innerHTML = h;
}
function sessCard(r, s) {
  var live = s.status === '조율중', slots = sessSlots(r, s), c = countSt(slots);
  var h = '<div class="card rb' + (s.status === '예정' ? ' done' : '') + '" data-sid="' + esc(s.id) + '">' +
    '<div class="rb-top"><b>' + esc(s.title || '회차') + '</b><span class="st ' + (SESS_ST[s.status] || ['', 'st-none'])[1] + '">' + (SESS_ST[s.status] || [s.status])[0] + '</span></div>' +
    '<div class="rb-when">' + mdw(s.start) + ' ' + hmMs(s.start) + (s.end ? '–' + hmMs(s.end) : '') + ' · ' + esc(s.location) + '</div>' +
    '<div class="rb-bar">' + slots.map(function (x) { return '<i class="' + x.st + '" title="' + esc(x.label + ' · ' + ST_TXT[x.st]) + '"></i>'; }).join('') + '</div>' +
    '<div class="rb-sum"><b>확정 ' + c.ok + '</b> / ' + slots.length + (c.wait ? ' · <span class="t-wait">대기 ' + c.wait + '</span>' : '') +
      (c.adj ? ' · <span class="t-adj">조율 필요 ' + c.adj + '</span>' : '') + (c.pick ? ' · <span class="t-pick">고르기 ' + c.pick + '</span>' : '') + '</div>' +
    '<div class="rb-rows">' + rbRow('ok', '장소', '<span class="rp a-ok"><b>' + esc(s.location) + '</b><i>확보</i></span>', '');
  sessRoles(r, s).forEach(function (x) {
    var ps = s.people.filter(function (p) { return p.role === '녹음자' && p.role_id === x.id; });
    h += rbRow(live ? roleState(s, x.id) : 'ok', esc(x.name), ps.map(function (p) { return rpChip(p, live); }).join(''), live ? addBtn(s, 'voice', x.id) : '') + notes(ps) + chooser(s, 'voice', x.id, ps);
  });
  ['엔지니어', '감독자'].forEach(function (role) {
    var ps = s.people.filter(function (p) { return p.role === role; }), kind = role === '감독자' ? 'director' : 'engineer';
    var st = !live ? 'ok' : !ps.length ? 'adj' : ps.every(function (p) { return partState(p) === 'ok'; }) ? 'ok' : ps.some(function (p) { return p.answer === '조율'; }) ? 'adj' : 'wait';
    h += rbRow(st, role === '감독자' ? '감독' : '엔지니어', ps.map(function (p) { return rpChip(p, live); }).join(''), live ? addBtn(s, kind, '') : '') + notes(ps) + chooser(s, kind, '', ps);
  });
  h += '</div>';
  var wait = s.people.filter(function (p) { return p.answer === '대기'; }).length;
  if (live) h += '<div class="rc-acts">' + (wait ? '<button type="button" class="rc-act" data-act="remind">🔔 답 없는 ' + wait + '명에게 다시 알림</button>' : '') +
    '<button type="button" class="rc-act bad" data-act="cancel">회차 취소</button></div>';
  else if (s.status === '예정') h += '<div class="rc-acts"><button type="button" class="rc-act ok" data-act="done">녹음 완료</button><button type="button" class="rc-act bad" data-act="cancel">회차 취소</button></div>';
  return h + '<div class="msg" id="rbMsg-' + esc(s.id) + '"></div></div>';
}
function rbRow(st, label, chips, add) {
  return '<div class="rb-row s-' + st + '"><span class="rb-l"><i></i>' + label + '</span><div class="rb-ps">' + (chips || '<span class="rc-none">아직 없어요</span>') + add + '</div></div>';
}
function rpChip(p, live) {
  var st = partState(p);
  var sub = p.role === '녹음자' ? (p.method || '') : p.from ? hmMs(p.from) + '~' + hmMs(p.to) : '';
  return '<span class="rp a-' + st + '"><b>' + esc(p.name) + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '<i>' + ST_TXT[st] + '</i>' +
    (live && st === 'pick' ? '<button type="button" class="rp-sel" data-act="select" data-pid="' + esc(p.id) + '">이 사람으로</button>' : '') +
    (live && st !== 'no' ? '<button type="button" class="rp-x" data-act="remove" data-pid="' + esc(p.id) + '" title="빼기">×</button>' : '') + '</span>';
}
function notes(ps) {
  return ps.filter(function (p) { return p.answer === '조율' && p.note; }).map(function (p) { return '<div class="rp-note">💬 <b>' + esc(p.name) + '</b> ' + esc(p.note) + '</div>'; }).join('');
}
function addBtn(s, kind, roleId) {
  return '<button type="button" class="rp-add" data-act="add" data-kind="' + kind + '" data-role="' + esc(roleId) + '">+ ' + (kind === 'voice' ? '후보' : '사람') + '</button>';
}
function chooser(s, kind, roleId, ps) {
  var a = RC.adding; if (!a || a.sid !== s.id || a.kind !== kind || a.role !== roleId) return '';
  var inIds = ps.map(function (p) { return p.person_id; });
  var list = RC.people.filter(function (p) { return p[kind] && inIds.indexOf(p.id) === -1; });
  return '<div class="rb-choose">' + (list.length ? list.map(function (p) {
    return '<button type="button" class="b-pick" data-act="addp" data-person="' + esc(p.id) + '">' + esc(p.name) + '</button>';
  }).join('') : '<span class="rc-none">더 넣을 수 있는 사람이 없어요</span>') + '<button type="button" class="rp-cancel" data-act="addx">닫기</button></div>';
}
$('rdSession').addEventListener('click', function (e) {
  var b = e.target.closest('[data-act]'); if (!b || !RC.current) return;
  var act = b.getAttribute('data-act'), card = b.closest('[data-sid]'), sid = card && card.getAttribute('data-sid');
  var msg = function (t, err) { if (sid) setMsg('rbMsg-' + sid, t, err); };
  var done = function (txt) { return function (x) { haptic('success'); if (txt) alertMsg(txt + (x && x.done ? '\n모두 확정돼서 녹음이 확정됐어요!' : '')); RC.adding = null; loadRec(); }; };
  var fail = function (err) { msg(err.message, true); };
  if (act === 'plan') { RC.planOpen = true; RC.want = null; RC.plan = null; renderRecBoard(); loadRecPlan(); return; }
  if (act === 'add') { RC.adding = { sid: sid, kind: b.getAttribute('data-kind'), role: b.getAttribute('data-role') }; renderRecBoard(); return; }
  if (act === 'addx') { RC.adding = null; renderRecBoard(); return; }
  if (act === 'addp') {
    var a = RC.adding; msg('넣는 중...');
    api('rec.addPerson', { session_id: a.sid, kind: a.kind, role_id: a.role || null, method: '후보', person_id: b.getAttribute('data-person') })
      .then(done(pname(b.getAttribute('data-person')) + '님에게 요청 알림을 보냈어요')).catch(fail); return;
  }
  if (act === 'select') { msg('정하는 중...'); api('rec.select', { participant_id: b.getAttribute('data-pid') }).then(done('')).catch(fail); return; }
  if (act === 'remove') {
    if (!confirm('이 사람을 뺄까요? 답을 기다리던 사람에게는 취소 알림이 가요')) return;
    msg('빼는 중...'); api('rec.removePerson', { participant_id: b.getAttribute('data-pid') }).then(done('')).catch(fail); return;
  }
  if (act === 'remind') {
    msg('보내는 중...');
    api('rec.remind', { session_id: sid }).then(function (x) { haptic('success'); msg(x.notify.sent + '명에게 다시 알렸어요' + (x.notify.failed.length ? ' (못 받음: ' + x.notify.failed.join(', ') + ')' : '')); }).catch(fail); return;
  }
  if (act === 'cancel' || act === 'done') {
    if (act === 'cancel' && !confirm('이 회차를 취소할까요? 들어간 사람에게 취소 알림이 가요')) return;
    msg('바꾸는 중...');
    api('rec.sessionStatus', { session_id: sid, status: act === 'cancel' ? '취소' : '완료' }).then(function (x) { if (RC.current) RC.current.status = x.status; done('')(x); }).catch(fail);
  }
});

// ----- 회차 만들기: 배역 고르기 → 가능한 시간·장소 → 사람 배치(지정·후보·엔지니어 교대·감독) → 요청 보내기 -----
function loadRecPlan() {
  var r = RC.current; if (!r) return;
  if (!RC.plan) $('rdPlan').innerHTML = '<div class="section-head b-gap"><h2>회차 만들기</h2></div><div class="skeleton row-skel"></div>';
  var id = r.id, p = { id: id };
  if (RC.want) p.role_ids = RC.want;
  api('rec.plan', p).then(function (d) {
    if (!RC.current || RC.current.id !== id) return;
    RC.plan = d; RC.want = d.want; RC.slot = null; RC.sel = null;
    if (RC.day === null && d.slots.length) RC.day = new Date(d.slots[0].start).toDateString();
    renderRecPlan();
  }).catch(function (err) { $('rdPlan').innerHTML = '<div class="empty"><b>가능한 시간을 찾지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function recPlaceName(code) { var p = RC.plan.places.filter(function (x) { return x.code === code; })[0]; return p ? p.name : code; }
function renderRecPlan() {
  var P = RC.plan; if (!P || !RC.planOpen) { $('rdPlan').innerHTML = ''; return; }
  var r = RC.current, hasSess = activeSess(r).length > 0;
  var h = '<div class="section-head b-gap"><h2>회차 만들기</h2><span class="section-count">마감 ' + mdw(P.due) + ' 전까지 · ' + durText(P.duration_min) + '</span>' +
    (hasSess ? '<button type="button" class="rc-x" data-close="1">닫기</button>' : '') + '</div>';
  // 1) 배역
  var free = P.roles.filter(function (x) { return !x.busy; });
  h += '<div class="rc-step"><span>1</span>이번에 녹음할 배역</div><div class="b-picks rc-want">' + free.map(function (x) {
    return '<button type="button" class="b-pick' + (RC.want.indexOf(x.id) !== -1 ? ' on' : '') + '" data-want="' + esc(x.id) + '">' + esc(x.name) +
      (x.pref_method && x.pref_people.length ? ' <small>' + x.pref_method + '</small>' : '') + '</button>';
  }).join('') + '</div>';
  // 2) 시간·장소
  var sub = P.people.filter(function (p) { return p.submitted; }).length;
  h += '<div class="rc-step"><span>2</span>가능한 시간·장소</div>' +
    '<p class="b-note rc-hint">업무가능 시간을 낸 사람만 계산해요 (과 ' + P.people.length + '명 중 ' + sub + '명). 녹음 장소: ' + P.places.map(function (p) { return esc(p.name); }).join(' · ') +
    '. 엔지니어는 한 명이 안 되면 두 명 교대도 찾아요</p>';
  if (!RC.want.length) h += '<div class="empty"><b>배역을 하나 이상 골라주세요</b></div>';
  else if (!P.slots.length) {
    h += '<div class="empty"><b>마감 전까지 가능한 시간이 없어요</b>배역 성우·엔지니어·감독이 모두 비는 시간이 없거나 녹음 장소가 다 찼어요. 배역을 나눠 회차를 따로 만들거나, 업무가능 시간을 더 모아 보세요</div>';
  } else {
    var days = [], byDay = {};
    P.slots.forEach(function (s, i) { var k = new Date(s.start).toDateString(); if (!byDay[k]) { byDay[k] = []; days.push(k); } byDay[k].push(i); });
    if (!byDay[RC.day]) RC.day = days[0];
    h += '<div class="b-picks rc-days">' + days.map(function (k) {
      var d = new Date(k);
      return '<button type="button" class="b-pick' + (k === RC.day ? ' on' : '') + '" data-day="' + esc(k) + '">' + (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ') <small>' + byDay[k].length + '</small></button>';
    }).join('') + '</div>';
    h += '<div class="rc-times">' + byDay[RC.day].map(function (i) {
      var s = P.slots[i];
      return '<button type="button" class="rc-t' + (RC.slot === i ? ' on' : '') + '" data-slot="' + i + '"><b>' + hmMs(s.start) + '–' + hmMs(s.end) + '</b>' +
        '<small>성우 ' + s.v.length + ' · 엔지 ' + (s.e.length || '교대') + ' · 감독 ' + s.d.length + '</small><small>' + s.places.map(recPlaceName).map(esc).join(' · ') + '</small></button>';
    }).join('') + '</div>';
    if (RC.slot !== null) h += '<div class="rc-step"><span>3</span>사람 배치</div>' + recSlotPanel();
    else h += '<p class="b-note b-center">시간을 누르면 사람을 배치하고 요청을 보낼 수 있어요</p>';
  }
  // 후보 (마감 전까지 전체)
  h += '<div class="section-head b-gap"><h2>후보</h2><span class="section-count">마감 전까지 비는 시간 순</span></div><div class="rc-cands">';
  REC_ROLES.forEach(function (k) {
    var list = P.people.filter(function (p) { return p[k[0]]; }).sort(function (a, b) { return b.fit - a.fit || b.free_h - a.free_h || a.name.localeCompare(b.name); });
    h += '<div class="card rc-col"><div class="b-card-title">' + k[1] + (k[0] === 'director' ? ' <small>교관 이상</small>' : '') + '</div>' +
      (list.length ? list.map(function (p) {
        return '<div class="rc-p' + (p.submitted ? '' : ' off') + '"><b>' + esc(p.name) + '</b><small>' + esc(k[0] === 'director' ? p.team.replace(/팀$/, '') + ' ' + p.position : p.position) + '</small>' +
          '<em>' + (p.submitted ? (p.free_h ? p.free_h + '시간 가능' : '빈 시간 없음') : '업무가능 미제출') + '</em></div>';
      }).join('') : '<div class="rc-none">해당하는 사람이 없어요</div>') + '</div>';
  });
  h += '</div>';
  if (P.busy.length) {
    h += '<div class="section-head b-gap"><h2>이미 잡힌 녹음</h2><span class="section-count">이 시간엔 그 장소를 빼고 계산해요</span></div><div class="card hl">' +
      P.busy.map(function (b) {
        return '<div class="rc-busy"><b>' + esc(recPlaceName(b.place)) + '</b><span>' + mdw(b.start) + ' ' + hmMs(b.start) + '–' + hmMs(b.end) + '</span><small>' + esc(b.title) + (b.status === '조율중' ? ' (조율 중)' : '') + '</small></div>';
      }).join('') + '</div>';
  }
  $('rdPlan').innerHTML = h;
}
function planPid(i) { return RC.plan.people[i].id; }
function recSlotPanel() {
  var P = RC.plan, s = P.slots[RC.slot];
  if (!RC.sel) {
    var cast = {};
    s.pick.cast.forEach(function (c) { cast[c.role_id] = { method: c.method, people: c.people.map(planPid) }; });
    RC.sel = { cast: cast, engineers: s.pick.engineer.map(planPid), split: s.pick.split, director: planPid(s.pick.director) };
  }
  if (!RC.place || s.places.indexOf(RC.place) === -1) RC.place = s.places[0];
  var avail = function (arr) { return arr.map(planPid); };
  var V = avail(s.v), E = avail(s.e), D = avail(s.d);
  var shiftOk = s.shift ? [planPid(s.shift.a), planPid(s.shift.b)] : [];
  var chips = function (kind, attr, chosen, okList) {
    var list = P.people.filter(function (p) { return p[kind]; }).sort(function (a, b) { return (okList.indexOf(b.id) !== -1) - (okList.indexOf(a.id) !== -1); });
    return list.map(function (p) {
      var ok = okList.indexOf(p.id) !== -1, on = chosen.indexOf(p.id) !== -1;
      return '<button type="button" class="b-pick' + (on ? ' on' : '') + (ok ? '' : ' off') + '" ' + attr + ' data-pid="' + esc(p.id) + '">' + esc(p.name) + (ok ? '' : ' <small>시간 밖</small>') + '</button>';
    }).join('');
  };
  var h = '<div class="card rc-pick"><div class="b-card-title">' + mdw(s.start) + ' ' + hmMs(s.start) + '–' + hmMs(s.end) + '</div>';
  h += '<div class="b-pick-row"><span>장소</span><div class="b-picks">' + s.places.map(function (c) {
    return '<button type="button" class="b-pick' + (c === RC.place ? ' on' : '') + '" data-place="' + esc(c) + '">' + esc(recPlaceName(c)) + '</button>';
  }).join('') + '</div></div>';
  P.roles.filter(function (x) { return RC.want.indexOf(x.id) !== -1; }).forEach(function (x) {
    var c = RC.sel.cast[x.id] || (RC.sel.cast[x.id] = { method: '지정', people: [] });
    h += '<div class="b-pick-row"><span>' + esc(x.name) + '</span><div>' +
      '<div class="rcr-seg sm">' + ['지정', '후보'].map(function (m) { return '<button type="button" class="' + (c.method === m ? 'on' : '') + '" data-method="' + m + '" data-role="' + esc(x.id) + '">' + m + '</button>'; }).join('') + '</div>' +
      '<div class="b-picks">' + chips('voice', 'data-cast="' + esc(x.id) + '"', c.people, V) + '</div>' +
      (!c.people.length ? '<small class="rc-warn">사람을 골라주세요</small>' : '') + '</div></div>';
  });
  h += '<div class="b-pick-row"><span>엔지니어</span><div><div class="b-picks">' + chips('engineer', 'data-eng="1"', RC.sel.engineers, E.concat(shiftOk)) + '</div>';
  if (RC.sel.engineers.length === 2) {
    var opts = '', st = s.start + 30 * 60000;
    for (var t = st; t < s.end; t += 30 * 60000) opts += '<option value="' + t + '"' + (t === RC.sel.split ? ' selected' : '') + '>' + hmMs(t) + '</option>';
    if (!RC.sel.split || RC.sel.split <= s.start || RC.sel.split >= s.end) RC.sel.split = st + Math.floor((s.end - st) / 60000 / 60) * 30 * 60000;
    h += '<div class="rc-shift"><b>' + esc(pname(RC.sel.engineers[0])) + '</b> ' + hmMs(s.start) + '~ <select id="rcSplit">' + opts + '</select> ~' + hmMs(s.end) + ' <b>' + esc(pname(RC.sel.engineers[1])) + '</b> <small>교대</small></div>';
  } else h += '<small class="rcr-hint">두 명을 고르면 교대 시각을 정할 수 있어요</small>';
  h += '</div></div>';
  h += '<div class="b-pick-row"><span>감독</span><div class="b-picks">' + chips('director', 'data-dir="1"', RC.sel.director ? [RC.sel.director] : [], D) + '</div></div>';
  var all = [], dup = [];
  Object.keys(RC.sel.cast).filter(function (k) { return RC.want.indexOf(k) !== -1; }).forEach(function (k) { all = all.concat(RC.sel.cast[k].people); });
  all = all.concat(RC.sel.engineers, RC.sel.director ? [RC.sel.director] : []);
  all.forEach(function (id, i) { if (all.indexOf(id) !== i && dup.indexOf(id) === -1) dup.push(id); });
  if (dup.length) h += '<small class="rc-warn">' + dup.map(pname).map(esc).join(', ') + '님이 두 군데 들어가 있어요</small>';
  h += '<button class="btn-primary" id="rcGo" type="button"' + (RC.busy ? ' disabled' : '') + '>요청 보내기</button>' +
    '<p class="b-note b-center">보내면 고른 사람에게 \'수락/조율\' 알림이 가고, 위 \'인력 배치\'에서 답을 한눈에 볼 수 있어요</p><div class="msg" id="rcGoMsg"></div></div>';
  return h;
}
function proposeRec() {
  var P = RC.plan, s = P && P.slots[RC.slot]; if (!s || RC.busy) return;
  var cast = RC.want.map(function (id) { var c = RC.sel.cast[id] || { method: '지정', people: [] }; return { role_id: id, method: c.method, people: c.people }; });
  var miss = cast.filter(function (c) { return !c.people.length; });
  if (miss.length) { setMsg('rcGoMsg', '배역마다 사람을 골라주세요', true); return; }
  if (cast.some(function (c) { return c.method === '지정' && c.people.length !== 1; })) { setMsg('rcGoMsg', '지정은 한 명만 골라주세요', true); return; }
  if (!RC.sel.engineers.length) { setMsg('rcGoMsg', '엔지니어를 골라주세요', true); return; }
  if (!RC.sel.director) { setMsg('rcGoMsg', '감독을 골라주세요', true); return; }
  RC.busy = true; $('rcGo').disabled = true; setMsg('rcGoMsg', '보내는 중...');
  api('rec.propose', { id: RC.current.id, start: s.start, place: RC.place, cast: cast, engineers: RC.sel.engineers,
    split: RC.sel.engineers.length === 2 ? RC.sel.split : null, director: RC.sel.director }).then(function (x) {
    RC.busy = false; haptic('success');
    var n = x.notify || {};
    alertMsg('요청을 보냈어요! ' + (n.sent || 0) + '명에게 알림이 갔어요' + (n.failed && n.failed.length ? '\n못 받음: ' + n.failed.join(', ') + ' (봇 시작 안 함 등)' : '') + '\n답이 오면 \'인력 배치\'에 바로 보여요');
    RC.plan = null; RC.slot = null; RC.sel = null; RC.want = null; RC.planOpen = false; $('rdPlan').innerHTML = '';
    loadRec();
  }).catch(function (err) { RC.busy = false; $('rcGo').disabled = false; setMsg('rcGoMsg', err.message, true); });
}
$('rdPlan').addEventListener('change', function (e) { if (e.target.id === 'rcSplit') RC.sel.split = +e.target.value; });
$('rdPlan').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b || !RC.plan) return;
  if (b.id === 'rcGo') { proposeRec(); return; }
  if (b.hasAttribute('data-close')) { RC.planOpen = false; $('rdPlan').innerHTML = ''; renderRecBoard(); return; }
  if (b.hasAttribute('data-want')) {
    var id = b.getAttribute('data-want'), at = RC.want.indexOf(id);
    if (at === -1) RC.want.push(id); else RC.want.splice(at, 1);
    RC.slot = null; RC.sel = null; RC.day = null;
    if (RC.want.length) { RC.plan = null; loadRecPlan(); } else renderRecPlan();
    return;
  }
  if (b.hasAttribute('data-day')) { RC.day = b.getAttribute('data-day'); RC.slot = null; RC.sel = null; }
  else if (b.hasAttribute('data-slot')) { var i = +b.getAttribute('data-slot'); if (RC.slot !== i) { RC.slot = i; RC.sel = null; } }
  else if (b.hasAttribute('data-place')) RC.place = b.getAttribute('data-place');
  else if (b.hasAttribute('data-method')) {
    var c = RC.sel.cast[b.getAttribute('data-role')]; c.method = b.getAttribute('data-method');
    if (c.method === '지정' && c.people.length > 1) c.people = c.people.slice(0, 1);
  } else if (b.hasAttribute('data-cast')) {
    var cc = RC.sel.cast[b.getAttribute('data-cast')], pid = b.getAttribute('data-pid'), k = cc.people.indexOf(pid);
    if (cc.method === '지정') cc.people = k === -1 ? [pid] : [];
    else if (k === -1) { if (cc.people.length < 5) cc.people.push(pid); } else cc.people.splice(k, 1);
  } else if (b.hasAttribute('data-eng')) {
    var ep = b.getAttribute('data-pid'), ek = RC.sel.engineers.indexOf(ep);
    if (ek !== -1) RC.sel.engineers.splice(ek, 1);
    else { if (RC.sel.engineers.length >= 2) RC.sel.engineers.pop(); RC.sel.engineers.push(ep); }
  } else if (b.hasAttribute('data-dir')) {
    var dp = b.getAttribute('data-pid'); RC.sel.director = RC.sel.director === dp ? null : dp;
  } else return;
  renderRecPlan();
});

// ----- 받은 사람: 녹음 요청 응답 (수락 / 조율) -----
var ASK = { id: null, data: null };
function openAsk(pid) {
  ASK.id = pid; ASK.data = null;
  $('askBody').innerHTML = '<div class="skeleton row-skel"></div>';
  openModal('askModal');
  api('rec.ask', { participant_id: pid }).then(function (d) { if (ASK.id !== pid) return; ASK.data = d; renderAsk(); })
    .catch(function (err) { $('askBody').innerHTML = '<div class="empty"><b>요청을 불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
var ASK_TXT = { '대기': ['아직 답하지 않았어요', 'st-none'], '수락': ['수락했어요', 'st-참석'], '조율': ['조율이 필요하다고 답했어요', 'st-지각'], '미선정': ['이번엔 다른 분이 맡게 됐어요', 'st-취소'] };
function renderAsk() {
  var d = ASK.data, s = d.session, rq = d.request;
  var role = d.role === '녹음자' ? '성우' + (d.role_name ? " · 배역 '" + d.role_name + "'" : '') + (d.method ? ' (' + d.method + ')' : '') : d.role_ko;
  var when = mdw(s.start) + ' ' + hmMs(s.start) + '–' + hmMs(s.end) + (d.from ? ' (내 시간 ' + hmMs(d.from) + '~' + hmMs(d.to) + ')' : '');
  var st = d.answer === '수락' && !d.selected && d.role === '녹음자' && d.method === '후보' ? ['수락했어요 · 요청자가 정하면 확정돼요', 'st-지각'] : (ASK_TXT[d.answer] || ['', 'st-none']);
  var rows = [['맡을 일', role], ['시간', when], ['장소', s.location], ['요청', s.by + (s.title ? ' · ' + s.title : '')], ['분량', rq.volume], ['메모', rq.note]].filter(function (x) { return x[1]; });
  var h = '<div class="ask-card">' + (rq.code ? '<span class="chip b-cat">' + esc(rq.code) + '</span>' : '') + '<h2>' + esc(rq.title || '녹음') + '</h2>' +
    '<p><span class="st ' + st[1] + '">' + st[0] + '</span>' + (s.status === '예정' ? ' <span class="st st-참석">녹음 확정</span>' : '') + '</p>' +
    rows.map(function (x) { return '<div class="rc-row"><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') +
    (d.mates.length ? '<div class="rc-row"><span>함께</span><b>' + d.mates.map(function (m) { return esc(m.name) + '(' + esc(m.role) + ')'; }).join(', ') + '</b></div>' : '') + '</div>';
  var canAnswer = d.mine && (s.status === '조율중' || s.status === '예정') && d.answer !== '미선정' && s.start > Date.now();
  if (canAnswer) {
    h += '<label class="field-label" for="askNote">조율 메모 <span class="hint">조율이 필요하면 가능한 시간 등을 적어주세요</span></label>' +
      '<textarea id="askNote" rows="3" maxlength="300" placeholder="예) 20시 이후면 가능해요">' + esc(d.note || '') + '</textarea>' +
      '<div class="ask-btns"><button type="button" class="btn-primary" id="askYes" onclick="sendAsk(\'수락\')">수락</button>' +
      '<button type="button" class="btn-ghost ask-adj" id="askNo" onclick="sendAsk(\'조율\')">조율 필요</button></div><div class="msg" id="askMsg"></div>';
  } else if (!d.mine) h += '<p class="b-note b-center">다른 사람에게 온 요청이라 응답은 본인만 할 수 있어요</p>';
  $('askBody').innerHTML = h;
}
function sendAsk(answer) {
  var note = $('askNote').value.trim();
  if (answer === '조율' && !note) { setMsg('askMsg', '조율이 필요한 내용을 적어주세요', true); return; }
  $('askYes').disabled = $('askNo').disabled = true; setMsg('askMsg', '보내는 중...');
  api('rec.answer', { participant_id: ASK.id, answer: answer, note: note }).then(function (x) {
    haptic('success');
    setMsg('askMsg', answer === '수락' ? (x.done ? '수락했어요! 모두 모여서 녹음이 확정됐어요 🎉' : '수락했어요! 요청자에게 알렸어요') : '조율이 필요하다고 요청자에게 알렸어요');
    refreshTodos(true);
    if (RC.list) loadRec();
    setTimeout(function () { if (ASK.id && MODAL === 'askModal') openAsk(ASK.id); }, 900);
  }).catch(function (err) { setMsg('askMsg', err.message, true); $('askYes').disabled = $('askNo').disabled = false; });
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

// ----- PC: Esc로 오른쪽 상세 닫기 -----
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && MODAL) { closeModal(); return; }
  if (e.key === 'Escape' && $('attFab').classList.contains('open')) { closeFabMenu(); return; }
  if (e.key !== 'Escape' || !isWide()) return;
  var t = e.target && e.target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
  if (curTab === 'attend' && $('attendWrap').classList.contains('split')) showList();
  else if (curTab === 'task' && $('taskView').classList.contains('split')) closeTask();
  else if (curTab === 'profile' && $('profileView').classList.contains('split')) closePfEdit();
  else if (curTab === 'rec' && RC.current) closeRec();
  else if (curTab === 'poll' && $('pollView').classList.contains('split')) closePoll();
});

// ----- PC 왼쪽 메뉴 접기/펴기 (이 브라우저에 기억) -----
function applyNav(mini) {
  document.body.classList.toggle('nav-mini', mini);
  var b = $('navToggle'); if (!b) return;
  var label = mini ? '메뉴 펴기' : '메뉴 접기';
  b.title = label; b.setAttribute('aria-label', label);
  b.querySelector('span').textContent = label;
}
function toggleNav() {
  document.body.classList.add('nav-anim');
  var mini = !document.body.classList.contains('nav-mini');
  applyNav(mini);
  lsSet('navMini', mini ? '1' : '0');
}
applyNav(lsGet('navMini') === '1');

// ----- 동네지도 (PC에서만) -----
// 폰(텔레그램 안드로이드·iOS, 또는 터치 화면이면서 좁은 화면)에서는 숨기고 불러오지도 않음
function isPhone() {
  var p = tg && tg.platform;
  if (p === 'android' || p === 'ios') return true;
  return window.matchMedia('(pointer: coarse) and (max-width: 860px)').matches;
}
var townTeam = null;
// 동네지도 탭은 PC 배치(가로 1000px 이상)일 때만. 폰·좁은 창에선 숨김 (창 크기를 바꾸면 다시 판단)
function townAllowed() { return !isPhone() && isWide(); }
function setupTownTab() {
  var ok = townAllowed();
  $('townTab').style.display = ok ? '' : 'none';
  var n = [].filter.call(document.querySelectorAll('#tabbar .tab'), function (b) { return b.style.display !== 'none'; }).length;
  $('tabbar').style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
  if (!ok && curTab === 'town') goTab('home');
}
var townResizeT = null;
window.addEventListener('resize', function () { clearTimeout(townResizeT); townResizeT = setTimeout(setupTownTab, 200); });
function startTown() {
  if (!window.Town || !townAllowed() || !S.team) return;
  if (townTeam === S.team.id) return;   // 이미 이 팀으로 그리는 중 (3분마다 알아서 새로고침)
  townTeam = S.team.id;
  var teamId = S.team.id;
  Town.mount($('townArea'), {
    load: function () { return api('dashboard.scene', { team_id: teamId }); },
    refreshMs: 180000,
    fill: true          // 화면 높이에 맞춰 크게
  });
}

function loadDashboard() {
  if (!S.team) return;
  lastDashAt = Date.now();
  var d = new Date();
  $('todayText').textContent = d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + WD[d.getDay()] + '요일';
  if (dashData) renderDashboard();   // 그려둔 것 먼저, 새 내용은 뒤에서
  var teamId = S.team.id;
  loadMonth(CALM.ym || ymOf(new Date()));   // 달력도 같이 새로
  return api('dashboard.load', { team_id: teamId }).then(function (r) {
    if (!S.team || S.team.id !== teamId) return;
    dashData = r;
    renderDashboard();
  }).catch(function (err) {
    if (dashData) return;
    $('trackArea').innerHTML = '<div class="empty"><b>대시보드를 불러오지 못했어요</b>' + esc(err.message) + '</div>';
    ['taskUpArea', 'projectArea', 'scheduleArea', 'tribeArea'].forEach(function (id) { $(id).innerHTML = ''; });
  });
}

function renderDashboard() {
  renderTeamFilter();
  renderManager();
  renderBdayBanner();
  $('weeklyBanner').innerHTML = '';   // 급한 알림은 개인노트 '지금 할 일'로 옮김
  var t = dashData.tribes;
  $('tribeTotal').textContent = t.filled ? '총 ' + t.total + '명' : '';
  $('tribeArea').innerHTML = tribeMapHtml(t);
}

// 일 종류 → 색 (모임 카키 · 녹음 파랑 · 사회·촬영·편집 황토 · 사명자 일정 초록)
var KIND_CLS = { '모임': 'k-meet', '녹음': 'k-rec', '사회·촬영·편집': 'k-duty', '일정': 'k-sched' };
var KIND_NAME = { '일정': '사명자 일정' };
function kindCls(k) { return KIND_CLS[k] || 'k-etc'; }
function kindLegend(withLive) {
  return '<div class="k-legend">' +
    [['모임', 'k-meet'], ['녹음', 'k-rec'], ['사회·촬영·편집', 'k-duty'], ['사명자 일정', 'k-sched']].map(function (k) {
      return '<span><i class="' + k[1] + '"></i>' + k[0] + '</span>';
    }).join('') + (withLive ? '<span><i class="k-meet live"></i>지금 하는 중</span>' : '') + '</div>';
}
function timeRange(t) { return t.allDay ? '하루 종일' : hmMs(t.start) + (t.end ? '–' + hmMs(t.end) : ''); }
function dayDiff(ms) { var a = new Date(); a.setHours(0, 0, 0, 0); var b = new Date(ms); b.setHours(0, 0, 0, 0); return Math.round((b - a) / 86400000); }
function itemDetailHtml(t) {
  return '<b>' + esc(t.title) + '</b>' +
    '<span>' + esc((KIND_NAME[t.kind] || t.kind) + (t.type && t.type !== t.kind && t.type !== t.title ? ' · ' + t.type : '')) + '</span>' +
    '<span>' + esc(t.team) + '</span>' +
    '<span>' + mdw(t.start) + ' ' + timeRange(t) + '</span>' +
    (t.place ? '<span>' + esc(t.place) + '</span>' : '') +
    (t.who ? '<span>' + esc(t.src === 'session' ? '대상 ' + t.who : t.who + (t.lead && t.src === 'staff' ? ' ' + t.lead : '')) + '</span>' : '');
}

function renderManager() {
  var d = dashData;
  if (!d) return;
  var now = Date.now();
  var live = ((d.track && d.track.items) || []).filter(function (t) { return !t.allDay && t.start <= now && now < t.end; });
  var pillNow = $('pillNow');
  pillNow.querySelector('b').innerHTML = live.length + '<small>건</small>';
  pillNow.classList.toggle('now', live.length > 0);
  $('dStatUp').innerHTML = (d.upcoming || []).length + '<small>건</small>';
  $('dStatProj').innerHTML = d.projects.length + '<small>개</small>';
  $('taskLiveDot').classList.toggle('on', live.length > 0);
  renderTrack();
  renderUpcoming();
  renderProjects();
  renderWeekSched();
  renderMonth();
}

// ----- 1. 오늘의 트랙: 팀마다 한 줄, 9시~23시 -----
var TRK_FROM = 9, TRK_TO = 23, TRK_ITEMS = [];
function renderTrack() {
  var d = dashData, now = Date.now();
  var day0 = new Date(); day0.setHours(0, 0, 0, 0);
  var x0 = day0.getTime() + TRK_FROM * 3600000, span = (TRK_TO - TRK_FROM) * 3600000;
  var pct = function (ms) { return Math.max(0, Math.min(100, (ms - x0) / span * 100)); };
  var all = (d.track && d.track.items) || [];
  TRK_ITEMS = all.filter(function (t) { return !t.allDay && t.end > x0 && t.start < x0 + span; });
  var teams = (d.teams || []).slice();
  TRK_ITEMS.forEach(function (t) { if (teams.indexOf(t.team) === -1) teams.push(t.team); });
  var counts = d.teamCounts || {};
  var nLive = 0;

  var hours = '';
  for (var h = TRK_FROM; h <= TRK_TO; h++) hours += '<span style="left:' + ((h - TRK_FROM) / (TRK_TO - TRK_FROM) * 100) + '%">' + h + '시</span>';

  var rows = teams.map(function (team) {
    var mine = TRK_ITEMS.filter(function (t) { return t.team === team; }).sort(function (a, b) { return a.start - b.start; });
    var laneEnd = [];
    var blocks = mine.map(function (t) {
      var lane = 0; while (laneEnd[lane] !== undefined && laneEnd[lane] > t.start) lane++;
      laneEnd[lane] = t.end;
      var l = pct(t.start), w = Math.max(pct(t.end) - l, 2.2);
      var isLive = t.start <= now && now < t.end, past = t.end <= now;
      if (isLive) nLive++;
      return '<button type="button" class="trk-b ' + kindCls(t.kind) + (isLive ? ' live' : '') + (past ? ' past' : '') + '" data-i="' + TRK_ITEMS.indexOf(t) + '"' +
        ' style="left:' + l + '%;width:' + w + '%;top:' + (lane * 38 + 7) + 'px" title="' + esc(t.title + ' · ' + timeRange(t) + (t.place ? ' · ' + t.place : '')) + '">' +
        '<b>' + esc(t.title) + '</b><small>' + timeRange(t) + '</small></button>';
    }).join('');
    var h = Math.max(1, laneEnd.length) * 38 + 14;
    var cnt = counts[team];
    return '<div class="trk-row"><div class="trk-lab"><b>' + esc(team) + '</b>' + (cnt !== undefined ? '<small>' + cnt + '명</small>' : '<small>과 전체</small>') + '</div>' +
      '<div class="trk-lane" style="height:' + h + 'px">' + blocks + '</div></div>';
  }).join('');

  var nowLine = now > x0 && now < x0 + span
    ? '<div class="trk-nowwrap"><div class="trk-now" style="left:' + pct(now) + '%"><span>' + hmMs(now) + '</span></div></div>' : '';
  var empty = !TRK_ITEMS.length ? '<div class="trk-empty">오늘은 등록된 일정이 없어요</div>' : '';

  var t0 = new Date();
  $('trackSub').textContent = (t0.getMonth() + 1) + '월 ' + t0.getDate() + '일 ' + WD[t0.getDay()] + '요일 · ' + TRK_ITEMS.length + '건' + (nLive ? ' · 지금 ' + nLive + '건' : '');
  $('trackArea').innerHTML = '<div class="trk card">' +
    '<div class="trk-scroll" id="trkScroll"><div class="trk-in">' +
      '<div class="trk-row trk-hd"><div class="trk-lab"></div><div class="trk-lane trk-hours">' + hours + '</div></div>' +
      rows + nowLine + empty +
    '</div></div>' +
    '<div class="trk-foot">' + kindLegend(true) + '<div class="trk-detail" id="trkDetail"><span>칸을 누르면 여기에 자세히 보여요</span></div></div>' +
  '</div>';
  // 폰: 지금 시각이 보이게 가로로 밀어 둠
  var sc = $('trkScroll');
  if (sc && sc.scrollWidth > sc.clientWidth + 4) {
    var lane = sc.querySelector('.trk-lane');
    var lw = lane ? lane.clientWidth : sc.scrollWidth;
    sc.scrollLeft = Math.max(0, (now - x0) / span * lw - sc.clientWidth / 3);
  }
}

// ----- 2-1. 우리는 준비 중: D-day 목록 (팀 칩으로 거름) -----
var UP_MORE = false;
function renderTeamFilter() {
  var teams = dashData.teams || [];
  if (teamFilter && teams.indexOf(teamFilter) === -1) teamFilter = '';
  $('teamFilter').innerHTML = [''].concat(teams).map(function (t) {
    return '<button class="fchip' + (t === teamFilter ? ' active' : '') + '" data-team="' + esc(t) + '">' + (t ? esc(t) : '전체') + '</button>';
  }).join('');
}
function renderUpcoming() {
  var list = (dashData.upcoming || []).filter(function (t) { return !teamFilter || t.team === teamFilter; });
  $('taskUpCount').textContent = list.length ? list.length + '건' : '';
  if (!list.length) {
    $('taskUpArea').innerHTML = '<div class="empty"><b>준비 중인 일정이 없어요</b>' + (teamFilter ? esc(teamFilter) + ' 일정이 없어요' : '앞으로 30일 안의 모임·녹음·업무가 여기에 보여요') + '</div>';
    return;
  }
  var show = UP_MORE ? list : list.slice(0, 6);
  $('taskUpArea').innerHTML = '<div class="hl card">' + show.map(function (t) {
    var dd = dayDiff(t.start);
    return '<div class="up-row"><span class="up-dd' + (dd <= 2 ? ' soon' : '') + '">' + (dd <= 0 ? '오늘' : 'D-' + dd) + '</span>' +
      '<div class="up-b"><b>' + esc(t.title) + '</b><small>' + esc(t.team) + ' · ' + mdw(t.start) + (t.allDay ? '' : ' ' + hmMs(t.start)) + (t.place ? ' · ' + esc(t.place) : '') + '</small></div>' +
      '<i class="up-k ' + kindCls(t.kind) + '" title="' + esc(KIND_NAME[t.kind] || t.kind) + '"></i></div>';
  }).join('') +
  (list.length > 6 ? '<button type="button" class="hl-more" onclick="UP_MORE=!UP_MORE;renderUpcoming()">' + (UP_MORE ? '접기' : (list.length - 6) + '건 더 보기') + '</button>' : '') +
  '</div>';
}

// ----- 2-2. 프로젝트: 상태 + 세 칸 막대 -----
var PJ_ST = { '진행': ['진행 중', 'pjs-go'], '기획': ['기획 중', 'pjs-plan'], '보류': ['보류', 'pjs-hold'], '완료': ['완료', 'pjs-go'] };
function projSegs(p) {
  if (p.progress !== null && p.progress !== undefined) return p.progress <= 0 ? 0 : p.progress < 34 ? 1 : p.progress < 67 ? 2 : 3;
  return { '기획': 1, '진행': 2, '보류': 1, '완료': 3 }[p.status] || 1;
}
function renderProjects() {
  var d = dashData; if (!d) return;
  $('projCount').textContent = d.projects.length ? d.projects.length + '개' : '';
  if (!d.projects.length) { $('projectArea').innerHTML = '<div class="empty"><b>진행 중인 프로젝트가 없어요</b>프로젝트가 등록되면 여기에 보여요</div>'; return; }
  $('projectArea').innerHTML = '<div class="hl card">' + d.projects.map(function (p) {
    var st = PJ_ST[p.status] || [p.status || '', 'pjs-plan'], n = projSegs(p);
    var due = p.due ? (dayDiff(p.due) < 0 ? '마감 지남' : dayDiff(p.due) === 0 ? '오늘 마감' : 'D-' + dayDiff(p.due)) + ' · ' + mdw(p.due) : '';
    return '<div class="pj">' +
      '<div class="pj-top"><b>' + esc(p.title) + '</b><span class="pj-st ' + st[1] + '">' + esc(st[0]) + '</span></div>' +
      '<div class="pj-bar ' + st[1] + '"><i' + (n >= 1 ? ' class="on"' : '') + '></i><i' + (n >= 2 ? ' class="on"' : '') + '></i><i' + (n >= 3 ? ' class="on"' : '') + '></i></div>' +
      '<div class="pj-meta">' + esc([p.channel, p.owner && '담당 ' + p.owner, p.mc && 'MC ' + p.mc].filter(Boolean).join(' · ')) +
        (due ? '<span class="pj-due' + (p.due && dayDiff(p.due) <= 3 ? ' soon' : '') + '">' + due + '</span>' : '') + '</div>' +
      (p.desc ? '<div class="pj-desc">' + esc(p.desc) + '</div>' : '') +
    '</div>';
  }).join('') + '</div>';
}

// ----- 2-3. 사명자 일정: 오늘부터 이번 주 토요일까지 -----
function renderWeekSched() {
  var d = dashData;
  var t0 = new Date(); t0.setHours(0, 0, 0, 0);
  var end = new Date(t0); end.setDate(end.getDate() + (7 - t0.getDay()));
  var rows = (d.schedules || []).filter(function (r) { return r.start >= t0.getTime() && r.start < end.getTime(); });
  if (!rows.length) { $('scheduleArea').innerHTML = '<div class="empty"><b>이번 주 남은 일정이 없어요</b>사명자 일정·모임이 등록되면 여기에 보여요</div>'; return; }
  var byDay = [], key = {};
  rows.forEach(function (r) { var k = new Date(r.start).toDateString(); if (!key[k]) { key[k] = []; byDay.push([r.start, key[k]]); } key[k].push(r); });
  $('scheduleArea').innerHTML = '<div class="hl card">' + byDay.map(function (g) {
    var dt = new Date(g[0]), today = sameDay(g[0], Date.now());
    return '<div class="ws-day' + (today ? ' today' : '') + '"><div class="ws-d"><small>' + (today ? '오늘' : WD[dt.getDay()]) + '</small><b>' + dt.getDate() + '일</b></div>' +
      '<div class="ws-list">' + g[1].map(function (r) {
        return '<div class="ws-it"><b>' + esc(r.title) + '</b><small>' + hmMs(r.start) + (r.end ? '–' + hmMs(r.end) : '') +
          esc([r.place, r.name && (r.name + (r.role ? ' ' + r.role : ''))].filter(Boolean).map(function (x) { return ' · ' + x; }).join('')) + '</small></div>';
      }).join('') + '</div></div>';
  }).join('') + '</div>';
}

// ----- 3. 한 달 달력: 모든 업무·회의·모임 -----
var CALM = { ym: null, cache: {}, sel: null, loading: null };
function ymOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
function loadMonth(ym) {
  if (!S.team || CALM.loading === ym) return;
  CALM.loading = ym;
  var teamId = S.team.id;
  api('dashboard.month', { team_id: teamId, month: ym }).then(function (r) {
    CALM.loading = null;
    if (!S.team || S.team.id !== teamId) return;
    CALM.cache[ym] = r.items || [];
    if (CALM.ym === ym) renderMonth();
  }).catch(function (err) {
    CALM.loading = null;
    if (CALM.ym === ym && !CALM.cache[ym]) $('monthArea').innerHTML = '<div class="empty"><b>달력을 불러오지 못했어요</b>' + esc(err.message) + '</div>';
  });
}
function moveMonth(n) {
  var now = new Date();
  if (n === 0) { CALM.ym = ymOf(now); CALM.sel = now.toDateString(); }
  else { var p = CALM.ym.split('-'); CALM.ym = ymOf(new Date(+p[0], +p[1] - 1 + n, 1)); CALM.sel = null; }
  renderMonth();
  if (!CALM.cache[CALM.ym]) loadMonth(CALM.ym);
}
function renderMonth() {
  var now = new Date();
  if (!CALM.ym) CALM.ym = ymOf(now);
  var p = CALM.ym.split('-'), y = +p[0], m = +p[1] - 1;
  var first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
  if (!CALM.sel) CALM.sel = (ymOf(now) === CALM.ym ? now : first).toDateString();
  var weeks = Math.ceil((first.getDay() + days) / 7);
  var start = new Date(y, m, 1 - first.getDay());
  var items = CALM.cache[CALM.ym];
  var byDay = {};
  (items || []).forEach(function (t) { var k = new Date(t.start).toDateString(); (byDay[k] = byDay[k] || []).push(t); });
  var todayKey = now.toDateString();
  var cells = '';
  for (var i = 0; i < weeks * 7; i++) {
    var d = new Date(start); d.setDate(start.getDate() + i);
    var k = d.toDateString(), evs = (byDay[k] || []).sort(function (a, b) { return a.start - b.start; });
    var hol = SCHED_HOLIDAYS[pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())];
    cells += '<button type="button" class="mc-d' + (d.getMonth() !== m ? ' out' : '') + (k === todayKey ? ' today' : '') + (k === CALM.sel ? ' sel' : '') +
      (hol || d.getDay() === 0 ? ' red' : d.getDay() === 6 ? ' blue' : '') + '" data-k="' + esc(k) + '">' +
      '<span class="mc-n"><i>' + d.getDate() + '</i>' + (hol ? '<small>' + hol + '</small>' : '') + '</span>' +
      '<span class="mc-evs">' + evs.slice(0, 3).map(function (t) {
        return '<span class="mc-ev ' + kindCls(t.kind) + '">' + (t.allDay ? '' : '<em>' + hmMs(t.start) + '</em>') + esc(t.title) + '</span>';
      }).join('') + (evs.length > 3 ? '<span class="mc-more">+' + (evs.length - 3) + '</span>' : '') + '</span>' +
      '<span class="mc-dots">' + evs.slice(0, 4).map(function (t) { return '<i class="' + kindCls(t.kind) + '"></i>'; }).join('') + '</span>' +
    '</button>';
  }
  var sel = byDay[CALM.sel] || [], selD = new Date(CALM.sel);
  var detail = !items ? '<div class="mc-none">불러오는 중…</div>'
    : '<div class="mc-dh">' + (selD.getMonth() + 1) + '월 ' + selD.getDate() + '일 ' + WD[selD.getDay()] + '요일' + (sel.length ? ' · ' + sel.length + '건' : '') + '</div>' +
      (sel.length ? sel.map(function (t) {
        return '<div class="mc-it ' + kindCls(t.kind) + '"><span class="mc-t">' + timeRange(t) + '</span>' +
          '<div><b>' + esc(t.title) + '</b><small>' + esc([t.team, KIND_NAME[t.kind] || t.kind, t.place, t.src === 'session' ? (t.who && '대상 ' + t.who) : t.who].filter(Boolean).join(' · ')) + '</small></div></div>';
      }).join('') : '<div class="mc-none">이날은 일정이 없어요</div>');
  $('monthArea').innerHTML = '<div class="mc card">' +
    '<div class="mc-top"><button type="button" class="mc-nav" data-m="-1" aria-label="지난달">‹</button><b>' + y + '년 ' + (m + 1) + '월</b>' +
      '<button type="button" class="mc-nav" data-m="1" aria-label="다음 달">›</button>' +
      (CALM.ym !== ymOf(now) ? '<button type="button" class="mc-nav mc-today" data-m="0">오늘</button>' : '') + kindLegend(false) + '</div>' +
    '<div class="mc-wd"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>' +
    '<div class="mc-grid' + (items ? '' : ' loading') + '">' + cells + '</div>' +
    '<div class="mc-detail">' + detail + '</div>' +
  '</div>';
}

// ----- 생일: 오늘 생일인 사람에게 축하 메시지 (봇으로 전달), 내 생일이면 받은 메시지 보기 -----
function renderBdayBanner() {
  var b = dashData.birthdays, el = $('bdayBanner');
  if (!b || (!b.today.length && !b.soon.length)) { el.innerHTML = ''; return; }
  var h = '';
  b.today.forEach(function (p) {
    if (p.me) {
      var n = b.wishes_to_me.length;
      h += '<div class="bday-card me" onclick="openMyWishes()"><span class="bd-i">🎉</span><div><b>생일 축하해요, ' + esc(p.name) + '님!</b>' +
        '<small>' + (n ? '축하 메시지 ' + n + '개가 왔어요 · 눌러서 보기' : '오늘 하루 축복이 가득하길 바라요') + '</small></div></div>';
    } else {
      h += '<div class="bday-card"><span class="bd-i">🎂</span><div><b>오늘은 ' + esc(p.name) + '님 생일이에요!</b><small>축하 한마디 보내볼까요?</small></div>' +
        (p.wished ? '<span class="bd-done">✓ 보냈어요</span>'
          : '<button type="button" class="bd-btn" onclick="openWish(\'' + esc(p.id) + '\')">축하 메시지</button>') + '</div>';
    }
  });
  if (b.soon.length) {
    h += '<p class="bday-soon">🎈 다가오는 생일 · ' + b.soon.map(function (p) {
      var d = parseDate(new Date().getFullYear() + '-' + p.md);
      return (p.in_days === 1 ? '내일' : (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')') + ' ' + esc(p.name);
    }).join(' · ') + '</p>';
  }
  el.innerHTML = h;
}
function openWish(id) {
  var p = dashData.birthdays.today.filter(function (x) { return x.id === id; })[0]; if (!p) return;
  $('bdayModalT').textContent = '🎂 ' + p.name + '님 생일 축하';
  $('bdayModalSub').textContent = '보내면 ' + p.name + '님 텔레그램으로 바로 전해져요 · 한 번만 보낼 수 있어요';
  $('bdayBody').innerHTML =
    '<div class="bd-quick">' + ['생일 축하해요! 🎉', '태어나 주셔서 감사해요 🙏', '오늘 하루 축복이 가득하길 바라요 ✨'].map(function (t) {
      return '<button type="button" class="b-pick" onclick="$(\'bdMsg\').value=this.textContent">' + t + '</button>';
    }).join('') + '</div>' +
    '<label class="field-label" for="bdMsg">메시지</label>' +
    '<textarea id="bdMsg" rows="4" maxlength="300">생일 축하해요! 🎉</textarea>' +
    '<button class="btn-primary" id="bdBtn" onclick="sendWish(\'' + esc(id) + '\')">축하 메시지 보내기</button><div class="msg" id="bdSendMsg"></div>';
  openModal('bdayModal');
}
function sendWish(id) {
  var btn = $('bdBtn'); btn.disabled = true; setMsg('bdSendMsg', '보내는 중...');
  api('birthday.wish', { team_id: S.team.id, person_id: id, message: $('bdMsg').value }).then(function (r) {
    var p = dashData.birthdays.today.filter(function (x) { return x.id === id; })[0]; if (p) p.wished = true;
    haptic('success'); renderBdayBanner();
    setMsg('bdSendMsg', r.delivered ? '보냈어요! 🎉' : '저장했어요. 다만 그분이 봇과 대화를 시작하지 않아서 텔레그램으로는 못 갔어요.', !r.delivered);
    setTimeout(function () { closeModal('bdayModal'); }, r.delivered ? 1200 : 3500);
  }).catch(function (err) { btn.disabled = false; setMsg('bdSendMsg', err.message, true); });
}
function openMyWishes() {
  var w = dashData.birthdays.wishes_to_me;
  $('bdayModalT').textContent = '🎉 받은 축하 메시지';
  $('bdayModalSub').textContent = w.length ? w.length + '명이 축하해 줬어요' : '아직 도착한 메시지가 없어요';
  $('bdayBody').innerHTML = w.length ? w.map(function (m) {
    return '<div class="bd-wish"><b>' + esc(m.name) + '</b><p>' + esc(m.message) + '</p><small>' + hmOf(m.at) + '</small></div>';
  }).join('') : '<p class="rd-empty">메시지가 오면 여기와 텔레그램으로 보여요</p>';
  openModal('bdayModal');
}

// 주간 업무가능 시간 알림: 이번 주 미제출(빨강) > 주일에 다음 주 미제출
// =====================================================================
// 개인노트 '지금 할 일' + 아래 탭 숫자 배지 (카톡 안 읽은 수처럼)
// =====================================================================
var TODO = { data: null, at: 0, wait: null };
function refreshTodos(force) {
  if (!S.me || !S.team) return;
  if (!force && (TODO.wait || Date.now() - TODO.at < 30000)) return;
  TODO.at = Date.now();
  TODO.wait = api('todos.list').then(function (d) { TODO.data = d; renderTodos(); })
    .catch(function () {}).then(function () { TODO.wait = null; });
}
// '지금 할 일'은 개인노트와 그 아래 칩 화면(내 과제·업무가능·시간취합) 모두 위에 같이 보임
function setTodoHtml(html) { document.querySelectorAll('.todo-area').forEach(function (el) { el.innerHTML = html; }); }
function renderTodos() {
  var d = TODO.data, n = d ? d.count : 0, bd = $('todoBadge');
  bd.hidden = !n; bd.textContent = n > 99 ? '99+' : String(n);
  if (!d) return;
  if (!d.items.length) { setTodoHtml('<div class="todo-ok">✅ 지금 할 일을 다 했어요</div>'); return; }
  var wkLabel = function (ws) { var m = parseDate(ws), e = parseDate(ws); e.setDate(e.getDate() + 6); return (m.getMonth() + 1) + '/' + m.getDate() + '~' + (e.getMonth() + 1) + '/' + e.getDate(); };
  var row = function (i, ic, title, sub, urgent) {
    return '<button type="button" class="todo' + (urgent ? ' urgent' : '') + '" onclick="openTodo(' + i + ')"><span class="todo-ic">' + ic + '</span>' +
      '<span class="todo-tx"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span><span class="todo-go">›</span></button>';
  };
  setTodoHtml('<div class="section-head"><h2>지금 할 일</h2><span class="section-count">' + d.items.length + '개</span></div><div class="todo-list">' +
    d.items.map(function (t, i) {
      if (t.kind === 'weekly') return row(i, '🎙', (t.which === 'this' ? '이번 주' : '다음 주') + ' 업무가능 시간 미제출',
        wkLabel(t.week_start) + (t.which === 'next' ? ' · 마감 ' + mdw(t.due) + ' ' + hmMs(t.due) : ' · 지금이라도 입력해주세요'), t.urgent);
      if (t.kind === 'reason') return row(i, '✍️', t.status + ' 사유를 적어주세요', shortD(t.date) + ' ' + t.name, true);
      if (t.kind === 'plan') return row(i, '🙋', '출결 사전체크', shortD(t.date) + (t.start ? ' ' + String(t.start).slice(0, 5) : '') + ' ' + t.name, t.urgent);
      if (t.kind === 'task') return row(i, '📝', '과제 제출 · ' + t.name, t.due ? '마감 ' + dtLabel(t.due) : '마감 없음', t.urgent);
      if (t.kind === 'notice') return row(i, '📢', '안 읽은 공지 · ' + t.name, mdOf(t.at) + (t.pinned ? ' · 📌 고정' : ''), false);
      if (t.kind === 'checkin') return row(i, '⏰', '오늘 체크인 · ' + t.name, t.left.join('·') + ' 남았어요', true);
      if (t.kind === 'poll') return row(i, '📅', '가능시간 입력 · ' + t.name, '마감 ' + mdw(Date.parse(t.due)) + ' ' + hmMs(Date.parse(t.due)), t.urgent);
      if (t.kind === 'recask') return row(i, '🎙', '녹음 요청 응답 · ' + t.name, t.role + ' · ' + mdw(t.start) + ' ' + hmMs(t.start) + (t.place ? ' · ' + t.place : ''), t.urgent);
      return '';
    }).join('') + '</div>');
}
// 할 일을 누르면 그 화면으로
function openTodo(i) {
  var t = TODO.data && TODO.data.items[i]; if (!t) return;
  var inTeam = function (fn) {
    if (t.team_id && S.team && t.team_id !== S.team.id && S.me.teams.some(function (x) { return x.id === t.team_id; })) return Promise.resolve(selectTeam(t.team_id)).then(fn);
    return Promise.resolve(fn());
  };
  if (t.kind === 'weekly') { goWeekly(t.week_start === mondayOf('next') ? 'next' : 'this'); return; }
  if (t.kind === 'recask') { openAsk(t.id); return; }
  if (t.kind === 'poll') { PL.pending = t.id; if (curTab === 'poll') loadPolls(); else goTab('poll'); return; }
  if (t.kind === 'reason' || t.kind === 'plan') {
    inTeam(function () { goTab('attend'); return refreshSessions().then(function () { if (byId(S.sessions, t.id)) openSession(t.id); }); });
    return;
  }
  if (t.kind === 'checkin') { inTeam(function () { goTab('attend'); }); return; }
  if (t.kind === 'task') {
    inTeam(function () { A.current = null; goTask('profile'); var tries = 0;
      (function open() { if (A.list && byId(A.list, t.id)) openTask(t.id); else if (tries++ < 20) setTimeout(open, 150); })(); });
    return;
  }
  if (t.kind === 'notice') {
    inTeam(function () { goTab('notice'); var tries = 0;
      (function open() { if (N.list && byId(N.list, t.id)) { if (N.open !== t.id) toggleNotice(t.id); } else if (tries++ < 20) setTimeout(open, 150); })(); });
  }
}
setInterval(function () { if (document.visibilityState === 'visible') refreshTodos(); }, 3 * 60 * 1000);
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refreshTodos(); });

function renderWeeklyBanner() {
  var w = dashData.weekly, el = $('weeklyBanner');
  var b = function (which, urgent, title, sub) {
    return '<div class="poll-banner' + (urgent ? ' urgent' : '') + '" onclick="goWeekly(\'' + which + '\')"><span class="pb-i">🎙</span>' +
      '<div><b>' + title + '</b><small>' + sub + '</small></div><span class="pb-go">›</span></div>';
  };
  var label = function (ws) { var m = parseDate(ws), e = parseDate(ws); e.setDate(e.getDate() + 6); return (m.getMonth() + 1) + '/' + m.getDate() + '~' + (e.getMonth() + 1) + '/' + e.getDate(); };
  if (!w.this.submitted) {
    el.innerHTML = b('this', true, '이번 주 업무가능 시간 미제출', label(w.this.week_start) + ' · 지금이라도 입력해주세요');
  } else if (!w.next.submitted && (w.isSunday || Date.now() > w.next.due)) {
    el.innerHTML = b('next', Date.now() > w.next.due, '다음 주 업무가능 시간을 입력해주세요', label(w.next.week_start) + ' · 마감 ' + mdw(w.next.due) + ' ' + hmMs(w.next.due));
  } else el.innerHTML = '';
}
function goWeekly(which) { goTab('weekly'); if (W.which !== which || !W.data) openWeekly(which); }

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

// 오늘의 트랙 칸 누르기 · 달력 넘기기/날짜 고르기 · 팀 칩 (화면에 처음부터 있는 요소라 한 번만 연결)
$('trackArea').addEventListener('click', function (e) {
  var b = e.target.closest('.trk-b'); if (!b) return;
  var t = TRK_ITEMS[+b.getAttribute('data-i')]; if (!t) return;
  document.querySelectorAll('#trackArea .trk-b.sel').forEach(function (x) { x.classList.remove('sel'); });
  b.classList.add('sel');
  $('trkDetail').innerHTML = itemDetailHtml(t);
});
$('monthArea').addEventListener('click', function (e) {
  var n = e.target.closest('.mc-nav');
  if (n) { moveMonth(+n.getAttribute('data-m')); return; }
  var d = e.target.closest('.mc-d'); if (!d) return;
  CALM.sel = d.getAttribute('data-k');
  renderMonth();
});
$('teamFilter').addEventListener('click', function (e) {
  var b = e.target.closest('.fchip');
  if (!b) return;
  teamFilter = b.getAttribute('data-team');
  document.querySelectorAll('#teamFilter .fchip').forEach(function (x) { x.classList.toggle('active', x === b); });
  UP_MORE = false;
  renderUpcoming();
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
    if (MODAL) closeModal();
    else if (curTab === 'task' && A.current) closeTask();
    else if (curTab === 'rec' && RC.current) closeRec();
    else if (curTab === 'poll' && PL.cur) closePoll();
    else if (curTab === 'profile' && $('pfEdit').style.display === 'block') closePfEdit();
    else if (S.current) showList();
  });
  var _open = openSession, _list = showList;
  openSession = function (id) { _open(id); try { tg.BackButton.show(); } catch (e) {} };
  showList = function () { _list(); try { tg.BackButton.hide(); } catch (e) {} };
}

// ----- 새 버전 확인: PC 텔레그램 등이 예전 화면을 저장해 두고 보여줄 때 대비 -----
// 서버의 index.html을 저장본 없이 받아 beta.js 버전 글자를 비교 → 다르면 한 번만 새로 불러옴 (텔레그램 로그인 정보가 든 # 뒷부분은 그대로)
function myVer() {
  var el = document.querySelector('script[src*="beta.js"]');
  var m = el && el.getAttribute('src').match(/[?&]v=([^&]+)/);
  return m ? m[1] : '';
}
function checkNewVersion() {
  var cur = myVer(); if (!cur || !window.fetch) return;
  fetch('index.html?_=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (html) {
    var m = html.match(/beta\.js\?v=([^"'&]+)/);
    if (!m || m[1] === cur) return;
    var tried = ''; try { tried = sessionStorage.getItem('betaReloadTo') || ''; } catch (e) {}
    if (tried === m[1]) return;   // 이미 한 번 해 봤으면 또 하지 않음 (계속 새로고침되는 것 방지)
    try { sessionStorage.setItem('betaReloadTo', m[1]); } catch (e) {}
    var u = new URL(location.href);
    u.searchParams.set('r', m[1]);
    location.replace(u.pathname + u.search + location.hash);
  }).catch(function () {});
}
checkNewVersion();
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') checkNewVersion(); });

boot();


// =====================================================================
// 프로필 (나의 기록): 내 정보 보기·고치기 + 한 달 활동
// 서버: profile.get / profile.update / profile.report (모두 본인 것만)
// =====================================================================
var P = { info: null, month: null, report: null, loading: false };
var DUTY_ICON = { '녹음': '🎙', '사회': '🎤', '촬영': '🎥', '음향편집': '🎚', '기타': '✳️' };
var REC_ROLE = { '녹음자': '목소리', '엔지니어': '엔지니어', '감독자': '디렉팅' };

function loadProfile() {
  if (!P.month) P.month = curMonth();
  closePfEdit();   // 탭을 다시 열면 고치기 화면은 닫고 시작
  if (P.info) renderPfCard();
  else api('profile.get').then(function (d) { P.info = d; renderPfCard(); })
    .catch(function (err) { $('pfCard').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
  loadPfReport();
}

function pfAge(b) {
  if (!b) return '';
  var d = parseDate(b), n = new Date(), a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a >= 0 ? '만 ' + a + '세' : '';
}
function pfFindName(list, id) { var x = (list || []).filter(function (v) { return v.id === id; })[0]; return x ? x.name : ''; }

function renderPfCard() {
  var d = P.info, p = d.person;
  var tribe = pfFindName(d.tribes, p.tribe_id), church = pfFindName(d.churches, p.church_id);
  var belong = [tribe, church, p.association].filter(Boolean).join(' · ');
  var rows = [
    ['성별', p.gender || ''], ['생년월일', p.birth_date ? p.birth_date.replace(/-/g, '.') + ' <small>' + pfAge(p.birth_date) + '</small>' : ''],
    ['연락처', esc(p.phone || '')], ['구역장', esc([p.district_leader_name, p.district_leader_phone].filter(Boolean).join(' · '))]
  ];
  var empty = rows.filter(function (r) { return !r[1]; }).length + (belong ? 0 : 1);
  $('pfCard').innerHTML =
    '<div class="pf-top">' +
      '<div class="pf-avatar">' + esc(String(p.name).slice(-2)) + '</div>' +
      '<div class="pf-who"><b>' + esc(p.name) + '</b>' +
        '<div class="b-chips">' + d.positions.map(function (x) { return '<span class="chip dark">' + esc(x.unit + ' ' + x.position) + '</span>'; }).join('') +
          d.external.map(function (x) { return '<span class="chip">' + esc((x.affiliation ? x.affiliation + ' ' : '') + x.role_name) + '</span>'; }).join('') + '</div>' +
        '<span class="pf-belong">' + (belong ? esc(belong) : '소속 교회를 아직 적지 않았어요') + '</span></div>' +
      '<button type="button" class="pf-edit-btn" onclick="openPfEdit()">정보 고치기</button>' +
    '</div>' +
    '<div class="pf-rows">' + rows.map(function (r) {
      return '<div class="pf-row"><span>' + r[0] + '</span><b>' + (r[1] || '<em>비어 있어요</em>') + '</b></div>';
    }).join('') + '</div>' +
    (empty ? '<p class="pf-nudge">비어 있는 칸이 ' + empty + '개 있어요. 채워두면 팀장님이 연락하기 쉬워져요.</p>' : '') +
    (!initData && loginRaw ? '<button type="button" class="pf-logout" onclick="logout()">이 브라우저에서 로그아웃</button>' : '');
}

// ----- 내 정보 고치기 (PC: 오른쪽 패널, 폰: 화면 전환) -----
function openPfEdit() {
  if (!P.info) return;
  var p = P.info.person, wide = isWide();
  $('pfName').textContent = p.name;
  setPfSeg('pfGender', p.gender || '');
  $('pfBirth').value = p.birth_date || '';
  $('pfPhone').value = p.phone || '';
  $('pfTribe').innerHTML = '<option value="">고르지 않음</option>' + P.info.tribes.map(function (t) {
    return '<option value="' + esc(t.id) + '"' + (t.id === p.tribe_id ? ' selected' : '') + '>' + esc(t.name) + '</option>';
  }).join('');
  pfFillChurches(p.church_id);
  $('pfAssoc').value = p.association || '';
  $('pfDlName').value = p.district_leader_name || '';
  $('pfDlPhone').value = p.district_leader_phone || '';
  setMsg('pfMsg', '');
  $('pfMain').style.display = wide ? 'block' : 'none';
  $('profileView').classList.toggle('split', wide);
  $('pfEdit').style.display = 'block';
  try { if (tg && tg.BackButton) tg.BackButton.show(); } catch (e) {}
  if (!wide) window.scrollTo(0, 0);
}
function closePfEdit() {
  $('profileView').classList.remove('split');
  $('pfEdit').style.display = 'none';
  $('pfMain').style.display = 'block';
  try { if (tg && tg.BackButton) tg.BackButton.hide(); } catch (e) {}
}
function setPfSeg(id, v) { document.querySelectorAll('#' + id + ' button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); }); }
function pfPick(id, btn) {
  var v = btn.getAttribute('data-v'), on = btn.classList.contains('on');
  setPfSeg(id, on ? '' : v);   // 한 번 더 누르면 해제
}
function pfSegVal(id) { var b = document.querySelector('#' + id + ' button.on'); return b ? b.getAttribute('data-v') : ''; }
function pfFillChurches(keep) {
  var tribe = $('pfTribe').value;
  var list = P.info.churches.filter(function (c) { return c.tribe_id === tribe; });
  var cur = typeof keep === 'string' ? keep : $('pfChurch').value;
  $('pfChurch').innerHTML = '<option value="">' + (list.length ? '고르지 않음' : '—') + '</option>' + list.map(function (c) {
    return '<option value="' + esc(c.id) + '"' + (c.id === cur ? ' selected' : '') + '>' + esc(c.name) + (c.church_type === '본부교회' ? ' (본부)' : '') + '</option>';
  }).join('');
  $('pfChurch').disabled = !list.length;
  $('pfChurchHint').style.display = tribe && !list.length ? 'block' : 'none';
}
function savePf() {
  var payload = {
    gender: pfSegVal('pfGender'), birth_date: $('pfBirth').value, phone: $('pfPhone').value.trim(),
    tribe_id: $('pfTribe').value, church_id: $('pfChurch').value, association: $('pfAssoc').value,
    district_leader_name: $('pfDlName').value.trim(), district_leader_phone: $('pfDlPhone').value.trim()
  };
  var btn = $('pfSaveBtn'); btn.disabled = true; setMsg('pfMsg', '저장하는 중...');
  api('profile.update', payload).then(function (d) {
    P.info = d; btn.disabled = false; haptic('success');
    setMsg('pfMsg', '저장했어요!');
    renderPfCard();
    setTimeout(function () { if ($('pfMsg').textContent === '저장했어요!') closePfEdit(); }, 900);
  }).catch(function (err) { btn.disabled = false; setMsg('pfMsg', err.message, true); });
}

// ----- 한 달 활동 -----
function pfMoveMonth(n) {
  var p = P.month.split('-'), d = new Date(+p[0], +p[1] - 1 + n, 1);
  var m = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  if (m > curMonth()) return;
  P.month = m; loadPfReport();
}
function loadPfReport() {
  $('pfMonth').textContent = monthLabel(P.month);
  $('pfNext').disabled = P.month >= curMonth();
  $('pfMonthNote').textContent = '';
  var month = P.month;
  $('pfReport').innerHTML = '<div class="empty"><b>모으는 중...</b></div>';
  api('profile.report', { month: month }).then(function (r) {
    if (month !== P.month) return;   // 그사이 다른 달로 넘김
    P.report = r; renderPfReport();
  }).catch(function (err) { $('pfReport').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}

function pfDay(iso) { return mdOf(iso) + ' ' + hmOf(iso); }
function pfBar(t) {
  var n = t.total || 1;
  var seg = function (k, cls) { return t[k] ? '<i class="' + cls + '" style="width:' + (t[k] / n * 100) + '%"></i>' : ''; };
  return '<div class="pf-bar">' + (t.total ? seg('참석', 'ok') + seg('지각', 'warn') + seg('조퇴', 'warn') + seg('불참', 'bad') : '') + '</div>';
}
function pfSection(title, count, body, cls) {
  return '<div class="pf-sec ' + (cls || '') + '"><div class="section-head"><h2>' + title + '</h2>' +
    (count ? '<span class="section-count">' + count + '</span>' : '') + '</div>' + body + '</div>';
}

function renderPfReport() {
  var r = P.report, mt = r.meetings, rec = r.recordings, du = r.duties, hw = r.assignments;
  var dutyN = du.list.length;
  $('pfMonthNote').textContent = mt.upcoming ? '아직 끝나지 않은 모임 ' + mt.upcoming + '개는 출석률에서 빠져요' : '';

  // 한눈에: 출석률 · 실무 녹음 · 그 밖의 실무 · 과제
  var h = '<div class="b-tiles pf-tiles">' +
    tile('모임 출석률', mt.closed ? '<em class="pf-rate ' + rateCls(mt.rate) + '">' + pctText(mt.rate) + '</em>' : '–') +
    tile('실무 녹음', rec.list.length + '<small>건</small>') +
    tile('그 밖의 실무', dutyN + '<small>건</small>') +
    tile('과제 제출', hw.list.length + '<small>건</small>') +
    '</div>';
  if (r.errors && r.errors.length) h += '<p class="b-note b-need-line">' + esc(r.errors.join('·')) + ' 기록을 불러오지 못했어요. 잠시 뒤 다시 열어주세요.</p>';

  var cols = '';

  // 모임 종류별 (정규수업·스터디·운영회의…)
  var tb = mt.by_type.length ? '<div class="card pf-types">' + mt.by_type.map(function (t) {
    var came = t.참석 + t.지각 + t.조퇴;
    return '<div class="pf-type"><div class="pf-type-top"><b>' + esc(t.type) + '</b>' +
      '<span>' + (t.total ? came + ' / ' + t.total + '회 함께함' : '') + (t.upcoming ? (t.total ? ' · ' : '') + '예정 ' + t.upcoming : '') + '</span></div>' +
      pfBar(t) +
      '<div class="pf-type-n">' + ['참석', '지각', '조퇴', '불참'].filter(function (k) { return t[k]; }).map(function (k) {
        return '<span class="st st-' + k + '">' + k + ' ' + t[k] + '</span>';
      }).join('') + '</div></div>';
  }).join('') + '</div>'
    : '<div class="empty"><b>이달엔 모임 기록이 없어요</b>정규수업·스터디에 함께하면 여기에 쌓여요</div>';
  cols += pfSection('수업·스터디·회의', mt.closed ? '출석 ' + mt.came + '/' + mt.closed + (mt.on_time != null ? ' · 정시 ' + pctText(mt.on_time) : '') : '', tb);

  // 실무 녹음
  var rb = rec.list.length ? '<div class="card pf-list">' + rec.list.map(function (x) {
    var name = [x.code ? '[' + x.code + ']' : '', x.title || '제목 없음'].filter(Boolean).join(' ');
    var stCls = x.status === '완료' ? 'st-참석' : x.status === '취소' ? 'st-취소' : x.status === '재녹음필요' ? 'st-지각' : 'st-none';
    return '<div class="pf-item"><span class="pf-ic">🎙</span><div class="pf-it"><b>' + esc(name) + (x.retake ? ' <small>재녹음</small>' : '') + '</b>' +
      '<span>' + pfDay(x.start) + (x.location ? ' · ' + esc(x.location) : '') + ' · ' + esc(REC_ROLE[x.role] || x.role) + (x.cast ? ' · ' + esc(x.cast) + ' 역' : '') + '</span></div>' +
      '<span class="st ' + stCls + '">' + esc(x.status) + '</span></div>';
  }).join('') + '</div>'
    : '<div class="empty"><b>이달엔 실무 녹음이 없어요</b>녹음에 배정되면 여기에 남아요</div>';
  cols += pfSection('실무 녹음', '지금까지 완료 ' + rec.all_time + '건', rb);

  // 그 밖의 실무 (사회·촬영·음향편집…)
  var db = dutyN ? '<div class="card pf-list">' + du.list.map(function (x) {
    return '<div class="pf-item"><span class="pf-ic">' + (DUTY_ICON[x.type] || '✳️') + '</span><div class="pf-it"><b>' + esc(x.title) + '</b>' +
      '<span>' + (x.start ? pfDay(x.start) : '날짜 미정') + (x.place ? ' · ' + esc(x.place) : '') + (x.dept ? ' · ' + esc(x.dept) : '') + '</span></div>' +
      '<span class="chip">' + esc(x.type) + '</span></div>';
  }).join('') + '</div>'
    : '<div class="empty"><b>이달엔 맡은 실무가 없어요</b>사회·촬영·음향편집 등을 맡으면 여기에 남아요</div>';
  cols += pfSection('그 밖의 실무', Object.keys(du.by_type).map(function (k) { return k + ' ' + du.by_type[k]; }).join(' · '), db);

  // 과제
  var hb = hw.list.length ? '<div class="card pf-list">' + hw.list.map(function (x) {
    return '<div class="pf-item"><span class="pf-ic">📝</span><div class="pf-it"><b>' + esc(x.title) + '</b>' +
      '<span>' + pfDay(x.at) + ' 제출' + (x.category ? ' · ' + esc(x.category) : '') + '</span></div>' +
      (x.feedback ? '<span class="st st-지각">피드백</span>' : '') + '</div>';
  }).join('') + '</div>'
    : '<div class="empty"><b>이달에 낸 과제가 없어요</b></div>';
  cols += pfSection('과제', '', hb);

  // 모임 하나하나
  if (mt.list.length) {
    cols += pfSection('모임 기록', mt.list.length + '번', '<div class="card pf-list">' + mt.list.map(function (x) {
      var st = x.status ? '<span class="st st-' + esc(x.status) + '">' + esc(x.status) + (x.late_min ? ' ' + x.late_min + '분' : '') + '</span>'
        : x.planned_status ? planChip(x.planned_status, true) : '<span class="st st-none">예정</span>';
      return '<div class="pf-item"><span class="pf-date">' + shortD(x.date) + '</span><div class="pf-it"><b>' + esc(x.title) + '</b>' +
        '<span>' + esc(x.type) + (x.time ? ' · ' + x.time : '') + (x.reason ? ' · ' + esc(x.reason) : '') + '</span></div>' + st + '</div>';
    }).join('') + '</div>', 'pf-wide');
  }

  $('pfReport').innerHTML = h + '<div class="pf-grid">' + cols + '</div>';
}
