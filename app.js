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
  try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {} // 아래로 쓸 때 앱이 닫히지 않게 (시간표 칠하기·스크롤용)
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
// 조회는 전부 묶음 요청(batch)으로 보냄. 같은 순간에 나가는 것끼리 모아 요청 1번으로 처리해서
// 구글 서버 왕복(한 번에 1~3초)을 줄임.
function callApi(action, params) {
  return batchRead(action, params);
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
// 구글 서버는 요청이 한꺼번에 몰리면 가끔 오류 페이지를 돌려줌 → 동시에 2개까지만 보내고 나머지는 줄 세움
var API_MAX = 2, apiBusy = 0, apiQueue = [];
function apiSlot(job) {
  return new Promise(function(resolve, reject) {
    apiQueue.push(function() {
      apiBusy++;
      job().then(resolve, reject).then(function() { apiBusy--; if (apiQueue.length) apiQueue.shift()(); });
    });
    if (apiBusy < API_MAX) apiQueue.shift()();
  });
}
function readOnlyAction(a) { return a === 'whoami' || /^get/.test(a) || a === 'weeklyStatus' || a === 'weeklyLoad' || a === 'weeklyBusy' || a === 'weeklyGetFixed'; }

function postApi(action, data) {
  // 조회는 같은 순간에 나가는 것끼리 모아서 요청 1번으로 보냄 (아래 batchRead)
  if (readOnlyAction(action)) return batchRead(action, data);
  var body = Object.assign({ action: action, initData: tgInitData, token: safeGetLocal(TOKEN_KEY) || '' }, data || {});
  // 저장 요청은 두 번 들어가면 안 되니 재시도 안 함 (조회만 재시도)
  var tries = readOnlyAction(action) ? 3 : 1;
  return apiSlot(function() { return fetchJsonRetry(function() { return fetch(API_URL, { method: 'POST', body: JSON.stringify(body) }); }, tries); })
    .then(function(json) { return unwrapApi(json.ok, json.result, json.error); });
}

function unwrapApi(ok, result, error) {
  if (ok) return result;
  if (/로그인이 필요/.test(error || '') && identifiedPerson) { safeRemoveLocal(TOKEN_KEY); showLoggedOut(); }
  throw new Error(error || '알 수 없는 오류');
}

var batchQ = null;
function batchRead(action, data) {
  return new Promise(function(resolve, reject) {
    if (!batchQ) { batchQ = []; setTimeout(flushBatch, 30); }
    batchQ.push({ call: Object.assign({ action: action }, data || {}), resolve: resolve, reject: reject });
  });
}
function flushBatch() {
  var q = batchQ; batchQ = null;
  var body = { action: 'batch', initData: tgInitData, token: safeGetLocal(TOKEN_KEY) || '', calls: q.map(function(x) { return x.call; }) };
  var t0 = Date.now();
  apiSlot(function() { return fetchJsonRetry(function() { return fetch(API_URL, { method: 'POST', body: JSON.stringify(body) }); }, 3); })
    .then(function(json) {
      try { console.log('[api] ' + (Date.now() - t0) + 'ms · ' + q.map(function(x) { return x.call.action; }).join(', ')); } catch (e) {}
      if (!json.ok) throw new Error(json.error || '알 수 없는 오류');
      q.forEach(function(x, i) {
        var r = json.result[i] || { ok: false, error: '응답이 없어요' };
        try { x.resolve(unwrapApi(r.ok, r.result, r.error)); } catch (e) { x.reject(e); }
      });
    })
    .catch(function(err) { q.forEach(function(x) { x.reject(err); }); });
}

// ===== 화면 먼저 보여주기 =====
// 지난번에 받은 내용을 이 폰에 저장해 두고, 앱을 열면 그것부터 그린 뒤
// 서버에서 새 내용이 오면 다시 그림 (두 번째부터는 기다림 없이 바로 보임)
function cachedRead(action, data, use, onError) {
  var key = 'c_' + action + (data ? '_' + JSON.stringify(data) : '');
  var hit = null;
  try { var raw = safeGetLocal(key); hit = raw ? JSON.parse(raw) : null; } catch (e) {}
  if (hit && hit.v !== undefined) { try { use(hit.v, true); } catch (e) {} }
  return batchRead(action, data).then(function(r) {
    try { safeSetLocal(key, JSON.stringify({ v: r, t: Date.now() })); } catch (e) {}
    use(r, false);
    return r;
  }).catch(function(err) {
    if (onError) onError(err, !!hit); // 저장해둔 게 있으면 그대로 두고 오류 화면을 덮지 않음
  });
}
function clearCachedReads() {
  try {
    var del = [];
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('c_') === 0) del.push(k); }
    del.forEach(safeRemoveLocal);
  } catch (e) {}
}

// ===== 저장소(이 폰 기억) =====
function safeGetLocal(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeSetLocal(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
function safeRemoveLocal(key) { try { localStorage.removeItem(key); } catch (e) {} }
// 예전 방식(이름만 기억)으로 저장된 값 정리
safeRemoveLocal('myPersonId'); safeRemoveLocal('myPersonName');

// ===== 탭 이동 =====
function goTab(name) {
  if (name === 'attend' && identifiedPerson && document.getElementById('classSelect').getAttribute('data-failed')) {
    document.getElementById('classSelect').removeAttribute('data-failed');
    loadAttendTargets();
  }
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-tab') === name);
  });
  document.querySelectorAll('.pc-item').forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-go') === name);
  });
  if (name === 'assign' && !asData) loadAssign(asWhich);
  window.scrollTo(0, 0);
}

// ===== 슬라이드 메뉴 =====
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('overlay').classList.add('show');
  document.getElementById('drawer').setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');
  toggleFab(false);
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  document.getElementById('drawer').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open');
}
function openMenuPage(name) {
  closeDrawer();
  setTimeout(function() { goTab(name); }, 180);
  if (name === 'profile' && identifiedPerson) { loadProfile(); loadPhoto(true); }
}
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeDrawer(); toggleFab(false); closePollSheet(); } });

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
  if (name === 'fixed') loadFixed();
}

// 공지 작성 폼 열고 닫기
function toggleNoticeForm() {
  var f = document.getElementById('noticeForm');
  var open = !f.classList.contains('open');
  f.classList.toggle('open', open);
  document.getElementById('noticeChev').classList.toggle('up', open);
  if (open && !nfData) loadMeetingTypes();
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
  return cachedRead('getUpcomingMeetings', null, function(meetings) {
    meetingsCache = meetings || [];
    meetingsCache.forEach(function(m) { m._t = parseMeeting(m); });
    renderNoticeList();
  }, function(err, hadCache) {
    if (!hadCache) document.getElementById('noticeList').innerHTML = '<div class="empty"><b>모임을 불러오지 못했어요</b>잠시 후 다시 열어주세요</div>';
    document.getElementById('debug').textContent = '모임목록 오류: ' + err.message;
  });
}

// ===== 출결 대상 (내 팀의 모임 + 업무, 로그인 후) =====
function loadAttendTargets() {
  var sel = document.getElementById('classSelect');
  if (!identifiedPerson) return;
  sel.innerHTML = '<option value="">불러오는 중...</option>';
  sel.removeAttribute('data-failed');
  return cachedRead('getMyAttendTargets', null, function(list) {
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
  }, function(err, hadCache) {
    if (hadCache) return;
    sel.innerHTML = '<option value="">목록을 불러오지 못했어요 — 탭을 다시 눌러주세요</option>';
    sel.setAttribute('data-failed', '1');
  });
}

// ===== 체크인 (기상·출발·도착) =====
var CI_EMOJI = { '기상': '☀️', '출발': '🚗', '도착': '📍' };
var myCheckins = [];

function loadMyCheckins() {
  if (!identifiedPerson) return;
  cachedRead('getMyCheckins', null, function(list) {
    myCheckins = list || [];
    renderMyCheckins();
  });
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
  document.getElementById('pcWho').textContent = person.name + '님';
  document.getElementById('profileName').textContent = person.name;
  document.getElementById('profileRole').textContent = '방송예술과';
  var w = document.getElementById('welcome');
  w.style.display = 'flex';
  w.innerHTML = '<span>' + escapeHtml(person.name) + '님으로 제출돼요</span><a href="#" onclick="forgetMe();return false;">저 아니에요</a>';
  document.getElementById('loginBlock').style.display = 'none';
  document.getElementById('attendForm').style.display = 'block';
  document.getElementById('loginItem').style.display = 'none';
  document.getElementById('logoutItem').style.display = 'flex';
  document.body.classList.remove('locked'); // 로그인 확인 → 앱 화면 열기
  applyRoles(roles);
  loadMeetings();
  loadDashboard();
  loadTribes();
  loadMyCheckins();
  loadAttendTargets();
  loadAnnouncements();
  loadAssignments();
  setProfileEnabled(true);
  loadPhoto(); // 폰에 저장해둔 사진을 바로 보여주고, 서버 확인은 프로필을 열 때
  loadMyPolls();
  loadWeeklyBanner();
  if (pendingPollId) { var pid = pendingPollId; pendingPollId = ''; openPollDetail(pid); }
  else if (pendingWeekly) { var wk = pendingWeekly; pendingWeekly = ''; openWeekly(wk); }
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
  document.body.classList.add('locked'); // 로그인 화면만 보이게
  document.getElementById('greeting').textContent = '반가워요 👋';
  ['avatar', 'drawerAvatar', 'profileAvatar'].forEach(function(id) { document.getElementById(id).textContent = '?'; });
  document.getElementById('drawerName').textContent = '게스트';
  document.getElementById('pcWho').textContent = '게스트';
  document.getElementById('pcAssignBtn').style.display = 'none';
  asData = null;
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
  myPhoto = ''; setAvatarPhoto('');
  pollPicked = {}; pollTeam = ''; roster = null;
  nfData = null; nfTeam = '';
  document.getElementById('pollBanner').innerHTML = '';
  document.getElementById('weeklyBanner').innerHTML = '';
  fixedList = null;
  document.getElementById('fxList').innerHTML = '<div class="empty inner"><b>로그인하면 설정할 수 있어요</b></div>';
  document.getElementById('photoInput').disabled = true;
  document.getElementById('avatarEdit').classList.remove('on');
  document.getElementById('photoActions').style.display = 'none';
}

