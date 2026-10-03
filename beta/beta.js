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
    var g = m.group || '조 없음';
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

// 텔레그램 뒤로가기 버튼: 모임 상세에서 누르면 목록으로
if (tg && tg.BackButton) {
  tg.BackButton.onClick(function () { if (S.current) showList(); });
  var _open = openSession, _list = showList;
  openSession = function (id) { _open(id); try { tg.BackButton.show(); } catch (e) {} };
  showList = function () { _list(); try { tg.BackButton.hide(); } catch (e) {} };
}

boot();
