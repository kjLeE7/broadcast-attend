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
function showState(title, desc) {
  $('loginBox').style.display = 'none';
  $('stateBox').style.display = 'block';
  $('stateBox').innerHTML = '<b>' + esc(title) + '</b>' + esc(desc || '');
  ['homeView', 'listView', 'detailView', 'reportView', 'noticeView', 'taskView', 'weeklyView'].forEach(function (id) { $(id).style.display = 'none'; });
}

// ---------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------
// 봇 알림의 '출결 체크하기' 버튼으로 열면 주소에 ?s=모임id 가 붙어 옴
var DEEP_SESSION = (function () { try { return new URLSearchParams(location.search).get('s'); } catch (e) { return null; } })();
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
    setupTownTab();
    document.body.classList.add('b-nav');
    renderTeamTabs();
    if (DEEP_SESSION) openDeepSession(DEEP_SESSION);
    else { if (curTab === 'home') $('teamTabs').style.display = 'none'; selectTeam(me.teams[0].id); }
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
  ['stateBox', 'homeView', 'listView', 'detailView', 'reportView', 'weeklyView', 'noticeView', 'taskView', 'teamTabs'].forEach(function (id) { $(id).style.display = 'none'; });
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
  S.members = null; S.types = []; S.sessions = []; S.current = null;
  M.board = null; M.open = null; stopBoardTimer(); R.data = null; R.open = null;
  N.list = null; A.list = null; A.current = null; C.list = []; dashData = null;
  document.querySelectorAll('#teamTabs .subtab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-team') === id); });
  showState('불러오는 중...', S.team.name + ' 정보를 가져오고 있어요');
  return loadTeam().then(function () {
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
  var lead = S.team.rank >= RANK.GROUP_LEADER;
  $('createCard').style.display = lead ? 'block' : 'none';
  $('ciCreateCard').style.display = S.team.rank >= RANK.INSTRUCTOR ? 'block' : 'none';
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
  var target = s.target_unit_id ? ' · ' + esc(groupName(s.target_unit_id)) : '';
  var selected = S.current && S.current.id === s.id;
  return '<button class="b-session' + (s.session_date < todayStr() ? ' b-past' : '') + (ph === 'cancel' ? ' b-cancel' : '') + (selected ? ' b-sel' : '') + '" onclick="openSession(\'' + esc(s.id) + '\')">' +
    '<div class="b-date' + (s.session_date === todayStr() ? ' today' : '') + '"><b>' + d.getDate() + '</b><span>' + (d.getMonth() + 1) + '월 ' + WD[d.getDay()] + '</span></div>' +
    '<div class="b-info"><b>' + esc(sessionName(s)) + '</b><span>' + esc(timePlace(s) || '시간·장소 미정') + target + tag + '</span></div>' +
    '<div class="b-side">' + side + '</div></button>';
}

// ---------------------------------------------------------------------
// 모임 만들기 (조장 이상) — 만들면 대상자에게 봇 알림
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
    location: $('cPlace').value.trim() || null,
    target_unit_id: $('cTarget').value || null,
    notify: $('cNotify').checked
  };
  if (!p.meeting_type_id && !p.title) { setMsg('cMsg', '모임 유형을 고르거나 제목을 적어주세요!', true); return; }
  if (!p.session_date) { setMsg('cMsg', '날짜를 골라주세요!', true); return; }
  if (!p.start_time) { setMsg('cMsg', '시작 시간을 넣어주세요! 지각을 판단하는 기준이 돼요.', true); return; }
  if (p.end_time && p.end_time <= p.start_time) { setMsg('cMsg', '끝나는 시간이 시작보다 늦어야 해요!', true); return; }
  var btn = $('cBtn'); btn.disabled = true; setMsg('cMsg', p.notify ? '만들고 알림 보내는 중...' : '만드는 중...');
  api('sessions.create', p).then(function (s) {
    Object.assign(s, {
      start_ms: kstMs(s.session_date, s.start_time), end_ms: s.end_time ? kstMs(s.session_date, s.end_time) : kstMs(s.session_date, s.start_time) + 3 * 3600000,
      target_count: targetMembersCount(s.target_unit_id), is_target: false,
      planned: { 참석: 0, 지각: 0, 불참: 0 }, final: { 참석: 0, 지각: 0, 불참: 0, 조퇴: 0 }, mine: null
    });
    S.sessions.push(s);
    S.sessions.sort(function (a, b) { return a.session_date + (a.start_time || '') < b.session_date + (b.start_time || '') ? -1 : 1; });
    ['cTitle', 'cStart', 'cEnd', 'cPlace'].forEach(function (id) { $(id).value = ''; });
    $('cType').value = ''; $('cTarget').value = '';
    btn.disabled = false;
    haptic('success');
    renderList();
    setMsg('cMsg', '만들었어요!' + (s.notify ? '\n' + notifyText(s.notify) : ''));
    setTimeout(function () { setMsg('cMsg', ''); toggleCreate(); }, s.notify && s.notify.failed.length ? 6000 : 1500);
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
  ['board', 'boardChips', 'boardActs'].forEach(function (k) { $(k).innerHTML = ''; });
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

function renderDetail() { renderHead(); renderMine(); renderBoard(); renderActs(); }

function renderHead() {
  var s = S.current, d = parseDate(s.session_date), ph = phaseOf(s);
  var tag = { cancel: '<span class="st st-취소">취소</span>', closed: '<span class="chip">마감</span>',
    live: '<span class="chip dark">진행 중</span>', before: '<span class="chip">예정</span>' }[ph];
  var lead = S.team.rank >= RANK.GROUP_LEADER;
  var nr = s.notify_result;
  $('dHead').innerHTML = '<div class="b-dhead"><h1>' + esc(sessionName(s)) + '</h1><p>' +
    (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')' + (timePlace(s) ? ' · ' + esc(timePlace(s)) : '') + '</p>' +
    '<div class="b-chips">' + tag + '<span class="chip">' + (s.target_unit_id ? esc(groupName(s.target_unit_id)) : esc(S.team.name) + ' 전체') + '</span>' +
    (M.board && M.board.grace_min ? '<span class="chip">시작 후 ' + M.board.grace_min + '분까지 참석</span>' : '') + '</div>' +
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
var VIEWS = { home: 'homeView', town: 'townView', attend: 'attendWrap', notice: 'noticeView', task: 'taskView', weekly: 'weeklyView' };
function goTab(t) {
  if (t === curTab) return;
  if (curTab === 'weekly' && W.dirty && !confirm('저장하지 않은 칸이 있어요. 그래도 넘어갈까요?')) return;
  setTabUI(t);
  $('stateBox').style.display = 'none';
  S.current = null; stopBoardTimer();
  try { if (tg && tg.BackButton) tg.BackButton.hide(); } catch (e) {}
  refreshTab();
  window.scrollTo(0, 0);
}
function setTabUI(t) {
  curTab = t;
  document.querySelectorAll('#tabbar .tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === t); });
  Object.keys(VIEWS).forEach(function (k) { $(VIEWS[k]).style.display = k === t ? '' : 'none'; });
  $('teamTabs').style.display = t !== 'weekly' && t !== 'home' && t !== 'town' && S.me && S.me.teams.length > 1 ? 'flex' : 'none';
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

// ----- PC 왼쪽 메뉴 접기/펴기 (이 브라우저에 기억) -----
function applyNav(mini) {
  document.body.classList.toggle('nav-mini', mini);
  var b = $('navToggle'); if (!b) return;
  var label = mini ? '메뉴 펴기' : '메뉴 접기';
  b.title = label; b.setAttribute('aria-label', label);
  b.querySelector('span').textContent = label;
}
function toggleNav() {
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
// 동네지도 탭은 PC에서만 보임
function setupTownTab() {
  if (isPhone()) return;
  $('townTab').style.display = '';
  $('tabbar').style.gridTemplateColumns = 'repeat(6, 1fr)';   // 좁은 PC 창의 아래 탭 6칸
}
function startTown() {
  if (!window.Town || isPhone() || !S.team) return;
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