// 앱을 열면: 텔레그램 서명 또는 저장된 토큰으로 자동 로그인 시도
function autoLogin() {
  // 지난번 로그인 정보를 먼저 써서 화면을 바로 그림 (서버 확인은 뒤에서)
  var cached = null;
  try { var raw = safeGetLocal('c_whoami'); cached = raw ? JSON.parse(raw) : null; } catch (e) {}
  if (cached && cached.person) setIdentity(cached.person, cached.roles);
  return postApi('whoami').then(function(r) {
    if (r.person) {
      safeSetLocal('c_whoami', JSON.stringify(r));
      if (!identifiedPerson || identifiedPerson.id !== r.person.id) setIdentity(r.person, r.roles);
      else applyRoles(r.roles); // 이미 그려둔 화면은 그대로 두고 권한만 최신으로
    } else {
      safeRemoveLocal('c_whoami');
      clearCachedReads();
      showLoggedOut();
    }
  }).catch(function() { if (!identifiedPerson) showLoggedOut(); });
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
  safeRemoveLocal('c_whoami');
  clearCachedReads();
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
  return cachedRead('getTribes', null, function(d) {
    var el = document.getElementById('tribeArea');
    document.getElementById('tribeTotal').textContent = d.filled ? '총 ' + d.total + '명' : '';
    el.innerHTML = '<div class="tribe-grid">' + d.list.map(function(t) {
      return '<div class="tribe' + (t.count ? '' : ' zero') + '"><span>' + escapeHtml(t.name) + '</span><b>' +
        (t.count === null ? '–' : t.count + '<small>명</small>') + '</b></div>';
    }).join('') + '</div>' +
      (d.filled ? '' : '<div class="tribe-hint">\'지파현황\' 시트에 인원을 적으면 여기에 보여요</div>');
  }, function(err, hadCache) {
    if (!hadCache) document.getElementById('tribeArea').innerHTML = '<div class="empty inner"><b>인원현황을 불러오지 못했어요</b>잠시 후 다시 열어주세요</div>';
  });
}

// ===== 공지사항 (과장·부과장·팀장 작성) =====
var announcements = [];
var openAnnId = null;

