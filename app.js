// ===== 설정 =====
var API_URL = 'https://script.google.com/macros/s/AKfycbz5rjT76_NTywRcYDL5BOXKKbfaBZm-V3Fk82_0z5qngfTs2NUDueX0irFH5Uaqi7Hm/exec';
var DEFAULT_DURATION_HOURS = 3; // 끝나는 시간이 없으면 시작 후 3시간을 '진행 중'으로 봄

var TOKEN_KEY = 'authToken';
var identifiedPerson = null;
var tgInitData = '';
var meetingsCache = [];

var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ===== 텔레그램 연동 =====
var tg = (window.Telegram && Telegram.WebApp) ? Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#F4F1EC'); tg.setBackgroundColor('#F4F1EC'); } catch (e) {}
  tgInitData = tg.initData || ''; // 텔레그램이 서명한 원본 (서버가 진짜인지 검사함)
}
function haptic(type) {
  try { if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(type); } catch (e) {}
}

// ===== API 호출 =====
function callApi(action, params) {
  var url = API_URL + '?action=' + encodeURIComponent(action);
  if (params) {
    Object.keys(params).forEach(function(k) {
      url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    });
  }
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(json) {
      if (json.ok) return json.result;
      throw new Error(json.error || '알 수 없는 오류');
    });
}

// 로그인·저장은 POST로 (서버가 텔레그램 서명 또는 로그인 토큰으로 본인 확인)
function postApi(action, data) {
  var body = Object.assign({ action: action, initData: tgInitData, token: safeGetLocal(TOKEN_KEY) || '' }, data || {});
  return fetch(API_URL, { method: 'POST', body: JSON.stringify(body) })
    .then(function(res) { return res.json(); })
    .then(function(json) {
      if (json.ok) return json.result;
      if (/로그인이 필요/.test(json.error || '')) { safeRemoveLocal(TOKEN_KEY); showLoggedOut(); }
      throw new Error(json.error || '알 수 없는 오류');
    });
}

// ===== 저장소(이 폰 기억) =====
function safeGetLocal(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeSetLocal(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
function safeRemoveLocal(key) { try { localStorage.removeItem(key); } catch (e) {} }
// 예전 방식(이름만 기억)으로 저장된 값 정리
safeRemoveLocal('myPersonId'); safeRemoveLocal('myPersonName');

// ===== 탭 이동 =====
function goTab(name) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-tab') === name);
  });
  window.scrollTo(0, 0);
}

// ===== 슬라이드 메뉴 =====
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('overlay').classList.add('show');
  document.getElementById('drawer').setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  document.getElementById('drawer').setAttribute('aria-hidden', 'true');
}
function openMenuPage(name) {
  closeDrawer();
  setTimeout(function() { goTab(name); }, 180);
}
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeDrawer(); });

// 오른쪽으로 쓸어서 메뉴 닫기
(function enableSwipeClose() {
  var startX = null;
  var drawer = document.getElementById('drawer');
  drawer.addEventListener('touchstart', function(e) { startX = e.touches[0].clientX; }, { passive: true });
  drawer.addEventListener('touchend', function(e) {
    if (startX !== null && e.changedTouches[0].clientX - startX > 60) closeDrawer();
    startX = null;
  });
})();

// 프로필 안의 인적사항 / 실무 참여 전환
function switchSub(name) {
  document.querySelectorAll('.subtab').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-sub') === name); });
  document.querySelectorAll('.sub').forEach(function(c) { c.classList.toggle('active', c.id === 'sub-' + name); });
}

// 공지 작성 폼 열고 닫기
function toggleNoticeForm() {
  var f = document.getElementById('noticeForm');
  var open = !f.classList.contains('open');
  f.classList.toggle('open', open);
  document.getElementById('noticeChev').classList.toggle('up', open);
  if (open && document.getElementById('noticeTypeSelect').options.length === 0) loadMeetingTypes();
}

