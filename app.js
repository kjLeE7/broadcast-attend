// ===== 설정 =====
var API_URL = 'https://script.google.com/macros/s/AKfycbz5rjT76_NTywRcYDL5BOXKKbfaBZm-V3Fk82_0z5qngfTs2NUDueX0irFH5Uaqi7Hm/exec';
var DEFAULT_DURATION_HOURS = 3; // 끝나는 시간이 없으면 시작 후 3시간을 '진행 중'으로 봄

var STORAGE_KEY_ID = 'myPersonId';
var STORAGE_KEY_NAME = 'myPersonName';
var identifiedPerson = null;
var telegramId = null;
var meetingsCache = [];

var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ===== 텔레그램 연동 =====
var tg = (window.Telegram && Telegram.WebApp) ? Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#F4F1EC'); tg.setBackgroundColor('#F4F1EC'); } catch (e) {}
  var u = tg.initDataUnsafe && tg.initDataUnsafe.user;
  if (u && u.id) telegramId = u.id;
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

// ===== 저장소(이 폰 기억) =====
function safeGetLocal(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeSetLocal(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
function safeClearLocal() {
  try { localStorage.removeItem(STORAGE_KEY_ID); localStorage.removeItem(STORAGE_KEY_NAME); } catch (e) {}
}

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
function setIdentity(person) {
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
  document.getElementById('manualSelectBlock').style.display = 'none';
  checkAndShowAdmin(person.id);
}

function forgetMe() {
  safeClearLocal();
  if (telegramId) callApi('unlinkTelegramId', { telegramId: telegramId }).catch(function() {});
  identifiedPerson = null;
  document.getElementById('greeting').textContent = '반가워요 👋';
  ['avatar', 'drawerAvatar', 'profileAvatar'].forEach(function(id) { document.getElementById(id).textContent = '?'; });
  document.getElementById('drawerName').textContent = '게스트';
  document.getElementById('profileName').textContent = '이름을 먼저 선택해주세요';
  document.getElementById('profileRole').textContent = '출결 탭에서 본인 이름을 고르면 표시돼요';
  document.getElementById('welcome').style.display = 'none';
  document.getElementById('manualSelectBlock').style.display = 'block';
  hideAdminUI();
}

function currentPersonId() {
  return identifiedPerson ? identifiedPerson.id : document.getElementById('personSelect').value;
}
function currentPersonName() {
  if (identifiedPerson) return identifiedPerson.name;
  var sel = document.getElementById('personSelect');
  return sel.value && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
}

function trySavedLocal(people) {
  var savedId = safeGetLocal(STORAGE_KEY_ID);
  var savedName = safeGetLocal(STORAGE_KEY_NAME);
  if (!savedId) return;
  var stillExists = people.some(function(p) { return String(p.id) === String(savedId); });
  if (stillExists) setIdentity({ id: savedId, name: savedName });
  else safeClearLocal();
}

// ===== 교관 이상 메뉴 =====
function hideAdminUI() {
  document.getElementById('adminCard').style.display = 'none';
}
function checkAndShowAdmin(personId) {
  if (!personId) { hideAdminUI(); return; }
  callApi('checkAdmin', { personId: personId }).then(function(isAdmin) {
    if (isAdmin) {
      document.getElementById('adminCard').style.display = 'block';
      if (identifiedPerson && String(identifiedPerson.id) === String(personId)) {
        document.getElementById('profileRole').textContent = '방송예술과 · 교관 이상';
      }
    } else hideAdminUI();
  }).catch(function() {});
}

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
    sel.addEventListener('change', function() { checkAndShowAdmin(sel.value); });

    if (telegramId) {
      // 텔레그램 계정 기준 자동인식 (기기 안 가리고 인식됨)
      document.getElementById('rememberRow').style.display = 'none';
      callApi('findPersonByTelegramId', { telegramId: telegramId }).then(function(person) {
        if (person) setIdentity(person);
        else trySavedLocal(people);
      }).catch(function() { trySavedLocal(people); });
    } else {
      trySavedLocal(people);
    }
  }).catch(function(err) {
    document.getElementById('debug').textContent += '\n인물목록 오류: ' + err.message;
  });
}

// ===== 출결 제출 =====
function submitForm() {
  var classId = document.getElementById('classSelect').value;
  var personId = currentPersonId();
  var personName = currentPersonName();

  if (!classId) { setMsg('msg', '출결할 모임을 선택해주세요!', true); return; }
  if (!personId) { setMsg('msg', '본인 이름을 선택해주세요!', true); return; }

  var status = document.querySelector('input[name="status"]:checked').value;
  var reason = document.getElementById('reason').value;
  if (status !== '참석' && !reason.trim()) { setMsg('msg', status + ' 사유를 적어주세요!', true); return; }

  var btn = document.getElementById('submitBtn');
  btn.disabled = true;
  setMsg('msg', '제출 중...');

  var payload = JSON.stringify({ classId: classId, personId: personId, personName: personName, status: status, reason: reason });

  callApi('submitAttendance', { data: payload }).then(function() {
    setMsg('msg', '제출 완료! 수고하셨어요 🙌');
    haptic('success');
    btn.disabled = false;
    document.getElementById('reason').value = '';

    if (!identifiedPerson) {
      if (telegramId) {
        callApi('linkTelegramId', { personId: personId, telegramId: telegramId }).catch(function() {});
        setIdentity({ id: personId, name: personName });
      } else {
        var remember = document.getElementById('rememberMe');
        if (remember && remember.checked) {
          safeSetLocal(STORAGE_KEY_ID, personId);
          safeSetLocal(STORAGE_KEY_NAME, personName);
          setIdentity({ id: personId, name: personName });
        }
      }
    }
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

  var payload = JSON.stringify({
    typeId: typeId, datetime: datetime, place: place,
    personId: currentPersonId(), hostName: currentPersonName()
  });

  var btn = document.getElementById('noticeSubmitBtn');
  btn.disabled = true;
  setMsg('adminMsg', '저장 중...');

  callApi('submitNotice', { data: payload }).then(function() {
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
  loadPeople();
  setInterval(renderDashboard, 60 * 1000); // 1분마다 진행 중/예정 다시 계산
})();
