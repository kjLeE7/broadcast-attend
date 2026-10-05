# CLAUDE.md — 방송예술과 텔레그램 미니앱 인수인계

새 대화에서 이 저장소 작업을 이어갈 때 먼저 읽는 문서예요.
(마지막 정리: 2026-10-04 밤, 홈 개편·녹음 요청(배역·회차·수락/조율)·보안 점검·시간취합·봇 채팅 답장 이전까지. 함수 버전 33)

## 0. 클로드 코드(터미널)에서 이어서 할 때

- 지금까지는 claude.ai 앱의 Claude가 클라우드 작업 공간에서 작업했어요. 2026-10-04부터 사용자 컴퓨터의 클로드 코드로도 이어서 해요.
  사용자는 `headroom wrap claude` 명령으로 클로드 코드를 켜요. **저장소 폴더 안에서 켜야** 이 문서가 자동으로 읽혀요.
- **Supabase 연결**: 저장소 루트의 `.mcp.json`에 Supabase MCP(이 프로젝트 `bundxpidywrcrwhhgclv`만, 문서·DB·디버깅·개발·함수 기능)가 들어 있어요.
  처음 켜면 "이 MCP 서버를 쓸까요?"를 승인하고, `/mcp` → supabase → Authenticate로 브라우저에서 Supabase 로그인하면 돼요(토큰 따로 필요 없음).
  MCP 도구 이름은 claude.ai 쪽과 같아요: `apply_migration`, `execute_sql`, `deploy_edge_function`, 로그 보기(`get_logs` 또는 `query_logs`, 버전마다 이름이 달라요) 등.
- **좋아진 점**: 사용자 컴퓨터에서는 Supabase 주소로 직접 요청이 돼요. claude.ai 작업 공간에선 막혀 있어서 실제 서버를 한 번도 못 불러 봤는데,
  여기선 `dashboard.scene`, `profile.report` 같은 걸 실제로 확인할 수 있어요(아래 '아직 확인 못 한 것' 참고).
- **푸시**: 사용자 본인 GitHub 계정으로 푸시돼요. 커밋 작성자는 7번 규칙대로.
- **조직·권한 원본 문서**(`claude/조직현황.md`, `claude/권한설계.md`)는 claude.ai 프로젝트 "문화"에 있어서 클로드 코드에선 못 읽어요.
  핵심은 이 문서 5·6번에 요약돼 있어요. 규칙이 바뀌면 이 문서를 고치고, 사용자에게 "claude.ai 프로젝트 문서도 같이 고쳐야 해요"라고 알려주세요.
  (저장소가 공개라 그 문서들을 저장소에 그대로 올리진 않았어요. 활동 장소·인원 같은 조직 정보가 들어 있어서요.)
- **사용자 성향**: 결과를 바로 보고 싶어 해요. 화면을 바꾸면 무엇이 달라졌는지 짧게, 쉬운 말로. 결정이 필요하면 선택지를 짧게 주고 물어봐요.

## 0-0. 다음 세션 시작할 때 (2026-10-04 정리)

- **먼저 할 일**: 이 문서를 읽고, 사용자에게 "지난번 이어서 뭐부터 할까요?"를 짧게 묻기. 사용자의 기억(메모리)에 결정사항·보안 남은 일이 정리돼 있음
  (공개 저장소라 보안 관련 남은 일·계정 상태는 여기 안 적고 메모리에만 둠).
- **대기 중인 사용자 결정·자료**
  1. 저장소 비공개 전환(2026-10-04 사용자가 진행): **무료 플랜은 비공개 저장소에서 GitHub Pages가 꺼짐** → GitHub Pro로 올린 뒤 비공개로.
     함수 배포는 아래 3번 '문지기 배포 방법'대로 파일을 직접 올리는 방식으로 바꿨음(raw.githubusercontent는 비공개면 못 가져옴).
     이미 배포된 버전 31은 배포할 때 코드가 묶여 저장돼서(eszip) 비공개로 바꿔도 계속 돌아감.
  2. 옛 운영 앱 Apps Script 점검 → 2026-10-04 고친 Code.gs·WeeklyAvail.gs를 사용자에게 줌(사용자가 붙여넣고 새 버전 배포). 받은 코드는 저장소에 올리지 않기.
  3. 정식 런칭 때 **테스트 데이터 초기화** + **서버 키 교체**. 초기화 SQL은 아직 안 만듦(만들면 저장소엔 파일만, 실행은 사용자 승인 뒤).
