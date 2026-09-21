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
// 텔레그램 스크립트가 서명을 못 읽었을 때를 대비해 주소(#tgWebAppData=…)와 저장값에서 직접 찾아봄
var tgSource = tgInitData ? 'sdk' : '';
if (!tgInitData) {
  try {
    var hp = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    if (hp.get('tgWebAppData')) { tgInitData = hp.get('tgWebAppData'); tgSource = 'hash'; }
  } catch (e) {}
}
if (!tgInitData) {
  try {
    var saved = JSON.parse(sessionStorage.getItem('__telegram__initParams') || '{}');
    if (saved.tgWebAppData) { tgInitData = saved.tgWebAppData; tgSource = 'saved'; }
  } catch (e) {}
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
  return fetchJsonRetry(function() { return fetch(url); }, 3)
    .then(function(json) {
      if (json.ok) return json.result;
      throw new Error(json.error || '알 수 없는 오류');
    });
}

// 구글 서버가 가끔 데이터 대신 오류 페이지를 돌려줄 때 잠깐 쉬었다가 다시 시도
function fetchJsonRetry(doFetch, tries) {
  return doFetch()
    .then(function(res) { return res.text(); })
    .then(function(text) { return JSON.parse(text); })
    .catch(function(err) {
      if (tries <= 1) throw new Error('서버 연결이 불안정해요. 잠시 후 다시 시도해주세요.');
      return new Promise(function(r) { setTimeout(r, 900); }).then(function() { return fetchJsonRetry(doFetch, tries - 1); });
    });
}

// 로그인·저장은 POST로 (서버가 텔레그램 서명 또는 로그인 토큰으로 본인 확인)
function postApi(action, data) {
  var body = Object.assign({ action: action, initData: tgInitData, token: safeGetLocal(TOKEN_KEY) || '' }, data || {});
  // 저장 요청은 두 번 들어가면 안 되니 재시도 안 함 (조회·로그인 확인만 재시도)
  var tries = (action === 'whoami') ? 3 : 1;
  return fetchJsonRetry(function() { return fetch(API_URL, { method: 'POST', body: JSON.stringify(body) }); }, tries)
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

// ===== 모임 카드 (공지 탭) =====
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
  return callApi('getUpcomingMeetings').then(function(meetings) {
    meetingsCache = meetings || [];
    meetingsCache.forEach(function(m) { m._t = parseMeeting(m); });
    renderNoticeList();
  }).catch(function(err) {
    document.getElementById('noticeList').innerHTML = '<div class="empty"><b>모임을 불러오지 못했어요</b>잠시 후 다시 열어주세요</div>';
    document.getElementById('debug').textContent = '모임목록 오류: ' + err.message;
  });
}

// ===== 출결 대상 (내 팀의 모임 + 업무, 로그인 후) =====
function loadAttendTargets() {
  var sel = document.getElementById('classSelect');
  if (!identifiedPerson) return;
  sel.innerHTML = '<option value="">불러오는 중...</option>';
  return postApi('getMyAttendTargets').then(function(list) {
    sel.innerHTML = '';
    if (!list.length) {
      sel.innerHTML = '<option value="">우리 팀에 출결할 모임·업무가 없어요</option>';
      return;
    }
    ['모임', '업무'].forEach(function(kind) {
      var items = list.filter(function(t) { return t.kind === kind; });
      if (!items.length) return;
      var g = document.createElement('optgroup');
      g.label = kind;
      items.forEach(function(t) {
        var opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.label;
        g.appendChild(opt);
      });
      sel.appendChild(g);
    });
  }).catch(function(err) {
    sel.innerHTML = '<option value="">목록을 불러오지 못했어요</option>';
  });
}

// ===== 체크인 (기상·출발·도착) =====
var CI_EMOJI = { '기상': '☀️', '출발': '🚗', '도착': '📍' };
var myCheckins = [];

function loadMyCheckins() {
  if (!identifiedPerson) return;
  postApi('getMyCheckins').then(function(list) {
    myCheckins = list || [];
    renderMyCheckins();
  }).catch(function() {});
}

