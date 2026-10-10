-- 설문조사 (2026-10-10): 과원 누구나 만듦. 익명이면 만든 사람도 누가 무엇을 답했는지 모름 (관리자·과장만 실명 보기)
create table surveys (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references org_units(id),
  title text not null check (char_length(title) <= 80),
  purpose text check (char_length(purpose) <= 1000),
  questions jsonb not null,                 -- [{id, type: text|one|many|scale, q, options[], required}]
  anonymous boolean not null default true,  -- 만든 뒤엔 못 바꿈
  share_results boolean not null default false,  -- 답한 대상자도 결과(모아보기)를 봄
  target_people uuid[] not null,
  target_label text,
  deadline timestamptz not null,
  status text not null default '진행' check (status in ('진행', '마감')),
  reminded_at timestamptz,
  closed_at timestamptz,
  created_by uuid not null references people(id),
  created_at timestamptz not null default now()
);
create index surveys_targets on surveys using gin (target_people);
-- 답: 한 사람 하나 (마감 전까지 고침). 같은 사람이 두 번 내지 않게 + 관리자·과장 실명 보기를 위해 사람 id는 둠.
-- 문지기가 관리자·과장 말고는 사람 id·시각을 내보내지 않음. audit 트리거도 달지 않음(감사 기록에 누가 무엇을 답했는지 남지 않게)
create table survey_answers (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  answers jsonb not null,                   -- {질문id: 글 | 보기 번호 | [보기 번호…] | 점수}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (survey_id, person_id)
);
alter table surveys enable row level security;
alter table survey_answers enable row level security;
revoke all on surveys, survey_answers from anon, authenticated;
create trigger trg_survey_answers_updated before update on survey_answers for each row execute function set_updated_at();
create trigger trg_audit after insert or delete or update on surveys for each row execute function audit_trigger();

-- 프로젝트 공지·타임라인 (2026-10-10): 공지·모임을 프로젝트에 이어 둠 + 기록
-- (처음엔 작업 흐름(work_flows)에 붙였다가 같은 날 프로젝트 방으로 옮김. 그때 생긴 notices.flow_id·meeting_sessions.flow_id·flow_events는
--  비어 있고 안 씀 — 지우기는 사용자 승인 뒤: drop table flow_events; alter table notices drop column flow_id; alter table meeting_sessions drop column flow_id;)
alter table notices add column project_id uuid references projects(id) on delete set null;
alter table meeting_sessions add column project_id uuid references projects(id) on delete set null;
create index notices_project on notices (project_id) where project_id is not null;
create index meeting_sessions_project on meeting_sessions (project_id) where project_id is not null;
-- 사람이 적는 것: 피드백·협업·협업 모임·초대·아이디어·인원 교체·결정·기타 / 자동: 진행·빠짐·자리·상태
create table project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('피드백', '협업', '협업 모임', '초대', '아이디어', '인원 교체', '결정', '기타', '진행', '빠짐', '자리', '상태')),
  at timestamptz not null default now(),    -- 일어난 때 (적는 사람이 고름)
  who text check (char_length(who) <= 40),  -- 피드백 준 사람·제안자·초대된 사람·교체 전 사람
  who2 text check (char_length(who2) <= 40),-- 교체 뒤 사람
  dept text check (char_length(dept) <= 40),-- 협업하는 과·부서
  role text check (char_length(role) <= 80),-- 역할·작업 단계
  place text check (char_length(place) <= 40),
  body text check (char_length(body) <= 1000),
  auto boolean not null default false,
  created_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now()
);
create index project_events_project on project_events (project_id, at);
alter table project_events enable row level security;
revoke all on project_events from anon, authenticated;
create trigger trg_audit after insert or delete or update on project_events for each row execute function audit_trigger();
