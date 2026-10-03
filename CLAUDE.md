# CLAUDE.md — 방송예술과 텔레그램 미니앱 인수인계

새 대화에서 이 저장소 작업을 이어갈 때 먼저 읽는 문서예요.
(마지막 정리: 2026-10-03)

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
| 파일 | `index.html`, `app.js`, `style.css`, `krmap.js` | `beta/index.html`, `beta/beta.js`, `beta/beta.css` |
| 데이터 | 구글 스프레드시트 + Apps Script | **Supabase만** 사용 |
| 주소 | https://kjlee7.github.io/broadcast-attend/ | https://kjlee7.github.io/broadcast-attend/beta/ |

- **운영 앱 파일은 사용자에게 먼저 묻고 고쳐요.** (index.html 끝에 사용자가 직접 넣은 `api()` 도우미 스크립트가 있어요. 지우지 마세요.)
- 베타 폴더는 다 고친 뒤 바로 올려도 된다고 했어요.
- 베타는 `../style.css`, `../krmap.js`를 같이 써요. 운영 앱 화면과 똑같은 모양이 목표예요.
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
- 현재 배포: SHA `9814c74f1c316a4e093de1e00a4c1464bccf144f` (함수 버전 10).
- 타입 검사는 로컬 `tsc`로 해요. `Uint8Array` 관련 TS2769, `req` 관련 TS7006은 알려진 오탐이라 무시해요. (npm/esbuild는 프록시에 막혀요.)

### 지금 있는 기능(action)
`public.bot`(로그인 전), `me`, `meeting_types.list`, `team.members`, `team.groups`,
`sessions.create/update/list`, `attendance.list/saveMine/saveFor/update`,
`weekly.load/save/board`, `fixed.list/save`,
`notices.list/create/update/delete`, `assignments.list/create/update/delete`,
`submissions.saveMine/list/feedback`, `checkins.list/create/delete/report/unreport`,
`dashboard.load`, `pin.setInitial`, `pin.verify`

## 4. DB 요약

- 모든 테이블 RLS 켜짐 + 정책 없음 → 공개 키로는 아무것도 못 해요. service_role(문지기)만 접근.
  함수 실행 권한은 public/anon/authenticated에서 회수돼 있어요.
- 모든 테이블에 `audit_trigger()`가 달려 있어요. 문지기가 보내는 헤더 `x-actor-id`로 누가 바꿨는지 `audit_log`에 남아요. 🔴 조회는 `access_log`.
- 주요 테이블
  - 사람·조직: `org_units`, `churches`, `people`, `people_private`, `positions`, `position_history`, `group_assignments`, `external_roles`
  - 교육: `meeting_types`, `meeting_sessions`, `attendance`(상태: 참석/불참/지각/조퇴), `checkins`, `checkin_reports`, `assignments`, `assignment_submissions`, `notices`, `session_reviews`
  - 녹음: `availability`(slots smallint[] 0~47, 30분 단위), `weekly_submissions`(week_start = 월요일), `fixed_schedules`, `recording_requests`(제목·코드, 대본은 `nas_ref`로 NAS만 가리킴), `castings`(한 배역에 여러 명 확정 가능), `recording_sessions`(retake_of), `recording_participants`
  - 홈: `staff_schedules`, `duties`(녹음/사회/촬영/음향편집/기타), `projects`(기획/진행/보류/완료), `tribe_stats`(12지파 행 미리 있음)
  - 관리: `app_settings`(`weekly_hours` {"from":8,"to":24}, `recording_access`), `pin_sessions`, `audit_log`, `access_log`
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
- [ ] 베타로 아직 안 옮긴 기능: 시간취합(투표), 녹음자 배치, 프로필
- [ ] 녹음 요청·세션·캐스팅 화면
- [ ] 관리자 페이지 (PIN 초기화, 설정값 수정, 비활성화)
- [ ] 홈 대시보드 데이터 입력 화면 (`staff_schedules`, `duties`, `projects`, `tribe_stats` — 지금은 Supabase 표 편집기로 입력)
- [ ] NAS 대본 연동
- [ ] 조직현황.md의 [확인 필요] 항목 정리
- [ ] 과장님 컨펌 후 방예과 계정으로 Supabase 이전
