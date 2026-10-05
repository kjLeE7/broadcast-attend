-- 회의 모드 (2026-10-06). 모임 하나에 회의 하나. 안건(시간 정하기·미리 의견), 진행(지금 안건·남은 시간·주차장), 서기 칸(요약·결정·할 일), 할 일은 담당자 '지금 할 일'로
create table meetings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references meeting_sessions(id) on delete cascade,
  team_id uuid not null references org_units(id),
  chair_id uuid not null references people(id),          -- 진행자 (모임 만든 사람)
  scribe_id uuid references people(id),                  -- 서기 (회의마다 지정)
  status text not null default '준비' check (status in ('준비', '진행', '끝')),
  current_item_id uuid,
  item_started_at timestamptz,
  started_at timestamptz, ended_at timestamptz,
  prep_reminded_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table meeting_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  kind text not null default '일반' check (kind in ('일반', '인원', '할 일 점검')),
  title text not null check (length(btrim(title)) between 1 and 80),
  background text, decide text, options text,             -- 배경 / 정해야 할 것 / 선택지
  person_id uuid references people(id),                   -- 인원 안건
  minutes_min smallint not null default 10 check (minutes_min between 1 and 120),
  extended_min smallint not null default 0,
  priority smallint not null default 2 check (priority between 1 and 3),   -- 1 높음
  sort smallint not null default 0,
  status text not null default '대기' check (status in ('대기', '논의 중', '결론', '넘김')),
  summary text, decision text,
  created_by uuid not null references people(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index meeting_items_m on meeting_items (meeting_id, sort);
create table meeting_opinions (
  item_id uuid not null references meeting_items(id) on delete cascade,
  person_id uuid not null references people(id),
  body text not null check (length(btrim(body)) between 1 and 500),
  updated_at timestamptz not null default now(),
  primary key (item_id, person_id)
);
create table meeting_parked (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  text text not null check (length(btrim(text)) between 1 and 200),
  created_by uuid not null references people(id),
  created_at timestamptz not null default now()
);
create table meeting_actions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  item_id uuid references meeting_items(id) on delete set null,
  team_id uuid not null references org_units(id),
  assignee_id uuid not null references people(id),
  task text not null check (length(btrim(task)) between 1 and 200),
  due_on date,
  done_at timestamptz,
  reminded_d1_at timestamptz, reminded_over_at timestamptz,
  created_by uuid not null references people(id),
  created_at timestamptz not null default now()
);
create index meeting_actions_who on meeting_actions (assignee_id) where done_at is null;
do $$ declare t text; begin
  foreach t in array array['meetings','meeting_items','meeting_opinions','meeting_parked','meeting_actions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('create trigger trg_audit after insert or delete or update on %I for each row execute function audit_trigger()', t);
  end loop;
end $$;
create trigger trg_meetings_updated before update on meetings for each row execute function set_updated_at();
create trigger trg_meeting_items_updated before update on meeting_items for each row execute function set_updated_at();