// ===== 날짜 처리 =====
// 서버가 주는 "9/25(금) 15:37" 또는 "9/19(토) 10:00~13:00" 형식을 날짜로 바꿈
function parseMeeting(m) {
  var s = String(m.datetime || '');
  var r = s.match(/(\d{1,2})\/(\d{1,2})[^\d]*(\d{1,2}):(\d{2})(?:\s*~\s*(\d{1,2}):(\d{2}))?/);
  if (!r) return null;
  var now = new Date();
  var year = now.getFullYear();
  var start = new Date(year, Number(r[1]) - 1, Number(r[2]), Number(r[3]), Number(r[4]));
  // 연말에 내년 1월 모임을 등록한 경우 보정
  if (start.getTime() < now.getTime() - 180 * 24 * 3600 * 1000) start.setFullYear(year + 1);
  var end;
  if (r[5]) {
    end = new Date(start.getTime());
    end.setHours(Number(r[5]), Number(r[6]));
  } else {
    end = new Date(start.getTime() + DEFAULT_DURATION_HOURS * 3600 * 1000);
  }
  return { start: start, end: end, hasEnd: !!r[5] };
}

function pad(n) { return (n < 10 ? '0' : '') + n; }
function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

function ddayText(start) {
  var a = new Date(); a.setHours(0, 0, 0, 0);
  var b = new Date(start.getTime()); b.setHours(0, 0, 0, 0);
  var diff = Math.round((b - a) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  return 'D-' + diff;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ===== 대시보드 그리기 =====
function renderDashboard() {
  var now = new Date();
  var ongoing = [], upcoming = [], unknown = [];

  meetingsCache.forEach(function(m) {
    var t = parseMeeting(m);
    if (!t) { unknown.push(m); return; }
    m._t = t;
    if (t.start <= now && now < t.end) ongoing.push(m);
    else if (t.start > now) upcoming.push(m);
  });
  upcoming.sort(function(a, b) { return a._t.start - b._t.start; });

  // 요약 숫자
  document.getElementById('statNow').innerHTML = ongoing.length + '<small>건</small>';
  document.getElementById('statUpcoming').innerHTML = (upcoming.length + unknown.length) + '<small>건</small>';
  document.getElementById('statNext').textContent = upcoming.length ? ddayText(upcoming[0]._t.start) : '–';
  document.getElementById('liveDot').classList.toggle('on', ongoing.length > 0);

  // 진행 중
  var nowArea = document.getElementById('nowArea');
  if (ongoing.length === 0) {
    nowArea.innerHTML = '<div class="empty"><b>지금 진행 중인 모임이 없어요</b>' +
      (upcoming.length ? '다음 모임은 ' + (upcoming[0]._t.start.getMonth() + 1) + '/' + upcoming[0]._t.start.getDate() +
        ' ' + hm(upcoming[0]._t.start) + ' ' + escapeHtml(upcoming[0].typeName) + '이에요' : '예정된 모임도 아직 없어요') +
      '</div>';
  } else {
    nowArea.innerHTML = ongoing.map(function(m) {
      var total = m._t.end - m._t.start;
      var pct = Math.max(0, Math.min(100, Math.round((now - m._t.start) / total * 100)));
      return '<div class="hero">' +
        '<span class="hero-chip"><i></i>진행 중</span>' +
        '<div class="hero-title">' + escapeHtml(m.typeName) + '</div>' +
        '<div class="hero-time">' + hm(m._t.start) + ' ~ ' + hm(m._t.end) + (m._t.hasEnd ? '' : ' (예상)') + '</div>' +
        '<div class="hero-meta">' +
          '<span>📍 ' + escapeHtml(m.place || '장소 미정') + '</span>' +
          (m.host ? '<span>🎙 ' + escapeHtml(m.host) + '</span>' : '') +
        '</div>' +
        '<div class="progress"><div style="width:' + pct + '%"></div></div>' +
        '<div class="progress-label"><span>시작 ' + hm(m._t.start) + '</span><span>' + pct + '%</span></div>' +
        '<button class="hero-btn" onclick="attendFor(\'' + escapeHtml(m.id) + '\')">지금 출결하기</button>' +
      '</div>';
    }).join('');
  }

  // 예정
  document.getElementById('upcomingCount').textContent = (upcoming.length + unknown.length) ? (upcoming.length + unknown.length) + '건' : '';
  var upArea = document.getElementById('upcomingArea');
  var list = upcoming.concat(unknown);
  if (list.length === 0) {
    upArea.innerHTML = '<div class="empty"><b>예정된 일정이 없어요</b>새 모임이 등록되면 여기에 보여요</div>';
    return;
  }
  upArea.innerHTML = list.map(function(m, i) { return eventCard(m, i === 0 && !!m._t); }).join('');
}

function eventCard(m, isNext) {
    var t = m._t;
    var dateBlock = t
      ? '<div class="m">' + (t.start.getMonth() + 1) + '월</div><div class="d">' + t.start.getDate() + '</div><div class="w">' + WEEKDAYS[t.start.getDay()] + '요일</div>'
      : '<div class="d">?</div>';
    return '<div class="event' + (isNext ? ' next' : '') + '">' +
      '<div class="date-block">' + dateBlock + '</div>' +
      '<div class="event-body">' +
        '<div class="event-top">' +
          (t ? '<span class="chip dday">' + ddayText(t.start) + '</span>' : '') +
          '<span class="chip">' + escapeHtml(m.status || '예정') + '</span>' +
        '</div>' +
        '<div class="event-title">' + escapeHtml(m.typeName) + '</div>' +
        '<div class="event-meta">' + (t ? hm(t.start) : escapeHtml(m.datetime)) +
          ' · ' + escapeHtml(m.place || '장소 미정') + (m.host ? ' · ' + escapeHtml(m.host) : '') + '</div>' +
      '</div>' +
      '<button class="event-go" onclick="attendFor(\'' + escapeHtml(m.id) + '\')">출결</button>' +
    '</div>';
}

// 공지 탭: 등록된 모임 공지 전체 (진행 중 + 예정)
function renderNoticeList() {
  var list = meetingsCache.slice().sort(function(a, b) {
    return (a._t ? a._t.start : Infinity) - (b._t ? b._t.start : Infinity);
  });
  document.getElementById('noticeCount').textContent = list.length ? list.length + '건' : '';
  document.getElementById('noticeList').innerHTML = list.length
    ? list.map(function(m, i) { return eventCard(m, i === 0 && !!m._t); }).join('')
    : '<div class="empty"><b>등록된 공지가 없어요</b>새 모임이 등록되면 여기에 보여요</div>';
}

// 카드에서 '출결' 누르면 출결 탭으로 이동 + 그 모임 자동 선택
function attendFor(meetingId) {
  document.getElementById('classSelect').value = meetingId;
  goTab('attend');
}

// ===== 모임 목록 =====
function loadMeetings() {
  var sel = document.getElementById('classSelect');
  return callApi('getUpcomingMeetings').then(function(meetings) {
    meetingsCache = meetings || [];
    sel.innerHTML = '';
    meetingsCache.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = '[' + c.typeName + '] ' + c.datetime + ' · ' + (c.place || '');
      sel.appendChild(opt);
    });
    if (!meetingsCache.length) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '출결할 모임이 없어요';
      sel.appendChild(opt);
    }
    renderDashboard();
    renderNoticeList();
  }).catch(function(err) {
    document.getElementById('nowArea').innerHTML = '<div class="empty"><b>모임을 불러오지 못했어요</b>잠시 후 다시 열어주세요</div>';
    document.getElementById('upcomingArea').innerHTML = '';
    document.getElementById('debug').textContent = '모임목록 오류: ' + err.message;
  });
}