function renderMyCheckins() {
  var area = document.getElementById('checkinArea');
  if (!identifiedPerson || !myCheckins.length) { area.innerHTML = ''; return; }
  area.innerHTML = myCheckins.map(function(c) {
    return '<div class="ci-card">' +
      '<div class="ci-head"><span class="hero-chip"><i></i>오늘의 체크인</span><b>' + escapeHtml(c.title) + '</b></div>' +
      '<div class="ci-btns">' + c.items.map(function(it) {
        var m = c.mine[it];
        return '<button class="ci-btn' + (m ? ' done' : '') + '" onclick="tapCheckin(\'' + escapeHtml(c.id) + '\',\'' + it + '\')">' +
          '<span class="ci-emoji">' + CI_EMOJI[it] + '</span><span class="ci-label">' + it + '</span>' +
          '<span class="ci-time">' + (m ? m.time + (m.eta ? ' → ' + escapeHtml(m.eta) : '') : '누르면 기록') + '</span></button>';
      }).join('') + '</div>' +
      '<div class="ci-eta" id="eta-' + escapeHtml(c.id) + '" style="display:none;">' +
        '<label>도착 예정 시간 <small>(모르면 비워두세요)</small></label>' +
        '<div class="ci-eta-row"><input type="time" id="etaInput-' + escapeHtml(c.id) + '">' +
        '<button onclick="sendCheckin(\'' + escapeHtml(c.id) + '\',\'출발\')">출발했어요</button></div>' +
      '</div>' +
      '<div class="msg" id="ciMsg-' + escapeHtml(c.id) + '"></div>' +
      '<div class="ci-tip">💬 봇 채팅방에 \'기상\' \'출발\' \'도착\'만 보내도 기록돼요</div>' +
    '</div>';
  }).join('');
}

function tapCheckin(id, item) {
  if (item === '출발') {
    var box = document.getElementById('eta-' + id);
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
    return;
  }
  sendCheckin(id, item);
}

function sendCheckin(id, item) {
  var eta = '';
  if (item === '출발') { var inp = document.getElementById('etaInput-' + id); eta = inp ? inp.value : ''; }
  setMsg('ciMsg-' + id, '기록 중...');
  postApi('checkin', { checkinId: id, item: item, eta: eta }).then(function(r) {
    haptic('success');
    var c = myCheckins.find(function(x) { return x.id === id; });
    if (c) c.mine[item] = { time: r.time, eta: r.eta };
    renderMyCheckins();
    setMsg('ciMsg-' + id, CI_EMOJI[item] + ' ' + item + ' ' + r.time + ' 기록했어요!');
  }).catch(function(err) { setMsg('ciMsg-' + id, err.message, true); haptic('error'); });
}