function loadAnnouncements() {
  if (!identifiedPerson) return;
  cachedRead('getAnnouncements', null, function(r) {
    announcements = r.list || [];
    document.getElementById('annAdminCard').style.display = r.canWrite ? 'block' : 'none';
    window.annCanManage = !!r.canManage;
    renderAnnouncements();
  }, function(err, hadCache) {
    if (!hadCache) document.getElementById('annList').innerHTML = '<div class="empty"><b>공지사항을 불러오지 못했어요</b>' + escapeHtml(err.message) + '</div>';
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
  cachedRead('getMyAssignments', null, renderAssignments, function(err, hadCache) {
    if (!hadCache) document.getElementById('hwArea').innerHTML = '<div class="empty"><b>과제를 불러오지 못했어요</b>' + escapeHtml(err.message) + '</div>';
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

// ===== 프로필 사진 =====
var PHOTO_KEY = 'myPhoto';
var myPhoto = '';

// 텔레그램 프로필 사진 (앱에서 따로 안 올렸을 때 대신 보여줌)
function telegramPhotoUrl() {
  try { return (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.photo_url) || ''; } catch (e) { return ''; }
}

function setAvatarPhoto(url) {
  ['avatar', 'drawerAvatar', 'profileAvatar'].forEach(function(id) {
    var el = document.getElementById(id);
    el.style.backgroundImage = url ? 'url("' + url.replace(/"/g, '%22') + '")' : '';
    el.classList.toggle('has-photo', !!url);
  });
}

function showPhoto() {
  setAvatarPhoto(myPhoto || telegramPhotoUrl());
  document.getElementById('photoRemoveBtn').style.display = myPhoto ? 'inline-block' : 'none';
}

function loadPhoto(force) {
  if (!identifiedPerson) return;
  var cacheKey = PHOTO_KEY + '_' + identifiedPerson.id;
  myPhoto = safeGetLocal(cacheKey) || '';
  showPhoto();
  document.getElementById('photoInput').disabled = false;
  document.getElementById('avatarEdit').classList.add('on');
  document.getElementById('photoActions').style.display = 'flex';
  // 사진은 용량이 커서, 폰에 저장된 게 있으면 프로필을 열 때만 서버에 다시 물어봄
  if (myPhoto && !force) return;
  postApi('getMyPhoto').then(function(r) {
    myPhoto = r.photo || '';
    if (myPhoto) safeSetLocal(cacheKey, myPhoto); else safeRemoveLocal(cacheKey);
    showPhoto();
  }).catch(function() {});
}

// 고른 사진을 가운데 기준 정사각형 256px JPEG로 줄임 (서버에는 작은 사진만 저장)
function shrinkPhoto(file) {
  return new Promise(function(resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function() {
      var side = Math.min(img.naturalWidth, img.naturalHeight);
      var sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
      var c = document.createElement('canvas');
      c.width = c.height = 256;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(img, sx, sy, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      var q = 0.85, out = c.toDataURL('image/jpeg', q);
      while (out.length > 44000 && q > 0.35) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      if (out.length > 44000) reject(new Error('사진을 줄이지 못했어요. 다른 사진으로 해주세요.'));
      else resolve(out);
    };
    img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('이 사진은 열 수 없어요. 다른 사진으로 해주세요.')); };
    img.src = url;
  });
}

function onPhotoPicked(input) {
  var file = input.files && input.files[0];
  input.value = '';
  if (!file || !identifiedPerson) return;
  if (!/^image\//.test(file.type || 'image/')) { setMsg('photoMsg', '사진 파일만 올릴 수 있어요.', true); return; }
  var box = document.getElementById('avatarEdit');
  box.classList.add('busy');
  setMsg('photoMsg', '올리는 중...');
  shrinkPhoto(file).then(function(dataUrl) {
    return postApi('saveMyPhoto', { photo: dataUrl }).then(function() {
      myPhoto = dataUrl;
      safeSetLocal(PHOTO_KEY + '_' + identifiedPerson.id, dataUrl);
      showPhoto();
      haptic('success');
      setMsg('photoMsg', '사진을 바꿨어요!');
      setTimeout(function() { setMsg('photoMsg', ''); }, 2000);
    });
  }).catch(function(err) { setMsg('photoMsg', err.message, true); haptic('error'); })
    .then(function() { box.classList.remove('busy'); });
}

function removePhoto() {
  if (!identifiedPerson || !confirm('프로필 사진을 지울까요?')) return;
  setMsg('photoMsg', '지우는 중...');
  postApi('saveMyPhoto', { photo: '' }).then(function() {
    myPhoto = '';
    safeRemoveLocal(PHOTO_KEY + '_' + identifiedPerson.id);
    showPhoto();
    setMsg('photoMsg', '지웠어요.');
    setTimeout(function() { setMsg('photoMsg', ''); }, 2000);
  }).catch(function(err) { setMsg('photoMsg', err.message, true); });
}

// ===== 빠른 메뉴 (+ 버튼) =====
function toggleFab(force) {
  var wrap = document.getElementById('fabWrap');
  var open = typeof force === 'boolean' ? force : !wrap.classList.contains('open');
  wrap.classList.toggle('open', open);
  document.getElementById('fabDim').classList.toggle('show', open);
  document.getElementById('fab').setAttribute('aria-expanded', open ? 'true' : 'false');
}

// ===== 가능시간 취합 만들기 =====
var roster = null;         // { teams, people: [{id, name, teams}] }
var pollTeam = '';         // 지금 보고 있는 소속
var pollPicked = {};       // 고른 사람 { id: true }
var pendingPollId = '';    // 링크로 열었는데 아직 로그인 확인 전

function openPollSheet(skipHome) {
  toggleFab(false);
  document.body.classList.add('sheet-open');
  document.getElementById('pollBg').classList.add('show');
  var sh = document.getElementById('pollSheet');
  sh.classList.add('open');
  sh.setAttribute('aria-hidden', 'false');
  var logged = !!identifiedPerson;
  document.getElementById('pollLogin').style.display = logged ? 'none' : 'block';
  document.getElementById('pollForm').style.display = logged ? 'block' : 'none';
  if (!logged) { document.getElementById('pollDetail').style.display = 'none'; return; }
  if (skipHome !== true) { setSheetHead(false); showPollHome(); }
}

// 만들기 폼 + 내 목록 화면
function showPollHome() {
  document.getElementById('pollDetail').style.display = 'none';
  document.getElementById('pollForm').style.display = 'block';
  document.getElementById('pollSheet').scrollTop = 0;
  var now = new Date();
  var dl = document.getElementById('pollDeadline');
  dl.min = localDT(now);
  if (!dl.value) { var d = new Date(now.getTime() + 2 * 86400000); d.setHours(22, 0, 0, 0); dl.value = localDT(d); }
  var d0 = document.getElementById('pollD0'), d1 = document.getElementById('pollD1');
  d0.min = d1.min = localDT(now).slice(0, 10);
  if (!d0.value) { d0.value = localDT(new Date(now.getTime() + 86400000)).slice(0, 10); d1.value = localDT(new Date(now.getTime() + 7 * 86400000)).slice(0, 10); }
  if (!roster) loadRoster(); else renderPollPeople();
  loadMyPolls();
}

function closePollSheet() {
  if (pdDirty && pd && document.getElementById('pollDetail').style.display !== 'none' && !confirm('저장하지 않은 칸이 있어요. 그래도 닫을까요?')) return;
  pdDirty = false;
  document.body.classList.remove('sheet-open');
  document.getElementById('pollBg').classList.remove('show');
  var sh = document.getElementById('pollSheet');
  sh.classList.remove('open');
  sh.setAttribute('aria-hidden', 'true');
}

function localDT(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function loadRoster() {
  document.getElementById('pollPeople').innerHTML = '<div class="people-empty">이름을 불러오는 중...</div>';
  postApi('getRoster').then(function(r) {
    roster = r;
    renderPollPeople();
  }).catch(function(err) {
    document.getElementById('pollPeople').innerHTML = '<div class="people-empty">이름을 불러오지 못했어요: ' + escapeHtml(err.message) + '</div>';
  });
}

// 소속 목록: 3개 팀 + (팀 없는 사람이 있으면) 기타
function pollTeamList() {
  var list = roster.teams.slice();
  if (roster.people.some(function(p) { return !p.teams.length; })) list.push('기타');
  return list;
}
function teamMembers(team) {
  return roster.people.filter(function(p) { return team === '기타' ? !p.teams.length : p.teams.indexOf(team) !== -1; });
}
function pickedCount(list) { return list.filter(function(p) { return pollPicked[p.id]; }).length; }

function renderPollPeople() {
  if (!roster) return;
  var myId = identifiedPerson ? identifiedPerson.id : '';
  document.getElementById('pollTeams').innerHTML = pollTeamList().map(function(t) {
    var n = pickedCount(teamMembers(t));
    return '<button type="button" class="team-chip' + (t === pollTeam ? ' active' : '') + '" onclick="pickTeam(\'' + t + '\')">' +
      escapeHtml(t) + (n ? '<span class="n">' + n + '</span>' : '') + '</button>';
  }).join('');
  var box = document.getElementById('pollPeople');
  if (!pollTeam) {
    box.innerHTML = '<div class="people-empty">소속을 누르면 이름이 나와요</div>';
  } else {
    var members = teamMembers(pollTeam);
    var others = members.filter(function(p) { return p.id !== myId; });
    var allOn = others.length && others.every(function(p) { return pollPicked[p.id]; });
    box.innerHTML = members.length
      ? '<div class="people-top"><span>' + escapeHtml(pollTeam) + ' ' + members.length + '명</span>' +
          (others.length ? '<button type="button" onclick="pickAll(' + (allOn ? 'false' : 'true') + ')">' + (allOn ? '모두 해제' : '모두 선택') + '</button>' : '') + '</div>' +
        '<div class="people-grid">' + members.map(function(p) {
          var me = p.id === myId;
          return '<button type="button" class="person' + (pollPicked[p.id] || me ? ' on' : '') + (me ? ' me' : '') + '"' +
            (me ? ' disabled title="만든 사람은 자동으로 포함돼요"' : ' onclick="togglePerson(\'' + escapeHtml(p.id) + '\')"') + '>' +
            escapeHtml(p.name) + (me ? ' (나)' : '') + '</button>';
        }).join('') + '</div>'
      : '<div class="people-empty">' + escapeHtml(pollTeam) + '에 등록된 사람이 없어요</div>';
  }
  var names = roster.people.filter(function(p) { return pollPicked[p.id] && p.id !== myId; }).map(function(p) { return p.name; });
  document.getElementById('pollPicked').textContent = names.length ? names.length + '명 선택 (나 포함 ' + (names.length + 1) + '명)' : '0명 선택';
  document.getElementById('pollPickedList').textContent = names.length ? names.join(' · ') : '';
}

function pickTeam(t) { pollTeam = pollTeam === t ? '' : t; renderPollPeople(); }
function togglePerson(id) { if (pollPicked[id]) delete pollPicked[id]; else pollPicked[id] = true; renderPollPeople(); }
function pickAll(on) {
  var myId = identifiedPerson ? identifiedPerson.id : '';
  teamMembers(pollTeam).forEach(function(p) { if (p.id === myId) return; if (on) pollPicked[p.id] = true; else delete pollPicked[p.id]; });
  renderPollPeople();
}

function submitPoll() {
  var title = document.getElementById('pollTitle').value.trim();
  var myId = identifiedPerson ? identifiedPerson.id : '';
  var targets = Object.keys(pollPicked).filter(function(id) { return id !== myId; });
  var deadline = document.getElementById('pollDeadline').value;
  if (!title) { setMsg('pollMsg', '모임 주제를 입력해주세요!', true); return; }
  if (!targets.length) { setMsg('pollMsg', '취합 대상을 한 명 이상 골라주세요!', true); return; }
  if (!deadline) { setMsg('pollMsg', '마감기한을 골라주세요!', true); return; }
  var d0 = document.getElementById('pollD0').value, d1 = document.getElementById('pollD1').value;
  var h0 = +document.getElementById('pollH0').value, h1 = +document.getElementById('pollH1').value;
  if (!d0 || !d1) { setMsg('pollMsg', '후보 날짜를 골라주세요!', true); return; }
  if (d1 < d0) { setMsg('pollMsg', '끝 날짜가 시작 날짜보다 빨라요!', true); return; }
  if ((new Date(d1) - new Date(d0)) / 86400000 + 1 > 14) { setMsg('pollMsg', '후보 날짜는 14일 안으로 골라주세요!', true); return; }
  if (h0 >= h1) { setMsg('pollMsg', '시간대를 확인해주세요!', true); return; }
  var btn = document.getElementById('pollSubmitBtn');
  btn.disabled = true;
  setMsg('pollMsg', '만드는 중...');
  postApi('createTimePoll', { title: title, targets: targets, deadline: deadline, startDate: d0, endDate: d1, startHour: h0, endHour: h1 }).then(function(r) {
    haptic('success');
    btn.disabled = false;
    setMsg('pollMsg', '');
    document.getElementById('pollTitle').value = '';
    pollPicked = {}; pollTeam = '';
    renderPollPeople();
    loadMyPolls();
    openPollDetail(r.id, '취합을 시작했어요! ' + r.count + '명' + (r.notified ? ' · 텔레그램 알림 ' + r.notified + '명' : '') + '\n내 가능시간도 칠해주세요.');
  }).catch(function(err) { setMsg('pollMsg', err.message, true); haptic('error'); btn.disabled = false; });
}

function loadMyPolls() {
  if (!identifiedPerson) return;
  cachedRead('getMyTimePolls', null, function(list) {
    var wrap = document.getElementById('pollListWrap');
    wrap.style.display = list.length && document.getElementById('pollDetail').style.display === 'none' ? 'block' : 'none';
    document.getElementById('pollListCount').textContent = list.length ? list.length + '건' : '';
    renderPollBanner(list);
    document.getElementById('pollList').innerHTML = list.map(function(p) {
      return '<div class="poll-card" onclick="openPollDetail(\'' + escapeHtml(p.id) + '\')"><div>' +
        '<span class="chip' + (p.open ? ' dark' : '') + '">' + (p.open ? '취합 중' : '마감') + '</span> ' +
        (p.mine ? '<span class="chip">내가 만듦</span>' : '') + '</div>' +
        '<div class="t">' + escapeHtml(p.title) + '</div>' +
        '<div class="m">' + (p.due ? '마감 ' + fmtDate(p.due) + (p.open ? ' · ' + ddayText(new Date(p.due)) : '') : '') +
          ' · 응답 ' + p.responded + '/' + p.count + ' · ' + escapeHtml(p.owner) +
          (p.open && !p.answered ? ' · <span class="todo">내 입력 전</span>' : '') + '</div></div>';
    }).join('');
  });
}

function renderPollBanner(list) {
  var todo = list.filter(function(p) { return p.open && !p.answered; });
  document.getElementById('pollBanner').innerHTML = todo.length
    ? '<div class="poll-banner" onclick="openPollDetail(\'' + escapeHtml(todo[0].id) + '\')"><span class="pb-i">🗓</span>' +
        '<div><b>가능시간 입력이 필요해요' + (todo.length > 1 ? ' (' + todo.length + '건)' : '') + '</b>' +
        '<small>' + escapeHtml(todo[0].title) + (todo[0].due ? ' · 마감 ' + fmtDate(todo[0].due) : '') + '</small></div><span class="pb-go">›</span></div>'
    : '';
}

// ----- 취합 하나 보기 -----
var pd = null;        // 지금 보고 있는 취합
var pdMine = {};      // 내가 칠한 칸 { '0-10': true }
var pdDirty = false;
var pdPage = 0;       // 7일씩 넘겨보기
var pdView = 'mine';
var pdSel = '';

function openPollDetail(id, notice) {
  if (!document.getElementById('pollSheet').classList.contains('open')) openPollSheet(true);
  if (!identifiedPerson) return;
  resetWeeklyUI();
  document.getElementById('pollForm').style.display = 'none';
  document.getElementById('pollListWrap').style.display = 'none';
  document.getElementById('pollDetail').style.display = 'block';
  document.getElementById('pollSheet').scrollTop = 0;
  document.getElementById('pdTitle').textContent = '불러오는 중...';
  document.getElementById('pdMeta').textContent = '';
  document.getElementById('pdGridMine').innerHTML = '';
  document.getElementById('pdGridRes').innerHTML = '';
  setMsg('pdMsg', '');
  postApi('getTimePoll', { id: id }).then(function(r) {
    pd = r; pdMine = {}; pdDirty = false; pdPage = 0; pdSel = '';
    pd.unit = r.unit || 60;
    r.mySlots.forEach(function(s) { pdMine[s] = true; });
    document.getElementById('pdMemo').value = r.myMemo || '';
    renderPd();
    switchPd(r.open && r.people.some(function(p) { return p.id === identifiedPerson.id; }) ? 'mine' : 'result');
    if (notice) setMsg('pdMsg', notice);
    loadBusy(r.id);
  }).catch(function(err) {
    document.getElementById('pdTitle').textContent = '취합을 열 수 없어요';
    document.getElementById('pdMeta').textContent = err.message;
  });
}

function switchPd(v) {
  pdView = v;
  document.querySelectorAll('.pd-tab').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-pd') === v); });
  document.getElementById('pdMine').style.display = v === 'mine' ? 'block' : 'none';
  document.getElementById('pdResult').style.display = v === 'result' ? 'block' : 'none';
  renderPd();
}

var PD_DAYS = 7;
function pdDates() { return pd.dates.slice(pdPage * PD_DAYS, pdPage * PD_DAYS + PD_DAYS); }
function pdPager(id) {
  var pages = Math.ceil(pd.dates.length / PD_DAYS);
  var el = document.getElementById(id);
  if (pages <= 1) { el.innerHTML = ''; return; }
  var ds = pdDates();
  el.innerHTML = '<button type="button" onclick="pdGo(-1)"' + (pdPage ? '' : ' disabled') + '>‹ 이전</button>' +
    '<span>' + shortDate(ds[0]) + ' ~ ' + shortDate(ds[ds.length - 1]) + '</span>' +
    '<button type="button" onclick="pdGo(1)"' + (pdPage < pages - 1 ? '' : ' disabled') + '>다음 ›</button>';
}
function pdGo(d) { pdPage += d; renderPd(); }
function ymdDate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function shortDate(s) { var d = ymdDate(s); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAYS[d.getDay()] + ')'; }
// 칸 키: 30분 취합 = "날짜번호-시작분"(0-1170 = 첫날 19:30), 예전 1시간 취합 = "날짜번호-시"
function slotKey(di, min) { return di + '-' + (pd.unit === 60 ? min / 60 : min); }
function slotMin(s) { var v = +s.split('-')[1]; return pd.unit === 60 ? v * 60 : v; }
function hmStr(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
function slotLabel(s) { var di = +s.split('-')[0], m = slotMin(s); return shortDate(pd.dates[di]) + ' ' + hmStr(m) + '~' + hmStr(m + pd.unit); }
function markPdDirty() { if (!pdDirty) { pdDirty = true; document.getElementById('pdSaveBtn').classList.add('dirty'); } }

function renderPd() {
  if (!pd) return;
  var answered = pd.people.filter(function(p) { return p.answered; }).length;
  document.getElementById('pdTitle').textContent = pd.title;
  document.getElementById('pdMeta').innerHTML = (pd.open ? '<span class="chip dark">취합 중</span> ' : '<span class="chip">마감</span> ') +
    (pd.due ? '마감 ' + fmtDate(pd.due) : '') + ' · 응답 ' + answered + '/' + pd.people.length + ' · ' + escapeHtml(pd.owner);
  if (pd.weekly) weeklyMeta();
  var isTarget = (pd.allPeople || pd.people).some(function(p) { return p.id === identifiedPerson.id; });
  document.getElementById('pdSaveBtn').disabled = !pd.open || !isTarget;
  document.getElementById('pdSaveBtn').classList.toggle('dirty', pdDirty);
  document.getElementById('pdHint').textContent = !pd.open ? '마감된 취합이에요. 결과 탭을 확인하세요.' :
    (isTarget ? '탭: 한 칸 · 꾹 누른 채 쓸기: 여러 칸 · 그냥 쓸면 스크롤' : '이 취합의 대상이 아니에요');
  renderPdQuick(isTarget);
  if (pdView === 'mine') { pdPager('pdPagerMine'); renderGrid('pdGridMine', false); }
  else { pdPager('pdPagerRes'); renderGrid('pdGridRes', true); renderPdResult(); }
}

function renderGrid(boxId, res) {
  var ds = pdDates(), start = pdPage * PD_DAYS;
  var total = pd.people.length;
  var step = pd.unit, half = step < 60;
  var html = '<div class="tgrid' + (res ? ' res' : '') + (half ? ' half' : '') + '" style="grid-template-columns: 34px repeat(' + ds.length + ', 1fr);">';
  html += '<div></div>' + ds.map(function(s) {
    var d = ymdDate(s), w = d.getDay();
    return '<div class="gh' + (w === 0 ? ' sun' : w === 6 ? ' sat' : '') + '"><b>' + (d.getMonth() + 1) + '/' + d.getDate() + '</b>' + WEEKDAYS[w] + '</div>';
  }).join('');
  for (var m = pd.h0 * 60; m < pd.h1 * 60; m += step) {
    var top = m % 60 === 0;
    html += '<div class="gt' + (top ? ' hr' : '') + '">' + (top ? (m / 60) + '시' : '') + '</div>';
    for (var i = 0; i < ds.length; i++) {
      var key = slotKey(start + i, m);
      var hr = top && half ? ' hr' : '';
      if (!res) {
        var bl = busyLabel(start + i, m, step);
        var blTop = bl && bl !== busyLabel(start + i, m - step, step);
        html += '<div class="gc' + hr + (pdMine[key] ? ' on' : '') + (bl ? ' busy' : '') + '" data-k="' + key + '"' + (bl ? ' title="' + escapeHtml(bl) + '"' : '') + '>' +
          (blTop ? '<span class="bl">' + escapeHtml(bl) + '</span>' : '') + '</div>';
      } else {
        var n = (pd.slots[key] || []).length;
        var a = n ? 0.15 + 0.85 * n / total : 0;
        html += '<div class="gc' + hr + (n === total && n > 0 ? ' full' : '') + (pdSel === key ? ' sel' : '') + '" data-k="' + key + '"' +
          (n ? ' style="background: rgba(79,78,48,' + a.toFixed(2) + '); border-color: transparent;' + (a > 0.55 ? ' color:#fff;' : '') + '"' : '') +
          ' onclick="pickCell(\'' + key + '\')">' + (n || '') + '</div>';
      }
    }
  }
  html += '</div>';
  var box = document.getElementById(boxId);
  box.innerHTML = html;
  if (!res) {
    bindPaint(box.firstChild);
    document.getElementById('pdBusyLegend').style.display = pd.busy && pd.busy.length ? 'flex' : 'none';
  }
}

// 칸 칠하기
// - 손가락: 탭 = 한 칸 켜기/끄기, 꾹(0.3초) 누른 채 쓸기 = 여러 칸 칠하기, 그냥 쓸기 = 화면 스크롤
// - 마우스: 누른 채 끌면 바로 칠하기
function bindPaint(grid) {
  var mode = null, hold = null, sx = 0, sy = 0, startEl = null;
  function locked() { return document.getElementById('pdSaveBtn').disabled; }
  function cellAt(x, y) { var el = document.elementFromPoint(x, y); if (el && el.classList && el.classList.contains('bl')) el = el.parentNode; return el && el.classList && el.classList.contains('gc') && grid.contains(el) ? el : null; }
  function paint(el) {
    if (!el) return;
    var k = el.getAttribute('data-k');
    if (!!pdMine[k] === mode) return;
    if (mode) pdMine[k] = true; else delete pdMine[k];
    el.classList.toggle('on', mode);
    markPdDirty();
  }
  function begin(el) { mode = !pdMine[el.getAttribute('data-k')]; paint(el); grid.classList.add('painting'); }
  function end() { clearTimeout(hold); hold = null; startEl = null; mode = null; grid.classList.remove('painting'); }
  grid.addEventListener('pointerdown', function(e) {
    var el = cellAt(e.clientX, e.clientY);
    if (!el || locked()) return;
    if (e.pointerType === 'mouse') { e.preventDefault(); begin(el); return; }
    sx = e.clientX; sy = e.clientY; startEl = el;
    hold = setTimeout(function() {
      hold = null;
      if (!startEl) return;
      try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light'); } catch (x) {}
      begin(startEl);
    }, 300);
  });
  grid.addEventListener('pointermove', function(e) {
    if (mode !== null) { paint(cellAt(e.clientX, e.clientY)); return; }
    if (hold && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) { clearTimeout(hold); hold = null; startEl = null; } // 스크롤하는 중
  });
  grid.addEventListener('pointerup', function() {
    if (hold && startEl) { clearTimeout(hold); hold = null; mode = !pdMine[startEl.getAttribute('data-k')]; paint(startEl); } // 짧게 탭
    end();
  });
  grid.addEventListener('pointercancel', end);
  grid.addEventListener('pointerleave', function(e) { if (e.pointerType === 'mouse') end(); });
  // 칠하기 모드일 때만 화면이 같이 움직이지 않게 막음
  grid.addEventListener('touchmove', function(e) { if (mode !== null && e.cancelable) e.preventDefault(); }, { passive: false });
  grid.addEventListener('contextmenu', function(e) { e.preventDefault(); });
}

// ----- 이미 일정이 있는 시간 (고정 일정 · 업무) -----
function busyLabel(di, m, step) {
  if (!pd || !pd.busy || !pd.busy.length || m < pd.h0 * 60) return '';
  var d = pd.dates[di];
  for (var i = 0; i < pd.busy.length; i++) {
    var b = pd.busy[i];
    if (b.date === d && b.from < m + step && b.to > m) return b.label;
  }
  return '';
}
function loadBusy(pollId) {
  weeklyApi('weeklyBusy', { dates: pd.dates }).then(function(list) {
    if (!pd || pd.id !== pollId) return;
    pd.busy = list;
    renderPd();
  }).catch(function() {});
}

// 지난주와 같아요 / 고정 일정 설정 버튼
function renderPdQuick(isTarget) {
  var el = document.getElementById('pdQuick');
  if (!pd.open || !isTarget) { el.innerHTML = ''; return; }
  var h = '';
  if (pd.weekly && pd.prev) h += '<button type="button" class="qbtn main" onclick="copyPrevWeek()">↺ 지난주와 같아요</button>';
  h += '<button type="button" class="qbtn" onclick="goFixedSetting()">⚙ 고정 일정' + (pd.busy && pd.busy.some(function(b) { return b.kind === 'fixed'; }) ? ' 수정' : ' 설정') + '</button>';
  el.innerHTML = h;
}
function copyPrevWeek() {
  if (!pd || !pd.prev) return;
  if (Object.keys(pdMine).length && !confirm('지금 칠한 칸을 지우고 ' + pd.prev.label + ' 입력으로 바꿀까요?')) return;
  pdMine = {};
  pd.prev.slots.forEach(function(k) { pdMine[k] = true; });
  var memo = document.getElementById('pdMemo');
  if (!memo.value.trim() && pd.prev.memo) memo.value = pd.prev.memo;
  markPdDirty();
  renderPd();
  setMsg('pdMsg', pd.prev.label + ' 입력을 불러왔어요. 바뀐 곳만 고치고 저장을 눌러주세요.');
}
function goFixedSetting() {
  if (pdDirty && !confirm('저장하지 않은 칸이 있어요. 그래도 이동할까요?')) return;
  pdDirty = false;
  closePollSheet();
  goTab('profile');
  switchSub('fixed');
}

// ===== 고정 일정 (프로필) =====
var fixedList = null;
var FX_DAYS = ['월', '화', '수', '목', '금', '토', '일']; // 1~7
function fxTimeOptions(sel) {
  var h = '';
  for (var m = 0; m <= 24 * 60; m += 30) { var v = hmStr(m); h += '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + v + '</option>'; }
  return h;
}
function loadFixed() {
  if (!identifiedPerson) return;
  if (fixedList) { renderFixed(); return; }
  document.getElementById('fxList').innerHTML = '<div class="skeleton row-skel"></div>';
  weeklyApi('weeklyGetFixed').then(function(list) { fixedList = list || []; renderFixed(); })
    .catch(function(err) { document.getElementById('fxList').innerHTML = '<div class="empty inner"><b>불러오지 못했어요</b>' + escapeHtml(err.message) + '</div>'; });
}
function renderFixed() {
  var box = document.getElementById('fxList');
  if (!fixedList.length) { box.innerHTML = '<div class="empty inner"><b>아직 고정 일정이 없어요</b>아래 버튼으로 추가해보세요 (예: 직장 월~금 09:00~18:00)</div>'; return; }
  box.innerHTML = fixedList.map(function(f, i) {
    return '<div class="fx-item"><div class="fx-top"><input type="text" maxlength="10" value="' + escapeHtml(f.label) + '" placeholder="직장" oninput="fixedList[' + i + '].label=this.value">' +
      '<button type="button" class="fx-del" onclick="delFixed(' + i + ')">삭제</button></div>' +
      '<div class="fx-days">' + FX_DAYS.map(function(d, j) { return '<button type="button" class="fx-day' + (f.days.indexOf(j + 1) !== -1 ? ' on' : '') + '" onclick="fxDay(' + i + ',' + (j + 1) + ')">' + d + '</button>'; }).join('') + '</div>' +
      '<div class="range-row"><div class="select-wrap"><select onchange="fixedList[' + i + '].from=this.value">' + fxTimeOptions(f.from) + '</select></div><span>~</span>' +
      '<div class="select-wrap"><select onchange="fixedList[' + i + '].to=this.value">' + fxTimeOptions(f.to) + '</select></div></div></div>';
  }).join('');
}
function fxDay(i, d) { var a = fixedList[i].days, k = a.indexOf(d); if (k === -1) a.push(d); else a.splice(k, 1); renderFixed(); }
function addFixed() {
  if (!identifiedPerson) { setMsg('fxMsg', '로그인이 필요해요', true); return; }
  if (!fixedList) fixedList = [];
  if (fixedList.length >= 6) { setMsg('fxMsg', '6개까지 넣을 수 있어요', true); return; }
  fixedList.push(fixedList.length ? { label: '', days: [], from: '19:00', to: '21:00' } : { label: '직장', days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' });
  renderFixed();
}
function delFixed(i) { fixedList.splice(i, 1); renderFixed(); }
function saveFixed() {
  if (!identifiedPerson || !fixedList) return;
  for (var i = 0; i < fixedList.length; i++) {
    var f = fixedList[i];
    if (!String(f.label).trim()) { setMsg('fxMsg', (i + 1) + '번째 일정 이름을 적어주세요 (예: 직장)', true); return; }
    if (!f.days.length) { setMsg('fxMsg', '\'' + f.label + '\' 요일을 골라주세요', true); return; }
    if (f.from >= f.to) { setMsg('fxMsg', '\'' + f.label + '\' 끝나는 시간이 시작보다 늦어야 해요', true); return; }
  }
  var btn = document.getElementById('fxSaveBtn');
  btn.disabled = true; setMsg('fxMsg', '저장 중...');
  weeklyApi('weeklySaveFixed', { list: fixedList }).then(function(r) {
    fixedList = r; renderFixed(); btn.disabled = false; haptic('success');
    setMsg('fxMsg', '저장했어요! 이제 가능시간 칠하는 화면에 음영으로 보여요.');
  }).catch(function(err) { btn.disabled = false; setMsg('fxMsg', err.message, true); });
}

function clearMySlots() {
  if (document.getElementById('pdSaveBtn').disabled) return;
  pdMine = {}; pdDirty = true; renderPd();
}

function saveMySlots() {
  var btn = document.getElementById('pdSaveBtn');
  btn.disabled = true;
  setMsg('pdMsg', '저장 중...');
  var slots = Object.keys(pdMine);
  var memo = document.getElementById('pdMemo').value.trim();
  var req = pd.weekly
    ? weeklyApi('weeklySave', { week: pd.week, slots: slots, memo: memo })
    : postApi('saveTimeAvail', { id: pd.id, slots: slots, memo: memo });
  req.then(function(r) {
    haptic('success');
    pdDirty = false;
    // 결과에 내 칸 반영
    var me = identifiedPerson.id;
    var bs = pd.allSlots || pd.slots, bp = pd.allPeople || pd.people;
    Object.keys(bs).forEach(function(k) { bs[k] = bs[k].filter(function(x) { return x !== me; }); });
    slots.forEach(function(k) { (bs[k] = bs[k] || []).push(me); });
    bp.forEach(function(p) { if (p.id === me) { p.answered = true; p.memo = memo; } });
    if (pd.weekly) { pd.submitted = true; applyWkFilter(); loadWeeklyBanner(); }
    btn.disabled = false;
    renderPd();
    setMsg('pdMsg', r.count ? r.count + '칸 저장했어요! 마감 전까지 언제든 고칠 수 있어요.' : (memo ? '특이사항을 저장했어요.' : '가능한 시간이 없다고 저장했어요.'));
    if (!pd.weekly) loadMyPolls();
  }).catch(function(err) { btn.disabled = false; setMsg('pdMsg', err.message, true); haptic('error'); });
}

function pickCell(k) { pdSel = pdSel === k ? '' : k; renderPd(); }

function renderPdResult() {
  var total = pd.people.length;
  var nameOf = {}; pd.people.forEach(function(p) { nameOf[p.id] = p.name; });
  // 같은 사람들이 되는 연속 칸은 하나로 묶기 (예: 19:00~20:30)
  var runs = [];
  pd.dates.forEach(function(ds, di) {
    var cur = null;
    for (var m = pd.h0 * 60; m < pd.h1 * 60; m += pd.unit) {
      var set = (pd.slots[slotKey(di, m)] || []).slice().sort().join(',');
      if (cur && set && cur.set === set) { cur.end = m + pd.unit; continue; }
      if (cur) runs.push(cur);
      cur = set ? { di: di, start: m, end: m + pd.unit, set: set, n: set.split(',').length } : null;
    }
    if (cur) runs.push(cur);
  });
  runs.sort(function(x, y) { return y.n - x.n || (y.end - y.start) - (x.end - x.start) || x.di - y.di || x.start - y.start; });
  document.getElementById('pdBest').innerHTML = runs.length
    ? '<div class="best"><h3>가장 많이 되는 시간</h3><ol>' + runs.slice(0, 3).map(function(r) {
        return '<li>' + shortDate(pd.dates[r.di]) + ' ' + hmStr(r.start) + '~' + hmStr(r.end) + ' <small>' + r.n + '/' + total + '명' + (r.n === total ? ' · 전원 가능 ✨' : '') + '</small></li>';
      }).join('') + '</ol></div>'
    : '<div class="empty inner"><b>아직 입력한 사람이 없어요</b>응답이 들어오면 여기에 모여요</div>';
  var info = document.getElementById('pdCellInfo');
  if (pdSel) {
    var yes = (pd.slots[pdSel] || []).map(function(id) { return nameOf[id]; });
    var no = pd.people.filter(function(p) { return p.answered && (pd.slots[pdSel] || []).indexOf(p.id) === -1; }).map(function(p) { return p.name; });
    info.innerHTML = '<b>' + slotLabel(pdSel) + '</b><br>가능 ' + yes.length + '명: ' + (yes.length ? escapeHtml(yes.join(', ')) : '없음') +
      (no.length ? '<br>안 됨: ' + escapeHtml(no.join(', ')) : '');
  } else info.textContent = '칸을 누르면 누가 되는지 보여요';
  var memos = pd.people.filter(function(p) { return p.memo; });
  document.getElementById('pdMemos').innerHTML = memos.length
    ? '<div class="memo-list"><h3>📝 특이사항</h3>' + memos.map(function(p) { return '<div><b>' + escapeHtml(p.name) + '</b>' + escapeHtml(p.memo) + '</div>'; }).join('') + '</div>'
    : '';
  var wait = pd.people.filter(function(p) { return !p.answered; }).map(function(p) { return p.name; });
  document.getElementById('pdWho').innerHTML = wait.length ? '<div class="who-row">아직 입력 전 <b>' + wait.length + '명</b>: ' + escapeHtml(wait.join(', ')) + '</div>' : '<div class="who-row"><b>모두 입력했어요 🎉</b></div>';
  document.getElementById('pdCloseBtn').style.display = pd.mine && pd.open ? 'block' : 'none';
}

function closePollUI() {
  if (!confirm('이 취합을 지금 마감할까요? 더 이상 입력할 수 없어요.')) return;
  postApi('closeTimePoll', { id: pd.id }).then(function() { pd.open = false; renderPd(); loadMyPolls(); })
    .catch(function(err) { alert(err.message); });
}


// ===== 주간 녹음 가능시간 (매주 주일 → 다음 주 월~일) =====
// 화면은 시간취합(pd) 화면을 그대로 빌려 씀. 서버 동작 이름은 모두 weekly로 시작.
var pendingWeekly = '';   // 링크로 열었는데 아직 로그인 확인 전
var wkWhich = 'next';
var wkTeam = '';

function weeklyApi(action, data) {
  if (readOnlyAction(action)) return batchRead(action, data);
  var body = Object.assign({ action: action, initData: tgInitData, token: safeGetLocal(TOKEN_KEY) || '' }, data || {});
  var tries = action === 'weeklySave' ? 1 : 3; // 저장은 두 번 들어가면 안 되니 재시도 안 함
  return apiSlot(function() { return fetchJsonRetry(function() { return fetch(API_URL, { method: 'POST', body: JSON.stringify(body) }); }, tries); })
    .then(function(json) { return unwrapApi(json.ok, json.result, json.error); });
}

function setSheetHead(weekly) {
  var h = document.querySelector('#pollSheet .sheet-head');
  h.querySelector('h2').textContent = weekly ? '주간 녹음 가능시간' : '가능시간 취합';
  h.querySelector('small').textContent = weekly ? '매주 주일 22시 마감 · 다음 주 월~일' : '누구나 만들 수 있어요';
}
function resetWeeklyUI() {
  setSheetHead(false);
  document.getElementById('pdBackBtn').style.display = '';
  document.getElementById('pdWeekTabs').style.display = 'none';
  document.getElementById('pdTeamFilter').style.display = 'none';
  document.querySelector('.pd-tab[data-pd="result"]').style.display = '';
}

function openWeekly(which) {
  toggleFab(false);
  which = which === 'this' ? 'this' : 'next';
  var sheetOpen = document.getElementById('pollSheet').classList.contains('open');
  if (sheetOpen && pdDirty && pd && !confirm('저장하지 않은 칸이 있어요. 그래도 넘어갈까요?')) return;
  if (!sheetOpen) openPollSheet(true);
  if (!identifiedPerson) return;
  wkWhich = which; wkTeam = '';
  pd = null; pdDirty = false;
  document.getElementById('pollForm').style.display = 'none';
  document.getElementById('pollListWrap').style.display = 'none';
  document.getElementById('pollDetail').style.display = 'block';
  setSheetHead(true);
  document.getElementById('pdBackBtn').style.display = 'none';
  document.getElementById('pdWeekTabs').style.display = 'flex';
  document.querySelectorAll('.wk-tab').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-wk') === which); });
  document.getElementById('pollSheet').scrollTop = 0;
  document.getElementById('pdTitle').textContent = '불러오는 중...';
  document.getElementById('pdMeta').textContent = '';
  document.getElementById('pdGridMine').innerHTML = '';
  document.getElementById('pdGridRes').innerHTML = '';
  document.getElementById('pdMemo').value = '';
  setMsg('pdMsg', '');
  weeklyApi('weeklyLoad', { which: which }).then(function(r) {
    if (wkWhich !== which) return; // 그새 다른 주를 눌렀으면 무시
    pd = r; pdMine = {}; pdDirty = false; pdPage = 0; pdSel = '';
    pd.allPeople = r.people; pd.allSlots = r.slots;
    r.mySlots.forEach(function(k) { pdMine[k] = true; });
    document.getElementById('pdMemo').value = r.myMemo || '';
    applyWkFilter();
    document.querySelector('.pd-tab[data-pd="result"]').style.display = r.canView ? '' : 'none';
    renderWkChips();
    switchPd('mine');
    if (!r.submitted) setMsg('pdMsg', which === 'next'
      ? '가능한 칸을 칠하고 저장하면 제출돼요. 되는 시간이 없으면 빈 채로 저장해도 돼요.'
      : '이번 주도 바뀐 일정이 있으면 고쳐서 저장해주세요.');
  }).catch(function(err) {
    document.getElementById('pdTitle').textContent = '불러오지 못했어요';
    document.getElementById('pdMeta').textContent = err.message;
  });
}

function weeklyMeta() {
  var all = pd.allPeople || pd.people;
  var done = all.filter(function(p) { return p.answered; }).length;
  var late = !pd.submitted && pd.due && Date.now() > pd.due;
  document.getElementById('pdMeta').innerHTML =
    (pd.submitted ? '<span class="chip dark">제출 완료</span> ' : '<span class="chip' + (late ? ' bad' : '') + '">' + (late ? '미제출 · 마감 지남' : '미제출') + '</span> ') +
    '마감 ' + fmtDate(pd.due) +
    (pd.canView ? ' · 제출 ' + done + '/' + all.length + '명' : '') +
    (pd.target ? '' : ' · 대상 아님(선택 제출)');
}

// 결과 탭: 소속으로 걸러보기 (성우만 / 엔지니어만)
function renderWkChips() {
  var el = document.getElementById('pdTeamFilter');
  if (!pd || !pd.canView) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = [''].concat(pd.teams || []).map(function(t) {
    return '<button type="button" class="wkchip' + (t === wkTeam ? ' active' : '') + '" onclick="pickWkTeam(\'' + escapeHtml(t) + '\')">' + (t ? escapeHtml(t) : '전체') + '</button>';
  }).join('');
}
function pickWkTeam(t) { wkTeam = t; pdSel = ''; applyWkFilter(); renderWkChips(); renderPd(); }

function applyWkFilter() {
  if (!pd || !pd.allPeople) return;
  var ppl = wkTeam ? pd.allPeople.filter(function(p) { return (p.teams || []).indexOf(wkTeam) !== -1; }) : pd.allPeople;
  var ids = {}; ppl.forEach(function(p) { ids[p.id] = true; });
  var s = {};
  Object.keys(pd.allSlots).forEach(function(k) {
    var v = pd.allSlots[k].filter(function(id) { return ids[id]; });
    if (v.length) s[k] = v;
  });
  pd.people = ppl; pd.slots = s;
}

// 홈 알림: 이번 주 미제출(빨강) > 주일에 다음 주 미제출
function loadWeeklyBanner() {
  if (!identifiedPerson) return;
  cachedRead('weeklyStatus', null, function(st) {
    // 녹음자 배치 메뉴(PC)는 결과를 볼 수 있는 사람에게만
    document.getElementById('pcAssignBtn').style.display = st.canView ? 'block' : 'none';
    var el = document.getElementById('weeklyBanner');
    var b = function(which, urgent, title, sub) {
      return '<div class="poll-banner' + (urgent ? ' urgent' : '') + '" onclick="openWeekly(\'' + which + '\')"><span class="pb-i">🎙</span>' +
        '<div><b>' + title + '</b><small>' + sub + '</small></div><span class="pb-go">›</span></div>';
    };
    if (st.this.active && st.this.target && !st.this.submitted) {
      el.innerHTML = b('this', true, '이번 주 녹음 가능시간 미제출', escapeHtml(st.this.label) + ' · 지금이라도 입력해주세요');
    } else if (st.next.active && st.next.target && !st.next.submitted && (st.isSunday || Date.now() > st.next.due)) {
      el.innerHTML = b('next', Date.now() > st.next.due, '다음 주 녹음 가능시간을 입력해주세요', escapeHtml(st.next.label) + ' · 마감 ' + fmtDate(st.next.due));
    } else el.innerHTML = '';
  });
}


// ===== 녹음자 배치 (PC 전용 화면) =====
var asData = null, asWhich = 'next', asSel = '';

function loadAssign(which) {
  asWhich = which === 'this' ? 'this' : 'next';
  document.querySelectorAll('.as-week').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-as') === asWhich); });
  document.getElementById('asMeta').textContent = '불러오는 중...';
  asSel = '';
  weeklyApi('weeklyLoad', { which: asWhich }).then(function(r) {
    asData = r;
    if (!r.canView) {
      document.getElementById('asGrid').innerHTML = '<div class="empty inner"><b>팀장 이상만 볼 수 있어요</b>내 가능시간 입력은 왼쪽 아래 버튼에서 하실 수 있어요</div>';
      document.getElementById('asMeta').textContent = '';
      return;
    }
    renderAssign();
  }).catch(function(err) {
    document.getElementById('asGrid').innerHTML = '<div class="empty inner"><b>불러오지 못했어요</b>' + escapeHtml(err.message) + '</div>';
    document.getElementById('asMeta').textContent = '';
  });
}

function asTeamOf(id) {
  var p = (asData.people || []).find(function(x) { return x.id === id; });
  return p && p.teams && p.teams.length ? p.teams[0] : '기타';
}
function asNameOf(id) {
  var p = (asData.people || []).find(function(x) { return x.id === id; });
  return p ? p.name : id;
}

function renderAssign() {
  var d = asData, W = WEEKDAYS;
  var done = d.people.filter(function(p) { return p.answered; }).length;
  document.getElementById('asMeta').textContent = d.title + ' · 제출 ' + done + '/' + d.people.length + '명';

  var step = d.unit, html = '<div class="tgrid res" style="grid-template-columns: 40px repeat(7, 1fr);">';
  html += '<div></div>' + d.dates.map(function(s) {
    var p = s.split('-'), dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])), w = dt.getUTCDay();
    return '<div class="gh' + (w === 0 ? ' sun' : w === 6 ? ' sat' : '') + '"><b>' + (+p[1]) + '/' + (+p[2]) + '</b>' + W[w] + '</div>';
  }).join('');
  var total = d.people.length || 1;
  for (var m = d.h0 * 60; m < d.h1 * 60; m += step) {
    var top = m % 60 === 0;
    html += '<div class="gt' + (top ? ' hr' : '') + '">' + (top ? (m / 60) + '시' : '') + '</div>';
    for (var i = 0; i < d.dates.length; i++) {
      var key = i + '-' + m;
      var ids = d.slots[key] || [];
      var a = ids.length ? 0.15 + 0.85 * ids.length / total : 0;
      html += '<div class="gc' + (top ? ' hr' : '') + (asSel === key ? ' sel' : '') + '" onclick="asPickCell(\'' + key + '\')"' +
        (ids.length ? ' style="background: rgba(79,78,48,' + a.toFixed(2) + '); border-color: transparent;' + (a > 0.55 ? ' color:#fff;' : '') + '"' : '') +
        '>' + (ids.length || '') + '</div>';
    }
  }
  document.getElementById('asGrid').innerHTML = html + '</div>';
  asRenderSide();
}

function asPickCell(key) { asSel = asSel === key ? '' : key; renderAssign(); }

function asRenderSide() {
  var d = asData;
  // 1) 고른 칸: 팀별로 누가 되는지
  var pick = document.getElementById('asPick');
  if (!asSel) {
    pick.innerHTML = '<div class="empty inner"><b>칸을 눌러보세요</b>그 시간에 되는 사람이 팀별로 나와요</div>';
  } else {
    var di = +asSel.split('-')[0], min = +asSel.split('-')[1];
    var ids = d.slots[asSel] || [];
    var byTeam = {};
    (d.teams || []).concat(['기타']).forEach(function(t) { byTeam[t] = []; });
    ids.forEach(function(id) { var t = asTeamOf(id); (byTeam[t] = byTeam[t] || []).push(asNameOf(id)); });
    var p = d.dates[di].split('-');
    var label = (+p[1]) + '/' + (+p[2]) + ' ' + pad(Math.floor(min / 60)) + ':' + pad(min % 60) + '~' + pad(Math.floor((min + d.unit) / 60)) + ':' + pad((min + d.unit) % 60);
    var html = '<div class="as-slot">' + label + ' · 가능 ' + ids.length + '명</div>';
    Object.keys(byTeam).forEach(function(t) {
      if (!byTeam[t].length) return;
      html += '<div class="as-team"><b>' + escapeHtml(t) + ' ' + byTeam[t].length + '명</b><div class="as-names">' +
        byTeam[t].map(function(n) { return '<span class="as-name">' + escapeHtml(n) + '</span>'; }).join('') + '</div></div>';
    });
    if (!ids.length) html += '<div class="as-team"><b>되는 사람이 없어요</b></div>';
    var memos = d.people.filter(function(x) { return x.memo && ids.indexOf(x.id) !== -1; });
    if (memos.length) html += '<div class="memo-list"><h3>📝 특이사항</h3>' + memos.map(function(x) {
      return '<div><b>' + escapeHtml(x.name) + '</b>' + escapeHtml(x.memo) + '</div>';
    }).join('') + '</div>';
    pick.innerHTML = html;
  }

  // 2) 성우+엔지니어가 함께 되는 시간 순위
  var teams = d.teams || [];
  var rows = [];
  d.dates.forEach(function(ds, di) {
    for (var m = d.h0 * 60; m < d.h1 * 60; m += d.unit) {
      var key = di + '-' + m, ids = d.slots[key] || [];
      if (!ids.length) continue;
      var cnt = {};
      ids.forEach(function(id) { var t = asTeamOf(id); cnt[t] = (cnt[t] || 0) + 1; });
      var allTeams = teams.every(function(t) { return cnt[t]; });
      rows.push({ key: key, di: di, m: m, n: ids.length, all: allTeams, cnt: cnt });
    }
  });
  rows.sort(function(a, b) { return (b.all - a.all) || (b.n - a.n) || a.di - b.di || a.m - b.m; });
  var best = document.getElementById('asBest');
  best.innerHTML = rows.length
    ? '<h3>많이 되는 시간</h3><ul class="as-best">' + rows.slice(0, 8).map(function(r) {
        var p = d.dates[r.di].split('-');
        return '<li onclick="asPickCell(\'' + r.key + '\')"><span>' + (+p[1]) + '/' + (+p[2]) + ' ' + pad(Math.floor(r.m / 60)) + ':' + pad(r.m % 60) + '</span>' +
          '<small>' + teams.map(function(t) { return t.replace('팀', '') + ' ' + (r.cnt[t] || 0); }).join(' · ') + (r.all ? ' ✨' : '') + '</small></li>';
      }).join('') + '</ul>'
    : '';

  // 3) 아직 안 낸 사람
  var miss = d.people.filter(function(x) { return !x.answered; });
  document.getElementById('asMiss').innerHTML = miss.length
    ? '<h3>아직 입력 전 ' + miss.length + '명</h3><div class="as-names">' + miss.map(function(x) {
        return '<span class="as-name off">' + escapeHtml(x.name) + '</span>';
      }).join('') + '</div>'
    : '<h3>모두 입력했어요 🎉</h3>';
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

var lastDashAt = 0;
function loadDashboard() {
  lastDashAt = Date.now();
  return cachedRead('getDashboard', { personId: currentPersonId() }, function(d) {
    dashData = d;
    renderManager();
  }, function(err, hadCache) {
    if (hadCache) return;
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

// ===== 모임 공지 폼 (팀 · 모임유형 · 고정모임 자동 입력) =====
var nfData = null;   // { teams:[], types:[{id,name,team}], fixed:[{team,typeId,typeName,day,start,end,place}] }
var nfTeam = '';

function loadMeetingTypes() {
  cachedRead('getMeetingForm', null, function(d) {
    nfData = d || { teams: [], types: [], fixed: [] };
    renderNoticeForm();
  }, function(err, hadCache) {
    if (!hadCache) setMsg('adminMsg', '오류: ' + err.message, true);
  });
}

function renderNoticeForm() {
  var teams = nfData.teams || [];
  if (teams.indexOf(nfTeam) === -1) nfTeam = teams[0] || '';
  document.getElementById('nfTeamWrap').style.display = teams.length > 1 ? 'block' : 'none';
  document.getElementById('nfTeams').innerHTML = teams.map(function(t) {
    return '<button type="button" class="tchip' + (t === nfTeam ? ' active' : '') + '" data-team="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>';
  }).join('');
  renderNoticeTypes();
}

// 선택한 팀에서 쓸 수 있는 모임유형 (모임유형 시트의 '팀'이 비었거나 '전체'면 모든 팀에 보임)
function nfTypesFor(team) {
  return (nfData.types || []).filter(function(t) {
    return !t.team || t.team === '전체' || !team || t.team.indexOf(team) !== -1;
  });
}

// 이 팀 + 이 모임유형의 고정모임 (팀이 딱 맞는 것 우선, 없으면 팀이 비었거나 '전체'인 것)
function nfFixedOf(typeId) {
  if (!nfData || !typeId) return null;
  var list = (nfData.fixed || []).filter(function(f) { return f.typeId === typeId; });
  return list.filter(function(f) { return f.team === nfTeam; })[0] ||
         list.filter(function(f) { return !f.team || f.team === '전체'; })[0] || null;
}

function renderNoticeTypes() {
  var sel = document.getElementById('noticeTypeSelect');
  var prev = sel.value;
  var list = nfTypesFor(nfTeam);
  sel.innerHTML = '<option value="">모임유형을 선택하세요</option>' + list.map(function(t) {
    return '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + (nfFixedOf(t.id) ? ' 📌' : '') + '</option>';
  }).join('');
  if (prev && list.some(function(t) { return t.id === prev; })) sel.value = prev;
  else { sel.value = ''; showPresetInfo(null); }
  updateFixedCheck();
}

document.getElementById('nfTeams').addEventListener('click', function(e) {
  var b = e.target.closest('.tchip');
  if (!b) return;
  nfTeam = b.getAttribute('data-team');
  document.querySelectorAll('#nfTeams .tchip').forEach(function(x) { x.classList.toggle('active', x === b); });
  renderNoticeTypes();
  if (document.getElementById('noticeTypeSelect').value) applyFixedPreset();
});

// 모임유형을 고르면: 고정모임이 있으면 다음 해당 요일·시간·장소를 자동으로 채움
function applyFixedPreset() {
  var f = nfFixedOf(document.getElementById('noticeTypeSelect').value);
  showPresetInfo(f);
  updateFixedCheck();
  if (!f) return;
  var dt = nextDateFor(f.day, f.start);
  if (dt) document.getElementById('noticeDatetime').value = dt;
  document.getElementById('noticeEnd').value = f.end || '';
  if (f.place) setNoticePlace(f.place);
  try { if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged(); } catch (e) {}
}

// 가장 가까운 그 요일 (오늘이 그 요일이고 아직 시작 전이면 오늘) → "2026-09-26T13:00"
function nextDateFor(day, start) {
  var hm = /^(\d{1,2}):(\d{2})$/.exec(start || '');
  if (!hm) return '';
  var now = new Date();
  var d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(hm[1]), Number(hm[2]));
  var idx = WEEKDAYS.indexOf(day);
  if (idx !== -1) {
    var add = (idx - d.getDay() + 7) % 7;
    if (add === 0 && d.getTime() <= now.getTime()) add = 7;
    d.setDate(d.getDate() + add);
  } else if (d.getTime() <= now.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// 장소 목록에 없는 장소면 목록에 추가해서 선택
function setNoticePlace(place) {
  var sel = document.getElementById('noticePlace');
  var has = Array.prototype.some.call(sel.options, function(o) { return o.value === place; });
  if (!has) {
    var opt = document.createElement('option');
    opt.value = place; opt.textContent = place;
    sel.appendChild(opt);
  }
  sel.value = place;
}

function showPresetInfo(f) {
  var el = document.getElementById('nfPreset');
  if (!f) { el.style.display = 'none'; el.innerHTML = ''; return; }
  var when = (f.day ? '매주 ' + f.day + ' ' : '') + (f.start || '') + (f.end ? '~' + f.end : '');
  el.innerHTML = '<b>📌 고정모임 설정을 불러왔어요</b><small>' + escapeHtml(when) + (f.place ? ' · ' + escapeHtml(f.place) : '') +
    ' — 이번만 다르면 아래에서 바꾸면 돼요</small>';
  el.style.display = 'block';
}

function updateFixedCheck() {
  var typeId = document.getElementById('noticeTypeSelect').value;
  var row = document.getElementById('nfFixedRow');
  document.getElementById('nfSaveFixed').checked = false;
  row.style.display = typeId ? 'flex' : 'none';
  if (!typeId) return;
  document.getElementById('nfFixedLabel').textContent = nfFixedOf(typeId)
    ? '📌 고정모임 설정을 지금 입력한 값으로 바꾸기'
    : '📌 이 설정을 고정모임으로 저장 (다음부터 자동 입력)';
}

// 방금 저장한 고정모임을 폰에 바로 반영 (서버 다시 안 불러도 다음 공지에 바로 적용)
function rememberFixedLocally(typeId, datetime, end, place) {
  if (!nfData) return;
  var t = (nfData.types || []).filter(function(x) { return x.id === typeId; })[0];
  var team = nfTeam || (t && t.team) || '전체';
  var d = new Date(datetime);
  var f = { team: team, typeId: typeId, typeName: t ? t.name : '', day: WEEKDAYS[d.getDay()],
            start: pad(d.getHours()) + ':' + pad(d.getMinutes()), end: end || '', place: place };
  nfData.fixed = (nfData.fixed || []).filter(function(x) { return !(x.typeId === typeId && x.team === team); });
  nfData.fixed.push(f);
  safeRemoveLocal('c_getMeetingForm');
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
  var end = document.getElementById('noticeEnd').value;
  var saveFixed = document.getElementById('nfSaveFixed').checked;

  if (!typeId || !datetime || !place) { setMsg('adminMsg', '모임유형·시작·장소를 입력해주세요!', true); return; }
  if (end && end <= datetime.slice(11, 16)) { setMsg('adminMsg', '끝나는 시간이 시작 시간보다 늦어야 해요!', true); return; }

  var btn = document.getElementById('noticeSubmitBtn');
  btn.disabled = true;
  setMsg('adminMsg', '저장 중...');

  postApi('createMeeting', { typeId: typeId, datetime: datetime, end: end, place: place, team: nfTeam, saveFixed: saveFixed }).then(function(r) {
    if (saveFixed) rememberFixedLocally(typeId, datetime, end, place);
    setMsg('adminMsg', saveFixed && r && r.fixedSaved ? '저장 완료! 고정모임 설정도 저장했어요 📌' : '저장 완료!');
    haptic('success');
    btn.disabled = false;
    document.getElementById('noticeDatetime').value = '';
    document.getElementById('noticeEnd').value = '';
    document.getElementById('noticePlace').value = '';
    if (nfData) renderNoticeTypes();
    document.getElementById('noticeTypeSelect').value = '';
    showPresetInfo(null);
    updateFixedCheck();
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
  // 메뉴 맨 아래에 텔레그램 연결 상태 표시 (문제 확인용)
  var foot = document.querySelector('.drawer-foot');
  if (foot) {
    foot.textContent = '방송예술과 미니앱 · ' + (tgInitData ? '텔레그램 서명 ✓' : '텔레그램 서명 없음') +
      ' [' + (tg ? (tg.platform || 'unknown') + ' v' + (tg.version || '?') : 'SDK없음') +
      ' · ' + (tgSource || '-') + ' · hash:' + (/tgWebApp/.test(location.hash) ? 'Y' : 'N') + ']';
  }
  loadPeople();
  autoLogin();
  // 봇 버튼에서 ?tab=attend 처럼 열면 그 탭으로 바로 이동
  try {
    var startTab = new URLSearchParams(location.search).get('tab');
    if (['home', 'notice', 'attend', 'task'].indexOf(startTab) !== -1) goTab(startTab);
    // 봇 알림의 '가능시간 입력하기' 버튼 (?poll=ID): 로그인 확인되면 바로 그 취합을 엶
    var startPoll = new URLSearchParams(location.search).get('poll');
    if (startPoll && /^TP\w+$/.test(startPoll)) { if (identifiedPerson) openPollDetail(startPoll); else pendingPollId = startPoll; }
    // 봇 독촉 알림의 '입력하러 가기' 버튼 (?weekly=next|this)
    var startWk = new URLSearchParams(location.search).get('weekly');
    if (startWk === 'next' || startWk === 'this') { if (identifiedPerson) openWeekly(startWk); else pendingWeekly = startWk; }
  } catch (e) {}
  // 5분마다 대시보드 새로고침 (앱을 보고 있을 때만 — 가려져 있으면 건너뜀)
  setInterval(function() {
    if (document.visibilityState === 'visible' && document.getElementById('page-home').classList.contains('active')) loadDashboard();
  }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && Date.now() - lastDashAt > 5 * 60 * 1000) loadDashboard();
  });
})();