// ===== 본인 인식 =====
function setIdentity(person, roles) {
  identifiedPerson = person;
  document.getElementById('greeting').textContent = person.name + '님, 반가워요 👋';
  var short = String(person.name || '?').slice(-2);
  document.getElementById('avatar').textContent = short;
  document.getElementById('drawerAvatar').textContent = short;
  document.getElementById('profileAvatar').textContent = short;
  document.getElementById('drawerName').textContent = person.name;
  document.getElementById('profileName').textContent = person.name;
  document.getElementById('profileRole').textContent = '방송예술과';
  var w = document.getElementById('welcome');
  w.style.display = 'flex';
  w.innerHTML = '<span>' + escapeHtml(person.name) + '님으로 제출돼요</span><a href="#" onclick="forgetMe();return false;">저 아니에요</a>';
  document.getElementById('loginBlock').style.display = 'none';
  document.getElementById('attendForm').style.display = 'block';
  document.getElementById('loginItem').style.display = 'none';
  document.getElementById('logoutItem').style.display = 'flex';
  applyRoles(roles);
}

function applyRoles(r) {
  if (!r) return;
  document.getElementById('adminCard').style.display = r.isAdmin ? 'block' : 'none';
  if (r.roles && r.roles.length) document.getElementById('profileRole').textContent = '방송예술과 · ' + r.roles.join(', ');
}