// ----- 관리자: 체크인 만들기 · 현황 -----
function toggleCheckinForm() {
  var f = document.getElementById('checkinForm');
  var open = !f.classList.contains('open');
  f.classList.toggle('open', open);
  document.getElementById('checkinChev').classList.toggle('up', open);
  if (open && !document.getElementById('ciDate').value) {
    var d = new Date();
    document.getElementById('ciDate').value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
}

function submitCheckin() {
  var items = [].slice.call(document.querySelectorAll('#ciItems input:checked')).map(function(x) { return x.value; });
  var btn = document.getElementById('ciSubmitBtn');
  btn.disabled = true;
  setMsg('ciMsg', '만드는 중...');
  postApi('createCheckin', {
    title: document.getElementById('ciTitle').value,
    date: document.getElementById('ciDate').value,
    items: items,
    target: document.getElementById('ciTarget').value
  }).then(function() {
    haptic('success');
    btn.disabled = false;
    document.getElementById('ciTitle').value = '';
    setMsg('ciMsg', '만들었어요! 대상자에게 체크인 버튼이 보여요.');
    loadCheckinBoard();
    loadMyCheckins();
    setTimeout(function() { setMsg('ciMsg', ''); toggleCheckinForm(); }, 1500);
  }).catch(function(err) { setMsg('ciMsg', err.message, true); btn.disabled = false; });
}

var checkinBoard = [];
var openBoardId = null;

function loadCheckinBoard() {
  postApi('getCheckinBoard').then(function(list) {
    checkinBoard = list || [];
    renderCheckinBoard();
  }).catch(function() {});
}

function renderCheckinBoard() {
  document.getElementById('ciBoardCount').textContent = checkinBoard.length ? checkinBoard.length + '개' : '';
  var el = document.getElementById('checkinBoard');
  if (!checkinBoard.length) { el.innerHTML = '<div class="empty"><b>최근 체크인이 없어요</b>위에서 새로 만들 수 있어요</div>'; return; }
  el.innerHTML = checkinBoard.map(function(c) {
    var open = openBoardId === c.id;
    var head = '<div class="ci-board-head" onclick="toggleBoard(\'' + escapeHtml(c.id) + '\')">' +
      '<div><div class="ci-board-title">' + escapeHtml(c.title) + '</div>' +
      '<div class="event-meta">' + escapeHtml(c.date || '날짜 없음') + ' · ' + escapeHtml(c.targets.join(', ')) + '</div></div>' +
      '<span class="chip' + (c.active ? ' dark' : '') + '">' + (c.active ? '진행 중' : (c.status === '종료' ? '종료' : '지난 날짜')) + '</span></div>' +
      '<div class="ci-counts">' + c.items.map(function(it) {
        return '<span>' + CI_EMOJI[it] + ' ' + it + ' <b>' + c.done[it] + '</b>/' + c.total + '</span>';
      }).join('') + '</div>';
    var table = '';
    if (open) {
      table = '<div class="table-scroll"><table class="sched ci-table"><thead><tr><th>이름</th>' +
        c.items.map(function(it) { return '<th>' + CI_EMOJI[it] + it + '</th>'; }).join('') + '</tr></thead><tbody>' +
        c.rows.map(function(r) {
          return '<tr><td class="c-who"><b>' + escapeHtml(r.name) + '</b><span>' + escapeHtml(r.group) + '</span></td>' +
            c.items.map(function(it) {
              var m = r.mine[it];
              return '<td class="' + (m ? 'ci-ok' : 'ci-miss') + '">' + (m ? m.time + (m.eta ? '<small>→' + escapeHtml(m.eta) + '</small>' : '') : '–') + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        (c.status !== '종료' ? '<button class="ghost-btn" onclick="closeCheckinUI(\'' + escapeHtml(c.id) + '\')">체크인 종료하기</button>' : '');
    }
    return '<div class="card ci-board">' + head + table + '</div>';
  }).join('');
}

function toggleBoard(id) { openBoardId = openBoardId === id ? null : id; renderCheckinBoard(); }

function closeCheckinUI(id) {
  postApi('closeCheckin', { checkinId: id }).then(function() { loadCheckinBoard(); loadMyCheckins(); })
    .catch(function(err) { alert(err.message); });
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
  loadMyCheckins();
  loadAttendTargets();
  loadAnnouncements();
  loadAssignments();
  loadProfile();
}

function applyRoles(r) {
  if (!r) return;
  document.getElementById('adminCard').style.display = r.isAdmin ? 'block' : 'none';
  document.getElementById('checkinAdminCard').style.display = r.isAdmin ? 'block' : 'none';
  document.getElementById('checkinBoardWrap').style.display = r.isAdmin ? 'block' : 'none';
  if (r.isAdmin) loadCheckinBoard();
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
  myCheckins = [];
  renderMyCheckins();
  hideAdminUI();
  document.getElementById('annCount').textContent = '';
  document.getElementById('annList').innerHTML = '<div class="empty"><b>로그인하면 공지사항이 보여요</b>출결 탭에서 처음 한 번만 로그인해요</div>';
  document.getElementById('hwArea').innerHTML = '<div class="empty"><b>로그인하면 우리 팀 과제가 보여요</b>출결 탭에서 처음 한 번만 로그인해요</div>';
  setProfileEnabled(false);
  document.querySelectorAll('#sub-info input[data-f]').forEach(function(i) { i.value = ''; });
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
  document.getElementById('checkinAdminCard').style.display = 'none';
  document.getElementById('checkinBoardWrap').style.display = 'none';
  document.getElementById('annAdminCard').style.display = 'none';
}

// ===== 12지파 인원현황 =====
function loadTribes() {
  return callApi('getTribes').then(function(d) {
    var el = document.getElementById('tribeArea');
    document.getElementById('tribeTotal').textContent = d.filled ? '총 ' + d.total + '명' : '';
    el.innerHTML = '<div class="tribe-grid">' + d.list.map(function(t) {
      return '<div class="tribe' + (t.count ? '' : ' zero') + '"><span>' + escapeHtml(t.name) + '</span><b>' +
        (t.count === null ? '–' : t.count + '<small>명</small>') + '</b></div>';
    }).join('') + '</div>' +
      (d.filled ? '' : '<div class="tribe-hint">\'지파현황\' 시트에 인원을 적으면 여기에 보여요</div>');
  }).catch(function() {
    document.getElementById('tribeArea').innerHTML = '<div class="empty inner"><b>인원현황을 불러오지 못했어요</b>잠시 후 다시 열어주세요</div>';
  });
}

// ===== 공지사항 (과장·부과장·팀장 작성) =====
var announcements = [];
var openAnnId = null;

function loadAnnouncements() {
  if (!identifiedPerson) return;
  postApi('getAnnouncements').then(function(r) {
    announcements = r.list || [];
    document.getElementById('annAdminCard').style.display = r.canWrite ? 'block' : 'none';
    window.annCanManage = !!r.canManage;
    renderAnnouncements();
  }).catch(function(err) {
    document.getElementById('annList').innerHTML = '<div class="empty"><b>공지사항을 불러오지 못했어요</b>' + escapeHtml(err.message) + '</div>';
  });
}

function fmtDate(ms) {
  if (!ms) return '';
  var d = new Date(ms);
  return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAYS[d.getDay()] + ') ' + hm(d);
}

function renderAnnouncements() {
  document.getElementById('annCount').textContent = announcements.length ? announcements.length + '건' : '';
  var el = document.getElementById('annList');
  if (!announcements.length) { el.innerHTML = '<div class="empty"><b>아직 공지사항이 없어요</b>문화부·과 전체 공유사항이 올라오면 여기에 보여요</div>'; return; }
  el.innerHTML = announcements.map(function(a) {
    var open = openAnnId === a.id;
    var long = a.content.length > 90 || a.content.split('\n').length > 3;
    return '<div class="ann' + (a.pinned ? ' pinned' : '') + (open ? ' open' : '') + '" onclick="toggleAnn(\'' + escapeHtml(a.id) + '\')">' +
      '<div class="ann-top">' + (a.pinned ? '<span class="chip dday">📌 고정</span>' : '') +
        '<span class="chip' + (/전체/.test(a.scope) ? ' dark' : '') + '">' + escapeHtml(a.scope) + '</span>' +
        '<span class="ann-date">' + fmtDate(a.date) + '</span></div>' +
      '<div class="ann-title">' + escapeHtml(a.title) + '</div>' +
      (a.content ? '<div class="ann-body' + (long && !open ? ' clamp' : '') + '">' + escapeHtml(a.content) + '</div>' : '') +
      '<div class="ann-foot"><span>' + escapeHtml(a.author) + '</span>' +
        (long ? '<span class="ann-more">' + (open ? '접기' : '더보기') + '</span>' : '') +
        ((a.mine || window.annCanManage) && open ? '<button class="ann-hide" onclick="event.stopPropagation();hideAnnouncement(\'' + escapeHtml(a.id) + '\')">내리기</button>' : '') +
      '</div></div>';
  }).join('');
}

function toggleAnn(id) { openAnnId = openAnnId === id ? null : id; renderAnnouncements(); }

function toggleAnnForm() {
  var f = document.getElementById('annForm');
  var open = !f.classList.contains('open');
  f.classList.toggle('open', open);
  document.getElementById('annChev').classList.toggle('up', open);
}

function submitAnnouncement() {
  var title = document.getElementById('annTitle').value.trim();
  if (!title) { setMsg('annMsg', '제목을 입력해주세요!', true); return; }
  var btn = document.getElementById('annSubmitBtn');
  btn.disabled = true;
  setMsg('annMsg', '올리는 중...');
  postApi('createAnnouncement', {
    scope: document.getElementById('annScope').value,
    title: title,
    content: document.getElementById('annContent').value,
    pinned: document.getElementById('annPinned').checked
  }).then(function() {
    haptic('success');
    btn.disabled = false;
    document.getElementById('annTitle').value = '';
    document.getElementById('annContent').value = '';
    document.getElementById('annPinned').checked = false;
    setMsg('annMsg', '올렸어요!');
    loadAnnouncements();
    setTimeout(function() { setMsg('annMsg', ''); toggleAnnForm(); }, 1200);
  }).catch(function(err) { setMsg('annMsg', err.message, true); haptic('error'); btn.disabled = false; });
}

function hideAnnouncement(id) {
  if (!confirm('이 공지를 내릴까요? (시트에는 남아 있어요)')) return;
  postApi('hideAnnouncement', { id: id }).then(function() { openAnnId = null; loadAnnouncements(); })
    .catch(function(err) { alert(err.message); });
}

// ===== 과제 (우리 팀 것만) =====
function loadAssignments() {
  if (!identifiedPerson) return;
  postApi('getMyAssignments').then(renderAssignments).catch(function(err) {
    document.getElementById('hwArea').innerHTML = '<div class="empty"><b>과제를 불러오지 못했어요</b>' + escapeHtml(err.message) + '</div>';
  });
}

function renderAssignments(list) {
  var el = document.getElementById('hwArea');
  if (!list.length) { el.innerHTML = '<div class="empty"><b>지금 우리 팀 과제가 없어요</b>과제가 하달되면 여기에 보여요</div>'; return; }
  var now = Date.now();
  el.innerHTML = list.map(function(h) {
    var late = h.due && h.due < now && !h.done;
    var dueText = h.due ? '마감 ' + fmtDate(h.due) + (h.due >= now ? ' · ' + ddayText(new Date(h.due)) : '') : '마감 미정';
    return '<div class="task' + (h.done ? ' done' : '') + (late ? ' late' : '') + '">' +
      '<div class="task-top"><span>' +
        '<span class="chip' + (h.kind ? ' dark' : '') + '">' + escapeHtml(h.kind || '과제') + '</span> ' +
        (h.team ? '<span class="chip">' + escapeHtml(h.team) + '</span>' : '') + '</span>' +
        '<span class="task-due">' + dueText + '</span></div>' +
      '<div class="task-title">' + escapeHtml(h.title) + '</div>' +
      '<div class="task-desc">' + escapeHtml([h.where && '제출처 ' + h.where, h.feedback ? '피드백 있음' : ''].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="hw-state">' + (h.done ? '✅ 제출 완료' : (late ? '⏰ 마감 지남 · 미제출' : '⬜ 아직 제출 전')) + '</div>' +
    '</div>';
  }).join('');
}

// ===== 프로필 (인적사항 수정) =====
function setProfileEnabled(on) {
  document.querySelectorAll('#sub-info input[data-f]').forEach(function(i) { i.disabled = !on; });
  document.getElementById('pfSaveBtn').disabled = !on;
  document.getElementById('pfNotice').style.display = on ? 'none' : 'block';
}

function loadProfile() {
  if (!identifiedPerson) return;
  postApi('getMyProfile').then(function(r) {
    document.querySelectorAll('#sub-info input[data-f]').forEach(function(i) {
      i.value = r.fields[i.getAttribute('data-f')] || '';
    });
    setProfileEnabled(true);
  }).catch(function(err) { setMsg('pfMsg', '불러오지 못했어요: ' + err.message, true); });
}

function saveProfile() {
  var fields = {};
  document.querySelectorAll('#sub-info input[data-f]').forEach(function(i) { fields[i.getAttribute('data-f')] = i.value.trim(); });
  var btn = document.getElementById('pfSaveBtn');
  btn.disabled = true;
  setMsg('pfMsg', '저장 중...');
  postApi('saveMyProfile', { fields: fields }).then(function() {
    haptic('success');
    btn.disabled = false;
    setMsg('pfMsg', '저장했어요!');
    setTimeout(function() { setMsg('pfMsg', ''); }, 2000);
  }).catch(function(err) { setMsg('pfMsg', err.message, true); haptic('error'); btn.disabled = false; });
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
    foot.textContent = '방송예술과 미니앱 · ' + (tgInitData ? '텔레그램 서명 ✓' : '텔레그램 서명 없음') +
      ' [' + (tg ? (tg.platform || 'unknown') + ' v' + (tg.version || '?') : 'SDK없음') +
      ' · ' + (tgSource || '-') + ' · hash:' + (/tgWebApp/.test(location.hash) ? 'Y' : 'N') + ']';
  }
  loadPeople();
  autoLogin();
  loadDashboard();
  loadTribes();
  // 봇 버튼에서 ?tab=attend 처럼 열면 그 탭으로 바로 이동
  try {
    var startTab = new URLSearchParams(location.search).get('tab');
    if (['home', 'notice', 'attend', 'task'].indexOf(startTab) !== -1) goTab(startTab);
  } catch (e) {}
  setInterval(loadDashboard, 5 * 60 * 1000); // 5분마다 대시보드 새로고침
})();
