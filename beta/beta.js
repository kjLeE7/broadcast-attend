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
var DEEP_TAB = (function () { try { var g = new URLSearchParams(location.search).get('go'); return ['attend', 'notice', 'poll', 'profile', 'dues', 'place', 'admin', 'people', 'pmonth', 'flow', 'rec'].indexOf(g) !== -1 ? g : null; } catch (e) { return null; } })();
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
    $('adminTab').style.display = me.is_admin ? '' : 'none';   // 관리자 탭은 관리자 명단만
    $('peopleTab').style.display = me.teams.some(function (t) { return t.rank >= RANK.INSTRUCTOR; }) ? '' : 'none';   // 인원 탭은 교관 이상
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
    else if (lastTab()) {
      // 새로고침: 보던 화면으로 (탭 이름만 기억, 열어 둔 상세는 안 기억)
      var lt = lastTab();
      Promise.resolve(selectTeam(me.teams[0].id)).then(function () { if (lt === 'task') goTask(lsGetS('betaTaskFrom') || 'notice'); else goTab(lt); });
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
// 오른쪽 위 동그라미: 들어와 있으면 내 이름·직책 + 지금 할 일 상자, 아직 못 들어왔으면(PC) 로그아웃
function onAvatar() {
  if (S.me && S.me.teams && S.me.teams.length) { toggleMePop(); return; }
  logout();
}
function toggleMePop(open) {
  var el = $('mePop');
  if (open === undefined) open = !el.classList.contains('open');
  el.classList.toggle('open', open);
  if (open) refreshTodos(true);
}
document.addEventListener('click', function (e) {
  if ($('mePop').classList.contains('open') && !e.target.closest('.b-mebox')) toggleMePop(false);
});
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
// 팀은 여러 개 고를 수 있음(다른 팀과 함께하는 모임·공지 등). keys = 고른 팀 id들, all = 과 전체
function pk(k) { return PK[k] || (PK[k] = { all: false, keys: [], teamOf: null, subs: [], pos: [], off: {}, pending: null }); }
function pkMine(k) { return ROSTER.data.teams.filter(function (t) { return t.my_rank >= PCFG[k].min; }); }   // 내가 만들 수 있는 팀
function pkTeams(k) { return pkMine(k).length ? ROSTER.data.teams : []; }   // 고를 수 있는 팀 칩: 만들 수 있는 팀이 하나라도 있으면 과의 모든 팀
function pkCanAll(k) { return ROSTER.data.teams.some(function (t) { return t.my_rank >= PCFG[k].all; }); }
function pkAllTeam(k) {   // '전체'로 만들 때 소속 팀: 지금 팀이 되면 지금 팀
  var ok = ROSTER.data.teams.filter(function (t) { return t.my_rank >= PCFG[k].all; });
  return (ok.filter(function (t) { return t.id === S.team.id; })[0] || ok[0] || {}).id;
}
// 만드는 팀(글·모임의 주인): 고른 팀 중 내가 만들 수 있는 팀(지금 팀 먼저) → 없으면 내가 만들 수 있는 팀(지금 팀 먼저)
function pkOwner(k) {
  var P = pk(k), mine = pkMine(k), can = function (id) { return mine.some(function (t) { return t.id === id; }); };
  if (P.keys.indexOf(S.team.id) !== -1 && can(S.team.id)) return S.team.id;
  for (var i = 0; i < P.keys.length; i++) if (can(P.keys[i])) return P.keys[i];
  return can(S.team.id) ? S.team.id : (mine[0] || {}).id;
}
function pkOpen(k) {
  var P = pk(k), box = $(k + 'Pick');
  if (!ROSTER.data || ROSTER.teamOf !== S.team.id) box.innerHTML = '<div class="b-aud"><b>명단 불러오는 중...</b></div>';
  return loadRoster().then(function () {
    if (P.teamOf !== S.team.id) {   // 처음이거나 팀을 바꿨으면 지금 팀으로
      var ms = pkMine(k), mine = ms.filter(function (t) { return t.id === S.team.id; })[0] || ms[0];
      P.all = !mine && pkCanAll(k); P.keys = mine ? [mine.id] : []; P.subs = []; P.pos = []; P.off = {}; P.teamOf = S.team.id;
    }
    pkRender(k); pkApplyPending(k);
  }).catch(function (err) { box.innerHTML = '<div class="b-aud"><b>명단을 불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
// 팀을 딱 하나 골랐을 때만 그 팀 (조·직책을 그 팀 기준으로)
function pkTeam(k) { var P = pk(k); return !P.all && P.keys.length === 1 ? ROSTER.data.teams.filter(function (t) { return t.id === P.keys[0]; })[0] : null; }
function pkSubOpts(t) {
  if (!t || !t.groups.length) return [];
  return [{ key: STAFF, name: '운영진' }].concat(t.groups.filter(function (g) { return g.name !== '4조'; }).map(function (g) { return { key: g.id, name: g.name }; }));
}
function pkRank(k, m) { var t = pkTeam(k); return t ? m.ranks[t.id] || 0 : m.rank; }
function pkPosOf(k, m) { var t = pkTeam(k); return (t && m.pos && m.pos[t.id]) || m.position; }
// 팀·조까지 고른 범위
function pkBase(k) {
  var P = pk(k), t = pkTeam(k), list = ROSTER.data.members;
  if (P.all) return list;
  list = list.filter(function (m) { return P.keys.some(function (id) { return m.ranks[id]; }); });
  if (!t || !P.subs.length) return list;
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
  var base = P.all ? ROSTER.data.section.name + whole
    : !t ? P.keys.map(pkTeamName).join('·') + (P.pos.length ? '' : ' 함께')
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
  var h = '<div class="b-pick-row"><span>팀</span><div class="b-picks">' + (canAll ? chip(P.all, '전체', "pkSetTeam('" + k + "','all')") : '') +
    teams.map(function (t) { return chip(!P.all && P.keys.indexOf(t.id) !== -1, t.name, "pkSetTeam('" + k + "','" + t.id + "')"); }).join('') + '</div></div>';
  if (!P.all && P.keys.length > 1) h += '<small class="ma-hint pk-multi">여러 팀을 함께 골랐어요 · ' + esc(pkTeamName(pkOwner(k))) + ' 이름으로 만들어져요</small>';
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
    }).join('') + '</div><small class="ma-hint">이름을 누르면 빼거나 다시 넣을 수 있어요</small>' : '<small>' + (P.all || P.keys.length ? '이 범위에는 사람이 없어요' : '위에서 팀을 골라주세요') + '</small>') + '</div>';
  box.innerHTML = h;
  if (k === 'c') {   // 모임 유형은 지금 보고 있는 팀 것만: 만드는 팀이 다른 팀이면 제목으로
    var other = !P.all && pkOwner(k) !== S.team.id;
    $('cType').disabled = other; if (other) $('cType').value = '';
  }
}
// 팀 칩: '전체'는 혼자, 팀은 여러 개 켜고 끄기
function pkSetTeam(k, id) {
  var P = pk(k);
  if (id === 'all') { P.all = !P.all; P.keys = P.all ? [] : (pkMine(k)[0] ? [pkOwner(k)] : []); }
  else { P.all = false; var i = P.keys.indexOf(id); if (i === -1) P.keys.push(id); else P.keys.splice(i, 1); }
  P.subs = []; P.pos = []; P.off = {}; pkRender(k);
}
function pkToggleSub(k, s) { var P = pk(k), i = P.subs.indexOf(s); if (i === -1) P.subs.push(s); else P.subs.splice(i, 1); P.pos = []; P.off = {}; pkRender(k); }
function pkTogglePos(k, p) { var P = pk(k), i = P.pos.indexOf(p); if (!p) P.pos = []; else if (i === -1) P.pos.push(p); else P.pos.splice(i, 1); P.off = {}; pkRender(k); }
function pkToggleOff(k, id) { var P = pk(k); if (P.off[id]) delete P.off[id]; else P.off[id] = true; pkRender(k); }
function pkReset(k) { var P = pk(k); P.subs = []; P.pos = []; P.off = {}; if (ROSTER.data) pkRender(k); }
// 보낼 대상: { team_id(만드는 팀), scope: team|all, target_people?, target_label? }
// 내가 만들 수 있는 팀 하나를 통째로 고르면 예전처럼 팀 대상(사람 목록 없음), 다른 팀이 섞이면 언제나 사람 목록
function pkPayload(k) {
  var P = pk(k);
  if (!ROSTER.data || (!P.all && !P.keys.length)) return { error: ROSTER.data ? '받는 팀을 골라주세요' : '대상 명단을 불러오는 중이에요. 잠시 뒤 다시 눌러주세요' };
  var picked = pkPicked(k);
  if (!picked.length) return { error: '받는 사람이 없어요. 대상을 다시 골라주세요' };
  var owner = P.all ? pkAllTeam(k) : pkOwner(k);
  if (!owner) return { error: '대상을 고를 수 있는 팀이 없어요' };
  var single = !P.all && P.keys.length === 1 && P.keys[0] === owner;
  var whole = !P.subs.length && !P.pos.length && picked.length === pkPool(k).length;
  var out = { team_id: owner, scope: P.all ? 'all' : 'team' };
  if (!whole || PCFG[k].people || (P.all ? !PCFG[k].dynAll : !single)) {
    out.target_people = picked.map(function (m) { return m.id; });
    out.target_label = pkLabel(k);
  }
  return out;
}
function pkTeamName(id) { var t = ROSTER.data && ROSTER.data.teams.filter(function (x) { return x.id === id; })[0]; return t ? t.name : ''; }
// 양식에 담을 대상 / 양식에서 되살리기(명단이 온 뒤, 지금 고를 수 없는 팀은 뺌). 예전 양식은 key 하나
function pkGet(k) { var P = pk(k); return P.all || P.keys.length ? { key: P.all ? 'all' : P.keys[0], keys: P.keys.slice(), all: P.all, subs: P.subs.slice(), pos: P.pos.slice(), off: Object.keys(P.off) } : null; }
function pkApplyPending(k) {
  var P = pk(k), g = P.pending; if (!g || !ROSTER.data) return;
  P.pending = null;
  var all = g.all || g.key === 'all';
  if (all && !pkCanAll(k)) { pkRender(k); return; }
  var ids = ROSTER.data.teams.map(function (t) { return t.id; });
  var keys = all ? [] : (g.keys || [g.key]).filter(function (id) { return ids.indexOf(id) !== -1; });
  if (!all && (!keys.length || !pkMine(k).length)) { pkRender(k); return; }
  P.all = all; P.keys = keys;
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
      place: getPlace(), desc: $('cDesc').value, notify: $('cNotify').checked, ci: cCiItems() }; },
    set: function (d) {
      $('cType').value = [].some.call($('cType').options, function (o) { return o.value === d.type; }) ? d.type : '';
      $('cTitle').value = d.title || ''; setTm('cStart', d.start); setTm('cEnd', d.end);
      setPlace(d.place); $('cDesc').value = d.desc || ''; $('cNotify').checked = d.notify !== false; setCCiItems(d.ci);
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
  cAgSync();
  openModal('cModal');
  pkOpen('c');
}
// 시간 고르기: 앱 모양 select (06:00~24:00, 10분 단위). 목록에 없는 시각(예: 04:14)은 그 값만 끼워 넣음
function fillTm(id) {
  var sel = $(id); if (sel.options.length) return;
  var h = '<option value="">--:--</option>';
  for (var m = 6 * 60; m <= 24 * 60; m += 10) { var v = ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); h += '<option value="' + v + '">' + v + '</option>'; }
  sel.innerHTML = h;
}
function setTm(id, v) {
  fillTm(id); var sel = $(id); v = v ? String(v).slice(0, 5) : '';
  if (v && ![].some.call(sel.options, function (o) { return o.value === v; })) {
    var o = document.createElement('option'); o.value = o.textContent = v;
    var after = [].filter.call(sel.options, function (x) { return x.value && x.value < v; }).pop();
    sel.insertBefore(o, after ? after.nextSibling : sel.options[1] || null);
  }
  sel.value = v;
}
fillTm('cStart'); fillTm('cEnd');
// 시작을 고르면 끝이 비어 있을 때 1시간 뒤로
$('cStart').addEventListener('change', function () { if (!$('cEnd').value && this.value) { var m = parseInt(this.value, 10) * 60 + parseInt(this.value.slice(3), 10) + 60; if (m <= 24 * 60) setTm('cEnd', ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2)); } });
function fillTypeSelect() {
  var sel = $('cType'), keep = sel.value;
  sel.innerHTML = '<option value="">모임 유형을 고르세요</option>' + S.types.map(function (t) {
    return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
  }).join('');
  sel.value = keep;
}
function applyTypeDefaults() {
  var t = S.types.filter(function (x) { return x.id === $('cType').value; })[0];
  if (!t) return;
  if (t.default_start && !$('cStart').value) setTm('cStart', hm(t.default_start));
  if (t.default_end && !$('cEnd').value) setTm('cEnd', hm(t.default_end));
  if (t.default_location && !getPlace()) setPlace(t.default_location);
  cAgSync();
}
// 회의면 안건 칸 보이기 (모임 유형 이름이나 제목에 '회의')
function cIsMeeting() {
  var t = S.types.filter(function (x) { return x.id === $('cType').value; })[0];
  return /회의/.test((t ? t.name : '') + ' ' + $('cTitle').value);
}
function cAgSync() {
  var on = cIsMeeting() && !EDIT.c; $('cAgendaBox').style.display = on ? '' : 'none';
  if (on && !$('cAgenda').children.length) cAgAdd();
}
function cAgAdd() {
  var d = document.createElement('div'); d.className = 'card c-ag';
  d.innerHTML = '<input type="text" class="b-input ag-t" maxlength="80" placeholder="안건 · 예) 10월 정규수업 시간 조정">' +
    '<input type="text" class="b-input ag-d" maxlength="500" placeholder="정해야 할 것 (선택) · 예) 토요일 오후로 옮길지">' +
    '<div class="c-ag-row"><div class="select-wrap"><select class="ag-m">' + [5, 10, 15, 20, 30, 45, 60].map(function (n) { return '<option' + (n === 10 ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div><span>분</span>' +
    '<div class="select-wrap"><select class="ag-p"><option value="1">중요도 높음</option><option value="2" selected>중요도 보통</option><option value="3">중요도 낮음</option></select></div>' +
    '<button type="button" class="c-ag-x" onclick="this.closest(\'.c-ag\').remove()" aria-label="안건 빼기">✕</button></div>';
  $('cAgenda').appendChild(d);
}
function cAgItems() {
  if ($('cAgendaBox').style.display === 'none') return [];
  return [].slice.call(document.querySelectorAll('#cAgenda .c-ag')).map(function (r) {
    return { title: r.querySelector('.ag-t').value.trim(), decide: r.querySelector('.ag-d').value.trim(), minutes_min: +r.querySelector('.ag-m').value, priority: +r.querySelector('.ag-p').value };
  }).filter(function (x) { return x.title; });
}
function notifyText(r) {
  if (!r) return '';
  var t = '알림 ' + r.sent + '명에게 보냈어요';
  if (r.failed && r.failed.length) t += '\n못 받은 사람: ' + r.failed.join(', ') + ' (봇을 아직 시작하지 않았을 수 있어요)';
  return t;
}
// 모임에 같이 붙일 체크인 항목 (기상·출발·도착 중 고른 것)
function cCiItems() { return [].slice.call(document.querySelectorAll('#cCiItems input:checked')).map(function (x) { return x.value; }); }
function setCCiItems(list) { document.querySelectorAll('#cCiItems input').forEach(function (x) { x.checked = (list || []).indexOf(x.value) !== -1; }); }
function createSession() {
  if (EDIT.k === 'c') { saveSessEdit(); return; }
  var p = {
    team_id: S.team.id,
    meeting_type_id: $('cType').value || null,
    title: $('cTitle').value.trim() || null,
    session_date: $('cDate').value,
    start_time: $('cStart').value || null,
    end_time: $('cEnd').value || null,
    location: getPlace() || null,
    description: $('cDesc').value.trim() || null,
    notify: $('cNotify').checked,
    checkin_items: cCiItems()
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
  if (!fileCheck('c')) return;
  var btn = $('cBtn'); btn.disabled = true; setMsg('cMsg', p.notify ? '만들고 알림 보내는 중...' : '만드는 중...');
  var agenda = cAgItems();
  api('sessions.create', p).then(function (s) { return fileUpload('c', 'session', s.id).then(function () { return s; }); }).then(function (s) {
    // 회의 안건: 회의를 만들고(mtg.get) 안건을 차례로 올림
    if (!agenda.length) return s;
    return api('mtg.get', { session_id: s.id }).then(function (d) {
      return agenda.reduce(function (pr, it) { return pr.then(function () { return api('mtg.item', Object.assign({ meeting_id: d.meeting.id, kind: '일반' }, it)); }); }, Promise.resolve());
    }).then(function () { s.agendaN = agenda.length; return s; }, function (err) { s.agendaErr = err.message; return s; });
  }).then(function (s) {
    Object.assign(s, {
      start_ms: kstMs(s.session_date, s.start_time), end_ms: s.end_time ? kstMs(s.session_date, s.end_time) : kstMs(s.session_date, s.start_time) + 3 * 3600000,
      target_count: s.target_people ? s.target_people.length : targetMembersCount(s.target_unit_id), is_target: false,
      planned: { 참석: 0, 지각: 0, 불참: 0 }, final: { 참석: 0, 지각: 0, 불참: 0, 조퇴: 0 }, mine: null
    });
    if (s.team_id === S.team.id) S.sessions.push(s);
    S.sessions.sort(function (a, b) { return a.session_date + (a.start_time || '') < b.session_date + (b.start_time || '') ? -1 : 1; });
    ['cTitle', 'cStart', 'cEnd', 'cDesc'].forEach(function (id) { $(id).value = ''; }); setPlace('');
    $('cType').value = ''; pkReset('c'); setCCiItems([]); $('cAgenda').innerHTML = ''; cAgSync();
    btn.disabled = false;
    // 체크인이 같이 생겼으면 출결 위 체크인 카드도 새로
    if (s.checkins && s.checkins.length) api('checkins.list', { team_id: S.team.id }).then(function (l) { C.list = l || []; renderCheckins(); }).catch(function () {});
    haptic('success');
    renderList();
    setMsg('cMsg', '만들었어요!' + (s.agendaN ? '\n회의 안건 ' + s.agendaN + '개도 올렸어요' : '') + (s.agendaErr ? '\n안건은 못 올렸어요: ' + s.agendaErr + ' (모임 › 회의 열기에서 올려주세요)' : '') + (s.notify ? '\n' + notifyText(s.notify) : ''));
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
  loadFiles('session', [s], function () { if (S.current && S.current.id === s.id) renderHead(); });
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

function sessCiItems(s) {
  var all = {}; (s.checkins || []).forEach(function (c) { (c.items || []).forEach(function (x) { all[x] = 1; }); });
  return ['기상', '출발', '도착'].filter(function (x) { return all[x]; });
}
function renderHead() {
  var s = S.current, d = parseDate(s.session_date), ph = phaseOf(s);
  var tag = { cancel: '<span class="st st-취소">취소</span>', closed: '<span class="chip">마감</span>',
    live: '<span class="chip dark">진행 중</span>', before: '<span class="chip">예정</span>' }[ph];
  var lead = S.team.rank >= RANK.GROUP_LEADER;
  var nr = s.notify_result;
  $('dHead').innerHTML = '<div class="b-dhead"><h1>' + esc(sessionName(s)) + '</h1><p>' +
    (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')' + (timePlace(s) ? ' · ' + esc(timePlace(s)) : '') + '</p>' +
    '<div class="b-chips">' + tag + '<span class="chip">' + (s.target_label ? esc(s.target_label) : s.target_unit_id ? esc(groupName(s.target_unit_id)) : esc(S.team.name) + ' 전체') + '</span>' +
    (M.board && M.board.grace_min ? '<span class="chip">시작 후 ' + M.board.grace_min + '분까지 참석</span>' : '') +
    (sessCiItems(s).length ? '<span class="chip">⏰ 체크인 ' + sessCiItems(s).map(function (x) { return CI_EMOJI[x] + x; }).join('·') + '</span>' : '') + '</div>' +
    (s.description ? '<div class="card b-desc">' + esc(s.description) + '</div>' : '') + fileChips('session', s.id) +
    (lead && nr ? '<div class="b-notify">📨 ' + esc(notifyText(nr)) + '</div>' : '') +
    // 상세 안 버튼: 고치기(조장 이상) · 회의(이름에 '회의'면 누구나)
    ((lead && ph !== 'cancel') || /회의/.test(sessionName(s)) ? '<div class="b-dacts">' +
      (lead && ph !== 'cancel' ? '<button type="button" onclick="editSession()">✏️ 모임 고치기</button>' : '') +
      (/회의/.test(sessionName(s)) ? '<button type="button" onclick="openMeeting(\'' + s.id + '\')">🗂 회의 열기</button>' : '') + '</div>' : '') + '</div>';
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

  var lead = MG.sess && b.can_check && ph !== 'cancel' && s.session_date <= todayStr();   // 출결확인은 모임 당일부터 (FAB '출결 확인·마감'을 켰을 때)
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
  if (!b || !MG.sess || phaseOf(s) !== 'before' || S.team.rank < RANK.INSTRUCTOR) { box.innerHTML = ''; return; }
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
  if (!MG.sess || !b.can_check || ph === 'cancel') { $('boardActs').innerHTML = ''; return; }
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
  var d = R.data, team = d.scope === 'team' && MG.rp, sm = d.summary;
  if (d.scope === 'team' && !MG.rp) {   // 조장 이상도 기본은 내 기록만 (팀 리포트는 FAB)
    var me = d.people.filter(function (p) { return p.id === S.me.profile.id; })[0];
    $('rpDesc').textContent = '내 한 달 출결이에요';
    $('rpBody').innerHTML = me ? '<div class="b-tiles">' + tile('출석률', pctText(me.attend_rate)) + tile('참석', me.참석 + '<small>건</small>') + tile('지각', me.지각 + '<small>건</small>') + tile('불참', me.불참 + '<small>건</small>') + '</div>' +
      '<div class="card b-pad b-top">' + personDetail(me) + '</div>' : '<div class="empty"><b>' + monthLabel(d.month) + ' 내 출결 기록이 없어요</b>팀 전체는 오른쪽 아래 + 에서 볼 수 있어요</div>';
    return;
  }
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
var VIEWS = { home: 'homeView', town: 'townView', attend: 'attendWrap', notice: 'noticeView', task: 'taskView', weekly: 'weeklyView', rec: 'recView', profile: 'profileView', poll: 'pollView', dues: 'duesView', sky: 'skyView', place: 'placeView', admin: 'adminView', people: 'peopleView', mtg: 'mtgView', pmonth: 'pmonthView', flow: 'flowView' };
function goTab(t) {
  if (t === curTab) return;
  if (curTab === 'rec' && RC.current) closeRec();
  if (curTab === 'weekly' && W.dirty && !confirm('저장하지 않은 칸이 있어요. 그래도 넘어갈까요?')) return;
  if (curTab === 'poll' && PL.dirty && !confirm('저장하지 않은 칸이 있어요. 그래도 넘어갈까요?')) return;
  closeModal(); closeFabMenu();
  if (LK.stop) { LK.stop(); LK.stop = null; }   // 캐릭터 미리보기 그리기 멈춤
  MG = {}; closeAct();
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
// 탭 묶음 (2026-10-06): 업무가능 → 업무, 시간취합 → 일정(출결), 회비 → 개인, 과제 → 소식(공지)
function parentTab(t) { return t === 'flow' ? 'rec' : t === 'weekly' ? 'profile' : t === 'poll' || t === 'place' || t === 'mtg' ? 'attend' : t === 'dues' || t === 'pmonth' ? 'profile' : t === 'task' ? 'notice' : t; }
function goTask(from) {
  taskFrom = from;
  if (curTab === 'task') { setTabUI('task'); loadTasks(); return; }
  goTab('task');
}
function renderTaskSeg() {
  var seg = taskFrom === 'profile' ? [] : [['공지', "goTab('notice')", 0], ['과제', '', 1]];
  $('taskSeg').innerHTML = seg.map(function (x) {
    return '<button class="wkchip' + (x[2] ? ' active' : '') + '"' + (x[1] ? ' onclick="' + x[1] + '"' : '') + '>' + x[0] + '</button>';
  }).join('');
  $('taskSeg').style.display = seg.length ? '' : 'none';
  $('taskDesc').textContent = taskFrom === 'profile' ? '나에게 하달된 과제예요. 눌러서 제출해주세요' : '과제를 눌러 제출하고, 제출 현황을 봐요';
}
// 아래 탭 '개인': 누르면 하위 메뉴(나의 기록·내 과제·업무가능 시간·시간취합)
// PC 펼친 메뉴에선 그 자리 아래로 펼침(개인 화면에 있으면 늘 펼침), 폰·접힌 메뉴에선 떠 있는 상자
function pfFloating() { return !isWide() || document.body.classList.contains('nav-mini'); }
// 하위 메뉴: 개인(pfSub) · 업무(recSub). 떠 있을 땐 하나만 열림
var SUB_TAB = { pfSub: 'pfTab', recSub: 'recTab' };
function togglePfSub(open, id) {
  id = id || 'pfSub';
  var el = $(id), tab = $(SUB_TAB[id]);
  if (open === undefined) open = !el.classList.contains('open');
  if (open && pfFloating()) {
    Object.keys(SUB_TAB).forEach(function (k) { if (k !== id) $(k).classList.remove('open'); });
    if (isWide()) el.style.top = tab.getBoundingClientRect().top + 'px';
    else { var bar = $('tabbar').getBoundingClientRect(), r = tab.getBoundingClientRect(); el.style.right = Math.max(6, bar.right - r.right) + 'px'; }
  }
  el.classList.toggle('open', open);
}
function pfGo(t) {
  toggleMePop(false);
  if (pfFloating()) { togglePfSub(false); togglePfSub(false, 'recSub'); }
  goTab(t);
}
document.addEventListener('click', function (e) {
  if (!pfFloating()) return;
  Object.keys(SUB_TAB).forEach(function (k) { if ($(k).classList.contains('open') && !e.target.closest('#' + k + ', #' + SUB_TAB[k])) togglePfSub(false, k); });
});
// 새로고침해도 보던 화면으로 돌아오게 지금 탭을 창(sessionStorage)에 기억
function lsGetS(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
function lastTab() {
  var t = lsGetS('betaTab');
  if (!t || t === 'home' || !VIEWS[t]) return null;
  if (t === 'town' && !townAllowed()) return null;
  return t;
}
function setTabUI(t) {
  curTab = t;
  try { sessionStorage.setItem('betaTab', t); sessionStorage.setItem('betaTaskFrom', taskFrom); } catch (e) {}
  var pt = parentTab(t);
  document.querySelectorAll('#tabbar .tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === pt); });
  var sub = t === 'task' && taskFrom !== 'profile' ? '' : t;
  document.querySelectorAll('#pfSub button, #recSub button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-t') === sub); });
  togglePfSub(!pfFloating() && pt === 'profile');
  togglePfSub(!pfFloating() && pt === 'rec', 'recSub');
  if (t === 'task') renderTaskSeg();
  Object.keys(VIEWS).forEach(function (k) { $(VIEWS[k]).style.display = k === t ? '' : 'none'; });
  $('teamTabs').style.display = t !== 'weekly' && t !== 'poll' && t !== 'home' && t !== 'town' && t !== 'rec' && t !== 'profile' && t !== 'dues' && t !== 'sky' && t !== 'admin' && t !== 'mtg' && t !== 'pmonth' && t !== 'flow' && S.me && S.me.teams.length > 1 ? 'flex' : 'none';
  document.body.classList.toggle('town-mode', t === 'town');
  document.body.classList.toggle('sky-mode', t === 'sky');
  setTimeout(renderAct, 0);
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
  else if (curTab === 'dues') loadDues();
  else if (curTab === 'sky') startSky();
  else if (curTab === 'place') loadPlace();
  else if (curTab === 'admin') loadAdmin();
  else if (curTab === 'people') loadPeople();
  else if (curTab === 'mtg') loadMeeting();
  else if (curTab === 'flow') loadFlows();
  else if (curTab === 'pmonth') { if (!P.month) P.month = curMonth(); loadPfReport(); }
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

// =====================================================================
// 고치기: 만들기 팝업(모임 c·체크인 ci·공지 ann·과제 hw)을 '고치기'로 다시 씀
// 받는 사람(대상)은 그대로 두고 내용만 고침. 닫으면 만들던 입력은 그대로 돌아옴
// =====================================================================
var EDIT = { k: null, id: null, snap: null };
var EDIT_TXT = {
  c: ['모임 고치기', '바꾼 내용은 저장을 눌러야 남아요'],
  ci: ['체크인 고치기', '뺀 항목의 보고 기록은 지워져요'],
  ann: ['공지 고치기', '바꾼 내용은 저장을 눌러야 남아요'],
  hw: ['과제 고치기', '바꾼 내용은 저장을 눌러야 남아요']
};
function editFields(k) { return [].slice.call($(k + 'Modal').querySelectorAll('.b-modal-body input, .b-modal-body textarea, .b-modal-body select')); }
function editOn(k, id, targetText) {
  if (EDIT.k) editOff();
  var head = $(k + 'ModalT');
  EDIT = { k: k, id: id, snap: {
    fields: editFields(k).map(function (el) { return { el: el, v: el.value, c: el.checked, d: el.disabled }; }),
    h1: head.textContent, p: head.nextElementSibling ? head.nextElementSibling.textContent : '', btn: $(k + 'Btn').textContent
  } };
  head.textContent = EDIT_TXT[k][0];
  if (head.nextElementSibling) head.nextElementSibling.textContent = EDIT_TXT[k][1];
  $(k + 'Btn').textContent = '저장';
  ['TplBar', 'TplSave'].forEach(function (x) { if ($(k + x)) $(k + x).style.display = 'none'; });
  var pick = $(k + 'Pick'), lab = pick.previousElementSibling;
  pick.style.display = 'none'; if (lab && lab.tagName === 'LABEL') lab.style.display = 'none';
  var note = document.createElement('div');
  note.className = 'edit-target'; note.id = k + 'EditNote';
  note.innerHTML = '<b>받는 사람</b> ' + esc(targetText || '') + '<small>받는 사람은 고칠 수 없어요. 바꿔야 하면 지우고 새로 만들어주세요.</small>';
  pick.parentNode.insertBefore(note, pick.nextSibling);
  setMsg(k + 'Msg', '');
}
function editOff() {
  var k = EDIT.k; if (!k) return;
  var sn = EDIT.snap, head = $(k + 'ModalT');
  sn.fields.forEach(function (f) { f.el.value = f.v; f.el.checked = f.c; f.el.disabled = f.d; });
  head.textContent = sn.h1; if (head.nextElementSibling) head.nextElementSibling.textContent = sn.p;
  $(k + 'Btn').textContent = sn.btn;
  ['TplBar', 'TplSave'].forEach(function (x) { if ($(k + x)) $(k + x).style.display = ''; });
  var pick = $(k + 'Pick'), lab = pick.previousElementSibling;
  pick.style.display = ''; if (lab && lab.tagName === 'LABEL') lab.style.display = '';
  var note = $(k + 'EditNote'); if (note) note.remove();
  if (k === 'c') { $('cNotify').nextElementSibling.textContent = '대상자에게 텔레그램 알림 보내기'; if (ROSTER.data) pkRender('c'); }
  EDIT = { k: null, id: null, snap: null };
}
function targetText(x, teamName) {
  return x.target_label || (x.target_unit_id ? groupName(x.target_unit_id) + '만' : (teamName || S.team.name) + ' 전체');
}
function toLocalInput(iso) { if (!iso) return ''; var d = new Date(iso); return ymd(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function editDone(k, text, after) {
  haptic('success'); setMsg(k + 'Msg', text);
  setTimeout(function () { setMsg(k + 'Msg', ''); closeModal(k + 'Modal'); if (after) after(); }, 900);
}

// ----- 모임 -----
function editSession() {
  var s = S.current; if (!s) return;
  fillTypeSelect();
  editOn('c', s.id, targetText(s));
  $('cType').value = s.meeting_type_id || ''; $('cType').disabled = true;
  $('cTitle').value = s.title || ''; $('cDate').value = s.session_date;
  setTm('cStart', hm(s.start_time)); setTm('cEnd', hm(s.end_time));
  setPlace(s.location || ''); $('cDesc').value = s.description || '';
  setCCiItems(sessCiItems(s));
  $('cNotify').checked = false; $('cNotify').nextElementSibling.textContent = '바뀐 날짜·시간·장소를 대상자에게 알리기';
  if (s.closed_at) setMsg('cMsg', '출결이 마감된 모임이에요. 시작 시간을 바꾸면 도착 확인한 사람의 참석·지각을 새 시간으로 다시 매겨요');
  cAgSync();
  openModal('cModal');
}
function saveSessEdit() {
  var s = S.current; if (!s || s.id !== EDIT.id) return;
  var cand = { title: $('cTitle').value.trim() || null, session_date: $('cDate').value, start_time: $('cStart').value || null,
    end_time: $('cEnd').value || null, location: getPlace() || null, description: $('cDesc').value.trim() || null };
  var cur = { title: s.title || null, session_date: s.session_date, start_time: s.start_time ? hm(s.start_time) : null,
    end_time: s.end_time ? hm(s.end_time) : null, location: s.location || null, description: s.description || null };
  if (!cand.session_date) { setMsg('cMsg', '날짜를 골라주세요!', true); return; }
  if (!cand.start_time) { setMsg('cMsg', '시작 시간을 넣어주세요!', true); return; }
  if (cand.end_time && cand.end_time <= cand.start_time) { setMsg('cMsg', '끝나는 시간이 시작보다 늦어야 해요!', true); return; }
  if (!s.meeting_type_id && !cand.title) { setMsg('cMsg', '제목을 적어주세요!', true); return; }
  var p = { id: s.id, notify: $('cNotify').checked };
  Object.keys(cand).forEach(function (key) { if (cand[key] !== cur[key]) p[key] = cand[key]; });
  var ci = cCiItems(); if (ci.join() !== sessCiItems(s).join()) p.checkin_items = ci;
  if (!fileCheck('c')) return;
  var hasFile = !!$('cFile').files[0];
  if (Object.keys(p).length === 2 && !hasFile) { setMsg('cMsg', '바뀐 내용이 없어요'); return; }
  var btn = $('cBtn'); btn.disabled = true; setMsg('cMsg', '저장 중...');
  // 파일만 새로 올리는 경우엔 모임 내용은 그대로
  (Object.keys(p).length === 2 ? Promise.resolve(s) : api('sessions.update', p)).then(function (ns) { return fileUpload('c', 'session', s.id).then(function () { return ns; }); }).then(function (ns) {
    btn.disabled = false; FL.session = null; loadFiles('session', [s], renderHead);
    Object.assign(s, ns, { start_ms: kstMs(ns.session_date, ns.start_time), end_ms: ns.end_time ? kstMs(ns.session_date, ns.end_time) : kstMs(ns.session_date, ns.start_time) + 3 * 3600000 });
    renderHead();
    if (p.checkin_items || p.session_date || p.title) api('checkins.list', { team_id: S.team.id }).then(function (l) { C.list = l || []; renderCheckins(); }).catch(function () {});
    editDone('c', '저장했어요!' + (ns.notify ? '\n' + notifyText(ns.notify) : ''), refreshSessions);
  }).catch(function (err) { btn.disabled = false; setMsg('cMsg', err.message, true); haptic('error'); });
}

// ----- 체크인 -----
function editCheckin(id) {
  var c = byId(C.list, id); if (!c) return;
  editOn('ci', id, targetText(c));
  $('ciTitle').value = c.title; $('ciDate').value = c.check_date;
  document.querySelectorAll('#ciItems input').forEach(function (x) { x.checked = c.items.indexOf(x.value) !== -1; });
  if (c.session_id) { $('ciDate').disabled = true; setMsg('ciMsg', '모임에 붙은 체크인이라 날짜는 모임을 따라가요'); }
  openModal('ciModal');
}
function saveCiEdit() {
  var c = byId(C.list, EDIT.id); if (!c) return;
  var items = [].slice.call(document.querySelectorAll('#ciItems input:checked')).map(function (x) { return x.value; });
  var p = { id: c.id, title: $('ciTitle').value.trim(), items: items };
  if (!c.session_id) p.check_date = $('ciDate').value;
  if (!p.title) { setMsg('ciMsg', '제목을 적어주세요!', true); return; }
  if (!items.length) { setMsg('ciMsg', '받을 항목을 하나 이상 골라주세요!', true); return; }
  var gone = c.items.filter(function (x) { return items.indexOf(x) === -1; });
  if (gone.length && !confirm(gone.join('·') + ' 항목을 빼면 그 보고 기록도 지워져요. 저장할까요?')) return;
  var btn = $('ciBtn'); btn.disabled = true; setMsg('ciMsg', '저장 중...');
  api('checkins.update', p).then(function (r) {
    btn.disabled = false;
    Object.assign(c, { title: r.title, check_date: r.check_date, items: r.items });
    if (c.reports) c.reports = c.reports.filter(function (x) { return r.items.indexOf(x.item) !== -1; });
    gone.forEach(function (x) { delete c.mine[x]; });
    renderCheckins(); refreshTodos(true);
    editDone('ci', '저장했어요!');
  }).catch(function (err) { btn.disabled = false; setMsg('ciMsg', err.message, true); });
}

// ----- 공지 -----
function editNotice(id) {
  var n = byId(N.list, id); if (!n) return;
  editOn('ann', id, n.target_label || (n.scope === 'section' ? '방송예술과 전체' : S.team.name + ' 전체'));
  $('annTitle').value = n.title; $('annBody').value = n.body || ''; $('annPinned').checked = !!n.is_pinned;
  openModal('annModal');
}
function saveAnnEdit() {
  var n = byId(N.list, EDIT.id); if (!n) return;
  var p = { id: n.id, title: $('annTitle').value.trim(), body: $('annBody').value.trim(), is_pinned: $('annPinned').checked };
  if (!p.title) { setMsg('annMsg', '제목을 적어주세요!', true); return; }
  var btn = $('annBtn'); btn.disabled = true; setMsg('annMsg', '저장 중...');
  if (!fileCheck('ann')) { btn.disabled = false; return; }
  api('notices.update', p).then(function (r) { return fileUpload('ann', 'notice', n.id).then(function () { return r; }); }).then(function (r) {
    btn.disabled = false; FL.notice = null;
    Object.assign(n, { title: r.title, body: r.body, is_pinned: r.is_pinned });
    renderNotices();
    editDone('ann', '저장했어요!', p.is_pinned !== !!n.is_pinned ? loadNotices : null);
  }).catch(function (err) { btn.disabled = false; setMsg('annMsg', err.message, true); });
}

// ----- 과제 -----
function editTask() {
  var a = A.current; if (!a) return;
  editOn('hw', a.id, targetText(a));
  $('hwCat').value = a.category || ''; $('hwTitle').value = a.title; $('hwDesc').value = a.description || '';
  $('hwDue').value = toLocalInput(a.due_at); $('hwFeedback').checked = a.needs_feedback !== false;
  openModal('hwModal');
}
function saveTaskEdit() {
  var a = A.current; if (!a || a.id !== EDIT.id) return;
  var due = $('hwDue').value;
  var p = { id: a.id, category: $('hwCat').value.trim() || null, title: $('hwTitle').value.trim(),
    description: $('hwDesc').value.trim() || null, due_at: due ? new Date(due).toISOString() : null, needs_feedback: $('hwFeedback').checked };
  if (!p.title) { setMsg('hwMsg', '과제 제목을 적어주세요!', true); return; }
  var btn = $('hwBtn'); btn.disabled = true; setMsg('hwMsg', '저장 중...');
  if (!fileCheck('hw')) { btn.disabled = false; return; }
  api('assignments.update', p).then(function (r) { return fileUpload('hw', 'assignment', a.id).then(function () { return r; }); }).then(function (r) {
    btn.disabled = false; FL.assignment = null;
    ['category', 'title', 'description', 'due_at', 'needs_feedback'].forEach(function (key) { a[key] = r[key]; });
    renderTasks(); openTask(a.id);
    editDone('hw', '저장했어요!');
  }).catch(function (err) { btn.disabled = false; setMsg('hwMsg', err.message, true); });
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
  if (EDIT.k && MODAL === EDIT.k + 'Modal') editOff();
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
  var mine = C.list.filter(function (c) { return (c.check_date === today || c.check_date === tmr) && (C.showDone || !ciDone(c)); })
    .sort(function (a, b) { return a.check_date < b.check_date ? -1 : 1; });
  var done = C.list.filter(function (c) { return c.check_date === today && ciDone(c); }).length;
  // 끝난 체크인은 숨김 (시간을 고치려면 '끝난 체크인 보기')
  $('ciArea').innerHTML = mine.map(ciCard).join('') + (done ? '<button type="button" class="ci-donelink" onclick="C.showDone=!C.showDone;renderCheckins()">' +
    (C.showDone ? '끝난 체크인 접기' : '✅ 오늘 체크인 ' + done + '개 끝 · 기록 보기·고치기') + '</button>' : '');
  var lead = S.team.rank >= RANK.GROUP_LEADER;
  $('ciBoardWrap').style.display = MG.ci && lead && C.list.length ? 'block' : 'none';
  if (!lead || !C.list.length) return;
  if (S.members) { $('ciBoard').innerHTML = C.list.map(ciBoardCard).join(''); return; }
  $('ciBoard').innerHTML = '<div class="empty inner"><b>불러오는 중...</b></div>';
  Promise.all([loadMembers(), needRoster(C.list)]).then(renderCheckins).catch(function (err) { $('ciBoard').innerHTML = '<div class="empty inner">' + esc(err.message) + '</div>'; });
}

// 체크인이 끝났는지: 마지막으로 낸 항목 뒤에 남은 항목이 없으면 끝 ('도착'을 내면 기상·출발도 끝으로 봄, 서버 '지금 할 일'과 같은 규칙)
function ciDone(c) {
  var last = -1; c.items.forEach(function (it, i) { if (c.mine[it]) last = i; });
  return last >= 0 && c.items.slice(last + 1).every(function (it) { return c.mine[it]; });
}
function ciCard(c) {
  var isToday = c.check_date === todayStr();
  return '<div class="ci-card"><div class="ci-head"><span class="hero-chip"><i></i>' +
      (isToday ? '오늘의 체크인' : '내일 체크인 · ' + shortD(c.check_date)) + '</span><b>' + esc(c.title) + '</b></div>' +
    '<div class="ci-btns">' + c.items.map(function (it) {
      var m = c.mine[it];
      return '<button class="ci-btn' + (m ? ' done' : '') + '" onclick="tapCheckin(\'' + esc(c.id) + '\',\'' + it + '\')">' +
        '<span class="ci-emoji">' + CI_EMOJI[it] + '</span><span class="ci-label">' + it + '</span>' +
        '<span class="ci-time">' + (m ? hmOf(m.at) + (m.fixed ? ' (고침)' : '') + (m.note ? ' → ' + esc(m.note) : '') : '누르면 기록') + '</span></button>';
    }).join('') + '</div>' +
    '<div class="ci-eta" id="eta-' + esc(c.id) + '" style="display:none;"><label>도착 예정 시간 <small>(모르면 비워두세요)</small></label>' +
      '<div class="ci-eta-row"><input type="time" id="etaIn-' + esc(c.id) + '"><button onclick="sendCheckin(\'' + esc(c.id) + '\',\'출발\')">출발했어요</button></div></div>' +
    '<div class="msg" id="ciMsg-' + esc(c.id) + '"></div>' +
    '<div class="ci-tip">잘못 눌렀으면 기록된 칸을 한 번 더 눌러 시간을 고치거나 지울 수 있어요</div></div>';
}

function tapCheckin(id, item) {
  var c = byId(C.list, id); if (!c) return;
  // 이미 낸 칸: 시간 고치기(잘못 눌렀을 때 실제 시각으로) 또는 지우기
  if (c.mine[item]) {
    var v = prompt(item + ' ' + hmOf(c.mine[item].at) + ' 기록\n\n실제 ' + item + ' 시간으로 고치려면 적어주세요 (예: 19:00)\n비우고 확인을 누르면 기록을 지울지 물어봐요', hmOf(c.mine[item].at));
    if (v === null) return;
    if (!v.trim()) { if (confirm(item + ' 기록을 지울까요?')) unCheckin(id, item); return; }
    fixCheckin(id, item, v.trim());
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

function fixCheckin(id, item, at) {
  setMsg('ciMsg-' + id, '고치는 중...');
  api('checkins.report', { checkin_id: id, item: item, at: at }).then(function (r) {
    var c = byId(C.list, id); c.mine[item] = { at: r.reported_at, note: r.note, fixed: true };
    haptic('success'); renderCheckins(); refreshTodos(true);
    setMsg('ciMsg-' + id, item + ' 시간을 ' + hmOf(r.reported_at) + '(으)로 고쳤어요');
  }).catch(function (err) { setMsg('ciMsg-' + id, err.message, true); });
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
      (S.team.rank >= RANK.INSTRUCTOR || c.created_by === S.me.profile.id ? '<div class="b-row-btns"><button class="ghost-btn" onclick="editCheckin(\'' + esc(c.id) + '\')">✏️ 체크인 고치기</button>' +
        '<button class="ghost-btn b-danger" onclick="deleteCheckin(\'' + esc(c.id) + '\')">이 체크인 지우기</button></div>' : '');
  }
  return html + '</div>';
}

function createCheckin() {
  if (EDIT.k === 'ci') { saveCiEdit(); return; }
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
  api('notices.list', { team_id: S.team.id }).then(function (l) { N.list = l; renderNotices(); loadFiles('notice', l, renderNotices); })
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
      (n.body ? '<div class="ann-body' + (open ? '' : ' clamp') + '">' + esc(n.body) + '</div>' : '') + fileChips('notice', n.id) +
      '<div class="ann-foot"><span>' + esc(n.author || '') + '</span>' + (MG.ann ? readChip('notice', n) : '') +
        (long && !open ? '<span class="ann-more">더보기</span>' : '') +
        (canDel && MG.ann ? '<button class="ann-hide" onclick="event.stopPropagation();editNotice(\'' + esc(n.id) + '\')">고치기</button>' +
          '<button class="ann-hide" onclick="event.stopPropagation();deleteNotice(\'' + esc(n.id) + '\')">삭제</button>' : '') +
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
  if (EDIT.k === 'ann') { saveAnnEdit(); return; }
  var p = { title: $('annTitle').value.trim(), body: $('annBody').value.trim(), is_pinned: $('annPinned').checked };
  if (!p.title) { setMsg('annMsg', '제목을 적어주세요!', true); return; }
  var tg = pkPayload('ann');
  if (tg.error) { setMsg('annMsg', tg.error, true); return; }
  Object.assign(p, tg); p.scope = tg.scope === 'all' ? 'section' : 'team';   // 공지는 과 전체 = section
  var other = p.scope === 'team' && p.team_id !== S.team.id, otherName = pkTeamName(p.team_id);
  var btn = $('annBtn'); btn.disabled = true; setMsg('annMsg', '올리는 중...');
  if (!fileCheck('ann')) { btn.disabled = false; return; }
  api('notices.create', p).then(function (row) { return fileUpload('ann', 'notice', row.id).then(function () { return row; }); }).then(function () {
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
  api('assignments.list', { team_id: S.team.id }).then(function (l) { A.list = l; renderTasks(); loadFiles('assignment', l, function () { renderTasks(); if (A.current) openTask(A.current.id); }); })
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
  if (EDIT.k === 'hw') { saveTaskEdit(); return; }
  var due = $('hwDue').value;
  var p = { category: $('hwCat').value.trim() || null, title: $('hwTitle').value.trim(),
    description: $('hwDesc').value.trim() || null, due_at: due ? new Date(due).toISOString() : null,
    needs_feedback: $('hwFeedback').checked };
  if (!p.title) { setMsg('hwMsg', '과제 제목을 적어주세요!', true); return; }
  var tg = pkPayload('hw');
  if (tg.error) { setMsg('hwMsg', tg.error, true); return; }
  Object.assign(p, tg);
  var btn = $('hwBtn'); btn.disabled = true; setMsg('hwMsg', '올리는 중...');
  if (!fileCheck('hw')) { btn.disabled = false; return; }
  api('assignments.create', p).then(function (a) { return fileUpload('hw', 'assignment', a.id).then(function () { return a; }); }).then(function (a) {
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
    (a.description ? '<div class="card b-desc">' + esc(a.description) + '</div>' : '') + fileChips('assignment', a.id) + '</div>';
  $('tdContent').value = (a.my && a.my.content) || '';
  $('tdLink').value = (a.my && a.my.file_url) || '';
  $('tdBtn').textContent = a.my ? '다시 제출' : '제출';
  setMsg('tdMsg', a.my ? dtLabel(a.my.submitted_at) + '에 제출했어요. 고쳐서 다시 낼 수 있어요.' : '');
  $('tdFeedback').innerHTML = a.my && a.my.feedback ? '<div class="b-feedback"><b>💬 피드백</b>' + esc(a.my.feedback) + '</div>' : '';
  var lead = S.team.rank >= RANK.GROUP_LEADER;
  $('tdBoardWrap').style.display = lead && MG.task ? 'block' : 'none';
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
  }).join('') + (S.team.rank >= RANK.INSTRUCTOR ? '<div class="b-pad b-top b-row-btns"><button class="ghost-btn" onclick="editTask()">✏️ 과제 고치기</button><button class="ghost-btn b-danger" onclick="deleteTask()">이 과제 지우기</button></div>' : '');
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
function setupRecTab() { $('recTab').style.display = ''; }   // 업무 탭은 모두에게 (교관 이상은 녹음 요청 관리까지)
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
  if (!STF.data) loadStatForm().then(function () { if (RC.current && statCan()) renderRecBoard(); });
  if (!S.team) return Promise.resolve();
  loadRecMine();
  // 진행 상황은 과원 모두 봄 (2026-10-06). 올리기·배치·알림 같은 관리와 업무가능 2주 모아보기는 교관 이상만
  var mgr = recAllowed();
  $('recView').classList.toggle('rec-ro', !mgr); $('recAvail').style.display = mgr ? '' : 'none'; $('recFab').style.display = mgr ? '' : 'none';
  if (!RC.list) $('recTable').innerHTML = '<div class="skeleton row-skel"></div>';
  if (mgr) loadAvail();
  return api('rec.list', { team_id: S.team.id }).then(function (d) {
    RC.list = d.requests; RC.people = d.people || []; RC.staff = !!d.staff;
    renderRecList();
    if (RC.pending) { var id = RC.pending; RC.pending = null; if (byId(RC.list, id)) openRec(id); }
    else if (RC.current) { var c = byId(RC.list, RC.current.id); if (c) { RC.current = c; renderRecHead(); renderRecBoard(); } }
  }).catch(function (err) {
    $('recTable').innerHTML = '<div class="empty"><b>녹음 요청을 불러오지 못했어요</b>' + esc(err.message) + '</div>';
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
function renderRecList() { renderRecCal(); renderRecTable(); }
// ----- 녹음 표: 진행 중 + 최근 60일, 검색 (제목·코드·사람) -----
var RT_ROLE = { '녹음자': 'v', '엔지니어': 'e', '감독자': 'd' };
function recWho(r) {
  var w = { v: [], e: [], d: [] };
  activeSess(r).forEach(function (x) { x.people.forEach(function (p) { if (p.answer === '미선정') return; var k = RT_ROLE[p.role]; if (k && w[k].indexOf(p.name) === -1) w[k].push(p.name); }); });
  return w;
}
function renderRecTable() {
  if (!RC.list) return;
  var q = ($('rtQ').value || '').trim().toLowerCase(), staff = RC.staff;
  var rows = RC.list.slice().sort(function (a, b) { return (recIsOpen(b) - recIsOpen(a)) || ((recIsOpen(a) ? (a.due_at || '9') < (b.due_at || '9') : a.received_at > b.received_at) ? -1 : 1); });
  rows = rows.map(function (r) { return { r: r, w: recWho(r), s: activeSess(r).filter(function (x) { return x.status !== '완료'; })[0] || activeSess(r)[0] }; });
  if (q) rows = rows.filter(function (x) { return [x.r.title, x.r.request_code, x.r.status].concat(x.w.v, x.w.e, x.w.d).join(' ').toLowerCase().indexOf(q) !== -1; });
  var open = RC.list.filter(recIsOpen).length;
  $('recOpenCount').textContent = '진행 중 ' + open + ' · 전체 ' + RC.list.length + (q ? ' · 찾은 것 ' + rows.length : '');
  if (!rows.length) { $('recTable').innerHTML = '<p class="rec-none">' + (q ? '「' + esc(q) + '」에 맞는 녹음이 없어요' : '최근 60일 동안 녹음 요청이 없어요' + (staff ? '. 오른쪽 아래 + 로 올려요' : '')) + '</p>'; return; }
  var hl = function (t) { t = esc(t); if (!q) return t; var i = t.toLowerCase().indexOf(esc(q).toLowerCase()); return i < 0 ? t : t.slice(0, i) + '<mark>' + t.slice(i, i + esc(q).length) + '</mark>' + t.slice(i + esc(q).length); };
  var ppl = function (a) { return a.length ? a.map(hl).join(', ') : '<span class="rt-none">–</span>'; };
  $('recTable').innerHTML = '<div class="card rt-wrap"><table class="rt"><thead><tr><th>녹음</th><th>상태</th><th>녹음 일시</th><th>녹음자</th>' + (staff ? '<th>엔지니어</th><th>감독</th><th>마감</th>' : '') + '</tr></thead><tbody>' +
    rows.map(function (x) {
      var r = x.r, due = r.due_at ? Date.parse(r.due_at) : null;
      return '<tr class="' + (recIsOpen(r) ? '' : 'past') + '" onclick="openRec(\'' + esc(r.id) + '\')"><td class="rt-t">' + (r.request_code ? '<small>' + hl(r.request_code) + '</small>' : '') + '<b>' + hl(r.title || '녹음') + '</b></td>' +
        '<td><span class="st ' + (REC_ST[r.status] || 'st-none') + '">' + esc(r.status) + '</span></td>' +
        '<td class="rt-d">' + (x.s ? mdw(x.s.start) + ' ' + hmMs(x.s.start) + (x.s.status === '조율중' ? '<small>조율 중</small>' : '') : '<span class="rt-none">–</span>') + '</td>' +
        '<td>' + ppl(x.w.v) + '</td>' + (staff ? '<td>' + ppl(x.w.e) + '</td><td>' + ppl(x.w.d) + '</td><td class="rt-d">' + (due ? dtLabel(r.due_at) + (recIsOpen(r) ? '<small class="' + (dayDiff(due) <= 2 ? 'rc-soon' : '') + '">' + ddText(due) + '</small>' : '') : '–') + '</td>' : '') + '</tr>';
    }).join('') + '</tbody></table></div>';
}
// ----- 녹음 달력: 홈 '한 달 일정'과 같은 모양, 녹음 회차만 -----
var RCAL = { ym: null, sel: null };
function rcalMove(n) {
  var now = new Date();
  if (n === 0) { RCAL.ym = ymOf(now); RCAL.sel = now.toDateString(); }
  else { var p = RCAL.ym.split('-'); RCAL.ym = ymOf(new Date(+p[0], +p[1] - 1 + n, 1)); RCAL.sel = null; }
  renderRecCal();
}
function recCalItems() {
  var out = [];
  (RC.list || []).forEach(function (r) { activeSess(r).forEach(function (x) {
    out.push({ r: r, s: x, start: x.start, end: x.end, title: (r.title || '녹음') + (x.title && activeSess(r).length > 1 ? ' · ' + x.title : ''), adj: x.status === '조율중' });
  }); });
  return out;
}
function renderRecCal() {
  var now = new Date(); if (!RCAL.ym) RCAL.ym = ymOf(now);
  var p = RCAL.ym.split('-'), y = +p[0], m = +p[1] - 1, first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
  if (!RCAL.sel) RCAL.sel = (ymOf(now) === RCAL.ym ? now : first).toDateString();
  var weeks = Math.ceil((first.getDay() + days) / 7), start = new Date(y, m, 1 - first.getDay()), byDay = {}, todayKey = now.toDateString();
  recCalItems().forEach(function (t) { var k = new Date(t.start).toDateString(); (byDay[k] = byDay[k] || []).push(t); });
  var cells = '';
  for (var i = 0; i < weeks * 7; i++) {
    var d = new Date(start); d.setDate(start.getDate() + i);
    var k = d.toDateString(), evs = (byDay[k] || []).sort(function (a, b) { return a.start - b.start; });
    var hol = SCHED_HOLIDAYS[pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())];
    cells += '<button type="button" class="mc-d' + (d.getMonth() !== m ? ' out' : '') + (k === todayKey ? ' today' : '') + (k === RCAL.sel ? ' sel' : '') +
      (hol || d.getDay() === 0 ? ' red' : d.getDay() === 6 ? ' blue' : '') + '" data-k="' + esc(k) + '">' +
      '<span class="mc-n"><i>' + d.getDate() + '</i>' + (hol ? '<small>' + hol + '</small>' : '') + '</span>' +
      '<span class="mc-evs">' + evs.slice(0, 3).map(function (t) { return '<span class="mc-ev k-rec' + (t.adj ? ' rc-adj' : '') + '"><em>' + hmMs(t.start) + '</em>' + esc(t.title) + '</span>'; }).join('') +
      (evs.length > 3 ? '<span class="mc-more">+' + (evs.length - 3) + '</span>' : '') + '</span>' +
      '<span class="mc-dots">' + evs.slice(0, 4).map(function (t) { return '<i class="k-rec' + (t.adj ? ' rc-adj' : '') + '"></i>'; }).join('') + '</span></button>';
  }
  var sel = (byDay[RCAL.sel] || []).sort(function (a, b) { return a.start - b.start; }), selD = new Date(RCAL.sel);
  var detail = !RC.list ? '<div class="mc-none">불러오는 중…</div>'
    : '<div class="mc-dh">' + (selD.getMonth() + 1) + '월 ' + selD.getDate() + '일 ' + WD[selD.getDay()] + '요일' + (sel.length ? ' · 녹음 ' + sel.length + '건' : '') + '</div>' +
      (sel.length ? sel.map(function (t) {
        var v = t.s.people.filter(function (q) { return q.role === '녹음자' && q.selected; }).map(function (q) { return q.name; });
        return '<button type="button" class="mc-it k-rec rc-calit" data-sid="' + esc(t.s.id) + '"><span class="mc-t">' + hmMs(t.start) + (t.end ? '–' + hmMs(t.end) : '') + '</span>' +
          '<div><b>' + esc(t.title) + (t.adj ? ' <em class="rc-adjtag">조율 중</em>' : '') + '</b><small>' + esc((v.length ? '녹음자 ' + v.join(', ') : '녹음자 확정 전') + (RC.staff && t.s.location ? ' · ' + t.s.location : '')) + '</small></div></button>';
      }).join('') : '<div class="mc-none">이날은 녹음이 없어요</div>');
  $('rcalNote').textContent = RC.staff ? '확정 · 조율 중(점선) 회차' : '확정된 녹음';
  $('recCal').innerHTML = '<div class="mc card">' +
    '<div class="mc-top"><button type="button" class="mc-nav" data-m="-1" aria-label="지난달">‹</button><b>' + y + '년 ' + (m + 1) + '월</b>' +
      '<button type="button" class="mc-nav" data-m="1" aria-label="다음 달">›</button>' + (RCAL.ym !== ymOf(now) ? '<button type="button" class="mc-nav mc-today" data-m="0">오늘</button>' : '') + '</div>' +
    '<div class="mc-wd"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>' +
    '<div class="mc-grid">' + cells + '</div><div class="mc-detail">' + detail + '</div></div>';
}
$('recCal').addEventListener('click', function (e) {
  var nav = e.target.closest('.mc-nav'); if (nav) { rcalMove(+nav.getAttribute('data-m')); return; }
  var it = e.target.closest('.rc-calit'); if (it) { openRecSess(it.getAttribute('data-sid')); return; }
  var d = e.target.closest('.mc-d'); if (d) {
    RCAL.sel = d.getAttribute('data-k'); renderRecCal();
    var evs = recCalItems().filter(function (t) { return new Date(t.start).toDateString() === RCAL.sel; });
    if (evs.length === 1 && isWide()) openRecSess(evs[0].s.id);
  }
});
// 달력에서 녹음 누르기: 교관 이상 = 요청 상세 전부, 그 밖 = 녹음·녹음자·시간만
function openRecSess(sid) {
  var hit = recCalItems().filter(function (t) { return t.s.id === sid; })[0]; if (!hit) return;
  if (RC.staff) { openRec(hit.r.id); return; }
  recBrief(hit.r, hit.s);
}
function recBrief(r, x) {
  var list = x ? [x] : activeSess(r);
  $('itemModalT').textContent = r.title || '녹음'; $('itemModalS').textContent = '녹음 일정';
  $('itemBody').innerHTML = (list.length ? list.map(function (s) {
    var v = s.people.filter(function (q) { return q.role === '녹음자' && q.selected; }).map(function (q) { return q.name; });
    return '<div class="rb-brief"><div><span>녹음</span><b>' + esc((r.title || '녹음') + (s.title ? ' · ' + s.title : '')) + '</b></div>' +
      '<div><span>녹음자</span><b>' + (v.length ? esc(v.join(', ')) : '확정 전') + '</b></div>' +
      '<div><span>시간</span><b>' + mdw(s.start) + ' ' + hmMs(s.start) + (s.end ? '–' + hmMs(s.end) : '') + '</b></div></div>';
  }).join('') : '<p class="rec-none">아직 확정된 녹음 일정이 없어요 · 상태: ' + esc(r.status) + '</p>');
  openModal('itemModal');
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
  }).join('') + '<p class="b-note rc-roles-hint">시간·장소를 정해 \'요청 보내기\'를 누르면 그때 고른 사람에게 알림이 가요</p>';
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
// =====================================================================
// 업무 탭 아래: 업무가능 시간 2주 한눈에 (오늘부터 14일)
// 시간대별 = 30분 칸마다 되는 사람 수(누르면 명단) / 사람별 = 날짜마다 되는 시간
// =====================================================================
var AV = { data: null, at: 0, team: null, view: 'time', sel: '' };
function loadAvail(force) {
  if (!force && AV.data && Date.now() - AV.at < 3 * 60 * 1000) { renderAvail(); return; }
  if (!AV.data) $('avBody').innerHTML = '<div class="b-wait">불러오는 중...</div>';
  api('weekly.overview').then(function (d) {
    AV.data = d; AV.at = Date.now();
    if (AV.team === null) AV.team = d.mine.length === 1 ? d.mine[0] : '';
    renderAvail();
  }).catch(function (err) { $('avBody').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function avTeam(t) { AV.team = t; AV.sel = ''; renderAvail(); }
function avView(v) { AV.view = v; AV.sel = ''; renderAvail(); }
function avPick(k) { AV.sel = AV.sel === k ? '' : k; renderAvail(); }
// 같은 주에 업무가능을 냈는지 (날짜 → 그 주 월요일)
function avWeekOf(d) { var x = parseDate(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); }
// [19,20,21,…] → '9:30~11, 19~22'
function avRanges(slots) {
  var s = (slots || []).slice().sort(function (a, b) { return a - b; }), out = [], i = 0;
  var t = function (n) { return n % 2 ? Math.floor(n / 2) + ':30' : String(n / 2); };
  while (i < s.length) { var a = s[i]; while (i + 1 < s.length && s[i + 1] === s[i] + 1) i++; out.push(t(a) + '~' + t(s[i] + 1)); i++; }
  return out;
}
function renderAvail() {
  var d = AV.data; if (!d) return;
  var ppl = AV.team ? d.people.filter(function (p) { return p.teams.indexOf(AV.team) !== -1; }) : d.people;
  var chips = (d.teams.length > 1 ? [''].concat(d.teams) : []).map(function (t) {
    return '<button type="button" class="wkchip' + (t === AV.team ? ' active' : '') + '" data-t="' + esc(t) + '" onclick="avTeam(this.getAttribute(\'data-t\'))">' + (t ? esc(t) : '전체') + '</button>';
  }).join('');
  var h = '<div class="av-bar"><div class="wk-chips">' + chips + '</div>' +
    '<div class="rcr-seg">' + [['time', '시간대별'], ['person', '사람별']].map(function (v) {
      return '<button type="button" class="' + (AV.view === v[0] ? 'on' : '') + '" onclick="avView(\'' + v[0] + '\')">' + v[1] + '</button>';
    }).join('') + '</div></div>';
  if (!ppl.length) { $('avBody').innerHTML = h + '<div class="empty"><b>이 팀에는 사람이 없어요</b></div>'; return; }
  var n = d.dates.length, total = ppl.length;
  if (AV.view === 'time') {
    var who = {};
    ppl.forEach(function (p) { Object.keys(p.slots).forEach(function (di) { p.slots[di].forEach(function (s) { (who[di + '-' + s] = who[di + '-' + s] || []).push(p.name); }); }); });
    h += '<div class="grid-wrap av-grid"><div class="tgrid res half" style="grid-template-columns: 34px repeat(' + n + ', minmax(36px, 1fr));">' + gridHead(d.dates);
    for (var s = d.hours.from * 2; s < d.hours.to * 2; s++) {
      var top = s % 2 === 0;
      h += '<div class="gt' + (top ? ' hr' : '') + '">' + (top ? (s / 2) + '시' : '') + '</div>';
      for (var di = 0; di < n; di++) {
        // 같은 인원이 이어지면 한 막대로: 숫자는 막대가 시작하는 칸에만, 위아래 이어진 칸은 모서리를 붙임
        var key = di + '-' + s, c = (who[key] || []).length, a = c ? 0.22 + 0.78 * c / total : 0;
        var up = s > d.hours.from * 2 ? (who[di + '-' + (s - 1)] || []).length : 0, dn = (who[di + '-' + (s + 1)] || []).length;
        h += '<div class="gc' + (top ? ' hr' : '') + (c ? ' on2' : '') + (c && up ? ' jt' : '') + (c && dn && s + 1 < d.hours.to * 2 ? ' jb' : '') + (c === total ? ' full' : '') + (AV.sel === key ? ' sel' : '') + '"' +
          (c ? ' style="--a:' + a.toFixed(2) + ';' + (a > 0.55 ? 'color:#fff;' : '') + '"' : '') +
          ' onclick="avPick(\'' + key + '\')">' + (c && c !== up ? c : '') + '</div>';
      }
    }
    h += '</div></div>';
    if (AV.sel) {
      var k = AV.sel.split('-'), date = d.dates[+k[0]], yes = who[AV.sel] || [], wk = avWeekOf(date);
      var no = ppl.filter(function (p) { return p.weeks[wk] && yes.indexOf(p.name) === -1; }).map(function (p) { return p.name; });
      var none = ppl.filter(function (p) { return !p.weeks[wk]; }).map(function (p) { return p.name; });
      h += '<div class="pd-cell-info"><b>' + shortD(date) + ' ' + slotHm(+k[1]) + '~' + slotHm(+k[1] + 1) + '</b><br>가능 ' + yes.length + '명: ' + (yes.length ? esc(yes.join(', ')) : '없음') +
        (no.length ? '<br>안 됨: ' + esc(no.join(', ')) : '') + (none.length ? '<br>아직 안 냄: ' + esc(none.join(', ')) : '') + '</div>';
    } else h += '<div class="pd-cell-info">칸을 누르면 그 시간에 누가 되는지 보여요</div>';
  } else {
    h += '<div class="table-scroll av-table"><table class="sched"><thead><tr><th class="av-name">이름</th>' + d.dates.map(function (x) {
      var w = parseDate(x).getDay();
      return '<th class="' + (w === 0 ? 'sun' : w === 6 ? 'sat' : '') + '">' + shortD(x) + '</th>';
    }).join('') + '</tr></thead><tbody>' + ppl.map(function (p) {
      return '<tr><td class="av-name"><b>' + esc(p.name) + '</b><span>' + esc(p.group || p.teams.join('·')) + '</span></td>' + d.dates.map(function (x, di) {
        var r = avRanges(p.slots[String(di)]);
        if (r.length) return '<td class="av-ok">' + r.map(esc).join('<br>') + '</td>';
        return p.weeks[avWeekOf(x)] ? '<td class="av-no">–</td>' : '<td class="av-none">미제출</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
  }
  // 주마다 아직 안 낸 사람
  var miss = d.weeks.map(function (w) {
    var names = ppl.filter(function (p) { return !p.weeks[w]; }).map(function (p) { return p.name; });
    var e = parseDate(w); e.setDate(e.getDate() + 6);
    return names.length ? '<div class="who-row">' + shortD(w) + '~' + shortD(ymd(e)) + ' 아직 안 냄 <b>' + names.length + '명</b>: ' + esc(names.join(', ')) + '</div>' : '';
  }).join('');
  $('avBody').innerHTML = h + (miss || '<div class="who-row"><b>2주 모두 냈어요 🎉</b></div>');
}

function openRec(id) {
  var r = byId(RC.list || [], id); if (!r) return;
  if (!RC.staff) { recBrief(r); return; }
  if (!RC.current || RC.current.id !== id) { RC.plan = null; RC.want = null; RC.day = null; RC.slot = null; RC.sel = null; RC.place = null; RC.adding = null; RC.planOpen = false; }
  RC.current = r;
  if (recAllowed() && !activeSess(r).length && freeRoles(r).length && recIsOpen(r) && r.status !== '보류') RC.planOpen = true;
  var wide = isWide();
  document.body.classList.toggle('rc-pop', wide);   // PC: 상세는 화면 가운데 팝업 (옆에서 밀고 들어오지 않음)
  $('recListWrap').style.display = wide ? 'block' : 'none';
  document.querySelector('.rec-title').style.display = wide ? '' : 'none';
  $('recAvail').style.display = wide && recAllowed() ? '' : 'none';
  renderRecList();
  $('recDetail').style.display = 'block'; $('recDetail').scrollTop = 0;
  try { if (tg && tg.BackButton) tg.BackButton.show(); } catch (e) {}
  if (!wide) window.scrollTo(0, 0);
  renderRecHead(); renderRecBoard();
  if (RC.planOpen) loadRecPlan(); else $('rdPlan').innerHTML = '';
}
function closeRec() {
  RC.current = null; RC.plan = null; RC.planOpen = false;
  document.body.classList.remove('rc-pop');
  $('recDetail').style.display = 'none';
  $('recListWrap').style.display = 'block';
  document.querySelector('.rec-title').style.display = '';
  $('recAvail').style.display = recAllowed() ? '' : 'none';
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
  if (!ss.length) h += recFlow(r, { status: '배치전', people: [], start: 0 });
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
    recFlow(r, s) +
    '<div class="rb-rows">' + rbRow('ok', '장소', '<span class="rp a-ok"><b>' + esc(s.location) + '</b><i>확보</i></span>', '');
  sessRoles(r, s).forEach(function (x) {
    var ps = s.people.filter(function (p) { return p.role === '녹음자' && p.role_id === x.id; });
    h += rbRow(live ? roleState(s, x.id) : 'ok', esc(x.name), ps.map(function (p) { return rpChip(p, live) + statBtn(s, p); }).join(''), live ? addBtn(s, 'voice', x.id) : '') + notes(ps) + chooser(s, 'voice', x.id, ps);
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
  else if (s.status === '예정') h += '<div class="rc-acts">' + (s.started_at ? '' : '<button type="button" class="rc-act" data-act="start">▶ 시작 보고</button>') +
    '<button type="button" class="rc-act ok" data-act="end">녹음 마쳤습니다</button><button type="button" class="rc-act bad" data-act="cancel">회차 취소</button></div>';
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
  if (act === 'stat') { openStatGrant({ person_id: b.getAttribute('data-person'), source_type: '녹음', source_id: sid, title: (RC.current.title || '') + ' · ' + (b.getAttribute('data-stitle') || '') }); return; }
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
  if (act === 'start' || act === 'end') { if (act === 'end' && !confirm('녹음을 마쳤다고 보고할까요? 회차가 완료로 바뀌어요')) return;
    msg('보내는 중...'); api(act === 'end' ? 'rec.end' : 'rec.start', { session_id: sid }).then(done('')).catch(fail); return; }
  if (act === 'arrive') { msg('기록하는 중...'); api('rec.arrive', { participant_id: b.getAttribute('data-pid') }).then(done('')).catch(fail); return; }
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
  } else if (!d.mine && !d.can_run) h += '<p class="b-note b-center">다른 사람에게 온 요청이라 응답은 본인만 할 수 있어요</p>';
  h += askRunBox(d);
  $('askBody').innerHTML = h;
}
// 녹음 당일: 성우는 '녹음실 도착', 엔지니어는 성우 도착 확인 + 시작 보고 + '녹음 마쳤습니다'
function askRunBox(d) {
  var s = d.session; if (s.status !== '예정' && !s.ended_at) return '';
  if (s.ended_at) return '<div class="ask-run"><b>✅ 녹음을 마쳤어요</b> <small>' + hmMs(Date.parse(s.ended_at)) + ' 종료 보고</small></div>';
  var h = '<div class="ask-run"><div class="ask-run-h"><b>' + (s.started_at ? '🔴 녹음 중' : '오늘 녹음') + '</b>' + (s.started_at ? '<small>' + hmMs(Date.parse(s.started_at)) + ' 시작</small>' : '') + '</div>';
  if (d.mine && d.role === '녹음자') h += d.arrived_at ? '<p class="ask-ok">✓ ' + hmMs(Date.parse(d.arrived_at)) + ' 녹음실 도착</p>'
    : d.can_arrive ? '<button class="btn-primary" onclick="recArrive(\'' + d.id + '\')">🎙 녹음실 도착</button><small class="ask-hint">봇 채팅에 \'도착\'이라고 쳐도 돼요</small>' : '<p class="ask-hint">녹음 시작 2시간 전부터 도착을 누를 수 있어요</p>';
  if (d.can_run && d.can_arrive) {
    var voices = d.mates.filter(function (m) { return m.selected && m.role === '성우'; });
    if (d.role === '녹음자' && !d.mine) voices.unshift({ id: d.id, name: '이 성우', arrived_at: d.arrived_at });
    if (voices.length) h += '<div class="ask-arr">' + voices.map(function (m) {
      return m.arrived_at ? '<span class="st st-참석">✓ ' + esc(m.name) + ' 도착</span>' : '<button class="st st-none" onclick="recArrive(\'' + m.id + '\')">' + esc(m.name) + ' 도착 확인</button>';
    }).join('') + '</div>';
    h += '<div class="ask-btns">' + (s.started_at ? '' : '<button class="btn-ghost" onclick="recRun(\'start\',\'' + s.id + '\')">▶ 시작 보고</button>') +
      '<button class="btn-primary" onclick="recRun(\'end\',\'' + s.id + '\')">녹음 마쳤습니다</button></div>';
  }
  return h + '<div class="msg" id="askRunMsg"></div></div>';
}
function recArrive(pid) {
  api('rec.arrive', { participant_id: pid }).then(function () { haptic('success'); refreshTodos(true); if (RC.list) loadRec(); if (MODAL === 'askModal') openAsk(ASK.id); })
    .catch(function (err) { alertMsg(err.message); });
}
function recRun(step, sid) {
  if (step === 'end' && !confirm('녹음을 마쳤다고 보고할까요? 회차가 완료로 바뀌어요')) return;
  api(step === 'end' ? 'rec.end' : 'rec.start', { session_id: sid }).then(function () { haptic('success'); refreshTodos(true); if (RC.list) loadRec(); if (MODAL === 'askModal') openAsk(ASK.id); })
    .catch(function (err) { alertMsg(err.message); });
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
  if (RP.open && (e.key === 'Escape' || e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { if (e.key === 'Escape') closeRecap(); else recapStep(e.key === 'ArrowRight' ? 1 : -1); return; }
  if (e.key === 'Escape' && $('mePop').classList.contains('open')) { toggleMePop(false); return; }
  if (e.key === 'Escape' && pfFloating() && ($('pfSub').classList.contains('open') || $('recSub').classList.contains('open'))) { togglePfSub(false); togglePfSub(false, 'recSub'); return; }
  if (e.key === 'Escape' && $('attFab').classList.contains('open')) { closeFabMenu(); return; }
  if (e.key !== 'Escape' || !isWide()) return;
  var t = e.target && e.target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
  if (curTab === 'attend' && $('attendWrap').classList.contains('split')) showList();
  else if (curTab === 'task' && $('taskView').classList.contains('split')) closeTask();
  else if (curTab === 'profile' && $('profileView').classList.contains('split')) closePfEdit();
  else if (curTab === 'rec' && RC.current) closeRec();
  else if (curTab === 'poll' && $('pollView').classList.contains('split')) closePoll();
  else if (curTab === 'people' && PPL.cur) closePerson();
  else if (curTab === 'mtg') closeMeeting();
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
  $('skyTab').style.display = ok ? '' : 'none';   // 하늘방송국도 PC 전용
  var n = [].filter.call(document.querySelectorAll('#tabbar .tab'), function (b) { return b.style.display !== 'none'; }).length;
  $('tabbar').style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
  if (!ok && (curTab === 'town' || curTab === 'sky')) goTab('home');
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
    refreshMs: 60000,   // 서버 설정값 town_refresh_sec이 오면 그걸로
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
// '지금 할 일'은 오른쪽 위 동그라미를 누르면 뜨는 상자 안(#todoArea)
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
      if (t.kind === 'flowstep') return row(i, '🧩', t.flow + ' · ' + t.name, (t.state === '막힘' ? '막힘 · ' : t.state === '시작' ? '하는 중 · ' : '내 차례 · ') + (t.due ? t.due.slice(5).replace('-', '/') + '까지 · ' : '') + '눌러서 보고', t.urgent);
      if (t.kind === 'mtgaction') return row(i, '📋', '회의에서 맡은 일 · ' + t.name, t.due ? t.due.slice(5).replace('-', '/') + '까지 · 눌러서 완료' : '눌러서 완료', t.urgent);
      if (t.kind === 'mtgprep') return row(i, '🗂', '회의 안건 의견 · ' + t.name, shortD(t.date) + ' 회의 · 안건 ' + t.left + '개 남음', t.urgent);
      if (t.kind === 'poll') return row(i, '📅', '가능시간 입력 · ' + t.name, '마감 ' + mdw(Date.parse(t.due)) + ' ' + hmMs(Date.parse(t.due)), t.urgent);
      if (t.kind === 'recarrive') return row(i, '🎙', '녹음실 도착 · ' + t.name, hmMs(t.start) + ' 시작' + (t.place ? ' · ' + t.place : '') + ' · 도착하면 눌러주세요', true);
      if (t.kind === 'recrun') return row(i, t.step === 'start' ? '▶' : '✅', (t.step === 'start' ? '녹음 시작 보고 · ' : '녹음 종료 보고 · ') + t.name, hmMs(t.start) + ' 시작' + (t.place ? ' · ' + t.place : ''), true);
      if (t.kind === 'recask') return row(i, '🎙', '녹음 요청 응답 · ' + t.name, t.role + ' · ' + mdw(t.start) + ' ' + hmMs(t.start) + (t.place ? ' · ' + t.place : ''), t.urgent);
      return '';
    }).join('') + '</div>');
}
// 할 일을 누르면 그 화면으로
function openTodo(i) {
  var t = TODO.data && TODO.data.items[i]; if (!t) return;
  toggleMePop(false);
  var inTeam = function (fn) {
    if (t.team_id && S.team && t.team_id !== S.team.id && S.me.teams.some(function (x) { return x.id === t.team_id; })) return Promise.resolve(selectTeam(t.team_id)).then(fn);
    return Promise.resolve(fn());
  };
  if (t.kind === 'weekly') { goWeekly(t.week_start === mondayOf('next') ? 'next' : 'this'); return; }
  if (t.kind === 'recask' || t.kind === 'recarrive' || t.kind === 'recrun') { openAsk(t.id); return; }
  if (t.kind === 'flowstep') { FW.pending = t.id; if (curTab === 'flow') loadFlows(); else goTab('flow'); return; }
  if (t.kind === 'mtgaction') { if (confirm('「' + t.name + '」 끝냈나요?')) api('mtg.actionDone', { id: t.id }).then(function () { haptic('success'); refreshTodos(true); }).catch(function (err) { alertMsg(err.message); }); return; }
  if (t.kind === 'mtgprep') { inTeam(function () { openMeeting(t.id); }); return; }
  if (t.kind === 'poll') { PL.pending = t.id; if (curTab === 'poll') loadPolls(); else goTab('poll'); return; }
  if (t.kind === 'reason' || t.kind === 'plan') {
    inTeam(function () { goTab('attend'); return refreshSessions().then(function () { if (byId(S.sessions, t.id)) openSession(t.id); }); });
    return;
  }
  if (t.kind === 'checkin') { inTeam(function () { goTab('attend'); }); return; }
  if (t.kind === 'task') {
    inTeam(function () { A.current = null; goTask('notice'); var tries = 0;
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
    else if (RP.open) closeRecap();
    else if (curTab === 'people' && PPL.cur) closePerson();
  else if (curTab === 'mtg') closeMeeting();
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
  loadStats();
  loadBadges();
  loadRecapStatus();
  loadLook();
  loadMyNotes();
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
  // 달을 넘길 땐 지난 달 내용을 흐리게 둔 채 불러옴 (비우면 화면 높이가 줄어 스크롤 막대가 깜빡이고 폭이 흔들림)
  var box = $('pfReport');
  if (box.querySelector('.pf-grid')) box.classList.add('b-dim'); else box.innerHTML = '<div class="empty"><b>모으는 중...</b></div>';
  api('profile.report', { month: month }).then(function (r) {
    if (month !== P.month) return;   // 그사이 다른 달로 넘김
    box.classList.remove('b-dim');
    P.report = r; renderPfReport();
  }).catch(function (err) { box.classList.remove('b-dim'); box.innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
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

// =====================================================================
// 성우 스탯: 나의 기록 맨 위 육각형 차트 + 받은 피드백, 교관 이상 '스탯 주기'
// 레벨은 서버가 지급 내역에서 계산해서 줌 (stats.get). 차트는 SVG로 직접 그림
// =====================================================================
var STAT = { data: null, pick: null };
var STF = { data: null, at: 0 };     // 스탯 주기 팝업 재료 (stats.form): 내가 줄 수 있는 팀·축·사람
function loadStatForm() {
  if (STF.data && Date.now() - STF.at < 300000) return Promise.resolve(STF.data);
  return api('stats.form').then(function (d) { STF.data = d; STF.at = Date.now(); return d; }).catch(function () { return null; });
}
function statCan() { return !!(STF.data && STF.data.teams.length); }
// 녹음 현황판: 녹음 완료된 회차의 들어간 성우 옆 '⭐ 스탯' (줄 수 있는 사람에게만)
function statBtn(s, p) {
  if (s.status !== '완료' || !p.selected || !statCan() || (S.me && p.person_id === S.me.profile.id)) return '';
  return '<button type="button" class="rp-stat" data-act="stat" data-person="' + esc(p.person_id) + '" data-stitle="' + esc(s.title || '') + '">⭐ 스탯</button>';
}
function loadStats() {
  api('stats.get').then(function (d) { STAT.data = d; renderStats(true); }).catch(function () { $('statArea').innerHTML = ''; });
  loadStatForm().then(function () { if (STAT.data) renderStats(false); });
}
function statSeenKey() { return 'statSeen:' + (S.me ? S.me.profile.id : ''); }
function renderStats(first) {
  var d = STAT.data, el = $('statArea');
  if (!d || !d.team_id) { el.innerHTML = ''; return; }
  // 레벨업 반짝임: 이 기기에서 지난번에 본 레벨보다 오른 축 (처음 보면 반짝임 없이 기억만)
  var seen = null; try { seen = JSON.parse(localStorage.getItem(statSeenKey()) || 'null'); } catch (e) {}
  var up = {};
  if (first) {
    d.axes.forEach(function (a) { if (seen && seen[a.id] && a.level > seen[a.id]) up[a.id] = 1; });
    var now = {}; d.axes.forEach(function (a) { now[a.id] = a.level; });
    try { localStorage.setItem(statSeenKey(), JSON.stringify(now)); } catch (e) {}
  }
  var grew = d.axes.filter(function (a) { return a.level > a.prev_level; }).length;
  el.innerHTML = '<div class="st-two"><div class="st-col"><div class="section-head"><h2>나의 성장</h2><span class="section-count">' +
      (grew ? '이번 달 ' + grew + '개 축 레벨업' : '축을 누르면 다음 레벨까지 남은 XP') + '</span>' +
      '</div>' +
    '<div class="card st-card"><div class="st-chart' + (first ? ' grow' : '') + '">' + statSvg(d, up) + '</div>' +
      '<div class="st-legend"><span><i class="now"></i>지금</span><span><i class="prev"></i>지난달 말</span></div>' +
      '<div class="st-pick" id="statPick">' + statPickText() + '</div></div></div><div class="st-col">' +
    '<div class="section-head st-fbhead"><h2>받은 피드백</h2><span class="section-count">' + d.feedback.length + '개</span></div>' +
    (d.feedback.length ? '<div class="st-fb">' + d.feedback.map(function (f) {
      return '<div class="card st-fbrow"><div class="st-fbtop"><b>' + esc(f.title || f.source_type) + '</b><small>' + mdOf(f.at) + ' · ' + esc(f.by) + '</small></div>' +
        '<div class="st-xps">' + f.items.map(function (i) { return '<span>' + esc(i.name) + ' +' + i.xp + '</span>'; }).join('') + '</div>' +
        '<p>' + esc(f.comment) + '</p></div>';
    }).join('') + '</div>' : '<div class="empty"><b>아직 받은 피드백이 없어요</b>실무를 마치면 교관님이 스탯을 올려줘요</div>') + '</div></div>';
}
function statPickText() {
  var a = STAT.data && STAT.data.axes[STAT.pick];
  if (!a) return '';
  return '<b>' + esc(a.name) + ' Lv.' + a.level + '</b> · ' + (a.need ? '다음 레벨까지 ' + (a.need - a.into) + ' XP' : '최고 레벨이에요') +
    (a.description ? '<small>' + esc(a.description) + '</small>' : '');
}
function statAxis(i) { STAT.pick = STAT.pick === i ? null : i; $('statPick').innerHTML = statPickText(); document.querySelectorAll('.st-lab').forEach(function (g) { g.classList.toggle('on', +g.getAttribute('data-i') === STAT.pick); }); }
// 활성 축 개수만큼 꼭짓점인 레이더. 반지름 = 레벨(다음 레벨까지 모은 만큼 소수로) / 최대 레벨
function statSvg(d, up) {
  var n = d.axes.length, R = 92, max = d.max_level || 10;
  if (n < 3) return '';
  var pt = function (i, r) { var t = -Math.PI / 2 + 2 * Math.PI * i / n; return [r * Math.cos(t), r * Math.sin(t)]; };
  var poly = function (f) { return d.axes.map(function (a, i) { return pt(i, f(a)).map(function (v) { return v.toFixed(1); }).join(','); }).join(' '); };
  var val = function (a) { return R * Math.min(1, (a.level + (a.need ? a.into / a.need : 0)) / max); };
  var h = '<svg viewBox="-150 -138 300 276" role="img" aria-label="스탯 차트">';
  for (var k = 2; k <= max; k += 2) h += '<polygon class="st-ring" points="' + poly(function () { return R * k / max; }) + '"/>';
  d.axes.forEach(function (a, i) { var p = pt(i, R); h += '<line class="st-ring" x1="0" y1="0" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '"/>'; });
  h += '<polygon class="st-prev" points="' + poly(function (a) { return R * a.prev_level / max; }) + '"/>';
  h += '<g class="st-now"><polygon points="' + poly(val) + '"/>' + d.axes.map(function (a, i) {
    var p = pt(i, val(a)); return '<circle class="' + (up[a.id] ? 'lvup' : '') + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5"/>';
  }).join('') + '</g>';
  d.axes.forEach(function (a, i) {
    var p = pt(i, R + 26), anchor = Math.abs(p[0]) < 8 ? 'middle' : p[0] > 0 ? 'start' : 'end';
    if (anchor !== 'middle') p[0] += p[0] > 0 ? -10 : 10;
    h += '<g class="st-lab' + (up[a.id] ? ' lvup' : '') + (STAT.pick === i ? ' on' : '') + '" data-i="' + i + '" onclick="statAxis(' + i + ')" text-anchor="' + anchor + '">' +
      '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] - 2).toFixed(1) + '">' + esc(a.name) + '</text>' +
      '<text class="lv" x="' + p[0].toFixed(1) + '" y="' + (p[1] + 13).toFixed(1) + '">Lv.' + a.level + (a.level > a.prev_level ? ' ▲' : '') + '</text></g>';
  });
  return h + '</svg>';
}

// ----- 스탯 주기 팝업 { person_id?, source_type?, source_id?, title? } -----
var SG = null;
function openStatGrant(o) {
  SG = { o: o, items: {}, team: null, existing: null };
  $('statModalT').textContent = '⭐ 스탯 주기';
  $('statBody').innerHTML = '<div class="b-wait">불러오는 중...</div>';
  openModal('statModal');
  STF.at = 0;
  Promise.all([loadStatForm(), o.source_id ? api('stats.form', { person_id: o.person_id, source_id: o.source_id }) : null]).then(function (r) {
    var f = r[0]; if (!f || !f.teams.length) { $('statBody').innerHTML = '<div class="empty"><b>스탯을 줄 수 있는 팀이 없어요</b>교관 이상만 줄 수 있어요</div>'; return; }
    SG.team = f.teams.filter(function (t) { return !o.person_id || t.people.some(function (p) { return p.id === o.person_id; }); })[0];
    if (!SG.team) { $('statBody').innerHTML = '<div class="empty"><b>이 사람에게는 줄 수 없어요</b>내 팀 사람에게만 줄 수 있어요</div>'; return; }
    SG.max = f.max_xp;
    SG.existing = r[1] && r[1].existing;
    if (SG.existing) { SG.items = SG.existing.items; $('statModalT').textContent = '⭐ 준 스탯 고치기'; }
    SG.person = o.person_id || '';
    SG.src = o.source_type || '수업';
    renderStatGrant();
  });
}
function renderStatGrant() {
  var t = SG.team, o = SG.o, sum = 0;
  Object.keys(SG.items).forEach(function (k) { sum += SG.items[k] || 0; });
  var who = t.people.filter(function (p) { return p.id === SG.person; })[0];
  var h = '';
  if (o.person_id) h += '<div class="sg-who"><b>' + esc(who ? who.name : '') + '</b>' + (o.title ? '<small>🎙 ' + esc(o.title) + '</small>' : '') + '</div>';
  else h += '<label class="field-label">누구에게</label><div class="b-chips sg-people">' + t.people.map(function (p) {
    return '<button type="button" class="b-pick' + (p.id === SG.person ? ' on' : '') + '" onclick="SG.person=\'' + esc(p.id) + '\';renderStatGrant()">' + esc(p.name) + '<small> ' + esc(p.position || '') + '</small></button>';
  }).join('') + '</div>' +
    '<label class="field-label">어떤 자리에서</label><div class="b-chips">' + ['수업', '스터디', '기타'].map(function (x) {
      return '<button type="button" class="b-pick' + (SG.src === x ? ' on' : '') + '" onclick="SG.src=\'' + x + '\';renderStatGrant()">' + x + '</button>';
    }).join('') + '</div>';
  h += '<label class="field-label">올려줄 스탯 <span class="hint">합계 ' + sum + ' / ' + SG.max + ' XP</span></label><div class="sg-axes">' + t.axes.map(function (a) {
    var v = SG.items[a.id] || 0;
    return '<div class="sg-axis"><span>' + esc(a.name) + '</span><div class="seg">' + [0, 1, 2, 3].map(function (x) {
      return '<button type="button" class="' + (v === x ? 'on' : '') + (x ? '' : ' z') + '" onclick="sgSet(\'' + a.id + '\',' + x + ')">' + (x ? '+' + x : '–') + '</button>';
    }).join('') + '</div></div>';
  }).join('') + '</div>' +
    '<label class="field-label" for="sgComment">한 줄 코멘트 <span class="hint">꼭 적어주세요</span></label>' +
    '<input type="text" id="sgComment" class="b-input" maxlength="200" placeholder="예) 후반부 톤 유지 좋았음" value="' + esc(($('sgComment') && $('sgComment').value) || (SG.existing ? SG.existing.comment : '')) + '">' +
    '<button class="btn-primary" id="sgBtn" onclick="saveStatGrant()">' + (SG.existing ? '고친 내용 저장' : '스탯 주기') + '</button>' +
    (SG.existing ? '<button type="button" class="ghost-btn b-danger sg-revoke" onclick="revokeStatGrant()">이 지급 취소하기</button>' : '') +
    '<div class="msg" id="sgMsg"></div>';
  $('statBody').innerHTML = h;
}
function sgSet(id, x) {
  var c = $('sgComment') && $('sgComment').value;
  SG.items[id] = x; renderStatGrant();
  if (c !== undefined) $('sgComment').value = c;
}
function saveStatGrant() {
  if (!SG.person) { setMsg('sgMsg', '누구에게 줄지 골라주세요', true); return; }
  var btn = $('sgBtn'); btn.disabled = true; setMsg('sgMsg', '저장하는 중...');
  var comment = $('sgComment').value;
  var req = SG.existing ? api('stats.update', { id: SG.existing.id, items: SG.items, comment: comment })
    : api('stats.grant', { team_id: SG.team.team_id, person_id: SG.person, source_type: SG.src, source_id: SG.o.source_id || null, items: SG.items, comment: comment });
  req.then(function (r) {
    haptic('success');
    var nf = r.notify;
    setMsg('sgMsg', SG.existing ? '고쳤어요' : nf && !nf.sent ? '저장했어요. 다만 그분이 봇과 대화를 시작하지 않아서 알림은 못 갔어요' : '스탯을 올려줬어요! 알림도 보냈어요', !!(nf && !nf.sent));
    setTimeout(function () { closeModal('statModal'); }, nf && !nf.sent ? 3000 : 1000);
  }).catch(function (err) { btn.disabled = false; setMsg('sgMsg', err.message, true); });
}
function revokeStatGrant() {
  if (!SG.existing || !confirm('이 지급을 취소할까요? 받은 사람의 스탯에서 빠져요')) return;
  api('stats.revoke', { id: SG.existing.id }).then(function () { haptic('success'); closeModal('statModal'); })
    .catch(function (err) { setMsg('sgMsg', err.message, true); });
}

// =====================================================================
// 칭호·배지: 나의 기록 '나의 배지'. 딴 배지를 누르면 대표 칭호로 (동네지도 이름 위에 보임)
// 새로 딴 배지 반짝임은 이 기기 localStorage 'badgeSeen:<id>'와 비교
// =====================================================================
var BDG = { data: null, pick: null, fresh: {} };
function loadBadges() {
  api('badges.get').then(function (d) {
    BDG.data = d; BDG.fresh = {};
    var key = 'badgeSeen:' + S.me.profile.id, seen = null;
    try { seen = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}
    var got = d.badges.filter(function (b) { return b.earned_at; }).map(function (b) { return b.id; });
    if (seen) got.forEach(function (id) { if (seen.indexOf(id) === -1) BDG.fresh[id] = 1; });
    try { localStorage.setItem(key, JSON.stringify(got)); } catch (e) {}
    renderBadges();
  }).catch(function () { $('badgeArea').innerHTML = ''; });
}
function renderBadges() {
  var d = BDG.data; if (!d || !d.badges.length) { $('badgeArea').innerHTML = ''; return; }
  var n = d.badges.filter(function (b) { return b.earned_at; }).length;
  var title = d.badges.filter(function (b) { return b.is_title; })[0];
  $('badgeArea').innerHTML = '<div class="section-head b-gap"><h2>나의 배지</h2><span class="section-count">' + n + ' / ' + d.badges.length +
      (title ? ' · 대표 칭호 ' + esc(title.icon + ' ' + title.name) : '') + '</span></div>' +
    '<div class="card bg-card"><div class="bg-grid">' + d.badges.map(function (b, i) {
      return '<button type="button" class="bg' + (b.earned_at ? ' on' : '') + (BDG.fresh[b.id] ? ' fresh' : '') + (b.is_title ? ' title' : '') + (BDG.pick === i ? ' sel' : '') + '" onclick="pickBadge(' + i + ')">' +
        '<span class="bg-ic">' + esc(b.icon) + '</span><b>' + esc(b.name) + '</b></button>';
    }).join('') + '</div><div class="bg-info" id="badgeInfo">' + badgeInfo() + '</div></div>';
}
function badgeInfo() {
  var b = BDG.data && BDG.data.badges[BDG.pick]; if (!b) return '';
  return '<b>' + esc(b.icon + ' ' + b.name) + '</b> · ' + esc(b.description) +
    (b.earned_at ? '<small>' + mdOf(b.earned_at) + '에 얻었어요</small>' +
      '<button type="button" class="ghost-btn bg-set" onclick="setTitle(' + (b.is_title ? 'null' : '\'' + esc(b.id) + '\'') + ')">' + (b.is_title ? '대표 칭호 내리기' : '대표 칭호로 걸기') + '</button>'
      : '<small>아직 못 얻었어요</small>');
}
function pickBadge(i) { BDG.pick = BDG.pick === i ? null : i; renderBadges(); }
function setTitle(id) {
  api('badges.setTitle', { badge_id: id }).then(function () {
    haptic('success');
    BDG.data.badges.forEach(function (b) { b.is_title = b.id === id; });
    renderBadges();
  }).catch(function (err) { alertMsg(err.message); });
}

// =====================================================================
// 연말 결산 '올해의 성우 리포트': 스토리처럼 한 장씩 → 마지막 요약 카드(공유 이미지)
// 공개일(recap_open) 전엔 교관 이상만 미리보기 + 기간 바꿔 보기. 관리자 명단은 공개일을 바꿈
// =====================================================================
var RP = { st: null, d: null, team: null, cards: [], i: 0, open: false, from: '', to: '' };
function loadRecapStatus() {
  api('recap.status').then(function (st) { RP.st = st; renderRecapCard(); }).catch(function () { $('recapArea').innerHTML = ''; });
}
function renderRecapCard() {
  // 켜기·공개일은 관리자 페이지에서 (2026-10-06)
  var st = RP.st; if (!st || !st.enabled || (!st.open && !st.preview)) { $('recapArea').innerHTML = ''; return; }
  var md = st.open_md.split('-'), when = (+md[0]) + '월 ' + (+md[1]) + '일';
  var h = '<div class="card rp-entry"><button type="button" class="rp-go" onclick="openRecap()"><span class="rp-gift">🎁</span><span><b>' + st.year + ' 올해의 성우 리포트</b>' +
    '<small>' + (st.open ? '한 해 동안 걸어온 길을 한 장씩 넘겨 봐요' : '미리보기 · 모두에게는 ' + when + '에 열려요') + '</small></span><span class="rp-arrow">›</span></button>';
  if (st.preview) h += '<details class="rp-opts"><summary>기간 바꿔 보기 (테스트용)</summary><div class="tp-row"><input type="date" id="rpFrom" value="' + esc(RP.from) + '"><span>~</span><input type="date" id="rpTo" value="' + esc(RP.to) + '"></div>' +
    '<small>비우면 ' + st.year + '년 한 해 전체예요</small></details>';
  $('recapArea').innerHTML = h + '</div>';
}
function setRecapOn(on) {
  api('recap.setEnabled', { on: on }).then(function () { haptic('success'); loadRecapStatus(); }).catch(function (err) { setMsg('rpOnMsg', err.message, true); });
}
function saveRecapOpen() {
  var v = $('rpOpen').value; if (!v) return;
  api('recap.setOpen', { md: v.slice(5) }).then(function (r) { haptic('success'); RP.st.open_md = r.open_md; setMsg('rpOpenMsg', '저장했어요'); loadRecapStatus(); })
    .catch(function (err) { setMsg('rpOpenMsg', err.message, true); });
}
function openRecap() {
  RP.from = ($('rpFrom') && $('rpFrom').value) || ''; RP.to = ($('rpTo') && $('rpTo').value) || '';
  var q = { year: RP.st.year }; if (RP.from && RP.to) { q.from = RP.from; q.to = RP.to; }
  RP.open = true; RP.i = 0; RP.cards = [['<div class="rp-c"><p class="rp-k">모으는 중...</p></div>']];
  $('recapView').hidden = false; document.body.classList.add('modal-open'); drawRecap();
  try { if (tg && tg.BackButton) tg.BackButton.show(); } catch (e) {}
  var teamQ = S.team && S.team.rank >= RANK.INSTRUCTOR ? api('recap.team', Object.assign({ team_id: S.team.id }, q)).catch(function () { return null; }) : Promise.resolve(null);
  Promise.all([api('recap.get', q), teamQ]).then(function (r) { RP.d = r[0]; RP.team = r[1]; RP.cards = recapCards(); RP.i = 0; drawRecap(); })
    .catch(function (err) { RP.cards = [['<div class="rp-c"><p class="rp-k">불러오지 못했어요</p><p class="rp-s">' + esc(err.message) + '</p></div>']]; drawRecap(); });
}
function closeRecap() {
  RP.open = false; $('recapView').hidden = true; document.body.classList.remove('modal-open');
  try { if (tg && tg.BackButton && curTab === 'profile') tg.BackButton.hide(); } catch (e) {}
}
function recapStep(k) { var n = RP.i + k; if (n < 0 || n >= RP.cards.length) return; RP.i = n; drawRecap(); }
function drawRecap() {
  $('rpBars').innerHTML = RP.cards.map(function (c, i) { return '<i class="' + (i < RP.i ? 'done' : i === RP.i ? 'now' : '') + '"></i>'; }).join('');
  $('rpCard').innerHTML = RP.cards[RP.i][0];
  $('rpCard').className = 'rp-card' + (RP.cards[RP.i][1] ? ' ' + RP.cards[RP.i][1] : '');
}
// 데이터가 없는 카드는 건너뜀
function recapCards() {
  var d = RP.d, y = d.year, c = [];
  var big = function (n, unit) { return '<b class="rp-n">' + n + '</b><span class="rp-u">' + unit + '</span>'; };
  var range = d.custom ? d.from.replace(/-/g, '.') + ' ~ ' + d.to.replace(/-/g, '.') : y + '년';
  c.push(['<div class="rp-c"><p class="rp-k">' + esc(range) + '</p><h2 class="rp-h">' + esc(S.me.profile.name) + '님의<br>올해의 성우 리포트</h2><p class="rp-s">한 해 동안 걸어온 길을 한 장씩 넘겨 봐요 ›</p></div>', 'cover']);
  if (d.recordings) c.push(['<div class="rp-c"><p class="rp-k">🎙 올해 마친 녹음</p>' + big(d.recordings, '건') + (d.roles ? '<p class="rp-s">맡은 배역 <b>' + d.roles + '</b>개</p>' : '') + '</div>']);
  if (d.place) c.push(['<div class="rp-c"><p class="rp-k">📍 제일 많이 간 곳</p><h2 class="rp-h">' + esc(d.place.name) + '</h2><p class="rp-s">' + d.place.count + '번 다녀왔어요</p></div>']);
  if (d.stats && d.stats.axes.some(function (a) { return a.now > 1 || a.start > 1; })) c.push(['<div class="rp-c"><p class="rp-k">⬡ 연초와 지금</p><div class="rp-chart">' + recapSvg(d.stats) + '</div>' +
    '<div class="st-legend"><span><i class="now"></i>지금</span><span><i class="prev"></i>연초</span></div>' +
    (d.stats.best ? '<p class="rp-s">제일 많이 자란 건 <b>' + esc(d.stats.best) + '</b></p>' : '') + '</div>']);
  if (d.comments.length) c.push(['<div class="rp-c"><p class="rp-k">💬 교관님이 남긴 말</p>' + d.comments.map(function (m) {
    return '<blockquote class="rp-q">“' + esc(m.comment) + '”<small>' + esc(m.by) + ' · ' + mdOf(m.at) + '</small></blockquote>'; }).join('') + '</div>']);
  if (d.badges.length) c.push(['<div class="rp-c"><p class="rp-k">🏅 올해 얻은 배지</p><div class="rp-badges">' + d.badges.map(function (b) {
    return '<span><i>' + esc(b.icon) + '</i>' + esc(b.name) + '</span>'; }).join('') + '</div></div>']);
  if (d.with_voice || d.with_engineer) c.push(['<div class="rp-c"><p class="rp-k">🤝 가장 많이 함께한 사람</p>' +
    (d.with_voice ? '<p class="rp-s">성우 <b>' + esc(d.with_voice.name) + '</b> · ' + d.with_voice.count + '번</p>' : '') +
    (d.with_engineer ? '<p class="rp-s">엔지니어 <b>' + esc(d.with_engineer.name) + '</b> · ' + d.with_engineer.count + '번</p>' : '') + '</div>']);
  if (d.meetings || d.absent) c.push(['<div class="rp-c"><p class="rp-k">👣 함께한 모임</p>' + big(d.meetings, '번') +
    ((d.late || d.absent) ? '<p class="rp-s">' + [d.late ? '그중 지각 <b>' + d.late + '</b>번' : '', d.absent ? '결석 <b>' + d.absent + '</b>번' : ''].filter(Boolean).join(' · ') + '</p>' : '') +
    '<p class="rp-s">자리를 지켜줘서 고마워요</p><small class="rp-foot">지각·결석 수는 나만 봐요 (요약 이미지엔 안 들어가요)</small></div>']);
  var t = RP.team;
  if (t) c.push(['<div class="rp-c"><p class="rp-k">👥 ' + esc(S.team.name) + ' 결산 (교관 이상만)</p><div class="rp-grid">' +
    [['녹음', t.recordings, '건'], ['모임', t.meetings, '번'], ['함께한 자리', t.attendance, '명'], ['스탯 피드백', t.grants, '번'], ['얻은 배지', t.badges, '개']].map(function (x) {
      return '<div><small>' + x[0] + '</small><b>' + x[1] + '</b>' + x[2] + '</div>'; }).join('') + '</div><p class="rp-s">팀 전체 합계예요 (사람별 숫자는 없어요)</p></div>']);
  c.push(['<div class="rp-c"><p class="rp-k">한 장으로 보기</p><img class="rp-img" id="rpImg" alt="올해의 성우 요약 카드" src="' + recapImage(d.summary) + '">' +
    '<p class="rp-s">' + (isWide() ? '<a class="rp-dl" download="' + y + '-올해의-성우.png" href="' + recapImage(d.summary) + '">이미지 저장</a>' : '그림을 길게 눌러 저장하세요') + '</p>' +
    '<small class="rp-foot">숫자·스탯 모양·배지만 들어가요 (제목·배역·이름은 안 들어가요)</small></div>', 'last']);
  return c;
}
function recapSvg(st) {
  var axes = st.axes.map(function (a) { return { id: a.name, name: a.name, level: a.now, prev_level: a.start, into: 0, need: 0 }; });
  return statSvg({ axes: axes, max_level: st.max_level }, {}).replace(/onclick="[^"]*"/g, '');
}
// 공유용 요약 이미지 (canvas → PNG). summary엔 숫자·스탯 레벨·축 이름·배지 아이콘만 있음
function recapImage(sm) {
  if (RP.img && RP.img.k === sm) return RP.img.url;
  var W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  var c = cv.getContext('2d'), F = getComputedStyle(document.body).fontFamily || 'sans-serif';
  c.fillStyle = '#F4F1EC'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#4F4E30'; c.fillRect(0, 0, W, 14);
  c.textAlign = 'center'; c.fillStyle = '#8C877D'; c.font = '600 40px ' + F; c.fillText(sm.year + ' 방송예술과', W / 2, 110);
  c.fillStyle = '#1F1E1A'; c.font = '800 76px ' + F; c.fillText('올해의 성우', W / 2, 200);
  var cx = W / 2, cy = 590, R = 220;
  if (sm.stats && sm.stats.levels.length >= 3) {
    var n = sm.stats.levels.length, mx = sm.stats.max_level || 10;
    var pt = function (i, r) { var t = -Math.PI / 2 + 2 * Math.PI * i / n; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; };
    c.strokeStyle = '#D9CFBF'; c.lineWidth = 2;
    for (var k = 2; k <= mx; k += 2) { c.beginPath(); for (var i = 0; i < n; i++) { var p = pt(i, R * k / mx); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); } c.closePath(); c.stroke(); }
    c.beginPath(); sm.stats.levels.forEach(function (lv, i) { var p = pt(i, R * lv / mx); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }); c.closePath();
    c.fillStyle = 'rgba(79,78,48,.28)'; c.fill(); c.strokeStyle = '#4F4E30'; c.lineWidth = 5; c.stroke();
    c.fillStyle = '#1F1E1A'; c.font = '700 34px ' + F;
    sm.stats.labels.forEach(function (lb, i) { var p = pt(i, R + 62); c.fillText(lb + ' ' + sm.stats.levels[i], p[0], p[1] + 12); });
  } else { c.fillStyle = '#8C877D'; c.font = '600 40px ' + F; c.fillText('🎙', cx, cy); }
  var nums = [['녹음', sm.recordings, '건'], ['배역', sm.roles, '개'], ['모임', sm.meetings, '번'], ['배지', sm.badges.length, '개']];
  nums.forEach(function (x, i) {
    var bx = 90 + i * 225;
    c.fillStyle = '#FFFFFF'; c.beginPath(); if (c.roundRect) c.roundRect(bx, 940, 205, 170, 28); else c.rect(bx, 940, 205, 170); c.fill();
    c.fillStyle = '#8C877D'; c.font = '600 32px ' + F; c.fillText(x[0], bx + 102, 992);
    c.fillStyle = '#4F4E30'; c.font = '800 72px ' + F; c.fillText(String(x[1]), bx + 102, 1075);
  });
  if (sm.badges.length) { c.font = '64px ' + F; c.fillText(sm.badges.slice(0, 10).join(' '), W / 2, 1210); }
  c.fillStyle = '#8C877D'; c.font = '600 30px ' + F; c.fillText('방송예술과 성우팀', W / 2, 1290);
  RP.img = { k: sm, url: cv.toDataURL('image/png') };
  return RP.img.url;
}

// =====================================================================
// 회비·후원 (개인 › 회비): 내 달별 상태 + 확인 요청. 회계담당자는 확인·반려·달별 현황, 관리자는 회계담당자 지정
// 계좌번호는 앱에 두지 않음 (사용자 결정)
// =====================================================================
var DU = { d: null, board: null, month: null, kind: '회비', pick: {}, tr: null };
var won = function (n) { return Number(n || 0).toLocaleString() + '원'; };
var monLabel = function (m) { return (+m.slice(5)) + '월'; };
function loadDues() {
  api('dues.mine', { team_id: S.team.id }).then(function (d) {
    DU.d = d; if (!DU.month) DU.month = d.current; renderDues();
    if (d.treasurer) loadDuesBoard();
  }).catch(function (err) { $('duesArea').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function loadDuesBoard() {
  api('dues.board', { team_id: S.team.id, month: DU.month }).then(function (b) { DU.board = b; renderDues(); })
    .catch(function (err) { DU.board = { error: err.message }; renderDues(); });
}
var DU_ST = { '확인': ['✓ 확인', 'st-참석'], '대기': ['확인 기다리는 중', 'st-지각'], '미납': ['아직 안 냄', 'st-불참'], '반려': ['반려', 'st-불참'], '취소': ['취소', 'st-none'] };
function duStChip(st) { var x = DU_ST[st] || [st, 'st-none']; return '<span class="st ' + x[1] + '">' + x[0] + '</span>'; }
function renderDues() {
  var d = DU.d; if (!d) return;
  var h = '<div class="section-head"><h2>내 회비</h2><span class="section-count">한 달 ' + won(d.monthly) + '</span></div>' +
    '<div class="du-months">' + d.months.map(function (m) { return '<div class="card du-m s-' + m.state + '"><b>' + (m.month.slice(0, 4) !== d.current.slice(0, 4) ? m.month.slice(2, 4) + '년 ' : '') + monLabel(m.month) + '</b>' + duStChip(m.state) + '</div>'; }).join('') + '</div>' +
    '<div class="du-acts"><button class="btn-primary" onclick="openDuesModal(\'회비\')">💰 납부 확인 요청</button><button class="ghost-btn du-item" onclick="openDuesModal(\'물품\')">🎁 후원물품 올리기</button></div>';
  if (d.entries.length) h += '<div class="section-head b-gap"><h2>내가 올린 것</h2></div><div class="du-list">' + d.entries.map(duEntry).join('') + '</div>';
  if (d.treasurer && MG.dues) h += renderDuesBoard();
  $('duesArea').innerHTML = h;
}
function duEntry(e, board) {
  var what = e.kind === '회비' ? e.months.map(monLabel).join('·') + ' 회비 · <b>' + won(e.amount) + '</b>' + (e.depositor ? ' <small>입금자 ' + esc(e.depositor) + '</small>' : '')
    : '🎁 ' + esc(e.item) + (e.qty ? ' · ' + esc(e.qty) : '');
  return '<div class="card du-e"><div class="du-top">' + (board ? '<b class="du-who">' + esc(e.name) + '</b>' : '') + '<span class="du-what">' + what + '</span>' + duStChip(e.status) + '</div>' +
    (e.memo ? '<p class="du-memo">' + esc(e.memo) + '</p>' : '') +
    (e.status === '반려' && e.reject_reason ? '<p class="du-memo bad">사유: ' + esc(e.reject_reason) + '</p>' : '') +
    '<small class="du-at">' + mdOf(e.created_at) + ' 올림' + (e.reviewed_at ? ' · ' + mdOf(e.reviewed_at) + ' ' + (e.reviewer ? esc(e.reviewer) + ' ' : '') + '처리' : '') + '</small>' +
    (board && e.status === '대기' ? '<div class="du-btns"><button class="du-ok" onclick="reviewDues(\'' + e.id + '\',true)">확인</button><button class="du-no" onclick="reviewDues(\'' + e.id + '\',false)">반려</button></div>' : '') +
    (!board && e.status === '대기' ? '<button class="du-cancel" onclick="cancelDues(\'' + e.id + '\')">요청 취소</button>' : '') + '</div>';
}
function renderDuesBoard() {
  var b = DU.board;
  var h = '<div class="du-sep"></div><div class="section-head"><h2>회계</h2><span class="section-count">회계담당자만 보여요</span></div>';
  if (!b) return h + '<div class="b-wait">불러오는 중...</div>';
  if (b.error) return h + '<div class="empty"><b>불러오지 못했어요</b>' + esc(b.error) + '</div>';
  h += '<div class="b-month"><button type="button" onclick="duMove(-1)">‹</button><b>' + b.month.slice(0, 4) + '년 ' + monLabel(b.month) + '</b><button type="button" onclick="duMove(1)"' + (b.month >= DU.d.current ? ' disabled' : '') + '>›</button></div>' +
    '<div class="du-sum"><div><small>낸 사람</small><b>' + b.totals.paid + '</b> / ' + b.totals.total + '명</div><div><small>회비</small><b>' + won(b.totals.fee) + '</b></div><div><small>후원금</small><b>' + won(b.totals.extra) + '</b></div></div>';
  if (b.pending.length) h += '<div class="section-head b-gap"><h2>확인 기다리는 것</h2><span class="section-count">' + b.pending.length + '건 · 통장·물품을 보고 눌러주세요</span></div><div class="du-list">' + b.pending.map(function (e) { return duEntry(e, true); }).join('') + '</div>';
  var unpaid = b.people.filter(function (p) { return p.state === '미납'; });
  h += '<div class="section-head b-gap"><h2>' + monLabel(b.month) + ' 과원별</h2><span class="section-count">미납 ' + unpaid.length + '명</span></div>' +
    '<div class="card du-people">' + b.people.map(function (p) { return '<span class="du-p s-' + p.state + '">' + esc(p.name) + '</span>'; }).join('') + '</div>' +
    (unpaid.length ? '<button class="ghost-btn du-contact" onclick="duesContacts()">💬 미납자 연락 목록을 텔레그램으로 받기</button><small class="du-hint">봇이 보내 준 목록에서 이름을 누르면 그 사람과 개인 대화로 가요</small><div class="msg" id="duContactMsg"></div>' : '');
  if (b.items.length) h += '<div class="section-head b-gap"><h2>' + monLabel(b.month) + ' 후원물품</h2></div><div class="du-list">' + b.items.map(function (e) { return duEntry(e, true); }).join('') + '</div>';
  return h;
}
function duMove(k) { var p = DU.month.split('-').map(Number), m = p[1] + k, y = p[0]; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } DU.month = y + '-' + String(m).padStart(2, '0'); DU.board = null; renderDues(); loadDuesBoard(); }
function renderTreasurerPick() {
  var d = DU.d; if (!DU.tr) DU.tr = d.treasurers.slice();
  return '<div class="du-sep"></div><div class="section-head"><h2>회계담당자 지정</h2><span class="section-count">관리자만 보여요</span></div><div class="card du-tr"><div class="b-chips">' +
    d.people.map(function (p) { return '<button type="button" class="b-pick' + (DU.tr.indexOf(p.id) !== -1 ? ' on' : '') + '" onclick="duTrToggle(\'' + p.id + '\')">' + esc(p.name) + '</button>'; }).join('') +
    '</div><button class="btn-primary du-trsave" onclick="saveTreasurers()">회계담당자 저장</button><div class="msg" id="duTrMsg"></div></div>';
}
function duTrToggle(id) { var i = DU.tr.indexOf(id); if (i === -1) DU.tr.push(id); else DU.tr.splice(i, 1); renderDues(); }
function saveTreasurers() {
  api('dues.setTreasurers', { team_id: S.team.id, ids: DU.tr }).then(function () { haptic('success'); DU.tr = null; loadDues(); setTimeout(function () { setMsg('duTrMsg', '저장했어요'); }, 400); })
    .catch(function (err) { setMsg('duTrMsg', err.message, true); });
}
function reviewDues(id, ok) {
  var reason = '';
  if (!ok) { reason = prompt('반려 사유를 적어주세요 (올린 사람에게 보여요)') || ''; if (!reason.trim()) return; }
  api('dues.review', { id: id, ok: ok, reason: reason }).then(function () { haptic('success'); loadDuesBoard(); loadDues(); }).catch(function (err) { alertMsg(err.message); });
}
function cancelDues(id) {
  if (!confirm('이 요청을 취소할까요?')) return;
  api('dues.cancel', { id: id }).then(function () { loadDues(); }).catch(function (err) { alertMsg(err.message); });
}
function duesContacts() {
  setMsg('duContactMsg', '보내는 중...');
  api('dues.contacts', { team_id: S.team.id, month: DU.month }).then(function (r) { setMsg('duContactMsg', r.sent ? '텔레그램으로 보냈어요. 봇 대화를 확인해주세요' : '못 보냈어요. 봇과 대화를 시작했는지 확인해주세요', !r.sent); })
    .catch(function (err) { setMsg('duContactMsg', err.message, true); });
}
// 확인 요청 팝업: 회비(몇 월·금액·입금자명) / 물품(이름·수량)
function openDuesModal(kind) {
  DU.kind = kind; DU.pick = {};
  var d = DU.d, un = d.months.filter(function (m) { return m.state === '미납'; }).map(function (m) { return m.month; });
  (un.length ? un.slice(-1) : [d.current]).forEach(function (m) { DU.pick[m] = 1; });
  $('duesModalT').textContent = kind === '회비' ? '💰 납부 확인 요청' : '🎁 후원물품 올리기';
  renderDuesModal(); openModal('duesModal');
}
function duesMonthOptions() {
  var d = DU.d, out = d.months.map(function (m) { return m.month; }).reverse(), p = d.current.split('-').map(Number);
  for (var i = 1; i <= 2; i++) { var m = p[1] + i, y = p[0]; if (m > 12) { m -= 12; y++; } out.push(y + '-' + String(m).padStart(2, '0')); }
  return out;
}
function renderDuesModal() {
  var d = DU.d, h = '';
  if (DU.kind === '회비') {
    var st = {}; d.months.forEach(function (m) { st[m.month] = m.state; });
    var n = Object.keys(DU.pick).length;
    h = '<label class="field-label">몇 월 회비인가요 <span class="hint">여러 달 골라도 돼요</span></label><div class="b-chips">' + duesMonthOptions().map(function (m) {
        var done = st[m] === '확인' || st[m] === '대기';
        return '<button type="button" class="b-pick' + (DU.pick[m] ? ' on' : '') + '"' + (done ? ' disabled' : '') + ' onclick="duPickMonth(\'' + m + '\')">' + monLabel(m) + (done ? '<small> ' + (st[m] === '확인' ? '✓' : '대기') + '</small>' : '') + '</button>';
      }).join('') + '</div>' +
      '<label class="field-label" for="duAmount">입금한 금액 <span class="hint">기본 ' + won(d.monthly * Math.max(1, n)) + ' · 더 넣으면 그만큼 후원금</span></label>' +
      '<input type="number" id="duAmount" class="b-input" inputmode="numeric" min="1" step="1000" value="' + (d.monthly * Math.max(1, n)) + '">' +
      '<label class="field-label" for="duDepositor">입금자명 <span class="hint">통장에 찍힌 이름</span></label><input type="text" id="duDepositor" class="b-input" maxlength="30" value="' + esc(S.me.profile.name) + '">';
  } else {
    h = '<label class="field-label" for="duItem">어떤 물품인가요</label><input type="text" id="duItem" class="b-input" maxlength="80" placeholder="예) 생수, 마이크 커버">' +
      '<label class="field-label" for="duQty">수량 <span class="hint">선택</span></label><input type="text" id="duQty" class="b-input" maxlength="30" placeholder="예) 2상자">';
  }
  h += '<label class="field-label" for="duMemo">메모 <span class="hint">선택</span></label><textarea id="duMemo" rows="2" maxlength="300"></textarea>' +
    '<button class="btn-primary" id="duBtn" onclick="submitDues()">' + (DU.kind === '회비' ? '확인 요청 올리기' : '물품 올리기') + '</button><div class="msg" id="duMsg"></div>';
  $('duesBody').innerHTML = h;
}
function duPickMonth(m) {
  var keep = { a: $('duDepositor') && $('duDepositor').value, m: $('duMemo') && $('duMemo').value };
  if (DU.pick[m]) delete DU.pick[m]; else DU.pick[m] = 1;
  renderDuesModal(); if (keep.a != null) $('duDepositor').value = keep.a; if (keep.m) $('duMemo').value = keep.m;
}
function submitDues() {
  var p = { team_id: S.team.id, kind: DU.kind, memo: $('duMemo').value };
  if (DU.kind === '회비') { p.months = Object.keys(DU.pick).sort(); p.amount = Number($('duAmount').value); p.depositor = $('duDepositor').value; }
  else { p.item = $('duItem').value; p.qty = $('duQty').value; }
  var btn = $('duBtn'); btn.disabled = true; setMsg('duMsg', '올리는 중...');
  api('dues.submit', p).then(function (r) {
    haptic('success'); setMsg('duMsg', r.treasurers ? '올렸어요! 회계담당자가 확인하면 알려드려요' : '올렸어요. 아직 회계담당자가 정해지지 않아서 알림은 안 갔어요', !r.treasurers);
    loadDues(); setTimeout(function () { closeModal('duesModal'); }, r.treasurers ? 1200 : 3000);
  }).catch(function (err) { btn.disabled = false; setMsg('duMsg', err.message, true); });
}

// =====================================================================
// 내 캐릭터 꾸미기 (나의 기록 오른쪽 아래): 고를 수 있는 값은 서버 목록(look.get options)뿐. 미리보기는 town.js Town.avatar
// =====================================================================
var LK = { look: null, saved: null, opts: null, stop: null };
var LOOK_ROWS = [
  ['gender', '성별', { m: '남', f: '여' }], ['skin', '피부', null], ['style', '머리 모양', { short: '짧은 머리', long: '긴 머리', bob: '단발', bun: '똥머리', up: '올림머리', pony: '포니테일' }],
  ['hair', '머리색', null], ['shirt', '윗옷', null], ['bottom', '아래옷', { pants: '바지', skirt: '치마' }], ['pants', '아래옷 색', null],
  ['hat', '머리에 쓰는 것', { '': '없음', cap: '모자', helmet: '헬멧', ribbon: '리본', phones: '헤드폰' }], ['hatc', '쓰는 것 색', null],
  ['ride', '탈것', { '': '걸어서', ford: '🚗 오픈카', bike: '🚲 자전거', moto: '🏍 오토바이', kick: '🛴 킥보드', camel: '🐫 낙타', donkey: '🫏 당나귀', turtle: '🐢 거북이' }]
];
function loadLook() {
  api('look.get').then(function (d) { LK.opts = d.options; LK.look = Object.assign({}, d.look); LK.saved = JSON.stringify(d.look); renderLook(); })
    .catch(function (err) { $('lookArea').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function renderLook() {
  var L = LK.look, h = '<div class="card lk-prev"><canvas id="lookCv"></canvas><small>왼쪽은 서 있을 때, 오른쪽은 이동할 때 모습이에요</small></div><div class="card lk-opts">';
  LOOK_ROWS.forEach(function (r) {
    var k = r[0], list = LK.opts[k] || [];
    if (k === 'hatc' && !L.hat) return;
    var cur = L[k] == null ? '' : L[k];
    h += '<div class="lk-row"><span class="lk-l">' + r[1] + '</span><div class="lk-ch">' + list.map(function (v) {
      var on = String(cur) === v ? ' on' : '';
      return r[2] ? '<button type="button" class="b-pick' + on + '" onclick="lookSet(\'' + k + '\',\'' + v + '\')">' + esc(r[2][v] || v) + '</button>'
        : '<button type="button" class="lk-sw' + on + '" style="background:' + v + '" aria-label="' + r[1] + '" onclick="lookSet(\'' + k + '\',\'' + v + '\')"></button>';
    }).join('') + '</div></div>';
  });
  h += '<div class="lk-row"><span class="lk-l">자주 하는 말<small>동네지도 말풍선 · 3개까지</small></span><div class="lk-says">' + [0, 1, 2].map(function (i) {
    return '<input type="text" class="b-input lk-say" maxlength="20" placeholder="' + ['예) 오늘도 화이팅!', '예) 커피 한 잔 할래요?', '예) 녹음 들어갑니다 🎙'][i] + '" value="' + esc((L.say || [])[i] || '') + '" oninput="lookSay(' + i + ',this.value)">';
  }).join('') + '</div></div>';
  h += '<div class="lk-row"><span class="lk-l">볼터치</span><div class="lk-ch"><button type="button" class="b-pick' + (L.blush ? ' on' : '') + '" onclick="lookSet(\'blush\',' + !L.blush + ')">' + (L.blush ? '있음' : '없음') + '</button></div></div></div>' +
    '<div class="lk-acts"><button class="btn-primary" id="lkBtn" onclick="saveLook()">저장하기</button><button class="ghost-btn" onclick="resetLook()">기본 모습으로</button></div><div class="msg" id="lkMsg"></div>';
  if (LK.stop) LK.stop();
  $('lookArea').innerHTML = h;
  LK.stop = window.Town && Town.avatar ? Town.avatar($('lookCv'), function () { return LK.look; }) : null;
}
function lookSay(i, v) { var a = (LK.look.say || []).slice(); a[i] = v; LK.look.say = a; }
function lookSet(k, v) { LK.look[k] = v; renderLook(); }
function resetLook() { LK.look = {}; renderLook(); }
function saveLook() {
  var btn = $('lkBtn'); btn.disabled = true; setMsg('lkMsg', '저장하는 중...');
  api('look.save', { look: LK.look }).then(function (r) {
    haptic('success'); LK.look = Object.assign({}, r.look); LK.saved = JSON.stringify(r.look); renderLook();
    setMsg('lkMsg', '저장했어요! 동네지도에 곧 반영돼요'); townTeam = null;
  }).catch(function (err) { btn.disabled = false; setMsg('lkMsg', err.message, true); });
}

// ----- 녹음 진행 흐름 (회차마다 단계 + 단계별 사람): 배치 → 요청 확인 → 수락 → 확정 → 도착 → 녹음 중 → 마침 -----
// 지난 단계 ✓, 지금 단계 진하게, 앞 단계 흐리게. 조율이 있으면 아래 빨간 가지
function recFlow(r, s) {
  var ppl = s.people.filter(function (p) { return p.answer !== '미선정'; });
  var RK = { '녹음자': '성우', '엔지니어': '엔지니어', '감독자': '감독' };
  var chip = function (p, ok, extra) { return '<span class="fl-p r-' + (RK[p.role] || '') + (ok ? ' ok' : '') + '" title="' + esc(RK[p.role] || p.role) + '">' + esc(p.name) + (extra || '') + '</span>'; };
  var voices = ppl.filter(function (p) { return p.role === '녹음자' && p.selected; });
  var live = s.status === '조율중', done = s.status === '완료', conf = s.status === '예정' || done;
  if (s.status === '배치전') return '<div class="fl"><div class="fl-row">' + ['배치', '요청 확인', '수락', '확정', '도착', '녹음 중', '마침'].map(function (n, i) {
    return '<div class="fl-step ' + (i ? 'next' : 'now') + '"><div class="fl-h"><i>' + (i + 1) + '</i>' + n + '</div><div class="fl-b">' + (i ? '' : '<span class="fl-t">회차를 만들면 시작해요</span>') + '</div></div>';
  }).join('') + '</div></div>';
  var steps = [
    ['배치', true, ppl.map(function (p) { return chip(p, true); }).join('')],
    ['요청 확인', ppl.every(function (p) { return p.seen_at || p.answer !== '대기'; }), ppl.map(function (p) { return chip(p, p.seen_at || p.answer !== '대기', p.seen_at || p.answer !== '대기' ? '' : ' <i>안 봄</i>'); }).join('')],
    ['수락', conf, ppl.map(function (p) { return chip(p, p.answer === '수락', p.answer === '조율' ? ' <i class="bad">조율</i>' : p.answer === '대기' ? ' <i>대기</i>' : ''); }).join('')],
    ['확정', conf, conf ? '<span class="fl-t">' + mdw(s.start) + ' ' + hmMs(s.start) + '</span>' : ''],
    ['도착', conf && voices.length && voices.every(function (p) { return p.arrived_at; }), conf ? voices.map(function (p) {
      return p.arrived_at ? chip(p, true, ' <i>' + hmMs(Date.parse(p.arrived_at)) + '</i>') : chip(p, false) + (s.status === '예정' ? '<button class="fl-btn" data-act="arrive" data-pid="' + esc(p.id) + '">도착</button>' : '');
    }).join('') : ''],
    ['녹음 중', !!s.started_at, s.started_at ? '<span class="fl-t">' + hmMs(Date.parse(s.started_at)) + ' 시작</span>' : ''],
    ['마침', done, s.ended_at ? '<span class="fl-t">' + hmMs(Date.parse(s.ended_at)) + ' 종료</span>' : done ? '<span class="fl-t">완료</span>' : '']
  ];
  var cur = steps.findIndex(function (x) { return !x[1]; }); if (cur < 0) cur = steps.length;
  var adj = ppl.filter(function (p) { return p.answer === '조율'; });
  return '<div class="fl"><div class="fl-row">' + steps.map(function (x, i) {
      var k = x[1] ? 'past' : i === cur ? 'now' : 'next';
      return '<div class="fl-step ' + k + '"><div class="fl-h"><i>' + (k === 'past' ? '✓' : i + 1) + '</i>' + x[0] + '</div><div class="fl-b">' + (x[2] || '') + '</div></div>';
    }).join('') + '</div>' +
    (adj.length && live ? '<div class="fl-branch"><b>조율 필요</b>' + adj.map(function (p) { return chip(p, false, p.note ? ' <i>' + esc(p.note) + '</i>' : ''); }).join('') + '<small>시간·사람을 다시 맞춰주세요</small></div>' : '') + '</div>';
}

// =====================================================================
// 하늘방송국 (PC 전용, sky.js): 처음 열 때 불러옴. 사무실 방명록은 쓴 사람과 주인만 봄
// =====================================================================
var GB = { p: null };
function startSky() {
  if (!window.Sky || !townAllowed() || !S.team || Sky.mounted()) return;
  var teamId = S.team.id;
  Sky.mount($('skyArea'), { load: function () { return api('sky.load', { team_id: teamId }); }, onGuest: openGuest });
}
function openGuest(p) {
  GB.p = p;
  $('guestModalT').textContent = '📮 ' + p.name + '님 방명록';
  $('guestModalSub').textContent = p.id === S.me.profile.id ? '내 사무실에 남겨진 글이에요. 쓴 사람과 나만 봐요' : '쓴 사람과 ' + p.name + '님만 봐요';
  $('guestBody').innerHTML = '<div class="b-wait">불러오는 중...</div>';
  openModal('guestModal');
  loadGuest();
}
function loadGuest() {
  var p = GB.p;
  api('guest.list', { owner_id: p.id }).then(function (d) {
    var h = d.mine ? '' : '<label class="field-label" for="gbText">한마디 남기기</label><textarea id="gbText" rows="3" maxlength="200" placeholder="예) 오늘 녹음 수고 많으셨어요!"></textarea>' +
      '<button class="btn-primary" id="gbBtn" onclick="writeGuest()">남기기</button><div class="msg" id="gbMsg"></div>';
    h += '<div class="gb-list">' + (d.entries.length ? d.entries.map(function (e) {
      return '<div class="gb-e"><div class="gb-top"><b>' + esc(e.author) + '</b><small>' + mdOf(e.at) + ' ' + hmOf(e.at) + '</small><button class="gb-x" onclick="delGuest(\'' + e.id + '\')" title="지우기">✕</button></div><p>' + esc(e.text) + '</p></div>';
    }).join('') : '<p class="gb-none">' + (d.mine ? '아직 남겨진 글이 없어요' : '내가 남긴 글이 여기에 보여요') + '</p>') + '</div>';
    $('guestBody').innerHTML = h;
  }).catch(function (err) { $('guestBody').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function writeGuest() {
  var t = $('gbText').value.trim(); if (!t) { setMsg('gbMsg', '내용을 적어주세요', true); return; }
  $('gbBtn').disabled = true; setMsg('gbMsg', '남기는 중...');
  api('guest.write', { team_id: S.team.id, owner_id: GB.p.id, text: t }).then(function () { haptic('success'); loadGuest(); })
    .catch(function (err) { $('gbBtn').disabled = false; setMsg('gbMsg', err.message, true); });
}
function delGuest(id) {
  if (!confirm('이 글을 지울까요?')) return;
  api('guest.delete', { id: id }).then(loadGuest).catch(function (err) { alertMsg(err.message); });
}

// =====================================================================
// 첨부 대본 (공지·과제): 우리 교회 대본이 아닐 때만. 비공개 보관함에 바로 올리고, 열 때마다 문지기가 5분짜리 주소를 줌. 14일 뒤 자동 삭제
// =====================================================================
var FL = { notice: null, assignment: null, session: null };   // { item_id: [파일] }
function loadFiles(kind, list, done) {
  var ids = (list || []).map(function (x) { return x.id; }); if (!ids.length) return;
  api('files.list', { kind: kind, ids: ids }).then(function (r) {
    var m = {}; r.files.forEach(function (f) { (m[f.item_id] = m[f.item_id] || []).push(f); }); FL[kind] = m; if (done) done();
  }).catch(function () {});
}
function fileChips(kind, id) {
  var fs = FL[kind] && FL[kind][id]; if (!fs || !fs.length) return '';
  return '<div class="fl-chips">' + fs.map(function (f) {
    var left = Math.max(0, Math.ceil((Date.parse(f.expires_at) - Date.now()) / 86400000));
    return '<button type="button" class="fl-chip" onclick="event.stopPropagation();openFile(\'' + f.id + '\')" title="' + left + '일 뒤 자동으로 지워져요">📄 ' + esc(f.name) +
      ' <small>' + Math.max(1, Math.round(f.size / 1024 / 1024 * 10) / 10) + 'MB · ' + left + '일 남음</small></button>' +
      (f.mine ? '<button type="button" class="fl-x" onclick="event.stopPropagation();delFile(\'' + kind + '\',\'' + f.id + '\')" title="파일 지우기">✕</button>' : '');
  }).join('') + '</div>';
}
function fileCheck(k) {
  var f = $(k + 'File').files[0]; if (!f) return true;
  var msg = k + 'Msg';
  if (!$(k + 'NotChurch').checked) { setMsg(msg, "우리 교회 대본이 아닌지 확인 칸에 체크해주세요. 교회 대본은 올리지 말고 NAS 위치만 적어주세요", true); return false; }
  if (f.size > 20 * 1024 * 1024) { setMsg(msg, '20MB까지 올릴 수 있어요', true); return false; }
  if (!/\.(pdf|hwp|hwpx|doc|docx|txt|rtf)$/i.test(f.name)) { setMsg(msg, 'PDF·한글·워드·텍스트 파일만 올릴 수 있어요', true); return false; }
  return true;
}
function fileUpload(k, kind, itemId) {
  var f = $(k + 'File').files[0]; if (!f) return Promise.resolve();
  setMsg(k + 'Msg', '대본 올리는 중...');
  return api('files.prepare', { kind: kind, item_id: itemId, name: f.name, size: f.size, not_church: $(k + 'NotChurch').checked })
    .then(function (r) {
      return fetch(r.url, { method: 'PUT', body: f, headers: { 'content-type': f.type || 'application/octet-stream', 'x-upsert': 'false' } })
        .then(function (res) { if (!res.ok) throw new Error('대본을 올리지 못했어요 (' + res.status + ')'); return api('files.done', { id: r.id }); });
    })
    .then(function () { $(k + 'File').value = ''; $(k + 'NotChurch').checked = false; FL[kind] = null; })
    .catch(function (err) { alertMsg('글은 올렸지만 대본 파일은 못 올렸어요: ' + err.message + '\n글을 고치기로 열어 다시 올려주세요'); });
}
function openFile(id) {
  api('files.open', { id: id }).then(function (r) {
    try { if (tg && tg.openLink) { tg.openLink(r.url); return; } } catch (e) {}
    window.open(r.url, '_blank', 'noopener');
  }).catch(function (err) { alertMsg(err.message); });
}
function delFile(kind, id) {
  if (!confirm('이 대본 파일을 지울까요?')) return;
  api('files.delete', { id: id }).then(function () {
    Object.keys(FL[kind] || {}).forEach(function (k) { FL[kind][k] = FL[kind][k].filter(function (f) { return f.id !== id; }); });
    if (kind === 'notice') renderNotices(); else if (kind === 'session') renderHead(); else { renderTasks(); if (A.current) openTask(A.current.id); }
  }).catch(function (err) { alertMsg(err.message); });
}

// ----- 내가 맡은 녹음 (업무 탭 맨 위, 누구나) -----
var ANS_TXT = { '대기': ['답해주세요', 'st-지각'], '수락': ['수락', 'st-참석'], '조율': ['조율 요청함', 'st-불참'] };
function loadRecMine() {
  api('rec.mine').then(function (l) {
    var now = Date.now(), up = l.filter(function (x) { return !x.ended && (x.end || x.start) > now - 3600000; }), past = l.filter(function (x) { return up.indexOf(x) === -1; });
    var row = function (x) {
      var st = x.ended ? ['녹음 마침', 'st-참석'] : x.status === '예정' && x.selected ? (x.arrived_at ? ['도착', 'st-참석'] : ['확정', 'st-참석']) : (ANS_TXT[x.answer] || [x.answer, 'st-none']);
      return '<button type="button" class="card rm-row" onclick="openAsk(\'' + x.id + '\')"><span class="rm-when"><b>' + mdw(x.start) + '</b>' + hmMs(x.start) + '</span>' +
        '<span class="rm-what"><b>' + esc(x.title) + (x.session ? ' · ' + esc(x.session) : '') + '</b><small>' + esc(x.role) + (x.location ? ' · ' + esc(x.location) : '') + '</small></span>' +
        '<span class="st ' + st[1] + '">' + st[0] + '</span></button>';
    };
    $('recMine').innerHTML = '<div class="section-head"><h2>내가 맡은 녹음</h2><span class="section-count">' + up.length + '건</span></div>' +
      (up.length ? up.map(row).join('') : '<p class="rec-none">지금 맡은 녹음이 없어요. 요청이 오면 알림으로 알려 드려요</p>') +
      (past.length ? '<details class="rm-past"><summary>지난 2주 ' + past.length + '건</summary>' + past.map(row).join('') + '</details>' : '');
  }).catch(function (err) { $('recMine').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}

// =====================================================================
// 장소 신청 (일정 › 장소 신청): 날짜별 장소 시간표 + 내 신청 + (승인자면) 승인할 것
// =====================================================================
var PLC = { date: null, d: null };
function loadPlace() {
  if (!PLC.date) PLC.date = todayStr();
  api('place.list', { team_id: S.team.id, date: PLC.date }).then(function (d) { PLC.d = d; renderPlace(); })
    .catch(function (err) { $('placeArea').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
var PL_ST = { '대기': ['승인 기다리는 중', 'st-지각'], '승인': ['확정', 'st-참석'], '반려': ['반려', 'st-불참'] };
function plTime(b) { return mdw(Date.parse(b.starts_at)) + ' ' + hmMs(Date.parse(b.starts_at)) + '~' + hmMs(Date.parse(b.ends_at)); }
function plName(code) { var p = (PLC.d.places || []).filter(function (x) { return x.code === code; })[0]; return p ? p.name : code; }
function renderPlace() {
  var d = PLC.d, h = '';
  if (d.approve.length) h += '<div class="section-head"><h2>승인할 신청</h2><span class="section-count">' + d.approve.length + '건</span></div>' + d.approve.map(function (b) {
    return '<div class="card pl-row"><div><b>' + esc(plName(b.place_code)) + '</b> · ' + plTime(b) + '<small>' + esc(b.name) + ' · ' + esc(b.purpose) + '</small></div>' +
      '<div class="du-btns"><button class="du-ok" onclick="decidePlace(\'' + b.id + '\',true)">승인</button><button class="du-no" onclick="decidePlace(\'' + b.id + '\',false)">반려</button></div></div>';
  }).join('');
  // 날짜 고르기 + 장소별 하루 시간표 (8~24시)
  h += '<div class="section-head' + (d.approve.length ? ' b-gap' : '') + '"><h2>장소 현황</h2></div><div class="b-month"><button type="button" onclick="plMove(-1)">‹</button><b>' + mdw(parseDate(PLC.date).getTime()) + '</b><button type="button" onclick="plMove(1)">›</button></div>';
  var H0 = 8, H1 = 24, pct = function (ms) { var dd = new Date(ms); return Math.max(0, Math.min(100, ((dd.getHours() + dd.getMinutes() / 60) - H0) / (H1 - H0) * 100)); };
  h += '<div class="card pl-grid"><div class="pl-axis"><span></span><div>' + [8, 10, 12, 14, 16, 18, 20, 22].map(function (x) { return '<i style="left:' + ((x - H0) / (H1 - H0) * 100) + '%">' + x + '</i>'; }).join('') + '</div></div>' +
    d.places.map(function (p) {
      var bs = d.bookings.filter(function (b) { return b.place_code === p.code; });
      return '<div class="pl-line" onclick="plLineClick(event,\'' + p.code + '\')"><span class="pl-name"><b>' + esc(p.name) + '</b><small>' + (p.approval === 'none' ? '바로 확정' : p.approval === 'recording' ? '엔지니어팀장 승인' : '과장·부과장 승인') + '</small></span><div class="pl-bar">' +
        bs.map(function (b) { var a = pct(Date.parse(b.starts_at)), z = pct(Date.parse(b.ends_at));
          return '<i class="' + (b.status === '승인' ? 'ok' : 'wait') + (b.mine ? ' mine' : '') + '" style="left:' + a + '%;width:' + Math.max(2, z - a) + '%" title="' + esc(hmMs(Date.parse(b.starts_at)) + '~' + hmMs(Date.parse(b.ends_at)) + ' ' + b.name + ' · ' + b.purpose) + '">' + esc(b.name) + '</i>'; }).join('') + '</div></div>';
    }).join('') + '<small class="pl-hint">줄을 누르면 그 장소로 신청해요 · 진한 칸 = 확정, 점선 = 승인 기다리는 중</small></div>';
  h += '<div class="section-head b-gap"><h2>내 신청</h2></div>' + (d.mine.length ? d.mine.map(function (b) {
    var st = PL_ST[b.status] || [b.status, 'st-none'];
    return '<div class="card pl-row"><div><b>' + esc(plName(b.place_code)) + '</b> · ' + plTime(b) + '<small>' + esc(b.purpose) + (b.reason ? ' · 사유: ' + esc(b.reason) : '') + '</small></div>' +
      '<span class="st ' + st[1] + '">' + st[0] + '</span>' + (b.status !== '반려' ? '<button class="gb-x" onclick="cancelPlace(\'' + b.id + '\')" title="신청 취소">✕</button>' : '') + '</div>';
  }).join('') : '<p class="rec-none">신청한 장소가 없어요. 오른쪽 아래 + 로 신청해요</p>');
  $('placeArea').innerHTML = h;
}
function plMove(k) { var dd = parseDate(PLC.date); dd.setDate(dd.getDate() + k); PLC.date = ymd(dd); loadPlace(); }
// 시간표 줄을 누르면: 누른 곳의 30분 칸이 시작, 1시간 뒤가 끝
function plLineClick(e, code) {
  var bar = e.currentTarget.querySelector('.pl-bar'), r = bar.getBoundingClientRect(), k = (e.clientX - r.left) / r.width;
  var mins = k >= 0 && k <= 1 ? Math.floor((8 * 60 + k * 16 * 60) / 30) * 30 : null;
  openPlaceModal(code, mins);
}
var PL_SLOTS = (function () { var a = []; for (var m = 8 * 60; m <= 24 * 60; m += 30) a.push(('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2)); return a; })();
function plFromChanged() {
  var f = PL_SLOTS.indexOf($('plFrom').value), t = PL_SLOTS.indexOf($('plTo').value);
  $('plTo').innerHTML = PL_SLOTS.slice(f + 1).map(function (x) { return '<option>' + x + '</option>'; }).join('');
  $('plTo').value = t > f ? PL_SLOTS[t] : PL_SLOTS[Math.min(PL_SLOTS.length - 1, f + 2)];
}
function openPlaceModal(code, startMin) {
  var d = PLC.d; if (!d) return;
  $('plFrom').innerHTML = PL_SLOTS.slice(0, -1).map(function (x) { return '<option>' + x + '</option>'; }).join('');
  var now = new Date(), st = startMin != null ? startMin : Math.max(8 * 60, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30);
  st = Math.min(23 * 60 + 30, st);
  $('plFrom').value = ('0' + Math.floor(st / 60)).slice(-2) + ':' + ('0' + st % 60).slice(-2);
  $('plTo').value = ''; plFromChanged();
  $('plPlace').innerHTML = d.places.map(function (p) { return '<option value="' + p.code + '">' + esc(p.name) + '</option>'; }).join('');
  if (code) $('plPlace').value = code;
  $('plDate').value = PLC.date; $('plDate').min = todayStr();
  placeRuleText(); setMsg('plMsg', ''); openModal('placeModal');
}
function placeRuleText() { var p = PLC.d.places.filter(function (x) { return x.code === $('plPlace').value; })[0]; $('placeRule').textContent = p ? p.rule : ''; }
function bookPlace() {
  var p = { team_id: S.team.id, place_code: $('plPlace').value, date: $('plDate').value, from: $('plFrom').value, to: $('plTo').value, purpose: $('plPurpose').value.trim() };
  if (!p.date || !p.from || !p.to) { setMsg('plMsg', '날짜와 시간을 골라주세요', true); return; }
  if (!p.purpose) { setMsg('plMsg', '무엇에 쓰는지 적어주세요', true); return; }
  var btn = $('plBtn'); btn.disabled = true; setMsg('plMsg', '신청하는 중...');
  api('place.book', p).then(function (r) {
    btn.disabled = false; haptic('success');
    setMsg('plMsg', r.status === '승인' ? '확정됐어요! 그 시간은 이제 내 자리예요' : '신청했어요. 승인되면 알려드려요' + (r.notify && !r.notify.sent ? ' (승인자가 아직 정해지지 않았거나 알림을 못 받았어요)' : ''));
    $('plPurpose').value = ''; PLC.date = p.date; loadPlace();
    setTimeout(function () { closeModal('placeModal'); }, 1300);
  }).catch(function (err) { btn.disabled = false; setMsg('plMsg', err.message, true); });
}
function decidePlace(id, ok) {
  var reason = ''; if (!ok) { reason = prompt('반려 사유를 적어주세요 (신청한 사람에게 보여요)') || ''; if (!reason.trim()) return; }
  api('place.decide', { id: id, ok: ok, reason: reason }).then(function () { haptic('success'); loadPlace(); }).catch(function (err) { alertMsg(err.message); });
}
function cancelPlace(id) {
  if (!confirm('이 신청을 취소할까요?')) return;
  api('place.cancel', { id: id }).then(loadPlace).catch(function (err) { alertMsg(err.message); });
}

// =====================================================================
// 관리자 페이지 (관리자 명단만): 관리자 · 회계담당자 · 장소 승인자 · 연말 결산 켜기/공개일
// =====================================================================
var ADM = null;
function loadAdmin() {
  api('admin.get').then(function (d) { ADM = d; ADM.edit = JSON.parse(JSON.stringify(d.settings)); renderAdmin(); })
    .catch(function (err) { $('adminArea').innerHTML = '<div class="empty"><b>열 수 없어요</b>' + esc(err.message) + '</div>'; });
}
function admPick(key, sub, title, desc) {
  var cur = sub ? ((ADM.edit[key] || {})[sub] || []) : (ADM.edit[key] || []);
  return '<div class="card adm-box"><div class="adm-h"><b>' + title + '</b><small>' + desc + '</small></div><div class="b-chips">' + ADM.people.map(function (p) {
    return '<button type="button" class="b-pick' + (cur.indexOf(p.id) !== -1 ? ' on' : '') + '" onclick="admToggle(\'' + key + '\',\'' + (sub || '') + '\',\'' + p.id + '\')">' + esc(p.name) + '<small> ' + esc(p.unit + ' ' + p.position) + '</small></button>';
  }).join('') + '</div><button class="btn-primary adm-save" onclick="admSave(\'' + key + '\')">저장</button><div class="msg" id="admMsg-' + key + '"></div></div>';
}
function renderAdmin() {
  var e = ADM.edit, md = String(e.recap_open || '12-22');
  $('adminArea').innerHTML =
    admPick('admins', '', '관리자', '이 페이지를 볼 수 있는 사람이에요. 나 자신은 뺄 수 없어요') +
    admPick('treasurers', '', '회계담당자', '회비 확인 요청을 받고 확인·반려해요') +
    admPick('place_approvers', 'recording', '녹음실 승인자 (코드원·SMC)', '비워 두면 엔지니어팀 팀장 이상이 승인해요') +
    admPick('place_approvers', 'external', '총회 대회의실·과천 성전 10층 승인자', '비워 두면 부과장 이상이 승인해요') +
    '<div class="card adm-box"><div class="adm-h"><b>올해의 성우 리포트</b><small>켜면 공개일 전엔 교관 이상 미리보기, 공개일부터 모두에게 보여요</small></div>' +
      '<label class="adm-sw"><input type="checkbox" ' + (e.recap_enabled === true ? 'checked' : '') + ' onchange="admSetNow(\'recap_enabled\', this.checked)"> 리포트 켜기</label>' +
      '<div class="tp-row"><span>공개일</span><input type="date" id="admRecap" value="' + new Date().getFullYear() + '-' + esc(md) + '"><button class="ghost-btn rp-save" onclick="admSetNow(\'recap_open\', $(\'admRecap\').value.slice(5))">저장</button></div>' +
      '<div class="msg" id="admMsg-recap"></div></div>';
}
function admToggle(key, sub, id) {
  var arr = sub ? ((ADM.edit[key] = ADM.edit[key] || {})[sub] = (ADM.edit[key][sub] || [])) : (ADM.edit[key] = ADM.edit[key] || []);
  var i = arr.indexOf(id); if (i === -1) arr.push(id); else arr.splice(i, 1); renderAdmin();
}
function admSave(key) {
  api('admin.set', { key: key, value: ADM.edit[key] }).then(function (r) { haptic('success'); ADM.settings[key] = r.value; setMsg('admMsg-' + key, '저장했어요'); })
    .catch(function (err) { setMsg('admMsg-' + key, err.message, true); });
}
function admSetNow(key, value) {
  api('admin.set', { key: key, value: value }).then(function (r) { haptic('success'); ADM.edit[key] = ADM.settings[key] = r.value; setMsg('admMsg-recap', '저장했어요'); RP.st = null; })
    .catch(function (err) { setMsg('admMsg-recap', err.message, true); });
}

// =====================================================================
// 할 수 있는 일 FAB: 모두가 보는 화면은 그대로 두고, 권한에 따라 다른 것(만들기·관리 보기)은 이 메뉴로
// 관리 보기는 MG 깃발로 켜고 끔 (탭을 바꾸면 꺼짐). 메뉴는 화면·권한마다 actItems()
// =====================================================================
var MG = {};
var ACT_IC = {
  plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12.5l4.5 4.5L19 7"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>', eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>', won: '<path d="M4 6l4 12 4-9 4 9 4-12M3 11h18"/>'
};
function mgToggle(k, after) { return function () { MG[k] = !MG[k]; closeAct(); after(); }; }
function actItems() {
  var t = curTab, it = [], lead = S.team && S.team.rank >= RANK.GROUP_LEADER, inst = S.team && S.team.rank >= RANK.INSTRUCTOR;
  var add = function (ic, label, fn, on) { it.push({ ic: ic, label: label + (on ? ' 닫기' : ''), fn: fn, on: on }); };
  if (t === 'attend') {
    if (S.current) {
      var b = M.board;
      if (b && b.can_check) add('check', '출결 확인·마감·알림', mgToggle('sess', renderDetail), MG.sess);
      if (lead && phaseOf(S.current) !== 'closed' && phaseOf(S.current) !== 'cancel') { add('x', '모임 취소 (대상자 알림)', cancelSess); add('x', '잘못 만들었어요 · 지우기', deleteSess); }
    } else if ($('reportView').style.display !== 'none') {
      if (R.data && R.data.scope === 'team') { add('list', '팀 전체 리포트', mgToggle('rp', renderReport), MG.rp); if (MG.rp) add('copy', '텍스트로 복사', copyReport); }
    } else {
      if (lead) add('plus', '모임 만들기', openSessModal);
      if (inst) add('plus', '체크인 만들기', openCiModal);
      if (lead && C.list.length) add('eye', '체크인 현황', mgToggle('ci', renderCheckins), MG.ci);
    }
  }
  if (t === 'attend' && !S.current) add('edit', '특이사항 알리기', function () { openNote({}); });
  if (t === 'mtg' && MT.d && MT.d.meeting.status !== '끝') add('plus', '안건 올리기', function () { openItem(); });
  if (t === 'people') { if (PPL.cur) add('edit', PPL.cur.person.name + '님 특이사항 적기', function () { openNote({ person_id: PPL.cur.person.id }); }); add('plus', '특이사항 적기', function () { openNote({ staff: true }); }); }
  if (t === 'poll' && !PL.cur) add('plus', '시간취합 만들기', openTpModal);
  if (t === 'place' && PLC.d) add('plus', '장소 신청', function () { openPlaceModal(); });
  if (t === 'notice') {
    if (annTeams().length) add('plus', '공지 쓰기', openAnnEdit);
    if (N.list && N.list.some(function (n) { return n.mine || n.read_count != null; })) add('eye', '확인 현황·고치기·삭제', mgToggle('ann', renderNotices), MG.ann);
  }
  if (t === 'task') {
    if (A.current) { if (lead) add('eye', '제출 현황', mgToggle('task', function () { openTask(A.current.id); }), MG.task); if (inst) add('edit', '과제 고치기', editTask); }
    else if (inst) add('plus', '과제 내기', openHwModal);
  }
  if (t === 'rec' && recAllowed() && !RC.current) add('plus', '녹음 요청 올리기', openRecModal);
  if (t === 'flow' && FW.can) add('plus', '작업 흐름 만들기', openFlowModal);
  if (t === 'profile') add('edit', '특이사항 알리기', function () { openNote({}); });
  if (t === 'profile' && statCan()) add('star', '스탯 주기', function () { closeAct(); openStatGrant({}); });
  if (t === 'dues' && DU.d && DU.d.treasurer) add('won', '회계 (확인·현황)', mgToggle('dues', renderDues), MG.dues);
  return it;
}
function renderAct() {
  var items = S.me ? actItems() : [], fab = $('actFab');
  fab.style.display = items.length ? '' : 'none';
  fab.classList.toggle('one', items.length === 1 && !items[0].on);
  $('actMenu').innerHTML = items.map(function (x, i) {
    return '<button class="fab-item' + (x.on ? ' on' : '') + '" type="button" onclick="actRun(' + i + ')"><span class="fab-label">' + esc(x.label) + '</span><span class="fab-mini"><svg viewBox="0 0 24 24">' + ACT_IC[x.ic] + '</svg></span></button>';
  }).join('');
  ACT.items = items;
}
var ACT = { items: [] };
function actRun(i) { var x = ACT.items[i]; closeAct(); if (x) x.fn(); setTimeout(renderAct, 50); }
function actFabTap() {
  if (ACT.items.length === 1 && !ACT.items[0].on) { actRun(0); return; }
  var open = !$('actFab').classList.contains('open');
  $('actFab').classList.toggle('open', open); $('actDim').classList.toggle('show', open);
}
function closeAct() { if (!$('actFab')) return; $('actFab').classList.remove('open'); $('actDim').classList.remove('show'); }
// ponytail: 화면 상태(상세 열기·명단 도착 등)가 바뀔 때마다 부르는 대신 1초마다 다시 계산 (메뉴가 열려 있을 땐 안 함)
setInterval(function () { if (S.me && !$('actFab').classList.contains('open')) renderAct(); }, 1000);

// =====================================================================
// 인원 특이사항 (교관 이상): 팀원 한눈에 → 사람별 타임라인(특이사항 + 운영진 메모 + 출결 기록)
// 팀원은 '특이사항 알리기'로 자기 것만 (나의 기록 아래 '내가 알린 특이사항')
// =====================================================================
var PPL = { board: null, cur: null };
var NOTE_CATS = ['건강', '직장·학업', '일정 충돌', '가정', '기타'], NOTE_AFF = ['수업', '스터디', '녹음', '업무'];
var CAT_IC = { '건강': '🤒', '직장·학업': '💼', '일정 충돌': '📅', '가정': '🏠', '기타': '📝' };
function loadPeople() {
  if (S.team.rank < RANK.INSTRUCTOR) { $('pplBoard').innerHTML = '<div class="empty"><b>이 팀에서는 볼 수 없어요</b>위에서 내가 교관 이상인 팀을 골라주세요</div>'; return; }
  api('people.board', { team_id: S.team.id }).then(function (d) { PPL.board = d.members; renderPeople(); if (PPL.cur) openPerson(PPL.cur.person.id); })
    .catch(function (err) { $('pplBoard').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function renderPeople() {
  var l = PPL.board || [];
  $('pplBoard').innerHTML = '<div class="section-head"><h2>' + esc(S.team.name) + '</h2><span class="section-count">' + l.length + '명 · 신경 쓸 사람이 위로</span></div>' +
    (l.length ? l.map(function (m) {
      var tags = [];
      if (m.fresh) tags.push(['bad', '이번 주 새 ' + m.fresh]);
      if (m.followup) tags.push(['warn', '보강·대체 ' + m.followup]);
      if (m.streak >= 2) tags.push(['bad', m.streak + '번 연속 불참']);
      if (m.open) tags.push(['', '진행 중 ' + m.open]);
      return '<button type="button" class="card ppl-row' + (PPL.cur && PPL.cur.person.id === m.id ? ' sel' : '') + '" onclick="openPerson(\'' + m.id + '\')">' +
        '<span class="ppl-nm"><b>' + esc(m.name) + '</b><small>' + esc([m.position, m.group].filter(Boolean).join(' · ')) + '</small></span>' +
        '<span class="ppl-mid">' + (m.latest ? esc(m.latest) : '<i>특이사항 없음</i>') + '<span class="tv-tags">' + tags.map(function (x) { return '<em class="' + x[0] + '">' + x[1] + '</em>'; }).join('') + '</span></span>' +
        '<span class="ppl-rate ' + (m.rate == null ? '' : m.rate < 60 ? 'bad' : m.rate < 80 ? 'warn' : 'ok') + '">' + (m.rate == null ? '–' : m.rate + '%') + '<small>4주 출석</small></span></button>';
    }).join('') : '<div class="empty"><b>팀원이 없어요</b></div>');
}
function openPerson(id) {
  var wide = isWide();
  $('pplList').style.display = wide ? 'block' : 'none'; $('peopleView').classList.toggle('split', wide);
  $('pplDetail').style.display = 'block'; $('pplTimeline').innerHTML = '<div class="b-wait">불러오는 중...</div>';
  try { if (tg && tg.BackButton) tg.BackButton.show(); } catch (e) {}
  api('people.timeline', { team_id: S.team.id, person_id: id }).then(function (d) { PPL.cur = d; renderTimeline(); renderPeople(); if (!wide) window.scrollTo(0, 0); })
    .catch(function (err) { $('pplTimeline').innerHTML = '<div class="empty"><b>불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function closePerson() {
  PPL.cur = null; $('peopleView').classList.remove('split'); $('pplDetail').style.display = 'none'; $('pplList').style.display = 'block';
  try { if (tg && tg.BackButton) tg.BackButton.hide(); } catch (e) {}
  renderPeople();
}
function noteRange(n) { return shortD(n.starts_on) + (n.ends_on ? (n.ends_on !== n.starts_on ? '~' + shortD(n.ends_on) : '') : '~ 계속'); }
function renderTimeline() {
  var d = PPL.cur, p = d.person;
  // 특이사항과 출결 기록을 날짜순 한 줄로
  var items = d.notes.map(function (n) { return { date: n.starts_on, n: n }; }).concat(d.events.map(function (e) { return { date: e.date, e: e }; }))
    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.n ? -1 : 1; });
  var open = d.notes.filter(function (n) { return n.status === '진행 중'; }).length;
  $('pplTimeline').innerHTML = '<div class="b-dhead"><h1>' + esc(p.name) + '</h1><p>' + esc([p.position, p.group].filter(Boolean).join(' · ')) + ' · 진행 중 특이사항 ' + open + '개 · 최근 6개월 출결 기록 ' + d.events.length + '건</p></div>' +
    (items.length ? '<div class="tl">' + items.map(function (x) {
      if (x.e) return '<div class="tl-i ev"><span class="tl-d">' + shortD(x.date) + '</span><div class="tl-c"><span class="st st-' + esc(x.e.status.replace('사전 ', '')) + '">' + esc(x.e.status) + '</span> ' + esc(x.e.name) + (x.e.reason ? '<small>사유: ' + esc(x.e.reason) + '</small>' : '') + '</div></div>';
      var n = x.n, done = n.status === '해결됨', fu = n.followup !== '없음';
      return '<div class="tl-i note' + (done ? ' done' : '') + '"><span class="tl-d">' + shortD(x.date) + '</span><div class="tl-c card">' +
        '<div class="tl-top"><b>' + (CAT_IC[n.category] || '📝') + ' ' + esc(n.title) + '</b><span class="st ' + (done ? 'st-참석' : 'st-지각') + '">' + n.status + '</span></div>' +
        '<small class="tl-meta">' + esc(n.category) + ' · ' + noteRange(n) + (n.affects.length ? ' · ' + esc(n.affects.join('·')) + ' 영향' : '') + ' · ' + (n.source === '본인' ? '본인이 알림' : esc(n.by) + ' 기록') + '</small>' +
        (n.body ? '<p>' + esc(n.body) + '</p>' : '') +
        (fu ? '<label class="tl-fu"><input type="checkbox" ' + (n.followup_done_at ? 'checked' : '') + ' onchange="noteStatus(\'' + n.id + '\',{followup_done:this.checked})"> ' + n.followup + ' 완료' + (n.followup_done_at ? ' <small>' + mdOf(n.followup_done_at) + '</small>' : '') + '</label>' : '') +
        (n.comments.length ? '<div class="tl-cm">' + n.comments.map(function (c) { return '<div><b>' + esc(c.by) + '</b> ' + esc(c.body) + ' <small>' + mdOf(c.at) + '</small></div>'; }).join('') + '</div>' : '') +
        '<div class="tl-acts"><input type="text" maxlength="500" placeholder="운영진 메모 남기기 (본인은 못 봐요)" id="nc-' + n.id + '" onkeydown="if(event.key===\'Enter\')noteComment(\'' + n.id + '\')">' +
          '<button onclick="noteComment(\'' + n.id + '\')">남기기</button><button onclick="noteStatus(\'' + n.id + '\',{status:\'' + (done ? '진행 중' : '해결됨') + '\'})">' + (done ? '다시 진행 중' : '해결됨') + '</button>' +
          '<button onclick="openNote({edit:\'' + n.id + '\'})">고치기</button></div></div></div>';
    }).join('') + '</div>' : '<div class="empty"><b>기록이 없어요</b>오른쪽 아래 + 로 특이사항을 적어요</div>');
}
function noteStatus(id, up) { api('notes.status', Object.assign({ id: id }, up)).then(function () { haptic('success'); refreshPerson(); }).catch(function (err) { alertMsg(err.message); }); }
function noteComment(id) {
  var v = $('nc-' + id).value.trim(); if (!v) return;
  api('notes.comment', { id: id, body: v }).then(function () { haptic('success'); refreshPerson(); }).catch(function (err) { alertMsg(err.message); });
}
function refreshPerson() { if (PPL.cur) openPerson(PPL.cur.person.id); api('people.board', { team_id: S.team.id }).then(function (d) { PPL.board = d.members; renderPeople(); }).catch(function () {}); }

// ----- 쓰기 팝업 { staff?, person_id?, edit? } -----
var NT = null;
function openNote(o) {
  var staff = !!(o.staff || o.person_id || o.edit) && S.team.rank >= RANK.INSTRUCTOR;
  var cur = o.edit && PPL.cur ? PPL.cur.notes.filter(function (n) { return n.id === o.edit; })[0] : o.mineEdit ? MYN.list.filter(function (n) { return n.id === o.mineEdit; })[0] : null;
  NT = { staff: staff, id: cur ? cur.id : null, person_id: o.person_id || (cur ? PPL.cur && PPL.cur.person.id : null) || '', cat: cur ? cur.category : '', aff: cur ? cur.affects.slice() : [] };
  $('noteModalT').textContent = cur ? '특이사항 고치기' : staff ? '특이사항 적기' : '특이사항 알리기';
  $('noteModalSub').textContent = staff ? '운영진(교관 이상)만 봐요. 건강은 "감기", "발목 다침"처럼 짧게만 적어주세요' : '수업·스터디·녹음에 나오기 어려운 사정을 알려주세요. 운영진(교관 이상)만 봐요';
  var who = staff && !o.person_id && !cur ? '<label class="field-label" for="ntWho">누구</label><div class="select-wrap"><select id="ntWho">' + (PPL.board || []).map(function (m) { return '<option value="' + m.id + '">' + esc(m.name) + '</option>'; }).join('') + '</select></div>' : '';
  $('noteBody').innerHTML = who +
    '<label class="field-label">종류</label><div class="b-chips" id="ntCats">' + NOTE_CATS.map(function (c) { return '<button type="button" class="b-pick' + (NT.cat === c ? ' on' : '') + '" onclick="NT.cat=\'' + c + '\';ntChips()">' + CAT_IC[c] + ' ' + c + '</button>'; }).join('') + '</div>' +
    '<label class="field-label" for="ntTitle">한 줄 요약</label><input type="text" id="ntTitle" class="b-input" maxlength="60" placeholder="예) 감기로 이번 주 수업 불참, 야근이 늘어 평일 저녁 어려움" value="' + esc(cur ? cur.title : '') + '">' +
    '<label class="field-label">기간 <span class="hint">끝을 비우면 \'계속\'</span></label><div class="tp-row"><input type="date" id="ntFrom" value="' + esc(cur ? cur.starts_on : todayStr()) + '"><span>~</span><input type="date" id="ntTo" value="' + esc(cur && cur.ends_on ? cur.ends_on : '') + '"></div>' +
    '<label class="field-label">어디에 영향</label><div class="b-chips" id="ntAff">' + NOTE_AFF.map(function (a) { return '<button type="button" class="b-pick' + (NT.aff.indexOf(a) !== -1 ? ' on' : '') + '" onclick="ntAff(\'' + a + '\')">' + a + '</button>'; }).join('') + '</div>' +
    '<label class="field-label" for="ntBody">자세히 <span class="hint">선택</span></label><textarea id="ntBody" rows="3" maxlength="1000">' + esc(cur && cur.body ? cur.body : '') + '</textarea>' +
    (staff ? '<label class="field-label">후속 조치</label><div class="select-wrap"><select id="ntFu">' + ['없음', '보강', '대체학습'].map(function (f) { return '<option' + (cur && cur.followup === f ? ' selected' : '') + '>' + f + '</option>'; }).join('') + '</select></div>' : '') +
    '<button class="btn-primary" id="ntBtn" onclick="saveNote()">' + (cur ? '저장' : staff ? '기록하기' : '알리기') + '</button>' +
    (cur ? '<button class="ghost-btn b-danger" onclick="delNote()">이 기록 지우기</button>' : '') + '<div class="msg" id="ntMsg"></div>';
  openModal('noteModal');
}
function ntChips() { document.querySelectorAll('#ntCats .b-pick').forEach(function (b, i) { b.classList.toggle('on', NOTE_CATS[i] === NT.cat); }); }
function ntAff(a) { var i = NT.aff.indexOf(a); if (i === -1) NT.aff.push(a); else NT.aff.splice(i, 1); document.querySelectorAll('#ntAff .b-pick').forEach(function (b, j) { b.classList.toggle('on', NT.aff.indexOf(NOTE_AFF[j]) !== -1); }); }
function saveNote() {
  var p = { team_id: S.team.id, id: NT.id, person_id: NT.person_id || ($('ntWho') && $('ntWho').value) || null, category: NT.cat, title: $('ntTitle').value.trim(),
    body: $('ntBody').value.trim(), starts_on: $('ntFrom').value, ends_on: $('ntTo').value || null, affects: NT.aff };
  if ($('ntFu')) p.followup = $('ntFu').value;
  if (!p.category) { setMsg('ntMsg', '종류를 골라주세요', true); return; }
  if (!p.title) { setMsg('ntMsg', '한 줄 요약을 적어주세요', true); return; }
  var btn = $('ntBtn'); btn.disabled = true; setMsg('ntMsg', '저장 중...');
  api('notes.save', p).then(function () {
    haptic('success'); setMsg('ntMsg', NT.staff ? '기록했어요' : '알렸어요! 운영진에게 전달됐어요');
    if (curTab === 'people') refreshPerson(); loadMyNotes();
    setTimeout(function () { closeModal('noteModal'); }, 900);
  }).catch(function (err) { btn.disabled = false; setMsg('ntMsg', err.message, true); });
}
function delNote() {
  if (!NT.id || !confirm('이 기록을 지울까요?')) return;
  api('notes.delete', { id: NT.id }).then(function () { closeModal('noteModal'); if (curTab === 'people') refreshPerson(); loadMyNotes(); }).catch(function (err) { setMsg('ntMsg', err.message, true); });
}
// 나의 기록: 내가 알린 특이사항
var MYN = { list: [] };
function loadMyNotes() {
  if (!$('myNotes')) return;
  api('notes.mine', { team_id: S.team.id }).then(function (l) {
    MYN.list = l;
    $('myNotes').innerHTML = l.length ? '<div class="section-head b-gap"><h2>내가 알린 특이사항</h2><span class="section-count">운영진만 봐요</span></div>' + l.slice(0, 6).map(function (n) {
      return '<button type="button" class="card ppl-row" onclick="openNote({mineEdit:\'' + n.id + '\'})"><span class="ppl-mid"><b>' + (CAT_IC[n.category] || '📝') + ' ' + esc(n.title) + '</b><small>' + noteRange(n) + '</small></span><span class="st ' + (n.status === '해결됨' ? 'st-참석' : 'st-지각') + '">' + n.status + '</span></button>';
    }).join('') : '';
  }).catch(function () {});
}

// =====================================================================
// 회의 모드: 준비(안건·미리 의견) → 진행(지금 안건 하나·남은 시간·주차장·서기 칸·할 일) → 끝(회의록)
// 진행 중엔 3초, 아니면 15초마다 새로 불러와 모두 같은 화면을 봄 (진행자가 넘기면 따라감)
// =====================================================================
var MT = { sid: null, d: null, timer: null, open: null };
function openMeeting(sid) { MT.sid = sid; MT.d = null; MT.open = null; if (curTab === 'mtg') loadMeeting(); else goTab('mtg'); }
function closeMeeting() { clearTimeout(MT.timer); var sid = MT.sid; MT.sid = null; goTab('attend'); if (sid && S.sessions && byId(S.sessions, sid)) openSession(sid); }
function loadMeeting() {
  clearTimeout(MT.timer); if (!MT.sid || curTab !== 'mtg') return;
  api('mtg.get', { session_id: MT.sid }).then(function (d) {
    MT.skew = d.meeting.server_now - Date.now(); MT.d = d;
    // 입력 중이면 화면을 다시 그리지 않음 (쓰던 글이 날아가지 않게)
    var a = document.activeElement, typing = a && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName) && a.closest('#mtgArea');
    if (!typing) renderMeeting();
    MT.timer = setTimeout(loadMeeting, d.meeting.status === '진행' ? 3000 : 15000);
  }).catch(function (err) { $('mtgArea').innerHTML = '<div class="empty"><b>회의를 열 수 없어요</b>' + esc(err.message) + '</div>'; });
}
setInterval(function () { if (curTab === 'mtg' && MT.d && MT.d.meeting.status === '진행') { var el = $('mtTimer'); if (el) el.outerHTML = mtTimer(); } }, 1000);
var PRI = { 1: '높음', 2: '보통', 3: '낮음' };
function mtLeft() {
  var m = MT.d.meeting, it = MT.d.items.filter(function (i) { return i.id === m.current_item_id; })[0]; if (!it || !m.item_started_at) return null;
  return (it.minutes_min + it.extended_min) * 60000 - (Date.now() + (MT.skew || 0) - Date.parse(m.item_started_at));
}
function mtTimer() {
  var l = mtLeft(); if (l == null) return '<span id="mtTimer"></span>';
  var over = l < 0, a = Math.abs(l), mm = Math.floor(a / 60000), ss = Math.floor(a % 60000 / 1000);
  return '<span id="mtTimer" class="mt-timer' + (over ? ' over' : l < 60000 ? ' soon' : '') + '">' + (over ? '+' : '') + mm + ':' + ('0' + ss).slice(-2) + '<small>' + (over ? '시간 지남' : '남음') + '</small></span>';
}
function renderMeeting() {
  var d = MT.d, m = d.meeting, s = d.session;
  var head = '<div class="b-dhead"><h1>🗂 ' + esc(s.title) + '</h1><p>' + shortD(s.date) + (s.start ? ' ' + String(s.start).slice(0, 5) : '') + (s.location ? ' · ' + esc(s.location) : '') +
    ' · 진행 ' + esc(m.chair) + ' · 서기 ' + (m.scribe ? esc(m.scribe) : '아직 없음') + ' · <span class="st ' + (m.status === '진행' ? 'st-지각' : m.status === '끝' ? 'st-참석' : 'st-none') + '">' + (m.status === '진행' ? '회의 중' : m.status === '끝' ? '끝남' : '준비 중') + '</span></p></div>';
  $('mtgArea').innerHTML = head + (m.status === '준비' ? renderPrep() : m.status === '진행' ? renderLive() : renderMinutes());
}
function itemCard(it, live) {
  var d = MT.d, mine = it.opinions.filter(function (o) { return o.person_id === d.me.id; })[0], open = MT.open === it.id || live;
  var fields = [['background', '배경'], ['decide', '정해야 할 것'], ['options', '선택지']].map(function (f) { return it[f[0]] ? '<div class="mt-f"><small>' + f[1] + '</small>' + esc(it[f[0]]) + '</div>' : ''; }).join('');
  return '<div class="card mt-item' + (open ? ' open' : '') + '">' +
    '<div class="mt-ih" onclick="mtToggle(\'' + it.id + '\')"><b>' + (it.kind === '인원' ? '👤 ' : it.kind === '할 일 점검' ? '✅ ' : '') + esc(it.title) + '</b>' +
      '<span class="mt-tags"><em>' + it.minutes_min + '분</em><em class="p' + it.priority + '">' + PRI[it.priority] + '</em>' + (it.kind !== '할 일 점검' ? '<em>의견 ' + it.opinions.length + '</em>' : '') + '</span></div>' +
    (open ? (it.kind === '할 일 점검' ? mtPrevActions() : '') + fields +
      (it.person_id ? '<button class="ghost-btn mt-person" onclick="mtPerson(\'' + it.person_id + '\')">👤 ' + esc(it.person || '') + '님 특이사항 타임라인 보기</button><div id="mtp-' + it.person_id + '"></div>' : '') +
      (it.kind !== '할 일 점검' ? '<div class="mt-ops">' + (it.opinions.length ? it.opinions.map(function (o) { return '<div><b>' + esc(o.name) + '</b> ' + esc(o.body) + '</div>'; }).join('') : '<p class="rec-none">아직 의견이 없어요</p>') + '</div>' +
        (d.meeting.status !== '끝' ? '<div class="mt-my"><textarea id="op-' + it.id + '" rows="2" maxlength="500" placeholder="내 의견 한두 줄 (회의 전에 미리)">' + esc(mine ? mine.body : '') + '</textarea><button onclick="saveOpinion(\'' + it.id + '\')">' + (mine ? '고치기' : '남기기') + '</button></div>' : '') : '') +
      (!live && (it.created_by === d.me.id || d.me.chair) && d.meeting.status === '준비' && it.kind !== '할 일 점검' ? '<div class="mt-ia"><button onclick="openItem(\'' + it.id + '\')">고치기</button><button onclick="delItem(\'' + it.id + '\')">지우기</button></div>' : '') : '') + '</div>';
}
function mtToggle(id) { if (MT.d.meeting.status === '진행' && id === MT.d.meeting.current_item_id) return; MT.open = MT.open === id ? null : id; renderMeeting(); }
function hmMin(t) { return t ? parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10) : null; }
function renderPrep() {
  var d = MT.d, its = d.items.slice().sort(function (a, b) { return a.priority - b.priority; }), total = its.reduce(function (n, i) { return n + i.minutes_min; }, 0);
  var dur = d.session.start && d.session.end ? hmMin(d.session.end) - hmMin(d.session.start) : null;
  var ready = d.members.filter(function (x) { return x.ready; }).length;
  return '<div class="mt-bar"><span>안건 ' + its.length + '개 · 예상 <b>' + total + '분</b>' + (dur ? ' / 회의 ' + dur + '분' : '') + '</span>' + (dur && total > dur ? '<em class="bad">회의 시간보다 ' + (total - dur) + '분 넘쳐요. 중요도를 낮추거나 시간을 줄여주세요</em>' : '') + '</div>' +
    (its.length ? its.map(function (i) { return itemCard(i); }).join('') : '<div class="empty"><b>아직 안건이 없어요</b>오른쪽 아래 + 로 안건을 올려요. 배경·정해야 할 것·선택지를 적으면 참석자가 미리 의견을 남겨요</div>') +
    '<div class="section-head b-gap"><h2>미리 의견 남긴 사람</h2><span class="section-count">' + ready + ' / ' + d.members.length + '명 · 회의 전날 저녁에 안 남긴 사람에게 알림</span></div><div class="card du-people">' +
    d.members.map(function (x) { return '<span class="du-p ' + (x.ready ? '' : 's-미납') + '">' + esc(x.name) + (x.ready ? ' ✓' : '') + '</span>'; }).join('') + '</div>' +
    (d.me.chair ? '<div class="card adm-box mt-chair"><div class="adm-h"><b>진행자</b><small>서기를 정하고, 시간이 되면 회의를 시작해요. 시작하면 안건이 중요도 순으로 정렬되고, 지난 회의에서 안 끝난 할 일이 있으면 맨 앞에 점검 안건이 붙어요</small></div>' +
      '<div class="tp-row"><span>서기</span><div class="select-wrap"><select id="mtScribe" onchange="setScribe(this.value)"><option value="">고르기</option>' + d.members.map(function (x) { return '<option value="' + x.id + '"' + (x.id === d.meeting.scribe_id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div></div>' +
      '<button class="btn-primary" onclick="mtStart()">▶ 회의 시작</button></div>' : '');
}
function renderLive() {
  var d = MT.d, m = d.meeting, me = d.me, cur = d.items.filter(function (i) { return i.id === m.current_item_id; })[0], w = me.chair || me.scribe;
  var side = '<div class="mt-side"><div class="section-head"><h2>안건 순서</h2></div>' + d.items.map(function (i) {
      return '<div class="mt-step s-' + i.status.replace(' ', '') + (i.id === m.current_item_id ? ' cur' : '') + '"' + (me.chair && i.id !== m.current_item_id ? ' onclick="mtGo(\'' + i.id + '\')" title="이 안건으로"' : '') + '><i>' + (i.status === '결론' ? '✓' : i.status === '넘김' ? '→' : i.id === m.current_item_id ? '▶' : '·') + '</i>' + esc(i.title) + '<small>' + i.minutes_min + '분</small></div>';
    }).join('') +
    '<div class="section-head b-gap"><h2>🅿️ 주차장</h2><span class="section-count">나중에 얘기할 것</span></div>' +
    d.parked.map(function (x) { return '<div class="mt-park">' + esc(x.text) + ' <small>' + esc(x.by) + '</small><button onclick="unpark(\'' + x.id + '\')">✕</button></div>'; }).join('') +
    '<div class="mt-my"><input type="text" id="mtParkIn" maxlength="200" placeholder="딴 얘기가 나오면 여기에" onkeydown="if(event.key===\'Enter\')park()"><button onclick="park()">나중에</button></div></div>';
  if (!cur) return '<div class="mt-live"><div class="mt-main"><div class="empty"><b>안건을 다 다뤘어요</b>' + (d.parked.length ? '주차장에 남은 이야기를 다루거나, ' : '') + '회의를 끝내면 회의록이 만들어지고 할 일이 담당자에게 가요</div>' +
    (me.chair ? '<button class="btn-primary" onclick="mtEnd()">■ 회의 끝내기</button>' : '') + '</div>' + side + '</div>';
  var acts = d.actions.filter(function (a) { return a.item_id === cur.id; });
  var main = '<div class="mt-main"><div class="mt-now"><span class="mt-lbl">지금 안건</span>' + mtTimer() + '</div>' + itemCard(cur, true) +
    '<div class="card mt-note"><div class="mt-nh"><b>📝 회의록</b><small>' + (w ? '서기·진행자가 적어요 (칸을 벗어나면 저장)' : '서기가 적고 있어요') + '</small></div>' +
      '<label>논의 요약</label>' + (w ? '<textarea rows="3" maxlength="2000" onblur="saveNoteField(\'' + cur.id + '\',\'summary\',this.value)">' + esc(cur.summary || '') + '</textarea>' : '<p>' + esc(cur.summary || '–') + '</p>') +
      '<label>결정</label>' + (w ? '<textarea rows="2" maxlength="1000" onblur="saveNoteField(\'' + cur.id + '\',\'decision\',this.value)">' + esc(cur.decision || '') + '</textarea>' : '<p>' + esc(cur.decision || '–') + '</p>') +
      '<label>할 일 <small>(담당자의 \'지금 할 일\'로 가요)</small></label>' + acts.map(function (a) { return '<div class="mt-act">☐ <b>' + esc(a.name) + '</b> ' + esc(a.task) + (a.due_on ? ' <small>' + a.due_on.slice(5).replace('-', '/') + '까지</small>' : '') + (w ? '<button onclick="delAction(\'' + a.id + '\')">✕</button>' : '') + '</div>'; }).join('') +
      (w ? '<div class="mt-addact"><div class="select-wrap"><select id="maWho">' + d.members.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('') + '</select></div><input type="text" id="maTask" maxlength="200" placeholder="무엇을"><input type="date" id="maDue"><button onclick="addAction(\'' + cur.id + '\')">추가</button></div>' : '') + '</div>' +
    (me.chair ? '<div class="mt-ctrl"><button onclick="mtExtend()">⏱ 5분 연장</button><button class="ok" onclick="mtNext(\'결론\')">결론 내고 다음 ›</button><button onclick="mtNext(\'넘김\')">다음 회의로 넘김</button><button class="bad" onclick="mtEnd()">■ 회의 끝내기</button></div>' : '') + '</div>';
  return '<div class="mt-live">' + main + side + '</div>';
}
function mtPrevActions() { return '<p class="b-note">지난 회의에서 맡은 일 중 안 끝난 것을 하나씩 확인해요. 담당자가 \'지금 할 일\'에서 완료를 누르면 끝나요.</p>'; }
function minutesText() {
  var d = MT.d, s = d.session, lines = ['[회의록] ' + s.title + ' · ' + s.date, '진행 ' + d.meeting.chair + ' · 서기 ' + (d.meeting.scribe || '-'), '참석 ' + d.members.map(function (x) { return x.name; }).join(', '), ''];
  d.items.forEach(function (i, n) {
    lines.push((n + 1) + '. ' + i.title + ' (' + i.status + ')');
    if (i.summary) lines.push('  - 논의: ' + i.summary.replace(/\n/g, ' '));
    if (i.decision) lines.push('  - 결정: ' + i.decision.replace(/\n/g, ' '));
    d.actions.filter(function (a) { return a.item_id === i.id; }).forEach(function (a) { lines.push('  - 할 일: ' + a.name + ' · ' + a.task + (a.due_on ? ' (' + a.due_on + '까지)' : '')); });
  });
  if (d.parked.length) { lines.push('', '[주차장]'); d.parked.forEach(function (x) { lines.push('- ' + x.text); }); }
  return lines.join('\n');
}
function renderMinutes() {
  var d = MT.d;
  return '<div class="card mt-doc">' + d.items.map(function (i, n) {
      var acts = d.actions.filter(function (a) { return a.item_id === i.id; });
      return '<div class="mt-di"><h3>' + (n + 1) + '. ' + esc(i.title) + ' <span class="st ' + (i.status === '결론' ? 'st-참석' : i.status === '넘김' ? 'st-지각' : 'st-none') + '">' + i.status + '</span></h3>' +
        (i.summary ? '<p><small>논의</small>' + esc(i.summary) + '</p>' : '') + (i.decision ? '<p class="dec"><small>결정</small>' + esc(i.decision) + '</p>' : '') +
        acts.map(function (a) { return '<div class="mt-act">' + (a.done_at ? '☑' : '☐') + ' <b>' + esc(a.name) + '</b> ' + esc(a.task) + (a.due_on ? ' <small>' + a.due_on.slice(5).replace('-', '/') + '까지</small>' : '') + '</div>'; }).join('') + '</div>';
    }).join('') + (d.parked.length ? '<div class="mt-di"><h3>🅿️ 주차장 (다음에)</h3>' + d.parked.map(function (x) { return '<p>· ' + esc(x.text) + '</p>'; }).join('') + '</div>' : '') + '</div>' +
    '<button class="btn-primary" onclick="copyMinutes()">📋 회의록 텍스트로 복사</button><div class="msg" id="mtMsg"></div>';
}
function copyMinutes() { var t = minutesText(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { setMsg('mtMsg', '복사했어요. 텔레그램에 붙여넣으세요'); }).catch(function () { prompt('복사해서 쓰세요', t); }); }
function mtDo(action, p) { return api(action, Object.assign({ meeting_id: MT.d.meeting.id }, p || {})).then(function (r) { haptic('success'); loadMeeting(); return r; }).catch(function (err) { alertMsg(err.message); }); }
function mtStart() { if (!MT.d.meeting.scribe_id && !confirm('서기가 아직 없어요. 그래도 시작할까요? (진행자가 적어도 돼요)')) return; mtDo('mtg.start'); }
function mtNext(outcome) { mtDo('mtg.next', { outcome: outcome }); }
function mtGo(id) { if (confirm('이 안건으로 넘어갈까요? 지금 안건은 대기로 남아요')) mtDo('mtg.next', { to: id }); }
function mtExtend() { mtDo('mtg.extend', { min: 5 }); }
function mtEnd() { if (confirm('회의를 끝낼까요? 회의록이 만들어지고, 할 일이 담당자에게 알림으로 가요')) mtDo('mtg.end').then(function (r) { if (r) alertMsg('회의를 끝냈어요' + (r.sent ? ' · 할 일 알림 ' + r.sent + '명' : '')); }); }
function setScribe(id) { document.activeElement.blur(); mtDo('mtg.scribe', { person_id: id || null }); }
function park() { var v = $('mtParkIn').value.trim(); if (v) { $('mtParkIn').blur(); mtDo('mtg.park', { text: v }); } }
function unpark(id) { mtDo('mtg.unpark', { id: id }); }
function saveOpinion(id) { var v = $('op-' + id).value; document.activeElement.blur(); api('mtg.opinion', { item_id: id, body: v }).then(function () { haptic('success'); loadMeeting(); refreshTodos(true); }).catch(function (err) { alertMsg(err.message); }); }
function saveNoteField(id, k, v) { var p = { item_id: id }; p[k] = v; api('mtg.note', p).catch(function (err) { alertMsg(err.message); }); }
function addAction(itemId) { var t = $('maTask').value.trim(); if (!t) { alertMsg('할 일을 적어주세요'); return; } var p = { item_id: itemId, assignee_id: $('maWho').value, task: t, due_on: $('maDue').value || null }; document.activeElement.blur(); mtDo('mtg.action', p); }
function delAction(id) { mtDo('mtg.actionDelete', { id: id }); }
function delItem(id) { if (confirm('이 안건을 지울까요?')) mtDo('mtg.itemDelete', { id: id }); }
function mtPerson(pid) {
  var box = $('mtp-' + pid); if (!box) return;
  if (box.innerHTML) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="b-wait">불러오는 중...</div>';
  api('people.timeline', { team_id: MT.d.meeting.team_id, person_id: pid }).then(function (t) {
    box.innerHTML = '<div class="mt-ptl">' + t.notes.filter(function (n) { return n.status === '진행 중'; }).map(function (n) { return '<div>' + (CAT_IC[n.category] || '📝') + ' <b>' + esc(n.title) + '</b> <small>' + noteRange(n) + (n.followup !== '없음' ? ' · ' + n.followup + (n.followup_done_at ? ' 완료' : ' 필요') : '') + '</small></div>'; }).join('') +
      t.events.slice(0, 5).map(function (e) { return '<div class="ev">' + shortD(e.date) + ' ' + esc(e.status) + ' · ' + esc(e.name) + (e.reason ? ' <small>' + esc(e.reason) + '</small>' : '') + '</div>'; }).join('') + '</div>';
  }).catch(function (err) { box.innerHTML = '<p class="rec-none">' + esc(err.message) + '</p>'; });
}
function openItem(id) {
  var it = id ? MT.d.items.filter(function (i) { return i.id === id; })[0] : null, staff = S.team.rank >= RANK.INSTRUCTOR;
  MT.ik = it ? it.kind : '일반';
  $('itemModalT').textContent = it ? '안건 고치기' : '안건 올리기'; $('itemModalS').textContent = '배경·정해야 할 것·선택지를 적으면 참석자들이 미리 의견을 남겨요';
  $('itemBody').innerHTML = (staff ? '<div class="b-chips" id="imKinds">' + [['일반', '일반'], ['인원', '👤 인원 (특이사항)']].map(function (k) { return '<button type="button" class="b-pick' + (MT.ik === k[0] ? ' on' : '') + '" data-k="' + k[0] + '" onclick="imKind(\'' + k[0] + '\')">' + k[1] + '</button>'; }).join('') + '</div>' : '') +
    '<div id="imWho" style="display:' + (MT.ik === '인원' ? '' : 'none') + '"><label class="field-label">누구 얘기인가요</label><div class="select-wrap"><select id="imPerson">' + MT.d.members.map(function (x) { return '<option value="' + x.id + '"' + (it && it.person_id === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div></div>' +
    '<label class="field-label" for="imTitle">안건</label><input type="text" id="imTitle" class="b-input" maxlength="80" value="' + esc(it ? it.title : '') + '" placeholder="예) 10월 정규수업 시간 조정">' +
    '<label class="field-label" for="imBg">배경 <span class="hint">왜 이 얘기를 하나요</span></label><textarea id="imBg" rows="2" maxlength="1000">' + esc(it && it.background || '') + '</textarea>' +
    '<label class="field-label" for="imDec">정해야 할 것</label><input type="text" id="imDec" class="b-input" maxlength="500" value="' + esc(it && it.decide || '') + '" placeholder="예) 토요일 오후로 옮길지">' +
    '<label class="field-label" for="imOpt">선택지 <span class="hint">선택</span></label><input type="text" id="imOpt" class="b-input" maxlength="500" value="' + esc(it && it.options || '') + '" placeholder="예) A. 그대로 / B. 토 14시 / C. 토 19시">' +
    '<label class="field-label">예상 시간 · 중요도</label><div class="tp-row"><div class="select-wrap"><select id="imMin">' + [5, 10, 15, 20, 30, 45, 60].map(function (n) { return '<option' + ((it ? it.minutes_min : 10) === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div><span>분</span>' +
      '<div class="select-wrap"><select id="imPri">' + [1, 2, 3].map(function (n) { return '<option value="' + n + '"' + ((it ? it.priority : 2) === n ? ' selected' : '') + '>중요도 ' + PRI[n] + '</option>'; }).join('') + '</select></div></div>' +
    '<button class="btn-primary" id="imBtn" onclick="saveItem(\'' + (id || '') + '\')">' + (it ? '저장' : '올리기') + '</button><div class="msg" id="imMsg"></div>';
  openModal('itemModal');
}
function imKind(k) { MT.ik = k; document.querySelectorAll('#imKinds .b-pick').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-k') === k); }); $('imWho').style.display = k === '인원' ? '' : 'none'; }
function saveItem(id) {
  var p = { meeting_id: MT.d.meeting.id, id: id || null, kind: MT.ik, person_id: MT.ik === '인원' ? $('imPerson').value : null, title: $('imTitle').value.trim(), background: $('imBg').value, decide: $('imDec').value, options: $('imOpt').value, minutes_min: +$('imMin').value, priority: +$('imPri').value };
  if (!p.title) { setMsg('imMsg', '안건을 적어주세요', true); return; }
  $('imBtn').disabled = true;
  api('mtg.item', p).then(function () { haptic('success'); closeModal('itemModal'); loadMeeting(); }).catch(function (err) { $('imBtn').disabled = false; setMsg('imMsg', err.message, true); });
}


// =====================================================================
// 작업 흐름: 업무 탭 위. 단계는 '앞 단계'로 이어지고, 열(단계 깊이)마다 나란히 그려짐
// =====================================================================
var FW = { list: null, can: false, pending: null };
var FW_IC = { '대기': '·', '시작': '▶', '완료': '✓', '막힘': '!' };
function loadFlows() {
  if (!S.team) return;
  api('flow.list', { team_id: S.team.id }).then(function (d) {
    FW.list = d.flows; FW.can = d.can_create; renderFlows();
    if (FW.pending) { var id = FW.pending; FW.pending = null; fwAct(id); }
  }).catch(function (err) { $('flowArea').innerHTML = '<div class="empty"><b>작업 흐름을 불러오지 못했어요</b>' + esc(err.message) + '</div>'; });
}
function fwLevels(steps) {
  var lv = {}, by = {}; steps.forEach(function (x) { by[x.id] = x; });
  function L(x) { if (lv[x.id] != null) return lv[x.id]; lv[x.id] = 0; var m = 0; x.after.forEach(function (a) { if (by[a]) m = Math.max(m, L(by[a]) + 1); }); return (lv[x.id] = m); }
  steps.forEach(L); return lv;
}
function fwStepSt(x) { return x.done ? 'done' : !x.ready ? 'wait' : x.people.some(function (p) { return p.state === '막힘'; }) ? 'stuck' : 'now'; }
function fwDue(d, done) {
  if (!d) return ''; var n = dayDiff(parseDate(d).getTime());
  return '<em class="fw-due' + (!done && n < 0 ? ' late' : !done && n <= 1 ? ' soon' : '') + '">' + d.slice(5).replace('-', '/') + (done ? '' : n < 0 ? ' 지남' : n === 0 ? ' 오늘' : ' D-' + n) + '</em>';
}
function fwCard(f) {
  var me = S.me.profile.id, lv = fwLevels(f.steps), cols = [];
  f.steps.forEach(function (x) { (cols[lv[x.id]] = cols[lv[x.id]] || []).push(x); });
  var done = f.steps.filter(function (x) { return x.done; }).length, idx = {};
  f.steps.forEach(function (x, i) { idx[x.id] = i + 1; });
  var h = '<div class="card fw-card' + (f.status === '완료' ? ' fin' : '') + '"><div class="fw-top"><div><b>' + esc(f.title) + '</b><small>' + esc(f.by) + ' · ' + shortD(f.created_at.slice(0, 10)) + (f.status === '완료' ? ' · 모두 끝남 🎉' : '') + '</small></div>' +
    '<span class="fw-prog"><i style="width:' + Math.round(done / Math.max(1, f.steps.length) * 100) + '%"></i></span><span class="fw-cnt">' + done + ' / ' + f.steps.length + '</span></div>' +
    (f.note ? '<details class="fw-note"><summary>원문 보기</summary><p>' + esc(f.note) + '</p></details>' : '') + '<div class="fw-cols">';
  cols.forEach(function (col) {
    h += '<div class="fw-col">' + col.map(function (x) {
      var st = fwStepSt(x);
      return '<div class="fw-node s-' + st + '"><div class="fw-nh"><span class="fw-no">' + idx[x.id] + '</span><b>' + esc(x.title) + '</b>' + fwDue(x.due_on, x.done) + '</div>' +
        (x.detail ? '<p class="fw-det">' + esc(x.detail) + '</p>' : '') +
        '<div class="fw-ps">' + x.people.map(function (p) {
          var can = x.ready && f.status === '진행' && (p.person_id === me || f.manage);
          return '<' + (can ? 'button type="button" onclick="fwAct(\'' + p.id + '\')"' : 'span') + ' class="fw-p p-' + p.state + (p.person_id === me ? ' me' : '') + (p.person_id ? '' : ' ext') + '" title="' + esc(p.state + (p.note ? ' · ' + p.note : '')) + '"><i>' + FW_IC[p.state] + '</i>' + esc(p.name) + '</' + (can ? 'button' : 'span') + '>';
        }).join('') + '</div>' +
        x.people.filter(function (p) { return p.note && (p.state === '막힘' || p.state === '완료'); }).map(function (p) { return '<div class="fw-pn">💬 <b>' + esc(p.name) + '</b> ' + esc(p.note) + '</div>'; }).join('') +
        '<div class="fw-foot">' + (st === 'wait' ? '⏳ ' + x.after.map(function (a) { return idx[a]; }).join('·') + '번 끝나면 차례' : st === 'done' ? '완료' : (x.people.length > 1 ? (x.done_rule === '모두' ? '모두 완료해야 끝' : '한 명만 완료하면 끝') : '')) + '</div></div>';
    }).join('') + '</div>';
  });
  h += '</div>' + (f.manage ? '<div class="fw-acts"><button type="button" onclick="openFlowEdit(\'' + f.id + '\')">✏️ 작업 고치기</button><button type="button" class="bad" onclick="fwCancel(\'' + f.id + '\',true)">지우기</button></div>' : '');
  return h + '</div>';
}
function renderFlows() {
  var open = FW.list.filter(function (f) { return f.status === '진행'; }), fin = FW.list.filter(function (f) { return f.status === '완료'; });
  $('flowArea').innerHTML = '<div class="section-head"><h2>작업 흐름</h2><span class="section-count">' + (open.length ? open.length + '건 진행 중' : '') + '</span></div>' +
    (open.length ? open.map(fwCard).join('') : '<p class="rec-none">진행 중인 작업이 없어요' + (FW.can ? '. 오른쪽 아래 + 에서 \'작업 흐름 만들기\'' : '') + '</p>') +
    (fin.length ? '<details class="rm-past"><summary>끝난 작업 ' + fin.length + '건 (30일)</summary>' + fin.map(fwCard).join('') + '</details>' : '');
}
function fwFind(spId) {
  var r = null; (FW.list || []).forEach(function (f) { f.steps.forEach(function (x) { x.people.forEach(function (p) { if (p.id === spId) r = { f: f, x: x, p: p }; }); }); });
  return r;
}
function fwAct(spId) {
  var r = fwFind(spId); if (!r) return;
  var mine = r.p.person_id === S.me.profile.id;
  $('itemModalT').textContent = mine ? '내 단계 보고' : r.p.name + '님 단계 (대신 누르기)'; $('itemModalS').textContent = '누르면 지시자에게 알림이 가요';
  $('itemBody').innerHTML = '<div class="fw-am"><small>' + esc(r.f.title) + '</small><b>' + esc(r.x.title) + '</b>' + (r.x.due_on ? '<span>' + r.x.due_on.slice(5).replace('-', '/') + '까지</span>' : '') + '<span>지금: ' + esc(r.p.state) + '</span></div>' +
    '<div class="fw-abtns">' + [['시작', '▶ 시작했어요'], ['완료', '✓ 끝냈어요'], ['막힘', '🆘 막혔어요'], ['대기', '되돌리기']].map(function (b) { return '<button type="button" class="fw-ab a-' + b[0] + (r.p.state === b[0] ? ' on' : '') + '" onclick="fwMark(\'' + spId + '\',\'' + b[0] + '\')">' + b[1] + '</button>'; }).join('') + '</div>' +
    '<label class="field-label" for="fwANote">메모 <span class="hint">막혔어요는 필수 · 지시자에게 같이 가요</span></label><input type="text" id="fwANote" class="b-input" maxlength="300" value="' + esc(r.p.note || '') + '" placeholder="예) 자료 링크 공유했어요 / 영상 원본이 없어요"><div class="msg" id="fwAMsg"></div>';
  openModal('itemModal');
}
function fwMark(spId, state) {
  api('flow.mark', { id: spId, state: state, note: $('fwANote').value }).then(function () { haptic('success'); closeModal('itemModal'); loadFlows(); refreshTodos(true); })
    .catch(function (err) { setMsg('fwAMsg', err.message, true); });
}
function fwCancel(id, remove) {
  if (!confirm('이 작업 흐름을 지울까요? 단계·진행 기록도 같이 지워지고, 더 이상 알림이 안 가요')) return;
  api('flow.cancel', { id: id, remove: !!remove }).then(function () { haptic('success'); loadFlows(); }).catch(function (err) { alertMsg(err.message); });
}
// ----- 만들기 -----
var FWF = { steps: [], n: 0, editId: null };
// 작업 고치기: 같은 팝업에 지금 단계를 채움 (있던 단계는 id를 key로)
function openFlowEdit(id) {
  var f = (FW.list || []).filter(function (x) { return x.id === id; })[0]; if (!f) return;
  FWF = { n: FWF.n, editId: id, steps: f.steps.map(function (x) {
    return { id: x.id, key: x.id, title: x.title, detail: x.detail || '', due_on: x.due_on || '', done_rule: x.done_rule, after: x.after.slice(),
      people: x.people.map(function (p) { return { person_id: p.person_id, name: p.name }; }) };
  }) };
  $('fwTitle').value = f.title; $('fwNote').value = f.note || '';
  $('flowModalT').textContent = '작업 고치기'; $('fwBtn').textContent = '저장하기';
  loadRoster().then(function () { renderFwSteps(); }).catch(function () {});
  renderFwSteps(); setMsg('fwMsg', '진행 상태는 그대로 남아요. 새 담당자는 차례가 되면 알림을 받아요'); openModal('flowModal');
}
function openFlowModal() {
  if (FWF.editId) { FWF = { steps: [], n: FWF.n }; $('fwTitle').value = ''; $('fwNote').value = ''; }
  $('flowModalT').textContent = '작업 흐름 만들기'; $('fwBtn').textContent = '만들고 알림 보내기';
  loadRoster().then(function () { renderFwSteps(); }).catch(function () {});
  if (!FWF.steps.length) fwAddStep(); else renderFwSteps();
  setMsg('fwMsg', ''); openModal('flowModal');
}
function fwNew() { return { key: 'k' + (++FWF.n), title: '', detail: '', due_on: '', people: [], after: [], done_rule: '한 명' }; }
function fwAddStep() { var x = fwNew(), last = FWF.steps[FWF.steps.length - 1]; if (last) x.after = [last.key]; FWF.steps.push(x); renderFwSteps(); }
function fwRoster() { return ROSTER.data ? ROSTER.data.members : []; }
function renderFwSteps() {
  var ro = fwRoster();
  $('fwSteps').innerHTML = FWF.steps.map(function (x, i) {
    return '<div class="card fw-ed" data-i="' + i + '"><div class="fw-edh"><span class="fw-no">' + (i + 1) + '</span><input type="text" class="b-input" maxlength="80" placeholder="할 일 · 예) PPT 1차 제작" value="' + esc(x.title) + '" oninput="FWF.steps[' + i + '].title=this.value">' +
      '<button type="button" class="c-ag-x" onclick="fwDel(' + i + ')" aria-label="단계 빼기">✕</button></div>' +
      '<input type="text" class="b-input" maxlength="500" placeholder="자세히 (선택)" value="' + esc(x.detail) + '" oninput="FWF.steps[' + i + '].detail=this.value">' +
      '<div class="fw-row"><span>담당</span><div class="fw-chips">' + x.people.map(function (p, j) { return '<span class="fw-p' + (p.person_id ? '' : ' ext') + '">' + esc(p.name) + '<button type="button" onclick="fwPDel(' + i + ',' + j + ')" aria-label="빼기">×</button></span>'; }).join('') +
        '<div class="select-wrap fw-psel"><select onchange="fwPAdd(' + i + ',this)"><option value="">+ 담당 추가</option><option value="@staff">교관 이상 모두</option>' +
        ro.map(function (m) { return '<option value="' + m.id + '">' + esc(m.name) + (m.position ? ' · ' + esc(m.position) : '') + '</option>'; }).join('') + '<option value="@ext">앱에 없는 사람 (이름만)</option></select></div></div></div>' +
      (x.people.length > 1 ? '<div class="fw-row"><span>끝나는 때</span><div class="fw-chips">' + ['한 명', '모두'].map(function (r) { return '<button type="button" class="b-pick' + (x.done_rule === r ? ' on' : '') + '" onclick="FWF.steps[' + i + '].done_rule=\'' + r + '\';renderFwSteps()">' + (r === '한 명' ? '한 명만 끝내면' : '모두 끝내야') + '</button>'; }).join('') + '</div></div>' : '') +
      '<div class="fw-row"><span>마감</span><input type="date" class="b-input fw-date" value="' + esc(x.due_on) + '" onchange="FWF.steps[' + i + '].due_on=this.value"></div>' +
      (i ? '<div class="fw-row"><span>앞 단계</span><div class="fw-chips">' + FWF.steps.slice(0, i).map(function (y, j) { return '<button type="button" class="b-pick' + (x.after.indexOf(y.key) !== -1 ? ' on' : '') + '" onclick="fwAfter(' + i + ',\'' + y.key + '\')">' + (j + 1) + '번' + (y.title ? ' ' + esc(y.title.slice(0, 10)) : '') + '</button>'; }).join('') + '<small>' + (x.after.length ? '' : '바로 시작') + '</small></div></div>' : '') + '</div>';
  }).join('');
}
function fwDel(i) { var k = FWF.steps[i].key; FWF.steps.splice(i, 1); FWF.steps.forEach(function (x) { x.after = x.after.filter(function (a) { return a !== k; }); }); renderFwSteps(); }
function fwAfter(i, k) { var a = FWF.steps[i].after, j = a.indexOf(k); if (j === -1) a.push(k); else a.splice(j, 1); renderFwSteps(); }
function fwPDel(i, j) { FWF.steps[i].people.splice(j, 1); renderFwSteps(); }
function fwPush(x, p) { if (!x.people.some(function (q) { return p.person_id ? q.person_id === p.person_id : !q.person_id && q.name === p.name; })) x.people.push(p); }
function fwPAdd(i, sel) {
  var v = sel.value, x = FWF.steps[i]; sel.value = ''; if (!v) return;
  if (v === '@ext') { var n = (prompt('이름을 적어주세요 (앱에 없는 사람은 알림이 안 가고, 지시자가 대신 완료를 눌러요)') || '').trim().slice(0, 30); if (n) fwPush(x, { person_id: null, name: n }); }
  else if (v === '@staff') fwRoster().filter(function (m) { return m.rank >= RANK.INSTRUCTOR; }).forEach(function (m) { fwPush(x, { person_id: m.id, name: m.name }); });
  else { var m = fwRoster().filter(function (m) { return m.id === v; })[0]; if (m) fwPush(x, { person_id: m.id, name: m.name }); }
  renderFwSteps();
}
function saveFlow() {
  var title = $('fwTitle').value.trim(), steps = FWF.steps.filter(function (x) { return x.title.trim() || x.people.length; });
  if (!title) { setMsg('fwMsg', '작업 이름을 적어주세요', true); return; }
  if (!steps.length) { setMsg('fwMsg', '단계를 하나 이상 적어주세요', true); return; }
  var bad = steps.filter(function (x) { return !x.title.trim() || !x.people.length; })[0];
  if (bad) { setMsg('fwMsg', (FWF.steps.indexOf(bad) + 1) + '번 단계의 할 일과 담당을 채워주세요', true); return; }
  var btn = $('fwBtn'); btn.disabled = true; setMsg('fwMsg', '만드는 중...');
  var edit = FWF.editId;
  api(edit ? 'flow.update' : 'flow.create', { id: edit, team_id: S.team.id, title: title, note: $('fwNote').value, steps: steps.map(function (x) { return { id: x.id || null, key: x.key, title: x.title, detail: x.detail, due_on: x.due_on || null, done_rule: x.done_rule, after: x.after, people: x.people }; }) })
    .then(function () {
      haptic('success'); btn.disabled = false; FWF = { steps: [], n: FWF.n, editId: null }; $('fwTitle').value = ''; $('fwNote').value = '';
      setMsg('fwMsg', edit ? '고쳤어요!' : '만들었어요! 지금 차례인 담당자에게 알림을 보냈어요'); setTimeout(function () { closeModal('flowModal'); }, 1300); loadFlows();
    }).catch(function (err) { btn.disabled = false; setMsg('fwMsg', err.message, true); });
}
// ----- 붙여넣은 글 → 단계 초안 (AI 없이 규칙): 줄·문장·'하고/해서'로 나누고, '이후'·'~하고/~다가'로 끝나면 앞 단계에 이어 붙임 -----
// 날짜: 오늘/내일/모레, 10월 10일, 10/10, 17일(앞에 나온 달), 10월 안으로(그달 말). 담당: 제가=나, 교관님들, 명단 이름, 직책(과장님·팀장님), 없으면 나
var FW_VERB = /(제작|만들|보완|수정|찾|분류|정리|피드백|준비|녹음|편집|검토|작성|확인|도와|촬영|연습|업로드|전달|보내|배포|공유|컨펌|승인|받|운영|진행|완료|제출|안내|올리|섭외|예약|모집|점검|교육|발표|회의|정하|결정|설계|기획|테스트)/;
var FW_LINK_START = /^(이후|그\s*후|그\s*다음|다음에?|그\s*뒤|그리고|끝나면|마치면)\s*,?\s*/;
var FW_LINK_END = /(하고|해서|드려서|하다가|다가|한\s*뒤|한\s*후|고)\s*[,.]?\s*$/;
function fwYmd(y, m, d) { return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2); }
function fwDateOf(t, ctx) {
  if (/오늘/.test(t)) return todayStr(); if (/내일/.test(t)) return addDays(1); if (/모레/.test(t)) return addDays(2);
  var y = new Date().getFullYear(), now = todayStr(), m;
  var fix = function (d) { return d < now ? (y + 1) + d.slice(4) : d; };
  if ((m = t.match(/(\d{1,2})\s*(?:월|\/|\.)\s*(\d{1,2})\s*일?/))) { ctx.month = +m[1]; return fix(fwYmd(y, +m[1], +m[2])); }
  if ((m = t.match(/(\d{1,2})\s*월\s*(안|중|말|까지|내)/))) { ctx.month = +m[1]; return fix(fwYmd(y, +m[1], new Date(y, +m[1], 0).getDate())); }
  if ((m = t.match(/(?:^|[^\d월\/.])(\d{1,2})\s*일/))) { var mm = ctx.month || (new Date().getMonth() + 1); return fix(fwYmd(y, mm, +m[1])); }
  return '';
}
function fwClean(t) {
  return t.replace(/[\u{1F000}-\u{1FFFF}☀-➿️*()]/gu, ' ')
    .replace(FW_LINK_START, '')
    .replace(/[가-힣]{2,3}\s*(성우|교관|팀장|조장)?\s*님(께|에게)\s*공유\s*/g, ' ')
    .replace(/\d{1,2}\s*(월|\/|\.)\s*\d{1,2}\s*일?\s*(까지|에)?|\d{1,2}\s*월\s*(안으로|안에|중으로|중에|말까지|까지|내)|(^|\s)\d{1,2}\s*일\s*(까지|에)?/g, ' ')
    .replace(/(오늘|내일|모레)\s*(까지|중)?|제가|저는|혹시|교관님들|(연기\s*)?교관분들은?|추가적으로/g, ' ')
    .replace(/님께\s*/g, '님 ').replace(/\s*(을|를)?\s*받(겠습니다|을 예정|기로)?[\s.!]*$/, '')
    .replace(/(해나갈 예정입니다|할 예정입니다|예정입니다|예정|주시면 좋을 것 같습니다|좋을 것 같습니다|주실 수 있으실까요|수 있으실까요|해주세요|부탁드립니다|하겠습니다|겠습니다|합니다|입니다)[\s?!.~]*$/, '')
    .replace(/(하고|해서|드려서|하다가|다가)\s*[,.]?\s*$/, '')
    .replace(/\s+/g, ' ').replace(/^[,.\s]+|[,.\s]+$/g, '').slice(0, 40);
}
// 먼저 AI(flow.parse)로, 키가 없거나 실패하면 아래 규칙 방식(fwParseRules)으로
function fwParse() {
  var text = $('fwNote').value.trim(); if (!text) { setMsg('fwMsg', '원문을 먼저 붙여넣어 주세요', true); return; }
  var btn = document.querySelector('.fw-parse'); btn.disabled = true; setMsg('fwMsg', '✨ AI가 글을 읽고 단계를 나누는 중...');
  api('flow.parse', { team_id: S.team.id, text: text }).then(function (r) {
    btn.disabled = false;
    if (!r.steps.length) { setMsg('fwMsg', '단계를 찾지 못했어요. 직접 적어주세요', true); return; }
    FWF.steps = r.steps.map(function (x) { var y = fwNew(); y.key = x.key; y.title = x.title; y.detail = x.detail; y.due_on = x.due_on; y.done_rule = x.done_rule; y.after = x.after; y.people = x.people; return y; });
    if (!$('fwTitle').value.trim() && r.title) $('fwTitle').value = r.title;
    renderFwSteps(); setMsg('fwMsg', '✨ AI가 ' + r.steps.length + '단계를 뽑았어요. 담당·마감·앞 단계가 맞는지 확인해 주세요');
  }).catch(function (err) {
    btn.disabled = false;
    fwParseRules(text);
    if (FWF.steps.length) setMsg('fwMsg', (err.code === 'no_ai' ? '' : 'AI가 안 돼서(' + err.message + ') ') + '간단 규칙으로 ' + FWF.steps.length + '단계를 뽑았어요. 꼭 확인해 주세요');
  });
}
function fwParseRules(text) {
  var ro = fwRoster(), me = { person_id: S.me.profile.id, name: S.me.profile.name }, out = [], ctx = { month: 0 }, prev = null, chain = false;
  // 글 어딘가에 '이후·그 다음'이 있으면 순서대로 쓴 글로 보고 모든 단계를 앞 단계에 이음 (괄호로 덧붙인 건 빼고)
  var ordered = /(^|\s)(이후|그\s*다음|그\s*후|그\s*뒤)/m.test(text);
  var who = function (t) {
    var ps = [];
    if (/제가|저는/.test(t)) ps.push(me);
    if (/교관\s*(님들|분들)/.test(t)) ro.filter(function (m) { return m.rank >= RANK.INSTRUCTOR; }).forEach(function (m) { ps.push({ person_id: m.id, name: m.name }); });
    ro.forEach(function (m) { if (t.indexOf(m.name) !== -1 || (m.name.length === 3 && new RegExp(m.name.slice(1) + '\\s*(님|성우|교관|팀장|조장)').test(t))) ps.push({ person_id: m.id, name: m.name }); });
    // 직책으로 부르면 그 직책인 사람 (과장님·부과장님·팀장님…)
    var pm, pre = /(부과장|과장|부팀장|팀장|서무)\s*님/g;
    while ((pm = pre.exec(t))) { var pos = pm[1]; ro.filter(function (m) { return m.position === pos; }).forEach(function (m) { ps.push({ person_id: m.id, name: m.name }); }); }
    var re = /([가-힣]{2,3})\s*(?:성우|교관|팀장|조장)?\s*님(께|에게|이|은|는|,)/g, m;
    while ((m = re.exec(t))) if (!ps.some(function (p) { return p.name.slice(-2) === m[1].slice(-2); }) && !/^(교관|성우|팀장|조장|과장|부과장|부팀장|서무|교관님)$/.test(m[1])) ps.push({ person_id: null, name: m[1] });
    var seen = {}; return ps.filter(function (p) { var k = p.person_id || p.name; return seen[k] ? false : (seen[k] = true); });
  };
  text.split(/\n+|(?<=[.!?。])\s+/).forEach(function (sent) {
    sent = sent.trim(); if (!sent) { chain = false; return; }
    var linkNext = FW_LINK_END.test(sent), linkPrev = chain || FW_LINK_START.test(sent) || (ordered && !/^[(（]/.test(sent));
    var parts = sent.split(/(?:하고|해서|드려서|한 뒤|한 후|하다가)\s*,?\s+/);
    for (var i = 0; i < parts.length - 1; i++) if (/(께|에게)\s*\S*$/.test(parts[i]) && !FW_VERB.test(parts[i].replace(/공유/, ''))) { parts[i + 1] = parts[i] + ' ' + parts[i + 1]; parts[i] = ''; }
    var first = true;
    parts.forEach(function (c) {
      c = c.trim(); if (!c) return;
      var due = fwDateOf(c, ctx), title = fwClean(c);
      if (due && out.length && /^[(（]/.test(c)) { out[out.length - 1].due_on = out[out.length - 1].due_on || due; return; }
      if (!FW_VERB.test(c) && !due) return;
      if (/필요합니다/.test(c) && !who(c).length) return;
      if (!title) return;
      var x = fwNew(); x.title = title; x.due_on = due; x.people = who(c);
      if (!x.people.length) x.people = [me];   // 담당을 못 찾으면 글 쓴 사람 (고칠 수 있음)
      if (prev && (!first || linkPrev)) x.after = [prev.key];
      out.push(x); prev = x; first = false;
    });
    chain = linkNext;
  });
  if (!out.length) { FWF.steps = []; setMsg('fwMsg', '단계를 찾지 못했어요. 한 줄에 일 하나씩 적어 보거나 직접 적어주세요', true); return; }
  if (!$('fwTitle').value.trim()) $('fwTitle').value = out[0].title.slice(0, 30);
  FWF.steps = out; renderFwSteps();
  setMsg('fwMsg', out.length + '단계를 뽑았어요. 담당·마감·앞 단계가 맞는지 확인해 주세요');
}