- **작업 환경 메모 (claude.ai 클라우드 작업 공간)**
  - 저장소 `.mcp.json`의 Supabase MCP는 여기선 프록시 오류로 안 붙음 → claude.ai의 Supabase 커넥터(`mcp__Supabase__*`, ToolSearch로 불러옴)로 SQL·배포·마이그레이션 함.
  - 쉘에서 Supabase 주소로 직접 요청은 막힘 → 배포 확인은 SQL `select net.http_post(url:='…/functions/v1/api', body:='{"action":"public.bot"}'::jsonb, headers:='{"Content-Type":"application/json"}'::jsonb);`
    뒤 `net._http_response`에서 결과 확인. cron 경로는 `x-cron-secret`에 `vault.decrypted_secrets`의 `cron_secret`.
  - 화면 확인: 저장소 루트에서 `python3 -m http.server 8770` → Playwright(Chromium `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `timezone_id='Asia/Seoul'`)로
    `beta/index.html`을 열고 `window.api = api = 가짜함수`로 바꿔 끼워 그림(외부 주소는 route로 막기). full_page 스크린샷은 오른쪽 패널 애니메이션 때문에 흐리게 찍히니 화면 크기 스크린샷 사용.
  - 커밋: `git -c user.name=Claude -c user.email=noreply@anthropic.com commit` + 메시지 끝 Co-Authored-By 줄, `git push origin HEAD:main`.
- **시범 인원 상태**: 6명 중 3명은 봇 Start를 아직 안 눌러 알림·메뉴 버튼이 안 감(이 문서 2번 '봇 왼쪽 아래 메뉴 버튼' 참고). 시범 인원 중 엔지니어팀이 없고 업무가능 시간도 아직 없어 녹음 '가능한 시간'은 비어 보임.

## 0-1. 지금까지 한 일 (시간 순 요약)

1. 2026-10-03 이전: 운영 앱(구글시트+Apps Script) 사용 중 → Supabase로 옮기기로 하고 DB 설계, 문지기 함수, 권한 체계 구축.
2. 베타 앱(`beta/`)에 출결·주간 녹음가능·공지·과제·체크인·홈 대시보드 이전. 시범 인원 5명 등록.
3. 모임·출결 흐름 완성(사전 체크 → 현장 확인 → 자동 마감 → 사유 → 월간 리포트). 함수 버전 11.
4. 동네지도(PC 전용 도트 그림 탭) + `places` 표 + `dashboard.scene`. 함수 버전 12.
5. 2026-10-04:
   - PC 왼쪽 메뉴 접기/펴기, 메뉴 글씨 크게.
   - 글꼴: 처음엔 전부 고운바탕 → 사용자 요청으로 **제목만 고운바탕, 나머지 프리텐다드**.
   - PC 배치 원칙: 평소 화면 전체 사용, 상세는 오른쪽 패널로 들어옴(출결·과제·프로필).
   - 등록 안 된 사람에게 텔레그램 번호 크게 표시. 함수 버전 13.
   - 화면 제목 한국어로(함께한 자리·한 달의 발자취·전하는 말·갈고닦는 시간·업무가능 시간 취합·나의 기록).
   - 프로필 '나의 기록' 탭(내 정보 고치기, 한 달 활동 리포트). 함수 버전 14.
   - 홈: 파트 사이 줄·여백, 파트 제목 크게 + 왼쪽 색 막대, PC 반반 사이 세로줄.
   - 공지 쓰기를 FAB + 팀·직책·조 칩으로 바꿈. 함수 버전 15.
   - **만들기는 전부 FAB + 팝업**: 공지 쓰기·체크인 만들기·모임 만들기·과제 내기. PC는 화면 가운데, 폰은 아래에서 올라오는 시트.
     공통 함수 `openModal(id)` / `closeModal(id?)` (beta.js), 팝업 마크업은 index.html 맨 아래 `.b-modal` 네 개(`annModal`·`ciModal`·`cModal`·`hwModal`).
     출결 FAB(`#attFab`)는 만들 수 있는 게 둘이면 작은 메뉴가 펼쳐지고, 하나면 바로 팝업. 과제는 `#hwFab`. 예전 접었다 펴는 만들기 카드는 없앰.
     ✕ · 바깥 누르기 · Esc · 텔레그램 뒤로가기로 닫힘. 닫아도 적던 글은 남아 있음. 새 '만들기' 화면도 이 방식으로.
   - **'녹음가능' → '업무가능'**: 성우는 녹음, 아나운서는 사회·촬영, 엔지니어는 엔지니어링이라 팀 상관없이 부르는 이름으로 통일.
     탭 '업무가능', 화면 제목 '업무가능 시간 취합', 알림 문구도 '업무가능 시간'. (코드·DB 이름은 그대로 weekly·availability)
   - 고정 일정 카드: 왼쪽 = 등록·수정(`#fxList`), 오른쪽 = 저장된 고정 일정 목록(`#fxSaved`, `W.fixedSaved`, 요일 칸·'월~금 · 주 45시간'). 접기 없앰. 폰은 위아래.
   - **아래 탭 정리**: 폰 = 홈·출결·공지·(녹음)·프로필, PC = 홈·동네지도·출결·공지·(녹음)·프로필. 녹음 탭은 교관 이상만(`setupRecTab`). 과제·업무가능 탭은 없앰(화면 `taskView`·`weeklyView`와 `curTab` 값 'task'·'weekly'는 그대로).
     과제 = 공지 안 [공지|과제] 칩(`goTask('notice')`, 과제 내기 FAB는 여기서만) + 프로필 [나의 기록|내 과제|업무가능] 칩(`goTask('profile')`).
     업무가능 = 프로필 안 칩. 아래 탭 강조는 `parentTab()`(weekly→profile, task→`taskFrom`). 칩 줄은 `.b-attseg` + `.wkchip`, 과제 쪽은 `renderTaskSeg()`.
     동네지도는 `townAllowed()` = 폰 아님 + 가로 1000px 이상. 창 크기 바뀌면 `setupTownTab()`으로 다시 판단, 탭 칸 수도 보이는 개수로.
   - **대상 고르기·내 양식 공통화**(함수 버전 25): 모임·과제·체크인·공지 팝업 모두 같은 고르기 + 같은 양식 줄.
     beta.js `pk*` 함수(팝업 키 k: c=모임, hw=과제, ci=체크인, ann=공지, 그리는 곳 `#{k}Pick`), 명단은 `loadRoster()` = `sessions.audience`(팀별 `my_rank` 포함) 한 번만.
     `PCFG[k]` = 팀 칩이 보이는 서열(min: 모임 조장, 나머지 교관) / 전체 칩 서열(all: 팀장) / 직책 줄(pos: 공지만) / dynAll(공지만: 과 전체를 통째로면 예전 section 공지).
     `pkPayload(k)` → `{team_id, scope, target_people?, target_label?}`. 팀 하나 통째면 사람 목록 없이 예전처럼 팀 대상.
     양식은 `tpl*` 함수 + `TPLF[k].get/set`(날짜·마감은 안 담음), kind = session·assignment·checkin·notice, 대상은 `data.target`(key·subs·pos·off).
     서버 공통 검사 `pickedPeople(ctx, p, 팀서열, 전체서열)`, 사람으로 집은 과제·체크인 보고·제출은 `requireItemMember`.
     `notices`·`assignments`·`checkins`에도 `target_people`·`target_label`. 목록은 다른 팀 글이라도 `target_people`에 내가 있으면 같이 보임(공지 scope 'other').
     제출·체크인 현황 명단은 `targetList(item)`(사람으로 집었으면 roster에서 이름). 공지 직책은 사람의 그 팀 직책(roster `pos[unit]`) 이름으로 거름.
   - **프로필 → '개인노트'** + **지금 할 일**(함수 버전 26): 아래 탭 이름·아이콘(노트) 바꿈, 화면 제목 '개인노트'(칩 '나의 기록'은 그대로).
     `todos.list` = 내 모든 팀에서 바로 해야 할 것: 업무가능 미제출(이번 주는 NAG_FROM 이후 주만, 다음 주는 마감 3일 전부터) · 사전체크 안 한 모임 ·
     사유 안 쓴 지각/불참/조퇴 · 안 낸 과제(마감 전, 대상인 것, 내가 낸 것 제외) · 안 읽은 공지(2주 안) · 오늘 체크인 남은 항목. 기존 list 액션들을 안에서 불러 씀.
     개인노트 맨 위 `#todoArea`(누르면 그 화면으로 `openTodo`). 2026-10-05부터 개인노트 칩 화면(내 과제·업무가능·시간취합) 위에도 같은 목록(`.todo-area`, `setTodoHtml`, 과제는 개인노트에서 왔을 때만 `#todoAreaTask`), 아래 탭 아이콘에 빨간 숫자 배지 `#todoBadge`(PC 펼친 메뉴는 줄 오른쪽 끝).
     `refreshTodos(force)`: 처음 들어올 때·탭 바꿀 때(30초 간격)·3분마다·다시 보일 때·저장 뒤(사전체크·사유·업무가능·과제 제출·공지 읽음·체크인 보고).
     홈의 업무가능 미제출 배너는 없앰(출결 탭의 '사유/사전체크' 상자는 그대로).
   - **홈 대시보드 개편**(함수 버전 27): 오늘의 트랙 → 준비 중·프로젝트·사명자 일정 세 칸 → 한 달 달력 → 12지파. 아래 '홈 대시보드' 참고.
   - **녹음 요청**(함수 버전 28): 아래 탭 '녹음'(세 팀 교관 이상만). 아래 '녹음 요청' 참고.
   - **녹음 배역·회차·수락/조율**(함수 버전 29): 배역별 지정/후보, 회차 여러 개, 엔지니어 교대, 받은 사람 수락/조율, 인력 배치 현황판.
   - **보안 점검**(함수 버전 30·31): 아래 '보안 점검' 참고. 사용자는 계정 2단계 인증을 진행 중(상세는 메모리).
   - **운영 앱 → 베타 완전 이전 시작**(2026-10-04): 목표는 Apps Script를 없애고 '레시피는 GitHub, 주방은 Supabase'로. 첫 단계로 **시간취합** 옮김(함수 버전 32, 아래 '시간취합').
     봇 채팅 답장도 문지기에 만들어 둠(함수 버전 33, 아래 '봇 채팅 답장'). **웹훅은 아직 Apps Script** — 운영 앱 사람들의 채팅 체크인이 시트에 들어가야 해서.
     남은 순서(전환하는 날): 과장님 컨펌 뒤 실제 인원 넣기 → 웹훅 전환(`cron.setWebhook`) → BotFather 기본 메뉴를 베타로 → Apps Script 트리거·배포 정리, 스크립트 속성의 봇 토큰 지우기.
   - 관리자 페이지에서 문구를 고치는 방법을 의논함 → **문구를 DB(`ui_texts` 같은 표)에 두는 방식이 좋다**고 정리했지만, 사용자가 "일단은 이대로"라고 해서 보류.

## 1. 누구와, 무엇을 만드는 중인지

- 사용자: 이강준. 대형교회 문화부 방송예술과 **성우팀 교관**. 개발자가 아니에요.
  - **답은 항상 한국어로**, 전문용어는 풀어서 쉽게 설명해 주세요.
  - 결정이 필요한 건 짧게 물어보고, 정해진 건 바로 진행해요.
- 목표: 텔레그램 채팅으로만 하던 성우팀 행정(출결·공지·과제·녹음가능시간 등)을 **텔레그램 미니앱**으로 옮기는 것.
- 조직·권한 규칙의 원본은 claude.ai 프로젝트 "문화"의 문서 두 개예요. 규칙이 바뀌면 그 문서도 같이 고쳐요.
  - `claude/조직현황.md` — 계층, 12지파, 직책 인원, 팀 목록 (자주 바뀌는 사실)
  - `claude/권한설계.md` — 권한 등급, 직책 서열, 기능별 테이블 (고정 규칙)

## 2. 앱이 두 개 있어요

| | 운영 앱 (지금 다들 쓰는 것) | 베타 앱 (새로 만드는 것) |
|---|---|---|
| 파일 | `index.html`, `app.js`, `style.css`, `krmap.js` | `beta/index.html`, `beta/beta.js`, `beta/beta.css`, `beta/town.js` |
| 데이터 | 구글 스프레드시트 + Apps Script | **Supabase만** 사용 |
| 주소 | https://kjlee7.github.io/broadcast-attend/ | https://kjlee7.github.io/broadcast-attend/beta/ |

- **운영 앱 파일은 사용자에게 먼저 묻고 고쳐요.** (index.html 끝에 사용자가 직접 넣은 `api()` 도우미 스크립트가 있어요. 지우지 마세요.)
- 베타 폴더는 다 고친 뒤 바로 올려도 된다고 했어요.
- 베타는 `../style.css`, `../krmap.js`를 같이 써요. 운영 앱 화면과 똑같은 모양이 목표예요.
- PC(가로 1000px 이상)에선 아래 탭이 왼쪽 메뉴가 돼요. 맨 위 버튼으로 접으면 아이콘만 남는 72px 막대(`body.nav-mini`, `toggleNav()`), 선택은 브라우저 저장 키 `navMini`에 기억.
- 글꼴: **제목은 고운바탕, 나머지는 프리텐다드** (2026-10-04 사용자 결정. 전부 고운바탕이던 걸 바꿈).
  - `beta.css`의 `--font-body`(프리텐다드, 굵기 100~900) / `--font-title`(고운바탕, 400·700뿐) 두 변수로 관리. 글꼴을 바꾸려면 이 두 줄만 고치면 됨.
  - `body, body * { font-family: var(--font-body) !important }` 아래에 고운바탕을 쓸 곳 목록(.page-title, .section-head h2, .b-info b, .b-dhead h1 등). 새 화면의 제목도 이 목록에 넣어요.
  - 프리텐다드는 jsdelivr의 dynamic-subset(쓰는 글자만 내려받음). 고운바탕은 `beta/fonts/`의 woff(자주 쓰는 2,350자 기본 + 드문 글자 `-ext`), `beta/fonts.css`.
  - 동네지도 그림 속 이름표(`town.js`의 `DISPLAY`)는 고운바탕 그대로. 개발 환경에선 jsdelivr가 막혀 있어 미리보기는 Noto Sans CJK로 대신 보임.
- **PC 화면 배치 원칙**: 평소엔 화면 전체를 씀(카드는 여러 줄 격자). 모임·과제처럼 눌러서 상세가 필요하면 왼쪽 목록 | 오른쪽 상세로 반반,
  상세는 오른쪽에서 스르륵 들어옴(✕ 버튼이나 Esc로 닫으면 다시 전체). 출결 `#attendWrap.split`, 과제 `#taskView.split`. 새 화면도 이 방식으로.
  (2026-10-05 다듬기: '녹음 한눈에'는 카드 하나 `.tv-panel` 안을 가는 선으로 나눔, 2주는 한 줄 띠(14칸), 고르기 전엔 sticky 아님. 업무가능 2주 표는 칸 상자 대신 이어진 막대 `.gc.on2`(진하기 = 인원, 숫자는 막대 시작 칸만).)
  예외: 녹음(`#recView`)은 PC에서 처음부터 반반이고, 요청을 고르기 전 오른쪽엔 '녹음 한눈에'(`#recOverview`, `renderRecOverview`: 다음 녹음, 손이 필요한 요청, 2주 녹음 달력). 이때 `#recView.ov`라 + 버튼은 보임. ✕/Esc는 상세 → 한눈에 보기로 (2026-10-04).
- 캐시 때문에 `beta/index.html`의 `?v=20261003h` 같은 버전 문자열을 고칠 때마다 올려요.
  앱을 켤 때·다시 보일 때 `checkNewVersion()`이 서버의 index.html을 저장본 없이 받아 `beta.js?v=` 글자를 비교하고, 다르면 `?r=새버전`을 붙여 한 번 새로 불러와요
  (PC 텔레그램이 예전 화면을 오래 저장해 두는 문제 때문, 2026-10-04). 그래서 **beta.js 버전 글자는 꼭 올려야** 다른 기기도 바뀌어요.
- 봇: `@BangYeah_bot`. 같은 봇에 BotFather `/newapp`으로 베타 미니앱을 따로 등록해요.
- **봇 왼쪽 아래 메뉴 버튼**(2026-10-04): BotFather 기본값은 운영 앱(모두에게). 베타 인원은 `setChatMenuButton`으로 **그 사람 채팅에서만** 베타('방송예술과')로 바꿈.
  앱을 켤 때(`me`) `people.bot_menu_url`이 베타 주소가 아니면 자동으로 바꿈. 한꺼번에: pg_net으로 `{action:"cron.betaMenu"}` + `x-cron-secret`.
  텔레그램이 `user not found`라고 하면 그 사람이 봇과 대화를 시작(Start)한 적이 없는 것 → 알림도 못 받음. Start 누른 뒤 베타 앱을 한 번 열면 메뉴도 바뀜.
  모두 베타로 넘어갈 땐 BotFather에서 기본 메뉴 주소를 베타로 바꾸면 됨. (텔레그램 채팅에 '출결'·'공지' 같은 단어를 치면 오는 답은 아직 운영 앱 Apps Script 웹훅)
  PC 브라우저 로그인(텔레그램 로그인 위젯)은 BotFather `/setdomain` → `kjlee7.github.io`가 돼 있어야 해요.

## 3. 구조

```
텔레그램 미니앱(베타) ──POST {action, payload}──▶ Edge Function "api" (문지기) ──service_role──▶ Supabase DB
```

- 앱은 DB에 직접 붙지 않아요. 모든 요청은 문지기 함수를 거쳐요.
- Supabase 프로젝트: `bundxpidywrcrwhhgclv` (서울 리전, 개인 조직 "BroadCast", 무료 플랜).
  과장님 컨펌 후 방예과 계정으로 옮길 예정이에요.
- 베타가 부르는 주소: `https://bundxpidywrcrwhhgclv.supabase.co/functions/v1/api`

### 로그인 확인 (문지기 안)
- 텔레그램 안에서: `initData` 서명 확인 (HMAC, 키 = HMAC("WebAppData", 봇 토큰)).
- PC 브라우저: 텔레그램 로그인 위젯 → 헤더 `x-telegram-login`, 키 = SHA256(봇 토큰), 7일간 유효. 브라우저 저장 키 `beta_tg_login`.
- 아이디/비밀번호는 없어요. 🔴 민감 기능만 PIN을 한 번 더 입력해요 (`pin.setInitial`, `pin.verify`, `pin_sessions`).
- Secrets(Supabase에만 있음, 코드·채팅에 절대 쓰지 않음): `TELEGRAM_BOT_TOKEN`, `ALLOWED_ORIGIN`.
  ALLOWED_ORIGIN 끝에 `/`가 붙어 있어도 코드가 `new URL(raw).origin`으로 정리해요.

### 문지기 배포 방법 (중요)
- 실제 코드: `supabase/functions/api/main.ts`
- **저장소가 비공개라 GitHub에서 불러오는 한 줄 방식은 안 돼요.** `deploy_edge_function`에 파일을 직접 올려요:
  - `files` = `[{name:"index.ts", content:'import "./main.ts";\n'}, {name:"main.ts", content: <main.ts 전체>}]`, entrypoint `index.ts`, verify_jwt = false.
  - main.ts는 상대 경로 import가 없고 `npm:@supabase/supabase-js@2`만 써서 이 두 파일이면 돼요.
- 고치는 순서: `main.ts` 수정 → 커밋·푸시 → 위처럼 배포 → `get_edge_function`으로 버전 확인 → `public.bot` 호출로 동작 확인.
- (버전 31까지는 `index.ts` 한 줄이 `raw.githubusercontent.com/.../<커밋SHA>/.../main.ts`를 불러오는 방식이었어요. 저장소가 공개일 때만 됨.)
- 현재 배포: 커밋 `aa802ab`의 main.ts (함수 버전 57, 마감 모임 시간 고치기). 배포 전 `npx esbuild main.ts`로 문법 확인 (2026-10-05 변수 겹침으로 함수가 안 켜진 적 있음). 저장소가 아직 공개라 한 줄 방식으로 올림. 비공개가 되면 파일 직접 올리기.
- 타입 검사는 로컬 `tsc`로 해요. `Uint8Array` 관련 TS2769, `req` 관련 TS7006은 알려진 오탐이라 무시해요. (npm/esbuild는 프록시에 막혀요.)

### 지금 있는 기능(action)
`public.bot`(로그인 전), `me`, `meeting_types.list`, `team.members`, `team.groups`,
`sessions.create/update/delete/list/board/close/remind/audience`, `cron.reminders`(pg_cron 전용), `attendance.plan/check/uncheck/setStatus/reason`, `reports.monthly`,
`weekly.load/save/board`, `fixed.list/save`,
`notices.list/create/update/delete/audience`, `assignments.list/create/update/delete`, `reads.mark/list`, `birthday.wish`, `templates.list/save/delete`, `todos.list`,
`submissions.saveMine/list/feedback`, `checkins.list/create/delete/report/unreport`,
`polls.list/get/create/save/close/remind/delete`, `checkins.update`, `weekly.overview`, `stats.get/form/grant/update/revoke`, `badges.get/setTitle`, `recap.status/get/team/setOpen`, `dues.mine/submit/cancel/board/review/contacts/setTreasurers`, `look.get/save`, `recap.setEnabled`, `sky.load`, `guest.list/write/delete`, `files.prepare/done/list/open/delete`, `place.list/book/decide/cancel`, `admin.get/set`, `people.board/timeline`, `notes.save/status/comment/delete/mine`, `mtg.*`(회의 모드), `flow.list/create/mark/cancel`(작업 흐름), (봇 웹훅: 헤더 `X-Telegram-Bot-Api-Secret-Token`), `cron.setWebhook`·`cron.webhookInfo`(cron 비밀값), `dashboard.load`, `dashboard.month`, `dashboard.scene`, `rec.list/mine/create/update/plan/propose/ask/answer/select/addPerson/removePerson/remind/sessionStatus/arrive/start/end`, `profile.get/update/report`, `pin.setInitial`, `pin.verify`

### 등록 안 된 사람
- 문지기가 403과 함께 `code: "not_registered"`, `tg_id`(텔레그램 숫자 번호), `tg_name`을 돌려줌 → 베타 화면에 번호를 크게 띄움(`showNotRegistered`).
  새 사람은 그 화면을 캡처해 보내고, `people`(name, telegram_user_id) + `position_history`(팀 직책) + 필요하면 `group_assignments`(조)를 넣으면 들어올 수 있음.
- **사용자가 직접 등록해요**(토큰 아끼려고, 2026-10-04). Supabase 대시보드 → BroadCast → SQL Editor에 아래를 붙여넣고 ★만 바꿔 Run.
  사용자가 등록을 부탁하면 이 방법을 다시 알려주고, 오류가 났거나 잘못 넣은 걸 고칠 때만 직접 해요.
  ```sql
  with p as (
    insert into people (name, telegram_user_id, tribe_id, is_active)
    values ('홍길동',            -- ★ 이름
            1234567890,          -- ★ 텔레그램 번호 (숫자만)
            (select id from org_units where name = '총회'), true)
    returning id
  ),
  ph as (
    insert into position_history (person_id, position_code, org_unit_id, started_on)
    select p.id,
           (select code from positions where name = '팀원'),     -- ★ 직책: 팀원·조장·교관·부팀장·팀장·부과장·과장·서무·문화부장
           (select id from org_units where name = '성우팀'),     -- ★ 소속: 성우팀·아나운서팀·엔지니어팀, 팀 없으면 방송예술과(세 팀 모두 권한)
           current_date
    from p returning id
  ),
  g as (
    insert into group_assignments (person_id, group_unit_id)
    select p.id, u.id from p join org_units u on u.name = '2조'   -- ★ 1조~4조, 조 없으면 '없음'
    returning id
  )
  select (select count(*) from ph) as 직책, (select count(*) from g) as 조;

  -- 확인
  select * from v_people_current order by name;
  ```
  결과 '직책 1'이면 됨. '조 0'은 조가 안 들어간 것(조 없는 사람이면 정상, 있어야 하면 조 이름 오타).
  오류: `duplicate key` = 이미 등록된 번호. `null value … violates` = 이름·소속 글자가 틀림(띄어쓰기까지 똑같이).

### 프로필 '나의 기록' (2026-10-04, 탭 맨 끝 + 오른쪽 위 동그라미)
- `profile.get`: 내 people 정보 + 구역장(people_private) + 직책 + 문화부 밖 사명 + 지파·교회 목록.
- `profile.update`: 본인이 고칠 수 있는 것 = 성별·생년월일·연락처·지파·교회·회 소속·구역장 성함/연락처. **이름·텔레그램 번호·직책은 못 고침**(팀장 이상 관리).
  교회는 고른 지파의 `churches`만. `churches` 표는 아직 비어 있음 → 지파별 교회 목록을 받아 채워야 함.
- `profile.report { month }`: 그달 내 모임 출결(모임 유형별: 정규수업·스터디·운영회의), 실무 녹음(`recording_participants`, 제목·코드만), 그 밖의 실무(`duties` owner = 나, 녹음 세션과 이어진 녹음 업무는 뺌), 과제 제출.
  출석률은 마감된 모임만. 녹음·실무·과제 부분은 하나가 실패해도 나머지는 보이게 `errors`에 이름만 남김(함수 로그 확인).
- PC에서 '정보 고치기'를 누르면 오른쪽 패널(`#profileView.split`). 오른쪽 위 동그라미는 이제 프로필로 감, 로그아웃은 프로필 카드 아래.
- 화면 제목은 한국어: 함께한 자리(출결) · 한 달의 발자취(리포트) · 전하는 말(공지) · 갈고닦는 시간(과제) · 업무가능 시간 취합(업무가능) · 개인노트(프로필 탭).

### 홈 대시보드 (2026-10-04 개편, 함수 버전 27)
- 위에서부터: **오늘의 트랙**(팀마다 한 줄, 9시~23시, 겹치면 줄을 나눔, 지난 건 흐리게, 지금 하는 건 색 채움 + 빨간 지금 선, 칸 누르면 아래에 자세히)
  → **세 칸**(PC 가로 3칸, 폰 위아래): 우리는 준비 중(D-day, 2일 안이면 빨강, 팀 칩, 6건 넘으면 더 보기) · 프로젝트(상태 글자 + 세 칸 막대) · 사명자 일정(오늘~토요일, 날짜별)
  → **한 달 달력**(‹ › 넘기기, PC는 칸에 3건 + '+N', 폰은 점, 날짜 누르면 아래 목록) → 12지파 지도.
- 색(원래 팔레트): 모임 카키 · 녹음 파랑 #3F6A8A · 사회·촬영·편집 황토 · 사명자 일정 초록. CSS `.k-meet/.k-rec/.k-duty/.k-sched/.k-etc`(변수 `--k`, `--kb`).
- 서버 공통 `sectionItems(ctx, sec, from, to, canDetail)` = 모임(취소 제외)·녹음(recording_sessions)·업무(duties, 녹음 세션과 이어진 건 뺌)·사명자 일정(staff_schedules)을
  `{src, kind(모임|녹음|사회·촬영·편집|일정|기타), type, team, title, start, end, allDay, place, who, lead}`로. 녹음·사회 제목은 교관 이상만(`canSeeDetail`).
- `dashboard.load`에 `track{date, items}`(오늘), `upcoming`(지금~30일, 40건), `teamCounts`(팀별 인원) 추가. 예전 `schedules`·`projects`는 그대로 씀(`tasksNow/tasksUpcoming`은 이제 화면에서 안 씀).
- `dashboard.month { team_id, month:"YYYY-MM" }` → 달력 6주 범위 items. 화면은 `CALM`(달마다 저장), 홈을 새로 불러올 때 지금 보는 달도 새로.
- 위 알약: 지금 진행 중(트랙에서 지금 하는 것) · 준비 중(upcoming) · 프로젝트.

### 녹음 요청 (2026-10-04, 함수 버전 28 → 29에서 배역·회차·수락/조율로 바뀜)
- 아래 탭 **'녹음'**(`recView`, 화면 제목 '목소리를 담는 시간'). **과 안 세 팀 어디서든 교관 이상**에게만 보임(`recAllowed()`, 서버 `recSection` = `canSeeDetail`). 내 업무가 아니어도 서로 공유.
- 구조: **요청**(`recording_requests`) → **배역**(`recording_roles`: name, `pref_method` 지정/후보, `pref_people`, `session_id` = 들어간 회차)
  → **회차**(`recording_sessions`: title '1회차', status **조율중 → 예정(모두 확정) → 완료 / 취소**, `confirmed_at`)
  → **사람**(`recording_participants`: role 녹음자/엔지니어/감독자, `role_id`(배역), `method` 지정/후보, `answer` 대기/수락/조율/미선정, `answer_note`, `selected`(실제로 들어가는 사람), 엔지니어 교대면 `starts_at/ends_at`).
  unique = (session, person, role, role_id) nulls not distinct. `castings` 표는 안 씀.
- **올리기**(`rec.create`, `#recModal`): 제목·마감(필수, 2026-10-05부터 날짜 `#rcDueDate`(기본 일주일 뒤) + 시간 `#rcDueTime`(기본 '그날까지' 23:59)), **예상 녹음시간** 칩(10분 내외=10·30·60·90·2시간 이상=120, 계산은 30분 칸 `recSlots`), 필요한 성우 수(− 숫자 + `#rcNeed`, 1~30, DB `voices_needed` 30까지) →
  배역 줄(`#rcRoles`, `RCF`): 2명 이상이면 배역 이름, 줄마다 미정/지정/후보 + 성우 칩. **요청 코드는 자동** `R`+YYMMDD+`-`+순번. 세 팀 교관 이상에게 봇 알림.
- **회차 만들기**(`rec.plan` → `rec.propose`): ① 이번에 녹음할 배역(아직 회차 없는 배역) ② 가능한 시간·장소: 업무가능 30분 칸으로, 지정 배역은 그 사람이 비어야, 후보는 한 명이라도 비어야,
  엔지니어는 한 명이 끝까지 안 되면 앞·뒤 두 명 교대(`shift`), 감독(세 팀 교관 이상), 녹음 장소(`places.can_record` 코드원·SMC). 조율 중·확정된 다른 회차의 사람(selected 또는 대기·수락)·장소는 뺌.
  ③ 사람 배치(`recSlotPanel`, 추천 조합이 켜져 있음, 시간 밖 사람은 점선): 장소, 배역마다 지정/후보 + 사람, 엔지니어 1~2명(2명이면 교대 시각), 감독 → '요청 보내기'.
  `rec.propose`: 회차(조율중) + 사람(대기) 저장, **사람마다 '수락 / 조율 응답하기' 알림**(web_app 버튼 `beta/?ask=participant_id`). 확정된 사람·장소가 겹치면 409.
- **받은 사람**: 버튼 또는 개인노트 '지금 할 일'(`todos.list` kind `recask`) → `#askModal`(`openAsk`, `rec.ask`) → 수락/조율(조율은 메모 필수, `rec.answer`).
  지정·엔지니어·감독은 수락하면 바로 확정(selected), 후보는 요청자가 '이 사람으로'(`rec.select`)를 눌러야 확정. 응답마다 회차 만든 사람에게 알림. 확정 뒤 조율하면 회차가 다시 조율중.
- **확정**(`recFinalize`): 회차의 모든 배역에 selected+수락, 엔지니어·감독 모두 수락이면 회차 '예정' + 확정 알림(사람·요청자), 뽑히지 않은 후보는 '미선정' + 안내. 요청 상태는 `recSyncStatus`(접수/캐스팅중/일정확정/녹음완료).
- **인력 배치 현황판**(`renderRecBoard`, `sessCard`): 회차마다 칸(장소·배역·엔지니어·감독) 막대(초록 확정·회색 대기·빨강 조율 필요·황토 고르기) + '확정 n / 전체',
  줄마다 사람 칩(지정/후보/교대 시간 + 상태), 조율 메모, '이 사람으로', ×빼기(`rec.removePerson`), '+ 후보/사람'(`rec.addPerson`, 바로 알림), '답 없는 N명에게 다시 알림'(`rec.remind`, 10분에 한 번), 회차 취소/녹음 완료(`rec.sessionStatus`).
  목록 카드에도 진행 막대·'확정 n/전체 · 조율 필요 · 대기 · 배치 전'.
- 홈 트랙·달력·동네지도·나의 기록은 **확정된(예정·완료) 회차의 selected 사람만** 봄. 엔지니어 교대는 동네지도에서 자기 시간만.
- 딥링크: `?rec=요청id`(교관 이상, 녹음 탭 상세), `?ask=participant_id`(누구나 본인 것 응답).
- 녹음 장소를 바꾸려면 `update places set can_record = true/false where code = ...`.
- 2026-10-04 기준: 시범 인원에 엔지니어팀이 없고 업무가능 시간도 아직 없어서 '가능한 시간'은 비어 보임.

### 녹음 진행 흐름 (2026-10-05, 함수 버전 44)
- 현황판 회차 카드 맨 위 단계 흐름도(`recFlow`): 배치 → 요청 확인(`seen_at`) → 수락 → 확정 → 도착(성우 `arrived_at`) → 녹음 중(`started_at`) → 마침(`ended_at`). 칸마다 사람 칩(성우 파랑·엔지니어 황토·감독 보라 줄), 조율이 있으면 아래 빨간 점선 가지.
- DB(`supabase/migrations/20261005_rec_flow.sql`): `recording_participants.seen_at/arrived_at/arrived_by`, `recording_sessions.started_at/started_by/ended_at/ended_by`.
- 요청 확인 = 받은 사람이 응답 팝업(`rec.ask`)을 처음 연 때. 도착 = 성우 본인(앱 버튼·봇 채팅 '도착') 또는 그 회차 엔지니어·교관 이상이 대신(`rec.arrive`), 시작 2시간 전 ~ 끝+1시간, 엔지니어에게 알림.
- 엔지니어(그 회차 selected) 또는 교관 이상: `rec.start`(시작 보고, 회차 만든 사람에게 알림) / `rec.end`('녹음 마쳤습니다' = 회차 완료 + 배지 판정 + 요청 상태). 현황판의 예전 '녹음 완료' 버튼은 이걸로 바뀜.
- 엔지니어는 교관이 아니어도 응답 팝업(`?ask=`)에서 성우 도착 확인·시작·종료 보고를 함. 개인노트 '지금 할 일'에 당일 `recarrive`(성우)·`recrun`(엔지니어) 항목.
- 봇 '도착': 지금 도착할 수 있는 녹음이 있으면 녹음 도착도 기록(체크인이 없어도).
- 회차가 아직 없으면 같은 흐름도를 '배치' 단계부터 빈 칸으로 보여줌. **PC에서 요청 상세는 화면 가운데 팝업**(`body.rc-pop`, `.rc-dim` 누르면 닫힘). '녹음 한눈에'는 뒤에 그대로.
- **체크인**: 뒤 항목을 냈으면 앞 항목은 '지금 할 일'에서 빠짐('도착'을 누르면 기상·출발도 끝). 낸 칸을 다시 누르면 **시간 고치기**(prompt, `checkins.report { at: "HH:MM" }`, 그날·지금보다 늦게는 안 됨, `checkin_reports.fixed_at` → '(고침)') 또는 비우면 지우기.

### 시간취합 (2026-10-04, 함수 버전 32, 운영 앱에서 옮겨 옴)
- 개인노트 칩 [나의 기록|내 과제|업무가능|**시간취합**] → `pollView`(화면 제목 '함께할 시간 찾기', `curTab` 'poll', 부모 탭 profile). 목록(진행 중·마감 7일) | PC는 오른쪽 상세(`#pollView.split`).
- **누구나 만듦**: FAB → `#tpModal`(`openTpModal`/`createPoll`): 주제·후보 날짜(최대 14일)·시간대(시)·마감(datetime-local, 한국 시간)·대상(`pk('tp')`, `PCFG.tp` = 팀원부터, 언제나 사람 목록 `people: true`). 만든 사람은 자동으로 대상.
  서버 `polls.create`: `pickedPeople(ctx, p, MEMBER, MEMBER)`, 하루 5개(`rateLimit poll_new`), 대상자에게 봇 알림(버튼 `beta/?poll=id`).
- 칠하기: 업무가능과 같은 `bindPaint(grid, get, dirty)`(저장소·dirty 함수를 받게 바꿈, 기본은 업무가능). 내 고정 일정(`fixed_schedules`) 음영. 칸 키 화면 '날짜번호-30분칸', 서버 `날짜번호*48+30분칸`(`time_poll_answers.slots smallint[]`).
- 모아보기: 대상자 누구나 봄(운영 앱과 같음). 가장 많이 되는 시간 3개(같은 사람들이 되는 연속 칸 묶음), 칸 인원·명단, 특이사항, 입력 전 명단.
- 만든 사람: 다시 알림(`polls.remind`, 10분에 한 번), 지금 마감(`polls.close`, 결과 알림 없음), 지우기(`polls.delete`, 입력도 같이).
- 자동(`cron.reminders` 안 `cronPolls`): 마감 24시간 전 미응답자에게 한 번(`reminded_at`, 밤 0~8시 제외, 만든 지 24시간 안 된 건 건너뜀), 마감 지나면 '마감' + 만든 사람에게 결과(`close_result`).
- 개인노트 '지금 할 일' kind `poll`(대상인데 아직 안 칠한 것, 내가 만든 건 빼고).
- 표: `time_polls`(team_id, title, start/end_date, hour_from/to, deadline, target_people, target_label, status 진행중/마감/취소, reminded_at, closed_at, close_result, created_by), `time_poll_answers`(poll_id, person_id, slots, memo).
- `sessions.audience`(대상 고르기 명단)는 이제 과 사람이면 받음(예전엔 조장 이상). 만들 수 있는지는 각 create에서 서열로 다시 확인.

### 봇 채팅 답장 (2026-10-04, 함수 버전 33, 운영 앱 Apps Script 웹훅에서 옮겨 옴)
- 문지기 맨 앞: 헤더 `X-Telegram-Bot-Api-Secret-Token`이 있으면 텔레그램 웹훅. vault `tg_webhook_secret`(함수 `tg_webhook_secret()`, service_role만)과 비교, 틀리면 401.
  처리는 `handleTelegramUpdate`, 오류가 나도 200(텔레그램이 다시 보내지 않게, 로그 "bot"). 같은 update_id는 한 번만(`bot_updates`, 하루 지나면 cron이 지움).
- 개인 채팅 글자만. 단어(`BOT_WORDS`, 앞 '/'·'@봇이름' 떼고): 앱·출결·공지·할일·시간취합·업무가능 → 그 화면 web_app 버튼(`beta/?go=attend|notice|poll|profile|weekly`, 앱의 `DEEP_TAB`·`DEEP_WEEK`).
  기상·출발·도착 → `todayCheckins`(오늘 체크인 중 내가 대상인 것, `requireItemTarget`과 같은 규칙)에 바로 `checkin_reports` 기록. 여러 개면 고르는 버튼(callback `ci|체크인id|항목`).
  출발 뒤 15분 안에 시간 답장(`parseHm`: 7:40·7시 40분·19시) → 출발 기록 note에 '07:40 도착 예정'(`bot_waits`). 모르는 말 → 도움말. 등록 안 된 사람 → 텔레그램 번호 안내.
- **전환**(지금은 안 함): SQL `select net.http_post(url:='…/functions/v1/api', body:='{"action":"cron.setWebhook"}'::jsonb, headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')));`
  → 웹훅을 문지기로 + 명령어 메뉴(`BOT_COMMANDS`) 등록. 확인은 같은 방식으로 `cron.webhookInfo`(target: supabase/apps-script).
  **되돌리기**: Apps Script 편집기에서 `setupBot` 실행(웹훅을 Apps Script로 다시 맞춤). 전환하면 Supabase에 없는 운영 앱 사람은 '등록 안 됨' 답을 받고, 채팅 체크인이 시트로 안 감.
- 테스트(2026-10-04): 가짜 update를 없는 채팅(id 1)으로 보내 확인 — 비밀값 틀리면 401, 등록자 '기상'·'/todo@BangYeah_bot', 미등록자 모두 200, 로그엔 'chat not found'만(정상).

### 2026-10-05 바뀐 것 (함수 버전 36)
- **다른 팀도 고르기**: 대상 고르기(`pk*`)의 팀 칩을 여러 개 켤 수 있음(`P.keys` 배열, `P.all` = 과 전체). 팀 칩은 내가 만들 수 있는 팀(`pkMine`, PCFG min)이 하나라도 있으면 과의 모든 팀이 보임.
  만드는 팀 `pkOwner`(고른 팀 중 내가 만들 수 있는 팀, 지금 팀 먼저). 그 팀 하나를 통째로 고르면 예전처럼 팀 대상, 다른 팀이 섞이면 언제나 `target_people`.
  조·직책 기준은 팀을 하나만 골랐을 때만. 서버 `pickedPeople`: 만드는 팀에서 서열 확인 + 사람은 같은 과면 누구나. 양식 대상은 `keys`(예전 `key`도 읽음).
- **고치기**: 만들기 팝업 4개(c·ci·ann·hw)를 `editOn(k, id, 대상글자)`로 '고치기' 모드로(대상 고르기 숨기고 '받는 사람' 안내, 양식 줄 숨김), 닫으면 `editOff`가 쓰던 입력·글자를 되돌림(`closeModal`에서).
  만들기 함수 맨 앞에서 `EDIT.k`면 `save*Edit`. 모임 = 상세 아래 '✏️ 모임 고치기'(조장 이상, 바뀐 칸만 `sessions.update`, 마감된 모임은 날짜·시작 잠금, 알림 선택),
  체크인 = 현황판 펼침 안 '체크인 고치기'(교관 이상·만든 사람, `checkins.update`), 공지 = 카드 아래 '고치기'(삭제와 같은 사람), 과제 = 제출 현황 아래 '과제 고치기'(교관 이상).
  **받는 사람은 못 고침**(바꾸려면 지우고 새로). `sessions.update { checkin_items }` = 모임에 붙은 체크인 항목 고치기(비우면 지움, 없으면 새로 붙임, 뺀 항목 기록 지움).
- **아래 탭 '녹음' → '업무'**(화면 제목은 그대로 '목소리를 담는 시간'). `rec.list`는 내 팀(서열 있는 팀)이 올린 요청 + 내가 올렸거나 회차에 들어간 요청만.
- **업무가능 시간 · 2주**(`#recAvail`, 업무 탭 맨 아래, PC는 `grid-column: 1/-1`로 화면 폭 가득 + 오른쪽 sticky 패널 위로 덮임): `weekly.overview` = 오늘부터 14일, 팀은 `boardTeams`(모아보기와 같음), 처음엔 내 팀(`mine`)이 하나면 그 팀.
  [시간대별] 30분 칸 인원 진하기 + 누르면 가능/안 됨/아직 안 냄 명단, [사람별] 날짜마다 되는 시간('19~22', 안 냈으면 '미제출'), 주마다 안 낸 사람. `AV`, `loadAvail`(3분 저장), `avRanges`.

- **아래 탭 '개인노트' → '개인' + 하위 메뉴**(`#pfSub`, `togglePfSub`/`pfGo`): 누르면 나의 기록·내 과제·업무가능 시간·시간취합.
  PC 펼친 메뉴는 '개인' 아래로 펼침(개인 화면이면 늘 펼침), 폰은 탭 막대 위 떠 있는 상자, PC 접힌 메뉴는 막대 오른쪽 상자(바깥 누르기·Esc로 닫힘).
  화면 안 [나의 기록|내 과제|업무가능|시간취합] 칩 줄은 없앰(과제의 [공지|과제] 칩은 공지에서 왔을 때만 그대로).
- **지금 할 일 → 오른쪽 위 동그라미 상자**(`.b-mebox`, `#mePop`, `toggleMePop`): 동그라미를 누르면 이름·직책(`#who`, 왼쪽 위에서 옮김) + 지금 할 일(`#todoArea`, 화면 안에선 없앰) + '나의 기록 보기'.
  숫자 배지 `#todoBadge`도 '개인' 탭에서 동그라미로 옮김. 왼쪽 위는 '방송예술과 BETA'만. 할 일을 누르거나 바깥·Esc면 닫힘.

### 성우 스탯 (2026-10-05, 함수 버전 37)
- 교관이 실무 뒤 팀원에게 축별 XP를 주고, 본인은 '나의 기록' 맨 위 육각형 차트(`#statArea`, `renderStats`, `statSvg`)로 봄. 마이그레이션 파일 `supabase/migrations/20261005_stats.sql`.
- 표: `stat_axes`(팀·key·이름·설명·sort·is_active, 성우팀 6축: 자연스러움·톤·발음·발성·변성·대본분석) / `stat_grants`(team_id, person_id, granted_by, source_type 녹음|수업|스터디|기타, source_id = 녹음이면 recording_sessions.id, comment 필수, revoked_at/by)
  / `stat_grant_items`(grant_id, axis_id, xp 1~3). 뷰 `v_stat_xp`(취소 안 된 축별 XP 합). 세 표 audit_trigger. 같은 실무·같은 교관·같은 사람은 1번(부분 unique `stat_grants_once`), 본인 지급은 DB check로도 막음.
- 레벨은 저장 안 함: 문지기 `statLevel` = 다음 레벨 필요 XP = 현재 레벨 × factor. 설정값 `stat_level` {factor 3, max 10}, `stat_grant_min_level` 30, `stat_max_xp_per_grant` 12 (관리자 화면은 아직 없음 → SQL로).
- 권한(문지기에서 거름): 보기 = 본인, 또는 그 팀에서 기준 서열 이상. 주기·고치기 = 그 팀 기준 서열 이상, 받는 사람이 그 팀 사람(`unitAudience`), 본인 아님. 고치기는 준 사람만. 취소 = 준 사람 또는 팀장 이상(지우지 않고 revoked).
  녹음 관계자 예외(엔지니어팀 팀장)는 안 씀. 녹음 지급은 '완료' 회차 + selected 사람만. 랭킹 화면 없음.
- 화면: 지난달 말 모양(prev_level) 연하게 겹침, 처음 열 때 가운데서 펼침, 축 누르면 다음 레벨까지 남은 XP, 레벨업 반짝임은 이 기기 localStorage `statSeen:<id>`와 비교. 아래 '받은 피드백'(실무 제목만).
  '⭐ 스탯 주기'(`openStatGrant`, `#statModal`): 나의 기록 위 버튼(사람·수업/스터디/기타 고르기) + 녹음 현황판 '녹음 완료' 회차의 성우 칩 옆 '⭐ 스탯'(이미 줬으면 고치기·취소). 받는 사람에게 봇 알림.
- 테스트(2026-10-05): DB 규칙은 SQL로 확인(본인 지급·같은 실무 두 번·XP 4 막힘, 취소하면 합계에서 빠짐). 문지기 권한 검사는 실제 로그인이 필요해서 아직 사람별로 못 돌림.

### 칭호·배지 (2026-10-05, 함수 버전 39)
- 표 `badges`(team_id, key, name, description, icon 이모지, cond_type, cond_value jsonb, sort, is_active) / `person_badges`(person_id, badge_id, earned_at, source_type 'auto', source_id, is_title; 사람·배지 unique, 대표 칭호는 사람당 하나 부분 unique). 마이그레이션 `supabase/migrations/20261005_badges.sql`.
- 조건 5종(깨지는 조건 없음): `rec_count`(녹음 완료 회차에 성우(녹음자)로 selected, 감독·엔지니어는 안 셈 → 감독 칭호는 나중에 따로) · `axis_level`({axis key, level}) · `all_axes_level`({level}) · `meeting_count`(마감된 모임 참석·지각·조퇴) · `grant_count`(취소 안 된 스탯 지급).
  레벨 기준 XP는 DB 함수 `stat_xp_for_level`(설정값 stat_level). 그 팀 사람(`effective_rank > 0`)만.
- 판정: DB 함수 `award_badges(사람)` = 새로 딴 것만 넣고 돌려줌(두 번 돌려도 중복 없음, 확인함). 소급은 `award_badges_all()`(알림 없음, 2026-10-05에 돌림 → 0개).
  문지기 `awardBadges(ctx, ids)` → 새로 딴 사람에게 봇 알림. 부르는 곳: `stats.grant`(받은 사람), `rec.sessionStatus` 완료(selected 성우), `closeSession`(모임 대상자), `badges.get` 본인(놓친 것 챙김).
- 초기 배지 11개(성우팀): 첫 마이크·녹음 10건·단골 목소리(30)·백 개의 목소리(변성5)·대본 해부학자(대본분석5)·또박또박 장인(발음5)·톤 마스터(톤5)·균형 잡힌 성우(전 축3)·꾸준한 발걸음(모임10)·뿌리 깊은 나무(모임50)·피드백 수집가(지급10).
- 화면: 나의 기록 차트 아래 '나의 배지'(`#badgeArea`, `renderBadges`), 못 딴 건 흐리게, 새로 딴 건 반짝임(localStorage `badgeSeen:<id>`), 누르면 설명 + '대표 칭호로 걸기/내리기'(`badges.setTitle`).
  대표 칭호는 `dashboard.scene` people의 `title`('🎭 백 개의 목소리') → 동네지도 이름표 위.
- 권한: `badges.get` 본인 또는 그 팀 기준 서열(stat_grant_min_level) 이상. 대표 칭호는 고른 것만 모두에게. 배지 정의 추가·수정은 지금 SQL(관리자 페이지 생기면 팀장 이상).

### 연말 결산 '올해의 성우 리포트' (2026-10-05, 함수 버전 40)
- 나의 기록 맨 위 카드(`#recapArea`, `renderRecapCard`) → 스토리 화면(`#recapView`, `openRecap`/`recapStep`/`closeRecap`, 오른쪽 누르면 다음·왼쪽 이전, ✕·Esc·뒤로가기).
  카드: 표지 · 녹음 수·배역 수 · 제일 많이 간 곳(모임+녹음 장소를 places 이름으로) · 연초 vs 지금 육각형(`statSvg` 재사용) · 교관 코멘트 3개(받은 XP 큰 순) · 올해 배지 · 가장 많이 함께한 성우·엔지니어 · 참석한 모임 수 · (교관 이상) 팀 결산 · 요약.
  데이터 없는 카드는 건너뜀. 지각·결석 수(`late`, `absent`)는 모임 카드에 본인 화면에만, summary·공유 이미지엔 안 넣음(2026-10-05 사용자 결정).
- 서버 `recap.status`(공개일·open·preview·admin) / `recap.get { year, from?, to? }` 본인 것만(다른 사람 id 안 받음) / `recap.team { team_id, year }` 팀 교관 이상, 합계만 / `recap.setOpen { md }` 관리자만.
  공개 전엔 `preview`(관리자 또는 어느 팀이든 교관 이상)만, 기간 바꿔 보기(from/to)도 preview만.
- 공유 이미지: `recapImage(summary)` canvas → PNG(1080×1350). `summary`엔 숫자·스탯 레벨·축 이름·배지 아이콘만(서버에서 제목·코드·배역·코멘트·이름을 아예 안 넣음). PC는 다운로드, 폰은 길게 눌러 저장.
- 설정값: `recap_open` "MM-DD"(기본 "12-22", 해마다), `admins` = 관리자 명단(people.id 배열, 지금 이강준만, 2026-10-05 사용자 결정). 관리자 명단은 나중에 관리자 페이지에서도 씀.

### 회비·후원 (2026-10-05, 함수 버전 42)
- 개인 하위 메뉴 '회비'(`duesView`, `curTab` 'dues', 화면 제목 '마음을 보태는 일', 딥링크 `?go=dues`). **계좌번호는 앱·DB에 두지 않음**(사용자 결정).
- 표 `dues_entries`(section_id, person_id, kind 회비|물품, months text[] 'YYYY-MM', amount, depositor, item, qty, memo, status 대기|확인|반려|취소, reviewed_by/at, reject_reason) + `dues_nags`(month, 미납 알림 기록). 마이그레이션 `supabase/migrations/20261005_dues.sql`.
- 설정값: `treasurers`(회계 명단, people.id, 관리자가 화면에서 지정), `dues_monthly` 10000, `dues_start` "2026-10"(미납을 세기 시작한 달), `dues_nag_day` 25.
- 과원(과·과의 팀에 지금 직책 있는 활성 인원) 모두 냄. 달 상태 = 그달이 months에 든 회비 줄 중 확인 있으면 '확인', 대기 있으면 '대기', 없으면 '미납'. 한 달 몫을 넘는 금액은 후원금으로 셈.
- 기능: `dues.mine`(내 달별 상태·올린 것, 관리자면 과원·회계 명단) / `dues.submit`(회계에게 봇 알림) / `dues.cancel`(대기만) / `dues.board`(회계만: 대기 목록·과원별·합계·물품) / `dues.review`(회계만, 반려는 사유 필수, 올린 사람에게 알림)
  / `dues.contacts`(회계만: 봇이 회계담당자에게 미납자 이름을 `tg://user?id=` 링크로 보냄 → 눌러서 개인 대화) / `dues.setTreasurers`(관리자만).
- 자동: `cron.reminders` 안 `cronDuesNag` — 매달 25일(한국 10시 이후) 그달 미납 과원에게 한 번(`dues_nags`로 중복 막음).
- 권한: 회비 내역은 본인과 회계 명단만. 교관·팀장도 다른 사람 회비는 못 봄. 회계 지정은 관리자 명단만.

### 나의 기록 배치·캐릭터 꾸미기 (2026-10-05, 함수 버전 43)
- '개인' 첫 화면 제목 '개인노트' → **'나의 기록'**. PC 배치: 위 [나의 성장 | 받은 피드백](`.st-two`), 아래 [배지·내 정보 | 내 캐릭터](`.pf-two`), 그 아래 한 달 활동. 폰은 위아래로.
- **연말 결산은 관리자가 켜야 보임**: 설정값 `recap_enabled`(기본 false), `recap.setEnabled { on }`(관리자만). 꺼져 있으면 관리자에게만 '켜기' 카드. 켜면 예전처럼 공개일 전 교관 이상 미리보기, 공개일 뒤 모두.
- **캐릭터 꾸미기**(나의 기록 오른쪽 아래 `#lookArea`, `renderLook`/`saveLook`): `look.get`(지금 값 + 고를 수 있는 목록 `LOOK_OPTS`, 서버가 원본) / `look.save`(본인만, 목록 밖 값은 거부) → `people.town_look`.
  고르는 것: 성별(m/f, f는 속눈썹) · 피부 · 머리 모양(short/long/bob/bun/up 올림머리/pony 포니테일) · 머리색 · 윗옷 · 아래옷(pants/skirt)+색 · 머리에 쓰는 것 `hat`(cap/helmet/ribbon/phones)+색 `hatc` · 볼터치 · 탈것 `ride`.
  탈것: ford(오픈카, 예전 그대로) + town.js `RIDES`(bike·moto·kick 킥보드(서서)·camel·donkey·turtle). 이동할 때만 타고, 빠르기는 RIDES speed(거북이 14, 걷기 30). 미리보기 `Town.avatar(canvas, () => look)`(서 있는 모습 + 지나가는 모습).
  town.js `withLook(id, look)` = 기본 생김새 위에 덮어씀(윗옷만 바꾸면 소매 그림자색 맞춤). 예전 style 'cap'도 모자로 그려짐.

### 하늘방송국 (2026-10-05, 함수 버전 47, PC 전용 탭)
- 아래 탭(PC 왼쪽 메뉴) '하늘방송국'(`skyView`, `#skyTab`, 동네지도처럼 `townAllowed()`일 때만). 그림은 `beta/sky.js`(`Sky.mount(상자, {load, onGuest})`), 캐릭터는 town.js `Town.drawPerson`·`withLook`을 같이 씀(꾸미기·탈것 그대로).
- **실시간 없음**(2026-10-05 사용자 결정): 나만 걸어 다니고, 다른 사람은 자기 사무실에 서 있음. 방향키·WASD 이동, Space/Enter·클릭 = 말 걸기·들어가기, 화면 클릭하면 그쪽으로 걸어감.
- **아이소메트릭 시점**(2026-10-05): 방 = 바닥 칸(gx, gy) + 뒤쪽 두 벽, `P(x,y,z)`로 2:1 투영, 가구는 `cube`(윗면·두 옆면 명암+외곽선) 조합 `PROPS`(desk·chair·shelf·sofa·plant·lamp·mic·book·counter·stairs·rug·mat), 벽 장식은 `onBack/onLeft`(창문·액자·문·이름표). 그리는 순서 = gx+gy. 방향키는 화면 기준(오른쪽 = +gx −gy). 가구 칸은 못 지나감(`blocked`).
- 장면: 1층 로비(안내 NPC 말풍선 `NPC_SAY`, 오른쪽 계단) → 계단에서 층 고르기 → 2층 성우팀 · 3층 아나운서팀 · 4층 엔지니어팀·운영진(과 소속이나 부과장 이상) 복도(사람 수만큼 문, 이름표·대표 칭호) → 사무실(주인 캐릭터·배지 액자·방명록 받침대·나가는 문).
- **방송국 장비**(2026-10-05): 사무실은 층(팀)마다 다름 — 2층 '녹음 부스'(유리 칸막이 `glass`·마이크·보면대 `stand`·흡음판·콘솔·스피커), 3층 '뉴스 스튜디오'(뉴스 데스크·카메라·소프트박스 조명·프롬프터·모니터 월), 4층 '주조정실'(큰 믹싱 콘솔·장비 랙 `server` 깜빡이는 불빛·모니터 월·스피커·헤드폰). 공통 ON AIR 등(`onAir`, 깜빡임), 벽 화면(`screen`, 움직이는 막대). 로비에도 모니터 월·ON AIR, 복도엔 프로그램 포스터.
- **참고 그림 반영**(2026-10-05, 사용자 바탕화면 아이소메트릭 방 그림 3장): 디오라마처럼 바닥 판 두께·벽 두께 단면, 긴 판자 바닥(세 톤·틈·이음새·결), 벽 아래 그림자, 가구 아래 그림자(`shadows`), 창 햇빛(`sunlight`, `scene.sun`), 잡동사니(책상 위 서류·컵·책 더미·스탠드, 상자·서류함·프린터·가방·쿠션, 벽 선반 `wallShelf`·걸이 화분 `hangPlant`·화이트보드).
- 서버 `sky.load { team_id }` = 과원(층·직책·꾸미기·배지 아이콘·대표 칭호). 층은 서버가 정함.
- **방명록** `guestbook`(owner_id, author_id, text 200자, `supabase/migrations/20261005_guestbook.sql`): **쓴 사람과 사무실 주인만 봄**(사용자 결정). `guest.list`(주인이면 전부, 아니면 내가 쓴 것만) / `guest.write`(같은 과, 본인 사무실엔 못 씀, 하루 20개, 주인에게 '방명록이 왔어요' 봇 알림 — 내용은 안 보냄) / `guest.delete`(쓴 사람·주인). 팝업 `#guestModal`.

### 첨부 대본 (2026-10-06, 함수 버전 48)
- **모임에도**(2026-10-06): 모임 만들기·고치기 팝업 '대본·자료 파일'(`cFile`), kind `session`, 올리기 = 만든 사람·조장 이상, 열기 = 대상자, 모임 날부터 14일 뒤 삭제. 상세 화면 제목 아래 칩. 고치기에서 파일만 올려도 됨.
- 공지·과제 만들기/고치기 팝업에 '대본 파일'(PDF·한글·워드·텍스트, 20MB) + **'우리 교회 대본이 아니에요' 확인 칸 필수**(교회 대본은 계속 NAS, 사용자 결정). 마이그레이션 `supabase/migrations/20261006_script_files.sql`.
- 비공개 보관함 `scripts`(storage bucket, public false) + 표 `content_files`(kind notice|assignment, item_id, path, name, size, uploaded_by, uploaded, expires_at, deleted_at).
- 흐름: 글 저장 → `files.prepare`(쓴 사람·관리자만 `fileCanEdit`, 1회용 올리기 주소) → 브라우저가 보관함에 바로 PUT(문지기 200KB 제한을 안 거침) → `files.done`(실제로 올라갔는지 확인).
  보기: `files.list { kind, ids }`(내 팀·내가 대상인 글만, 이름만) → 칩 누르면 `files.open`(받는 사람만 `fileCanOpen` = 쓴 사람·관리자·대상자, **5분짜리 주소**, `access_log`에 열람 기록). `files.delete`(올린 사람·관리자).
- **자동 삭제**: 과제는 마감+14일, 공지·마감 없는 과제는 올린 날+14일(설정값 `file_keep_days`). `cron.reminders` 안 `cronFiles`가 지움(올리다 만 것도 하루 뒤 정리).

### 탭 다시 나누기 (2026-10-06, 함수 버전 50)
- 아래 탭 = 홈 · **일정**(←출결) · **소식**(←공지) · **업무**(이제 모두에게) · 개인 (+ PC: 동네지도·하늘방송국). 화면 id·`curTab` 값은 그대로(attend·notice·rec·profile).
- 부모 탭(`parentTab`): 시간취합(poll) → 일정 [모임 | 월간 리포트 | 시간취합], 업무가능(weekly) → 업무 [녹음 | 업무가능 시간], 과제(task) → 소식 [공지 | 과제] 한 곳만, 회비 → 개인. 개인 하위 메뉴는 나의 기록·회비만.
- 업무 탭 맨 위 **'내가 맡은 녹음'**(`#recMine`, `rec.mine` = 내가 들어간 회차, 미선정·취소 빼고 지난 14일~앞으로, 누르면 `openAsk`). 교관 아래(`!recAllowed()`)는 이것과 [업무가능 시간] 칩만, 녹음 요청 관리·한눈에·2주 모아보기는 교관 이상.
- 다음 할 일: 일정 탭에 [장소 신청] 칩 (녹음실 = 엔지니어팀장 승인, 총회 대회의실·과천 성전 10층 = 과장·부과장 승인, 스담 = 승인 없이 먼저 신청한 사람).

### 장소 신청 · 관리자 페이지 (2026-10-06, 함수 버전 51)
- **장소 신청**: 일정 탭 [모임 | 월간 리포트 | 시간취합 | 장소 신청] → `placeView`(화면 제목 '자리 맡기', 딥링크 `?go=place`). 날짜별 장소 하루 시간표(8~24시, 확정 진하게·대기 점선), 내 신청, (승인자면) 승인할 신청. FAB → `#placeModal`.
  마이그레이션 `supabase/migrations/20261006_place_bookings.sql`: `places.approval`(none·recording·external), 표 `place_bookings`(place_code, starts_at, ends_at, purpose, team_id, person_id, status 대기|승인|반려|취소, decided_by/at, reason).
  규칙(사용자 결정): 스담 등 `none` = 바로 확정(먼저 신청한 사람), 녹음실 `recording` = 녹음실 승인자, 총회·성전 `external` = 과장·부과장(다른 부서와 조율). 대기·승인과 겹치면 409.
  승인자 = 설정값 `place_approvers {recording, external}`, 비면 녹음실 = 엔지니어팀 팀장 이상, 외부 = 과 부과장(50) 이상(`placeApprovers`). 신청 → 승인자 봇 알림, 승인·반려 → 신청자 알림.
  기능: `place.list { team_id, date }` / `place.book` / `place.decide { id, ok, reason }`(승인자만) / `place.cancel`(신청자).
- **관리자 페이지**: 탭 '관리자'(`adminView`, `#adminTab`, `me.is_admin`일 때만). `admin.get` / `admin.set { key, value }`(관리자 명단만, 키는 admins·treasurers·place_approvers·recap_enabled·recap_open만, 사람은 과원 중에서, 나 자신은 관리자에서 못 뺌).
  회비 화면의 회계 지정과 결산 카드의 켜기·공개일 버튼은 여기로 옮김(중복 제거).
- **할 수 있는 일 FAB**(2026-10-06, 사용자 결정): 모두가 보는 화면은 같게, 권한에 따라 다른 것은 오른쪽 아래 FAB 하나(`#actFab`, `actItems()`가 화면·권한마다 메뉴를 만듦, 1초마다 다시 계산)로. 예전 화면별 FAB(`.b-fab:not(.act-fab)`)는 CSS로 숨김.
  관리 보기는 `MG` 깃발로 켜고 끔(탭 바꾸면 꺼짐): `MG.sess` 모임 출결 확인·마감·알림 상자 / `MG.ci` 체크인 현황 / `MG.rp` 팀 월간 리포트(기본은 내 기록만) / `MG.ann` 공지 확인 현황·고치기·삭제 / `MG.task` 과제 제출 현황 / `MG.rec` 녹음 요청 관리·한눈에·2주 모아보기(기본은 '내가 맡은 녹음') / `MG.dues` 회계.
  만들기 메뉴: 모임·체크인(일정), 시간취합, 장소 신청, 공지·과제, 녹음 요청, 스탯 주기(나의 기록), 모임 고치기·취소·지우기, 과제 고치기.

### 인원 특이사항 (2026-10-06, 함수 버전 52)
- 탭 '인원'(`peopleView`, `#peopleTab`, 어느 팀이든 교관 이상일 때만, 화면 제목 '한 사람 한 사람', 딥링크 `?go=people`). 지금 고른 팀(`S.team`) 기준, 그 팀 교관 이상이어야 봄.
- 표(`supabase/migrations/20261006_person_notes.sql`): `person_notes`(team_id, person_id, category 건강·직장·학업·일정 충돌·가정·기타, title 60자, body, starts_on, ends_on(비면 계속), affects 수업·스터디·녹음·업무, status 진행 중·해결됨, followup 없음·보강·대체학습 + followup_done_at, source 운영진·본인, created_by) / `person_note_comments`(운영진 메모).
- 왼쪽 팀원 한눈에(`people.board`): 진행 중 특이사항·최근 요약·보강 밀림·이번 주 새 것·연속 불참·최근 4주 출석률, 신경 쓸 사람(score)이 위로. 오른쪽 사람별 타임라인(`people.timeline`, 열람 기록 남김): 특이사항 카드(보강 완료 체크·해결됨·운영진 메모·고치기) + 출결 기록(불참·지각·조퇴·사전 불참과 사유, 180일)을 날짜순 한 줄로.
- 팀원 쪽: '특이사항 알리기'(일정 탭·나의 기록 + 메뉴, `#noteModal`) → `notes.save`(본인 것만, 그 팀 교관 이상에게 봇 알림) / 나의 기록 아래 '내가 알린 특이사항'(`notes.mine`, 본인이 쓴 것만, 운영진 기록·메모는 안 보임).
- 기능: `people.board/timeline`, `notes.save/status/comment/delete/mine`. **회의 모드는 아직**(사용자: 써 본 뒤 회의 얘기를 더 하고 붙이기).

### 회의 모드 (2026-10-06, 함수 버전 53)
- 모임 상세 + 메뉴 **'회의 열기 (안건·의견·회의록)'** → `mtgView`(부모 탭 일정). 모임 하나에 회의 하나(`meetings.session_id` unique, 처음 열 때 만듦). 마이그레이션 `supabase/migrations/20261006_meetings.sql`.
- 표: `meetings`(chair_id = 모임 만든 사람, scribe_id, status 준비·진행·끝, current_item_id, item_started_at, prep_reminded_at) / `meeting_items`(kind 일반·인원·할 일 점검, title, background·decide·options, person_id, minutes_min, extended_min, priority 1~3, sort, status 대기·논의 중·결론·넘김, summary, decision) / `meeting_opinions`(안건×사람 미리 의견) / `meeting_parked`(주차장) / `meeting_actions`(담당자·할 일·마감, done_at, reminded_d1/over_at).
- 볼 수 있는 사람 = 그 모임 대상자 + 그 팀 교관 이상(사용자 결정). 진행자만 시작·넘기기·5분 연장·끝내기·서기 지정, 서기·진행자만 요약·결정·할 일 칸, 참석자 누구나 안건 올리기·의견·주차장.
- **준비**: 안건(배경·정해야 할 것·선택지·예상 시간·중요도), 시간 합이 회의 시간을 넘으면 경고, 안건마다 미리 의견, '미리 의견 남긴 사람' 칩. 회의 전날 18시 뒤 안 남긴 사람에게 봇 알림(`cronMeetings`), '지금 할 일' kind `mtgprep`(사흘 안).
- **진행**(3초마다 새로 불러와 같은 화면): 지금 안건 하나 + 남은 시간(넘으면 빨갛게 깜빡임) + 회의록 칸 + 할 일 추가 + 진행자 버튼 [5분 연장][결론 내고 다음][다음 회의로 넘김][회의 끝내기], 오른쪽 안건 순서(진행자는 눌러서 이동)·🅿️ 주차장('나중에').
  시작할 때 안건을 중요도 순으로 정렬, 같은 팀 지난 회의에 안 끝난 할 일이 있으면 맨 앞에 '지난 회의 할 일 점검'. 인원 안건은 특이사항 타임라인을 회의 화면에서 펼쳐 봄.
- **끝**: 회의록 문서(안건별 상태·논의·결정·할 일, 주차장) + 텍스트 복사. 끝내면 담당자마다 맡은 일 봇 알림, '지금 할 일' kind `mtgaction`(눌러서 완료), 마감 하루 전·지남 알림.
- 기능: `mtg.get/item/itemDelete/opinion/scribe/start/next/extend/note/park/unpark/action/actionDelete/actionDone/end`.
- **모임 만들기에서 안건까지**(2026-10-06): 모임 유형 이름이나 제목에 '회의'가 있으면 팝업에 '회의 안건' 칸(`#cAgendaBox`, `cAgSync`/`cAgAdd`/`cAgItems`: 안건·정해야 할 것·분·중요도). 만들면 `mtg.get`(회의 생성) → 안건마다 `mtg.item`. 고치기 모드에선 숨김.
- **월간 리포트는 일정 탭 칩에서 뺌**(인원 탭과 겹쳐서, 2026-10-06 사용자 결정). 화면 코드(`reportView`)는 남아 있음.

### 프로필 / 월간 리포트 나누기 · 자주 하는 말 · 장소 시간 (2026-10-06, 함수 버전 54)
- 개인 하위 메뉴 = **프로필 · 월간 리포트 · 회비**. 프로필(`profileView`, 제목 '프로필') = 결산 카드·나의 성장·받은 피드백·배지·내 정보·내 캐릭터·내가 알린 특이사항. 월간 리포트(`pmonthView`, `curTab` 'pmonth') = 한 달 활동(모임·실무 녹음·그 밖의 실무·과제, `loadPfReport`).
- **자주 하는 말**: 내 캐릭터 꾸미기에 칸 3개(20자) → `town_look.say`(look.save가 3개·20자로 자름) → 동네지도에서 사람마다 다른 박자로 25~45초에 한 번 4초 동안 머리 위 말풍선(town.js drawText, '동작 줄이기'면 안 나옴).
- 장소 신청 시간: 30분 단위 select(08:00~24:00, 앱 스타일). 시간표 줄을 누르면 누른 곳의 30분 칸이 시작, 1시간 뒤가 끝(`plLineClick`). 날짜는 지금 보는 날짜.

### 업무 탭 공개 · 업무가능 시간 개인으로 · 프로필 배치 (2026-10-06, 함수 버전 55)
- **업무 탭(녹음)은 과원 모두 진행 상황을 봄**: `rec.list`는 과 팀원 이상, 과의 모든 요청(진행 중 + 최근 60일). 올리기·회차 만들기·알림·빼기·상태 바꾸기는 교관 이상(화면 `#recView.rec-ro`로 버튼 숨김, 서버는 각 기능에서 확인). FAB '녹음 요청 관리' 토글 없앰.
- **업무가능 2주 모아보기(`weekly.overview`, `#recAvail`)는 교관 이상만.**
- 업무가능 시간 입력(`weeklyView`)은 **개인 하위 메뉴**로(부모 탭 profile). 개인 메뉴 = 프로필 · 월간 리포트 · 업무가능 시간 · 회비.
- 프로필 배치: 위 [내 정보 | 나의 배지] → [나의 성장 | 받은 피드백] → 맨 아래 내 캐릭터(PC: 왼쪽 미리보기 | 오른쪽 고르기 두 줄).
- (2026-10-06) 모임 상세 머리에 버튼 줄(`.b-dacts`): '✏️ 모임 고치기'(조장 이상) · '🗂 회의 열기'(이름에 '회의'). + 메뉴의 모임 고치기·회의 열기는 뺌. 마감된 모임도 날짜·시작 고칠 수 있음(도착 확인한 사람 참석/지각을 새 시작으로 다시 매김). 고친 시간이 아직 안 끝났으면 마감을 풀고(`closed_at` null, 예정) 자동 불참(도착 기록 없는 불참)과 사유를 지움.

### 작업 흐름 (2026-10-06, 함수 버전 56)
- 업무 탭 위 '작업 흐름'(`#flowArea`, `loadFlows`/`renderFlows`/`fwCard`). 과원 누구나 봄(과의 진행 중 + 30일 안에 끝난 것), **교관 이상이 만듦**(+ 메뉴 '작업 흐름 만들기', `#flowModal`).
- 표(`supabase/migrations/20261006_work_flows.sql`): `work_flows`(team_id, title, note 원문, status 진행·완료·취소, created_by) / `work_steps`(sort, title, detail, due_on, done_rule 한 명·모두, after_ids = 앞 단계, ready_at, done_at, reminded_d1/over_at) / `work_step_people`(person_id 또는 null + name(앱에 없는 사람), state 대기·시작·완료·막힘, note).
- 흐름: 만들면 앞 단계가 없는 단계 담당자에게 '내 차례' 알림. 담당자(또는 지시자·그 팀 교관 이상이 대신)가 [시작][끝냈어요][막혔어요(메모 필수)][되돌리기] → 지시자에게 알림 → `flowSync`가 단계 완료(done_rule) 판단 → 다음 단계 담당자 알림 → 다 끝나면 지시자에게 '모두 끝남'. 마감 하루 전·지남 알림(`cronFlows`), '지금 할 일' kind `flowstep`.
- 그림: 단계 깊이(앞 단계 사슬)마다 열, 칸 색 = 진행(카키)·완료(초록)·기다림(점선)·막힘(빨강), 사람 칩에 상태.
- **글에서 단계 뽑기**(`fwParse`, AI 없이 규칙): 문장·'하고/해서/드려서'로 나누고 같은 문장 안은 앞 단계로 이음, '○○님께 공유' 조각은 다음 조각과 합침, 명단 이름·'제가'(나)·'교관님들'(교관 이상 모두)·명단에 없는 '○○님께'(이름만), 오늘/내일/모레/M/D, '(내일까지 …)' 같은 덧붙임은 앞 단계 마감으로. 지시자가 고쳐서 저장.
- 기능: `flow.list/create/mark/cancel`(cancel `remove: true`면 지움). 2026-10-06 샘플 1건(감정 연기 수업 준비, 안소현 대신 임지윤) SQL로 넣음(알림 없이).

### 보안 점검 (2026-10-04, 함수 버전 30)
- 고친 것: ① 기능 이름을 `Object.hasOwn(actions, name)`으로만 찾음(예전엔 `constructor` 같은 기본 속성이 불려 서버 키가 응답에 실릴 수 있었음, 로그인한 등록자만 가능했음)
  ② 비밀값(봇 토큰·서버 키)이 비면 요청 거부 ③ 네트워크 오류 로그에 봇 토큰 안 남김 ④ 과제 링크는 http(s)만(서버·화면) ⑤ 녹음 응답 같은 답이면 알림 안 함·30초 쿨다운
  ⑥ 모임 `notify_result/remind_result`는 조장 이상만 ⑦ DB: anon·authenticated의 표·순서값 권한 전부 회수(+기본 권한), `effective_rank`·`set_updated_at` search_path 고정.
- 확인된 것: 서명 검사(상수 시간 비교, 만료), 비활성 차단, cron 비밀값, 모든 id 기능이 그 항목의 팀으로 권한 확인, 텔레그램 HTML 이스케이프, DB 오류는 일반 문구, 뷰는 security_invoker, PIN 5회 잠금.
- 함수 버전 31: 알림 보내는 기능에 사람마다 횟수 제한(`rateLimit`, 표 `action_limits`, 하루 지나면 cron이 지움), 과제 제출·체크인 보고는 대상만(`requireItemTarget`),
  조·모임이 그 팀 것인지(`checkGroup`), 글자 수 제한, 양식 종류 고정, 요청 200KB 제한. 화면: PC 로그인은 '이 PC에서 로그인 유지'(`#loginKeep`)를 켤 때만 localStorage 7일, 아니면 sessionStorage.
  `beta/index.html`에 CSP 메타(연결은 자기 주소·Supabase만, 스크립트는 자기·telegram.org, 프레임은 oauth.telegram.org). **새 외부 주소를 쓰면 CSP에 추가해야 함.**
- 남은 것은 사용자와 정리 중이에요. **저장소가 공개라 약점 목록은 여기에 적지 않아요** (대화로만 다루기).

### 공지 쓰기 (2026-10-04)
- 오른쪽 아래 동그란 + 버튼(FAB, `#annFab`)으로 열림. 팝업(`#annModal`)으로 뜸 (2026-10-04 오른쪽 패널 → 팝업으로 바꿈).
  운영 앱 `style.css`는 PC에서 `.fab-wrap`을 숨기므로 베타는 따로 `.b-fab`를 씀.
- 대상은 칩으로 좁힘: 팀(전체·성우팀·아나운서팀·엔지니어팀) → 직책(여러 개 콕 집기) → 조(팀이고 조가 있을 때만). 아래에 받는 사람 명단.
  '전체'는 어느 팀이든 팀장 이상일 때만, 팀 칩은 내가 교관 이상인 팀만. 직책·조 칩은 실제 명단에 있는 것만 보임.
- `notices.target_positions`(직책 코드 배열, 비면 모두). `notices.audience { team_id, scope }` = 그 단위·아래 단위 직책 + 문화부까지 상속된 직책, 사람마다 가장 높은 직책.
- 직책을 콕 집은 공지는 그 직책인 사람 + 쓴 사람 + 관리자(팀 공지 교관 이상, 과 공지 팀장 이상)만 봄. 보는 사람의 직책은 그 팀에서의 서열(rank)로 맞춤.

### 업무가능 독촉 · 생일 (2026-10-04, 함수 버전 21)
- **독촉**: 같은 10분 cron(`cron.reminders`) 안의 `cronWeeklyNag`. 마감(주일 22시)이 지난 주의 미제출자(과·팀에 지금 직책 있는 활성 인원 전부)에게
  **6시간마다**, **밤 0~8시는 쉼**, 그 주가 끝날 때까지(다음 주일 22시에 다음 주로 넘어감). 기록은 `weekly_nags`(주마다 한 줄: last_at·count·result).
  `NAG_FROM = "2026-10-05"` 이전 주는 건너뜀(기능 넣은 날 끝나 가던 주). 버튼 주소 `beta/?go=weekly&ws=월요일` → 그 주 업무가능 화면.
- **생일**: `dashboard.load`의 `birthdays` = 과 인원 중 오늘 생일(`today`, 내가 보냈는지 `wished`), 7일 안 생일(`soon`, 월/일만), 내 생일이면 받은 메시지(`wishes_to_me`).
  홈 맨 위 `#bdayBanner`. '축하 메시지' → 팝업(`#bdayModal`) → `birthday.wish` → `birthday_wishes`(한 사람에게 그해 한 번) + 봇으로 바로 전달(`delivered`).
  2/29생은 평년엔 2/28. 양력 기준(`people.birth_date`, 프로필에서 본인이 입력). 나이는 안 보냄.

### 공지·과제 확인 기록 (2026-10-04, 함수 버전 20)
- 공지 카드를 눌러 펼치거나 과제를 열면 `reads.mark` → `content_reads`(kind notice|assignment, item_id, person_id, first/last_read_at). 열람 기록이라 audit 트리거 없음.
- 목록에 `seen`(내가 확인했는지, 쓴 사람은 늘 true) → 안 본 글은 왼쪽 줄 + '새 글 · 눌러서 확인'/'새 과제' 칩.
- `read_count`(쓴 사람 제외)는 볼 수 있는 사람에게만: 공지 = 쓴 사람·팀 공지 교관 이상·과 공지 팀장 이상, 과제 = 쓴 사람·조장 이상. 아니면 null.
- '👀 확인 N명' 칩 → 팝업(`#readModal`) `reads.list` = 받는 사람(쓴 사람 제외) 중 확인한 사람(처음 본 시각)·아직 안 본 사람.
  공지 받는 사람 = `unitAudience` + 조·직책 대상 필터, 과제 = `sessionMembers`(오늘 기준 팀원, 조 대상).
- 공지·과제를 지우면 확인 기록도 지움.

### 모임·출결 흐름 (2026-10-03 완성)
1. **모임 만들기**: 조장 이상. 대상(팀 전체 또는 조)을 고르고, 만들면 봇이 대상자에게 개인 메시지로 알림
   (`notify_result`에 보낸 수·못 받은 사람 기록. 봇을 시작 안 한 사람은 못 받음). 버튼은 `beta/?s=모임id`로 열림.
   취소하면 취소 알림. 미니앱 주소는 Secret `MINIAPP_URL`로 바꿀 수 있음(없으면 GitHub Pages 베타 주소).
2. **사전 출결체크**: 본인이 참석/지각/불참 + 사유(지각·불참은 필수). 시작 시간 전까지만 → `attendance.planned_*`
3. **현황**: 팀원 모두가 상태를 봄. **사유는 본인·조장 이상만** (`attView`에서 걸러냄)
4. **현장 출결확인**: 조장 이상이 이름 눌러 확인 → `arrived_at`, `checked_by`. 시작 + `late_grace_minutes`(설정값, 기본 0) 지나면 지각.
   늦게 누를 땐 실제 도착 시각(`at`)을 넣을 수 있음. 지각이면 사전 사유를 최종 사유로 옮겨 둠.
5. **마감**: 끝나는 시간(없으면 시작+3시간)이 지나면 목록·현황·리포트를 열 때 자동 마감(`autoClose`), 또는 마감 버튼.
   확인 안 된 대상자 = 불참. `closed_at` 기록, 상태 '완료'. 마감 뒤에도 늦게 온 사람 확인 가능(불참→지각).
6. **사유 입력**: 최종이 지각·불참·조퇴면 본인 화면에 사유 칸, 목록 위에 '사유를 적어주세요' 알림. 조장 이상이 대신 적을 수 있음
7. **월간 리포트**: 마감된 모임만 셈. 사람별 출석률(참석+지각+조퇴)/정시율/지각률/불참률/사전체크율/평균 지각 분/사유 목록.
   조장 이상은 팀 전체 + '텍스트로 복사', 팀원은 본인 것만. (자동 발송은 아직 없음)
9. **대상 고르기** (2026-10-04, 함수 버전 22): 모임 만들기 팝업에서 팀 칩(전체·성우팀·아나운서팀·엔지니어팀) → 조 칩(조가 있는 팀만: 운영진·1조·2조·3조, 여러 개)
   → 아래 받는 사람 명단(이름 누르면 빼기). 운영진 = 그 팀 교관 이상 + 4조, 4조 칩은 숨김(운영진으로 대신). 아나운서·엔지니어팀은 조가 없어 명단만.
   `sessions.audience { team_id }` = 과의 팀(내가 조장 이상이면 can), 팀마다 조, 사람(팀별 서열 `ranks`). 전체 칩은 어느 팀이든 팀장 이상.
   팀 전체(조·빼기 없음)면 예전처럼 팀 모임. 그 밖엔 `meeting_sessions.target_people`(사람 id 배열) + `target_label`(표시 글자)로 저장.
   전체 모임은 지금 팀 소속으로 만들어지고, 다른 팀 사람은 `sessions.list`에서 `target_people`에 내가 있으면 같이 보임. `sessionMembers`는 target_people이 있으면 그 사람들.
   다른 팀 모임은 그 팀의 모임 유형을 못 골라서 제목 필수.
10. **장소·양식·내용** (2026-10-04, 함수 버전 23)
   - 장소는 드롭다운(`#cPlaceSel`): 스담·회의실·사무실·연구실·거울방·코드원 스튜디오·SMC·과천성전 10층·과천성전 9층·벽산 편집실·기타.
     목록은 index.html에 직접 적혀 있음(바꾸려면 거기). 기타면 직접 입력 칸(`#cPlace`)이 스르륵(`.b-slide.open`). `getPlace()`/`setPlace(v)`.
     저장은 예전처럼 `location` 글자 그대로(동네지도 `places.aliases` 글자 맞추기와 같이 감).
   - 내용: `meeting_sessions.description`(2000자). 상세 화면 제목 아래 카드, 새 모임 알림에 300자까지.
   - 내 양식: `user_templates`(사람·kind·name 유일, data jsonb, 종류마다 20개). 모임은 kind `session`.
     날짜 빼고 유형·제목·시간·장소·내용·알림·대상(팀 key·조 subs·뺀 사람 off)을 저장. 팝업 맨 위 칩을 누르면 채움(`useSessTpl`), ×로 지움.
     대상은 명단이 온 뒤 맞춤(`MA.pending` → `applyPendingTarget`), 지금 고를 수 없는 팀이면 건너뜀. 개인용(다른 사람과 공유 안 됨).
11. **모임에 체크인 붙이기** (2026-10-05, 함수 버전 35): 모임 만들기 팝업 '체크인도 받기' 칩(`#cCiItems`, 기상·출발·도착 각각, 기본 꺼짐 — 오후 수업은 출발·도착만, 이른 아침은 기상까지).
   `sessions.create { checkin_items }` → 같은 날짜·대상으로 `checkins`(session_id) 생성. `SESSION_COLS`에 `checkins(id, items)` 포함 → 상세 '⏰ 체크인' 칩(`sessCiItems`), 알림에 한 줄(`sessionCheckinItems`).
   날짜·제목 바꾸면 체크인도 따라감, 취소하면 체크인 지움, 모임 지우면 cascade. 양식에도 `ci`. 따로 있는 '체크인 만들기'는 그대로(모임 없는 녹음·촬영·이동용).
8. **사전체크 알림** (2026-10-04, 함수 버전 16)
   - 만들 때: 대상자 전원에게 알림(1번, 원래 있던 것).
   - 자동: 시작 **72시간 전·24시간 전**에 사전체크 안 한 사람(사전·최종 출결 둘 다 없음)에게만. pg_cron 작업 `session-reminders`가 **10분마다**
     pg_net으로 문지기에 `{action:"cron.reminders"}` + 헤더 `x-cron-secret`을 보냄. 비밀값은 vault `cron_secret`, 확인은 `check_cron_secret()`(service_role만).
     그 시점보다 늦게 만든 모임은 그 알림을 건너뜀(만들 때 알림이 이미 감). 날짜·시작 시간을 바꾸면 `reminded_72h_at/24h_at`을 비워 새 시간 기준으로 다시.
   - 수동: 모임 상세 '🔔 사전체크 알림' 상자(교관 이상, 시작 전만) → `sessions.remind`. 10분에 한 번.
     누른 사람도 미체크면 같이 받음. 못 받은 사람은 `remind_result.why`에 이유(봇 대화 시작 안 함·차단 등), 원문은 함수 로그 "tg send". 상자에 미체크 명단·자동 알림 예정/보냄·마지막 수동 알림 결과.
   - 칸: `meeting_sessions.reminded_72h_at`, `reminded_24h_at`, `reminded_manual_at`, `remind_result`.
   - 자동 알림이 안 가면: `select * from cron.job_run_details order by start_time desc limit 5;`, `select * from net._http_response order by id desc limit 5;`, 함수 로그 순서로 봄.
- `attendance.status`는 **최종** 결과, `planned_status`는 **사전** 체크. 예전 `saveMine/saveFor/update/list`는 없앴음.

### 동네지도 (2026-10-03, PC 전용 '동네지도' 탭)
- 과원이 **일정상** 지금 어디서 무엇을 하는지 도트 캐릭터로 보여줌. 실제 위치 아님.
- 그림판: `beta/town.js` 하나 (`Town.mount(요소, { load })`). 같은 파일로 Claude 미리보기(예시 50명)도 만듦.
  장소 배치·가구·캐릭터는 전부 코드로 그림(이미지 파일 없음). 장소 코드는 town.js의 `place('코드', …)`와 `places.code`가 같아야 함.
- 홈과 출결 사이의 **'동네지도' 탭**(`townView`). 탭에 들어가면 `body.town-mode`로 화면 전체를 쓰고, 지도는 화면 높이에 맞춰 커짐(`fill: true`). 홈 화면은 그대로.
- 폰(텔레그램 android·ios, 또는 터치+좁은 화면)에서는 탭 자체를 숨기고 불러오지도 않음 (`isPhone()`, `setupTownTab()` in beta.js). 탭을 처음 열 때 불러옴.
- 서버 `dashboard.scene { team_id }` → 그 과 사람 + 오늘 일정 조각(segs). 우선순위: 녹음 > 업무(duties) > 모임 > 사명자 일정(주최자만) > 고정일정(=직장).
  일정 없으면 화면에서 휴게실. 고정일정은 전부 '직장'으로 봄(제목은 안 보냄).
- 공개 범위: 장소·이름·캐릭터·업무유형은 모두. **녹음·사회의 구체적인 내용(detail)은 과 안 어느 팀에서든 교관 이상일 때만 서버가 보냄.**
  모임·업무 제목(예: 정규수업 1·2조)은 모두에게 보임.
- 장소 글자 맞추기: `places` 표의 `aliases`(띄어쓰기·대소문자 무시, 긴 별칭부터). 목록에 없으면 '외부'(장소 글자를 그대로 표시), 비어 있으면 '외부 · 장소 미정'.
- 직장은 거리 위 건물(안 보이고 인원 팻말·창문 불, 마우스 올리면 명단). 휴게실은 8명까지만 보이고 나머지 '+N명 더'. 다른 방도 자리가 모자라면 '+N명 더'.
- 한 방에 9명 이상이면 이름표 숨김(마우스를 올리면 보임). 60초마다 새로 불러옴(설정값).
- **배치(2026-10-04)**: 동네지도 탭(fill)에선 '장소별 현황'이 지도 **위에 가로로**(`.tw-panel.tw-top`, 동네 묶음별 카드, 이름 칩은 6개까지 + '+N'),
  지도는 아래에 **화면 폭 가득**(높이 제한 없음, 필요하면 아래로 스크롤). 데모(town-demo.html, fill 아님)는 예전처럼 오른쪽 패널.
- **장소 크게 보기**: 지도에서 방(또는 그 안 사람·'+N명 더'·직장 팻말)이나 위쪽 장소 카드를 누르면 `openZoom(id)` → 지도 위에 큰 창.
  왼쪽 = 그 방을 확대한 그림(매 프레임 `wC`에서 잘라 그림, 이름표 전부 보임), 오른쪽 = 그 장소 사람 목록(업무유형·진행·시간·제목, 녹음·사회 내용은 교관 이상만).
  ✕·바깥 누르기·Esc로 닫힘. 직장은 건물 그림 + 명단.
- 미리보기: `beta/town-demo.html` (로그인 없이 가짜 50명, 시계 돌리기·팀원/교관 보기 전환). 그림을 고치면 여기서 먼저 확인.
  Claude 미리보기(artifact)는 이 파일에 town.js를 끼워 넣어 만든 것. 참고 그림풍: 위에서 비스듬히 본 도트, 따뜻하고 바랜 색, 진한 외곽선.
- **아직 확인 못 한 것**: 실제 데이터로 `dashboard.scene`을 불러오는 것 (claude.ai 작업 공간에선 Supabase 주소로 직접 요청이 막혀 있었음. 클로드 코드에선 가능).
  사용자가 PC에서 탭을 열어 보고 오류가 나면 Supabase 함수 로그부터 볼 것.
- **사용자 확인 대기**: 고정일정에 직장 말고 학교 등이 섞이는지 (섞이면 고정일정에 종류 칸 추가).
- **캐릭터 꾸미기**(2026-10-04): `people.town_look` jsonb → `dashboard.scene`이 `look`으로 보냄 → town.js가 기본 생김새(`lookFor`, id 해시) 위에 덮어씀.
  덮을 수 있는 것: skin·hair·style(short/long/bob/bun/cap)·shirt·shirt2·pants·capc·blush, 그리고 `ride`.
  `ride: "ford"` = 이동하는 동안만 짙은 파랑 머스탱풍 **오픈카**(지붕 없음, 흰 줄, 그 사람 얼굴이 차 위로 쏙 — 사람 그림의 머리 7칸을 잘라 씀)로 그려지고 걸음보다 빠름(55 vs 30), 도착하면 내림(`drawRide`, `fordParts`).
  지금 설정: 김지혜 = ford. 2026-10-05부터 본인이 나의 기록에서 직접 꾸밈(아래 '나의 기록 배치·캐릭터 꾸미기'). 새 탈것·모양은 town.js 그리기 + main.ts `LOOK_OPTS` 둘 다 추가.
  사람마다 애니메이션 박자는 `p.seed`(id 해시 숫자). 예전엔 문자 id를 더해서 걷는 다리 움직임이 안 됐음 → 고침.
- **장소 상태 연출**(2026-10-05, 함수 버전 38): 받아 둔 segs로 분마다 장소 상태 계산(`updatePlaceStatus`, `placeSt`, `busyLabel`). 새 표 없음.
  코드원·SMC 녹음 중 = ON AIR 깜빡임 + 문 닫힘 + 이름표 'ON AIR'. 스담 방 5개 수업·모임·회의·스터디·연습 중 = 바닥 불빛 + 이름표 'OO 중'. 총회·성전 = '회의 중'.
  녹음이 시간이 지나 끝나는 순간(새로 불러와서 바뀐 건 빼고) 문이 열리고 '🎉 수고했어요!' + 반짝이 5초(`cheers`). '동작 줄이기' 설정이면 깜빡임·연출 없음.
  새로 불러오기는 `dashboard.scene`의 `refresh_sec`(설정값 `town_refresh_sec`, 기본 60, 최소 15), 탭이 안 보이면 멈추고 돌아오면 바로 새로(`onVis`).
- 장소 글자 맞추기 주의: '과천성전 9층'은 별칭 '과천성전'에 걸려 10층 방에 보임, '줌'은 목록에 없어 '외부'로 보임(필요하면 places·town.js에 장소 추가).

## 4. DB 요약

- 모든 테이블 RLS 켜짐 + 정책 없음 → 공개 키로는 아무것도 못 해요. service_role(문지기)만 접근.
  함수 실행 권한은 public/anon/authenticated에서 회수돼 있어요.
- 모든 테이블에 `audit_trigger()`가 달려 있어요. 문지기가 보내는 헤더 `x-actor-id`로 누가 바꿨는지 `audit_log`에 남아요. 🔴 조회는 `access_log`.
- 주요 테이블
  - 사람·조직: `org_units`, `churches`, `people`, `people_private`, `positions`, `position_history`, `group_assignments`, `external_roles`
  - 교육: `meeting_types`, `meeting_sessions`(+`closed_at`, `notified_at`, `notify_result`), `attendance`(최종 `status`: 참석/불참/지각/조퇴, 사전 `planned_status/planned_reason/planned_at`, 확인 `arrived_at/checked_by`, 사유 `reason/reason_at`), `checkins`, `checkin_reports`, `assignments`, `assignment_submissions`, `notices`, `session_reviews`
  - 녹음: `availability`(slots smallint[] 0~47, 30분 단위), `weekly_submissions`(week_start = 월요일), `fixed_schedules`, `recording_requests`(제목·코드, 대본은 `nas_ref`로 NAS만 가리킴), `castings`(한 배역에 여러 명 확정 가능), `recording_sessions`(retake_of), `recording_participants`
  - 홈: `staff_schedules`, `duties`(녹음/사회/촬영/음향편집/기타), `projects`(기획/진행/보류/완료), `tribe_stats`(12지파 행 미리 있음)
  - 동네지도: `places`(code·name·area·building·floor·aliases)
  - 관리: `app_settings`(`weekly_hours` {"from":8,"to":24}, `recording_access`, `late_grace_minutes` 0), `pin_sessions`, `audit_log`, `access_log`
- 뷰: `v_people_current`, `v_positions_current`
- 함수: `effective_rank(person, unit)`, `set_pin`, `reset_pin`, `verify_pin`, `is_pin_unlocked`, `audit_trigger`
- 스키마를 바꿀 땐 Supabase MCP `apply_migration`을 써요. drop이 섞이면 취소될 때가 있어서 나눠서 해요.

## 5. 권한 규칙 (자세한 건 권한설계.md)

- 직책 서열: 팀원 10 · 조장 20 · 교관 30 · 부팀장 35 · 팀장 40 · 부과장 50 · 과장 60 · 서무 65 · 문화부장 70
- `position_history` = 사람 + 직책 + 조직단위 + 기간. 겸직 가능. 문화부 직책만 넣어요.
- 조장은 팀 단위로 기록하고, 어느 조인지는 `group_assignments`로 봐요.
- 윗단위 직책은 아래로 상속돼요. 상속은 **문화부(`is_permission_root`)까지만**.
- 등급: 🟢 일반 / 🟡 관리 / 🔴 민감(PIN + 열람 기록)
- 공통: 본인이 낸 건 본인이 조회·수정. 조장 이상은 출결 현황 조회·수정. 다른 팀원은 이름까지만 보여요.
- 녹음 관계자: 성우팀 교관(30) 이상, 엔지니어팀 팀장(40) 이상은 두 팀의 녹음 관련 데이터(가능시간 모아보기 등)를 다 봐요.
- 구역장 정보는 팀장 이상만 봐요.
- 공지: 팀 공지는 교관 이상, 과 공지는 팀장 이상이 써요. 다른 팀 사람을 함께 고르는 건 만드는 팀에서 그 서열이면 돼요(2026-10-05).
- 회의 모드: 그 모임 대상자 + 그 팀 교관 이상. 진행자(모임 만든 사람)·서기 권한은 위 '회의 모드' 참고.
- 인원 특이사항(🟡~🔴 성격): 다른 사람 것은 그 팀 교관 이상만 봄(열람 기록). 팀원은 자기가 알린 것만 쓰고 봄, 운영진 기록·메모는 못 봄. 지우기 = 쓴 사람·교관 이상.
- 장소 신청: 신청·취소는 과원 누구나(취소는 본인). 승인·반려는 그 장소 승인자만(관리자 페이지 지정, 기본 녹음실=엔지니어팀장, 총회·성전=부과장 이상).
- 관리자 페이지: 관리자 명단(`admins`)만. 관리자·회계·장소 승인자 지정, 결산 켜기·공개일.
- 첨부 대본: 올리기·지우기 = 그 글 쓴 사람·관리자(공지 팀 교관/과 팀장, 과제 교관 이상). 열기 = 쓴 사람·관리자·받는 사람, 5분 주소, 열람 기록. 14일 뒤 자동 삭제. 우리 교회 대본은 올리지 않음(NAS).
- 하늘방송국 방명록: 쓴 사람과 사무실 주인만 봄. 지우기도 이 둘만.
- 회비(🔴 성격): 본인과 회계 명단만 봄. 회계 명단은 관리자가 지정. 계좌번호는 앱에 안 둠.
- 연말 결산: 본인 것만. 공개일(`recap_open`) 전엔 교관 이상·관리자만 미리보기, 팀 결산은 그 팀 교관 이상(합계만). 공개일은 관리자 명단(`admins`)만 바꿈.
- 배지(🟡): 보유 목록은 본인 + 그 팀 교관(설정값) 이상. 대표 칭호는 본인이 고른 것만 모두에게. 배지 정의는 팀장 이상(관리자 페이지, 지금은 SQL).
- 성우 스탯(🟡): 주기·고치기는 그 팀 교관(설정값 `stat_grant_min_level`) 이상, 본인에겐 못 줌. 보기는 본인 + 그 팀 교관 이상. 취소는 준 사람·팀장 이상. 녹음 관계자 예외 없음.
- 모임: 만들기·고치기·취소·출결확인·마감은 조장 이상. 출결 상태는 팀원 모두, 사유는 본인·조장 이상.

## 6. 조직 계층

총회 → 12지파(요한, 베드로, 바돌로매, 마태, 서울야고보, 부산야고보, 안드레, 빌립, 시몬, 맛디아, 다대오, 도마)
→ 부서(문화부) → 과(방송예술과) → 팀(성우/아나운서/엔지니어) → 조(1~4조)
지금은 요한지파 = 총회로 봐요.

## 7. 지켜야 할 것

- 교회는 **녹음 대본 유출**을 아주 싫어해요. 대본은 NAS에만 두고 Supabase엔 제목·코드만.
- 특이사항·심방·캐스팅 참고 같은 민감 정보는 🔴 + NAS.
- 과장님 컨펌 전에는 실제 인원 데이터를 넓게 넣지 않아요. 지금은 시범 인원만 있어요:
  박현희(성우팀 팀장), 이강준(교관), 정동훈(교관), 임지윤(조장, 2조), 신효지(팀원, 2조), 김지혜(방송예술과 교관, 팀 없음 → 세 팀 모두 교관 권한. 2026-10-04 추가).
- 봇 토큰 등 비밀값은 채팅에 붙여넣지 말라고 안내해요.
- 화면 확인은 브라우저에서 `window.api`를 가짜로 바꿔 넣어 해요 (DB에 쓰지 않게).
- 커밋 작성자: `user.name Claude`, `user.email noreply@anthropic.com`.

## 8. 남은 할 일

- [ ] 사용자: BotFather `/newapp`(베타), `/setdomain`, 시범 인원에게 베타 링크 공유 → 의견 모으기
- [ ] 실제 서버로 한 번씩 확인: `dashboard.scene`, `profile.get/update/report`, 미등록자 화면(`not_registered`). 클로드 코드에서 함수 로그로 오류 확인
- [ ] 모임: 월간 리포트 자동 발송(매달 1일 팀장에게 봇으로), 모임 전날 미체크자 알림, 모임 고치기 화면
- [ ] 운영 앱 기능은 다 옮김(시간취합·봇 채팅 답장, 녹음자 배치는 녹음 요청으로 대신). 전환하는 날: 웹훅 `cron.setWebhook` → BotFather 기본 메뉴 → Apps Script 정리
- [ ] `churches` 표 채우기(지파별 본부교회·지교회), 팀장 이상이 다른 사람의 '나의 기록' 보기
- [ ] 녹음: 재녹음·편집완료·전달완료 흐름, 요청·배역 고치기 화면, 감독 교대
- [ ] 관리자 페이지 (PIN 초기화, 설정값 수정, 비활성화)
- [ ] 동네지도: 모임 만들 때 장소를 `places` 목록에서 고르게 (지금은 글자 맞추기), 고정일정에 종류(직장/학교/기타) 칸, 캐릭터 꾸미기(본인이 고르기)
- [ ] 홈 대시보드 데이터 입력 화면 (`staff_schedules`, `duties`, `projects`, `tribe_stats` — 지금은 Supabase 표 편집기로 입력)
- [ ] NAS 대본 연동
- [ ] 조직현황.md의 [확인 필요] 항목 정리
- [ ] 과장님 컨펌 후 방예과 계정으로 Supabase 이전
- [ ] 정식 배포 전: 서버 키(service_role) 새로 바꾸기, 테스트 데이터 초기화