function showLoggedOut() {
  identifiedPerson = null;
  document.getElementById('greeting').textContent = '반가워요 👋';
  ['avatar', 'drawerAvatar', 'profileAvatar'].forEach(function(id) { document.getElementById(id).textContent = '?'; });
  document.getElementById('drawerName').textContent = '게스트';
  document.getElementById('profileName').textContent = '로그인이 필요해요';
  document.getElementById('profileRole').textContent = '출결 탭에서 이름과 인증코드로 로그인하세요';
  document.getElementById('loginBlock').style.display = 'block';
  document.getElementById('attendForm').style.display = 'none';
  document.getElementById('loginItem').style.display = 'flex';
  document.getElementById('logoutItem').style.display = 'none';
  hideAdminUI();
}

// 앱을 열면: 텔레그램 서명 또는 저장된 토큰으로 자동 로그인 시도
function autoLogin() {
  return postApi('whoami').then(function(r) {
    if (r.person) setIdentity(r.person, r.roles);
    else showLoggedOut();
  }).catch(function() { showLoggedOut(); });
}

function doLogin() {
  var personId = document.getElementById('personSelect').value;
  var code = document.getElementById('authCode').value.trim();
  if (!personId) { setMsg('loginMsg', '이름을 선택해주세요!', true); return; }
  if (!code) { setMsg('loginMsg', '인증코드를 입력해주세요!', true); return; }
  var btn = document.getElementById('loginBtn');
  btn.disabled = true;
  setMsg('loginMsg', '확인 중...');
  postApi('login', { personId: personId, code: code }).then(function(r) {
    safeSetLocal(TOKEN_KEY, r.token);
    document.getElementById('authCode').value = '';
    setMsg('loginMsg', '');
    haptic('success');
    setIdentity(r.person, r.roles);
    btn.disabled = false;
  }).catch(function(err) {
    setMsg('loginMsg', err.message, true);
    haptic('error');
    btn.disabled = false;
  });
}

// 로그아웃 (텔레그램 연결도 해제 → 다음에 다시 인증코드 필요)
function forgetMe() {
  closeDrawer();
  postApi('logout').catch(function() {});
  safeRemoveLocal(TOKEN_KEY);
  showLoggedOut();
  goTab('attend');
}

function currentPersonId() { return identifiedPerson ? identifiedPerson.id : ''; }

// ===== 교관 이상 메뉴 =====
function hideAdminUI() {
  document.getElementById('adminCard').style.display = 'none';
}

// ===== 과 대시보드 (모두 같은 화면) =====
var dashData = null;
var teamFilter = '';
var TASK_ICON = { '녹음': '🎙', '사회': '🎤', '촬영': '🎥', '음향편집': '🎚' };

function loadDashboard() {
  return callApi('getDashboard', { personId: currentPersonId() }).then(function(d) {
    dashData = d;
    renderManager();
  }).catch(function(err) {
    document.getElementById('scheduleArea').innerHTML = '<div class="empty"><b>대시보드를 불러오지 못했어요</b>' + escapeHtml(err.message) + '</div>';
    ['taskNowArea', 'taskUpArea', 'projectArea'].forEach(function(id) { document.getElementById(id).innerHTML = ''; });
  });
}

function mdw(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAYS[d.getDay()] + ')'; }
function hmMs(ms) { return hm(new Date(ms)); }
function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }

function renderManager() {
  var d = dashData;
  if (!d) return;
  document.getElementById('dStatNow').innerHTML = d.tasksNow.length + '<small>건</small>';
  document.getElementById('dStatUp').innerHTML = d.tasksUpcoming.length + '<small>건</small>';
  document.getElementById('dStatProj').innerHTML = d.projects.length + '<small>개</small>';
  document.getElementById('taskLiveDot').classList.toggle('on', d.tasksNow.length > 0);

  // 0. 사명자 일정 (표)
  var sa = document.getElementById('scheduleArea');
  if (!d.schedules.length) {
    sa.innerHTML = '<div class="empty"><b>2주 안에 등록된 일정이 없어요</b>\'사명자일정\' 시트에 입력하면 여기에 보여요</div>';
  } else {
    var today = Date.now(), prevDay = null;
    sa.innerHTML = '<table class="sched"><thead><tr><th>날짜·시간</th><th>일정</th><th>주관자</th><th>참여자</th></tr></thead><tbody>' +
      d.schedules.map(function(r) {
        var showDate = prevDay === null || !sameDay(prevDay, r.start);
        prevDay = r.start;
        return '<tr class="' + (sameDay(r.start, today) ? 'today' : '') + '">' +
          '<td class="c-date">' + (showDate ? mdw(r.start) : '') +
            '<span class="c-time">' + hmMs(r.start) + (r.end ? '~' + hmMs(r.end) : '') + '</span></td>' +
          '<td class="c-what"><b>' + escapeHtml(r.title) + '</b><span>' +
            escapeHtml([r.category, r.place].filter(Boolean).join(' · ')) + '</span></td>' +
          '<td class="c-who"><b>' + escapeHtml(r.name) + '</b><span>' + escapeHtml(r.role) + '</span></td>' +
          '<td class="c-part">' + (r.participants ? escapeHtml(r.participants) : '–') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  // 1. 진행 중 업무
  document.getElementById('taskNowArea').innerHTML = d.tasksNow.length
    ? d.tasksNow.map(function(t) { return taskCard(t, true); }).join('')
    : '<div class="empty"><b>지금 진행 중인 업무가 없어요</b>녹음·사회·촬영·음향편집이 시작되면 여기에 떠요</div>';

  // 2. 예정 업무 (팀 필터)
  var ups = d.tasksUpcoming.filter(function(t) { return !teamFilter || t.team === teamFilter; });
  document.getElementById('taskUpCount').textContent = ups.length + '건';
  document.getElementById('taskUpArea').innerHTML = ups.length
    ? ups.map(function(t) { return taskCard(t, false); }).join('')
    : '<div class="empty"><b>예정된 업무가 없어요</b>' + (teamFilter ? teamFilter + ' 업무가 없어요' : '\'업무\' 시트에 입력하면 여기에 보여요') + '</div>';

  // 3. 진행 중 프로젝트
  document.getElementById('projCount').textContent = d.projects.length + '개';
  document.getElementById('projectArea').innerHTML = d.projects.length
    ? d.projects.map(projectCard).join('')
    : '<div class="empty"><b>진행 중인 프로젝트가 없어요</b></div>';
}

function taskCard(t, live) {
  var when = t.start ? '<b>' + (live ? hmMs(t.start) : ddayText(new Date(t.start))) + '</b>' + (live ? (t.end ? '~' + hmMs(t.end) : '') : mdw(t.start) + ' ' + hmMs(t.start)) : '<b>미정</b>';
  return '<div class="tcard' + (live ? ' live' : '') + '">' +
    '<div class="t-icon">' + (TASK_ICON[t.type] || '📌') + '</div>' +
    '<div class="t-body">' +
      '<div class="t-top">' +
        (t.type ? '<span class="chip' + (live ? '' : ' dark') + '">' + escapeHtml(t.type) + '</span>' : '') +
        (t.team ? '<span class="chip">' + escapeHtml(t.team) + '</span>' : '') +
      '</div>' +
      '<div class="t-title">' + escapeHtml(t.title) + '</div>' +
      '<div class="t-meta">' + escapeHtml([t.owner && '담당 ' + t.owner, t.place, t.dept && '요청 ' + t.dept].filter(Boolean).join(' · ')) + '</div>' +
    '</div>' +
    '<div class="t-when">' + when + '</div>' +
  '</div>';
}

function projectCard(p) {
  return '<div class="pcard">' +
    '<div class="p-top">' +
      '<span class="chip dark">' + escapeHtml(p.channel || '프로젝트') + '</span>' +
      (p.due ? '<span class="p-due">마감 ' + mdw(p.due) + ' · ' + ddayText(new Date(p.due)) + '</span>' : '<span class="p-due">' + escapeHtml(p.status) + '</span>') +
    '</div>' +
    '<div class="p-title">' + escapeHtml(p.title) + '</div>' +
    (p.desc ? '<div class="p-desc">' + escapeHtml(p.desc) + '</div>' : '') +
    '<div class="p-people">' +
      '<span>담당<b>' + escapeHtml(p.owner || '미정') + '</b></span>' +
      (p.mc ? '<span>MC<b>' + escapeHtml(p.mc) + '</b></span>' : '') +
    '</div>' +
    (p.progress !== null && p.progress !== undefined ? '<div class="p-bar"><div style="width:' + Math.min(100, p.progress) + '%"></div></div>' : '') +
  '</div>';
}

document.getElementById('teamFilter').addEventListener('click', function(e) {
  var b = e.target.closest('.fchip');
  if (!b) return;
  teamFilter = b.getAttribute('data-team');
  document.querySelectorAll('.fchip').forEach(function(x) { x.classList.toggle('active', x === b); });
  renderManager();
});

function loadMeetingTypes() {
  callApi('getMeetingTypesForNotice').then(function(types) {
    var sel = document.getElementById('noticeTypeSelect');
    sel.innerHTML = '';
    types.forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
  }).catch(function(err) {
    setMsg('adminMsg', '오류: ' + err.message, true);
  });
}

function setMsg(id, text, isErr) {
  var el = document.getElementById(id);
  el.textContent = text;
  el.classList.toggle('err', !!isErr);
}

// ===== 인물 목록 불러오기 =====
function loadPeople() {
  return callApi('getPeople').then(function(people) {
    var sel = document.getElementById('personSelect');
    sel.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '이름을 선택하세요';
    sel.appendChild(placeholder);
    people.forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  }).catch(function(err) {
    document.getElementById('debug').textContent += '\n인물목록 오류: ' + err.message;
  });
}

// ===== 출결 제출 =====
function submitForm() {
  var classId = document.getElementById('classSelect').value;

  if (!identifiedPerson) { showLoggedOut(); return; }
  if (!classId) { setMsg('msg', '출결할 모임을 선택해주세요!', true); return; }

  var status = document.querySelector('input[name="status"]:checked').value;
  var reason = document.getElementById('reason').value;
  if (status !== '참석' && !reason.trim()) { setMsg('msg', status + ' 사유를 적어주세요!', true); return; }

  var btn = document.getElementById('submitBtn');
  btn.disabled = true;
  setMsg('msg', '제출 중...');

  postApi('submitAttendance', { classId: classId, status: status, reason: reason }).then(function() {
    setMsg('msg', '제출 완료! 수고하셨어요 🙌');
    haptic('success');
    btn.disabled = false;
    document.getElementById('reason').value = '';
  }).catch(function(err) {
    setMsg('msg', '오류: ' + err.message, true);
    haptic('error');
    btn.disabled = false;
  });
}

// ===== 모임 공지 저장 =====
function submitNotice() {
  var typeId = document.getElementById('noticeTypeSelect').value;
  var datetime = document.getElementById('noticeDatetime').value;
  var place = document.getElementById('noticePlace').value;

  if (!typeId || !datetime || !place) { setMsg('adminMsg', '모든 정보를 입력해주세요!', true); return; }

  var btn = document.getElementById('noticeSubmitBtn');
  btn.disabled = true;
  setMsg('adminMsg', '저장 중...');

  postApi('createMeeting', { typeId: typeId, datetime: datetime, place: place }).then(function() {
    setMsg('adminMsg', '저장 완료!');
    haptic('success');
    btn.disabled = false;
    document.getElementById('noticeDatetime').value = '';
    document.getElementById('noticePlace').value = '';
    loadMeetings();
    setTimeout(function() { setMsg('adminMsg', ''); toggleNoticeForm(); }, 1200);
  }).catch(function(err) {
    setMsg('adminMsg', '오류: ' + err.message, true);
    haptic('error');
    btn.disabled = false;
  });
}

// ===== 시작 =====
(function init() {
  var d = new Date();
  document.getElementById('todayText').textContent =
    d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + WEEKDAYS[d.getDay()] + '요일';
  loadMeetings();
  // 메뉴 맨 아래에 텔레그램 연결 상태 표시 (문제 확인용)
  var foot = document.querySelector('.drawer-foot');
  if (foot) {
    foot.textContent = '방송예술과 미니앱 · ' + (tg && tgInitData
      ? '텔레그램 서명 ✓ (' + (tg.platform || '?') + ' v' + (tg.version || '?') + ')'
      : '텔레그램 서명 없음' + (tg ? ' (' + (tg.platform || 'unknown') + ')' : ''));
  }
  loadPeople();
  autoLogin();
  loadDashboard();
  setInterval(renderDashboard, 60 * 1000); // 1분마다 진행 중/예정 다시 계산
  setInterval(loadDashboard, 5 * 60 * 1000); // 5분마다 대시보드 새로고침
})();
