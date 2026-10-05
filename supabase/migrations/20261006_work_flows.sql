-- 작업 흐름 (2026-10-06): 지시자(교관 이상)가 단계·담당·마감·앞 단계를 적으면, 차례가 된 담당자에게 알림 + 모두가 진행 상황을 봄
create table work_flows (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references org_units(id),
  title text not null check (char_length(title) between 1 and 80),
  note text check (char_length(note) <= 3000),          -- 붙여넣은 원문 등
  status text not null default '진행' check (status in ('진행','완료','취소')),
  created_by uuid not null references people(id),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table work_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references work_flows(id) on delete cascade,
  sort smallint not null default 0,
  title text not null check (char_length(title) between 1 and 80),
  detail text check (char_length(detail) <= 500),
  due_on date,
  done_rule text not null default '한 명' check (done_rule in ('한 명','모두')),
  after_ids uuid[] not null default '{}',                -- 이 단계들이 끝나야 차례
  ready_at timestamptz,                                  -- 차례가 된 때 (알림 보낸 때)
  done_at timestamptz,
  reminded_d1_at timestamptz,
  reminded_over_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table work_step_people (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references work_steps(id) on delete cascade,
  person_id uuid references people(id),                  -- 앱에 없는 사람은 null + name
  name text not null check (char_length(name) between 1 and 30),
  state text not null default '대기' check (state in ('대기','시작','완료','막힘')),
  note text check (char_length(note) <= 300),
  changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index work_flows_team on work_flows (team_id, status);
create index work_steps_flow on work_steps (flow_id);
create index work_step_people_step on work_step_people (step_id);
create index work_step_people_person on work_step_people (person_id) where person_id is not null;

alter table work_flows enable row level security;
alter table work_steps enable row level security;
alter table work_step_people enable row level security;
revoke all on work_flows, work_steps, work_step_people from anon, authenticated;
create trigger trg_work_flows_updated before update on work_flows for each row execute function set_updated_at();
create trigger trg_work_steps_updated before update on work_steps for each row execute function set_updated_at();
create trigger trg_work_step_people_updated before update on work_step_people for each row execute function set_updated_at();
create trigger trg_audit after insert or delete or update on work_flows for each row execute function audit_trigger();
create trigger trg_audit after insert or delete or update on work_steps for each row execute function audit_trigger();
create trigger trg_audit after insert or delete or update on work_step_people for each row execute function audit_trigger();
