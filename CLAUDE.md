# CLAUDE.md — 방송예술과 텔레그램 미니앱 인수인계

새 대화에서 이 저장소 작업을 이어갈 때 먼저 읽는 문서예요.
(마지막 정리: 2026-10-04, 프로필·글꼴·PC 배치·홈 파트 구분까지)

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
   - **아래 탭 정리**: 폰 = 홈·출결·공지·프로필 4칸, PC = 홈·동네지도·출결·공지·프로필. 과제·업무가능 탭은 없앰(화면 `taskView`·`weeklyView`와 `curTab` 값 'task'·'weekly'는 그대로).
     과제 = 공지 안 [공지|과제] 칩(`goTask('notice')`, 과제 내기 FAB는 여기서만) + 프로필 [나의 기록|내 과제|업무가능] 칩(`goTask('profile')`).
     업무가능 = 프로필 안 칩. 아래 탭 강조는 `parentTab()`(weekly→profile, task→`taskFrom`). 칩 줄은 `.b-attseg` + `.wkchip`, 과제 쪽은 `renderTaskSeg()`.
     동네지도는 `townAllowed()` = 폰 아님 + 가로 1000px 이상. 창 크기 바뀌면 `setupTownTab()`으로 다시 판단, 탭 칸 수도 보이는 개수로.
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
- Supabase에 배포된 `index.ts`는 **한 줄**이에요:
  ```ts
  import "https://raw.githubusercontent.com/kjLeE7/broadcast-attend/<커밋SHA>/supabase/functions/api/main.ts";
  ```
- 고치는 순서: `main.ts` 수정 → 커밋·푸시 → 그 커밋 SHA로 `index.ts`를 바꿔 `deploy_edge_function` (verify_jwt = false).
- 현재 배포: SHA `d8670e183030ca1bea30f606d96d201f9f6b84b2` (함수 버전 24, 캐릭터 꾸미기 look).
- 타입 검사는 로컬 `tsc`로 해요. `Uint8Array` 관련 TS2769, `req` 관련 TS7006은 알려진 오탐이라 무시해요. (npm/esbuild는 프록시에 막혀요.)

### 지금 있는 기능(action)
`public.bot`(로그인 전), `me`, `meeting_types.list`, `team.members`, `team.groups`,
`sessions.create/update/delete/list/board/close/remind/audience`, `cron.reminders`(pg_cron 전용), `attendance.plan/check/uncheck/setStatus/reason`, `reports.monthly`,
`weekly.load/save/board`, `fixed.list/save`,
`notices.list/create/update/delete/audience`, `assignments.list/create/update/delete`, `reads.mark/list`, `birthday.wish`, `templates.list/save/delete`,
`submissions.saveMine/list/feedback`, `checkins.list/create/delete/report/unreport`,
`dashboard.load`, `dashboard.scene`, `profile.get/update/report`, `pin.setInitial`, `pin.verify`

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
- 화면 제목은 한국어: 함께한 자리(출결) · 한 달의 발자취(리포트) · 전하는 말(공지) · 갈고닦는 시간(과제) · 업무가능 시간 취합(업무가능) · 나의 기록(프로필).

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
- 한 방에 9명 이상이면 이름표 숨김(마우스를 올리면 보임). 3분마다 새로 불러옴.
- 미리보기: `beta/town-demo.html` (로그인 없이 가짜 50명, 시계 돌리기·팀원/교관 보기 전환). 그림을 고치면 여기서 먼저 확인.
  Claude 미리보기(artifact)는 이 파일에 town.js를 끼워 넣어 만든 것. 참고 그림풍: 위에서 비스듬히 본 도트, 따뜻하고 바랜 색, 진한 외곽선.
- **아직 확인 못 한 것**: 실제 데이터로 `dashboard.scene`을 불러오는 것 (claude.ai 작업 공간에선 Supabase 주소로 직접 요청이 막혀 있었음. 클로드 코드에선 가능).
  사용자가 PC에서 탭을 열어 보고 오류가 나면 Supabase 함수 로그부터 볼 것.
- **사용자 확인 대기**: 고정일정에 직장 말고 학교 등이 섞이는지 (섞이면 고정일정에 종류 칸 추가).
- **캐릭터 꾸미기**(2026-10-04): `people.town_look` jsonb → `dashboard.scene`이 `look`으로 보냄 → town.js가 기본 생김새(`lookFor`, id 해시) 위에 덮어씀.
  덮을 수 있는 것: skin·hair·style(short/long/bob/bun/cap)·shirt·shirt2·pants·capc·blush, 그리고 `ride`.
  `ride: "ford"` = 이동하는 동안만 짙은 파랑 머스탱풍 **오픈카**(지붕 없음, 흰 줄, 그 사람 얼굴이 차 위로 쏙 — 사람 그림의 머리 7칸을 잘라 씀)로 그려지고 걸음보다 빠름(55 vs 30), 도착하면 내림(`drawRide`, `fordParts`).
  지금 설정: 김지혜 = ford. 사용자가 "누구 캐릭터를 ~로" 부탁하면 SQL로 `town_look`만 고치면 됨(새 탈것·모양이면 town.js에 그리기 추가).
  사람마다 애니메이션 박자는 `p.seed`(id 해시 숫자). 예전엔 문자 id를 더해서 걷는 다리 움직임이 안 됐음 → 고침.
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
- 공지: 팀 공지는 교관 이상, 과 공지는 팀장 이상이 써요.
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
- [ ] 베타로 아직 안 옮긴 기능: 시간취합(투표), 녹음자 배치
- [ ] `churches` 표 채우기(지파별 본부교회·지교회), 팀장 이상이 다른 사람의 '나의 기록' 보기
- [ ] 녹음 요청·세션·캐스팅 화면
- [ ] 관리자 페이지 (PIN 초기화, 설정값 수정, 비활성화)
- [ ] 동네지도: 모임 만들 때 장소를 `places` 목록에서 고르게 (지금은 글자 맞추기), 고정일정에 종류(직장/학교/기타) 칸, 캐릭터 꾸미기(본인이 고르기)
- [ ] 홈 대시보드 데이터 입력 화면 (`staff_schedules`, `duties`, `projects`, `tribe_stats` — 지금은 Supabase 표 편집기로 입력)
- [ ] NAS 대본 연동
- [ ] 조직현황.md의 [확인 필요] 항목 정리
- [ ] 과장님 컨펌 후 방예과 계정으로 Supabase 이전
