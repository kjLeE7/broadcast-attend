# CLAUDE.md — 방송예술과 텔레그램 미니앱 인수인계

새 대화에서 이 저장소 작업을 이어갈 때 먼저 읽는 문서예요.
(마지막 정리: 2026-10-04, 동네지도 탭까지)

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
- 글꼴: 베타 전체(동네지도 포함)가 **고운바탕**(Gowun Batang, OFL). `beta/fonts/`에 woff로 넣고 `beta/fonts.css`에서 불러요.
  자주 쓰는 완성형 2,350자+영문·기호는 기본 파일(약 40만 바이트), 나머지 드문 글자는 `-ext` 파일(그 글자가 화면에 있을 때만 내려받음).
  `beta.css` 끝의 `body, body * { font-family: … !important }`가 style.css의 글꼴 지정을 전부 덮어써요. (woff2 변환은 brotli가 프록시에 막혀 woff로 함)
- **PC 화면 배치 원칙**: 평소엔 화면 전체를 씀(카드는 여러 줄 격자). 모임·과제처럼 눌러서 상세가 필요하면 왼쪽 목록 | 오른쪽 상세로 반반,
  상세는 오른쪽에서 스르륵 들어옴(✕ 버튼이나 Esc로 닫으면 다시 전체). 출결 `#attendWrap.split`, 과제 `#taskView.split`. 새 화면도 이 방식으로.
- 캐시 때문에 `beta/index.html`의 `?v=20261003h` 같은 버전 문자열을 고칠 때마다 올려요.
- 봇: `@BangYeah_bot`. 같은 봇에 BotFather `/newapp`으로 베타 미니앱을 따로 등록해요.
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
- 현재 배포: SHA `8039964687f2d90f3c2f770b06459a5c476d927c` (함수 버전 14, 프로필 나의 기록).
- 타입 검사는 로컬 `tsc`로 해요. `Uint8Array` 관련 TS2769, `req` 관련 TS7006은 알려진 오탐이라 무시해요. (npm/esbuild는 프록시에 막혀요.)

### 지금 있는 기능(action)
`public.bot`(로그인 전), `me`, `meeting_types.list`, `team.members`, `team.groups`,
`sessions.create/update/delete/list/board/close`, `attendance.plan/check/uncheck/setStatus/reason`, `reports.monthly`,
`weekly.load/save/board`, `fixed.list/save`,
`notices.list/create/update/delete`, `assignments.list/create/update/delete`,
`submissions.saveMine/list/feedback`, `checkins.list/create/delete/report/unreport`,
`dashboard.load`, `dashboard.scene`, `profile.get/update/report`, `pin.setInitial`, `pin.verify`

### 등록 안 된 사람
- 문지기가 403과 함께 `code: "not_registered"`, `tg_id`(텔레그램 숫자 번호), `tg_name`을 돌려줌 → 베타 화면에 번호를 크게 띄움(`showNotRegistered`).
  새 사람은 그 화면을 캡처해 보내고, `people`(name, telegram_user_id) + `position_history`(팀 직책) + 필요하면 `group_assignments`(조)를 넣으면 들어올 수 있음.

### 프로필 '나의 기록' (2026-10-04, 탭 맨 끝 + 오른쪽 위 동그라미)
- `profile.get`: 내 people 정보 + 구역장(people_private) + 직책 + 문화부 밖 사명 + 지파·교회 목록.
- `profile.update`: 본인이 고칠 수 있는 것 = 성별·생년월일·연락처·지파·교회·회 소속·구역장 성함/연락처. **이름·텔레그램 번호·직책은 못 고침**(팀장 이상 관리).
  교회는 고른 지파의 `churches`만. `churches` 표는 아직 비어 있음 → 지파별 교회 목록을 받아 채워야 함.
- `profile.report { month }`: 그달 내 모임 출결(모임 유형별: 정규수업·스터디·운영회의), 실무 녹음(`recording_participants`, 제목·코드만), 그 밖의 실무(`duties` owner = 나, 녹음 세션과 이어진 녹음 업무는 뺌), 과제 제출.
  출석률은 마감된 모임만. 녹음·실무·과제 부분은 하나가 실패해도 나머지는 보이게 `errors`에 이름만 남김(함수 로그 확인).
- PC에서 '정보 고치기'를 누르면 오른쪽 패널(`#profileView.split`). 오른쪽 위 동그라미는 이제 프로필로 감, 로그아웃은 프로필 카드 아래.
- 화면 제목은 한국어: 함께한 자리(출결) · 한 달의 발자취(리포트) · 전하는 말(공지) · 갈고닦는 시간(과제) · 목소리 시간표(녹음가능) · 나의 기록(프로필).

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
- **아직 확인 못 한 것**: 실제 데이터로 `dashboard.scene`을 불러오는 것 (개발 환경에서 Supabase 주소로 직접 요청이 막혀 있음).
  사용자가 PC에서 탭을 열어 보고 오류가 나면 Supabase 함수 로그부터 볼 것.
- **사용자 확인 대기**: 고정일정에 직장 말고 학교 등이 섞이는지 (섞이면 고정일정에 종류 칸 추가).

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
  박현희(성우팀 팀장), 이강준(교관), 정동훈(교관), 임지윤(조장, 2조), 신효지(팀원, 2조).
- 봇 토큰 등 비밀값은 채팅에 붙여넣지 말라고 안내해요.
- 화면 확인은 브라우저에서 `window.api`를 가짜로 바꿔 넣어 해요 (DB에 쓰지 않게).
- 커밋 작성자: `user.name Claude`, `user.email noreply@anthropic.com`.

## 8. 남은 할 일

- [ ] 사용자: BotFather `/newapp`(베타), `/setdomain`, 시범 인원에게 베타 링크 공유 → 의견 모으기
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
