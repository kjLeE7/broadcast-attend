-- 내 할 일 (2026-10-07): 각자 '언제까지 이거 해야 함'을 적고 체크. 마감 전날·당일 아침 9시 봇 알림. 본인만 봄
create table personal_todos (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 100),
  memo text check (char_length(memo) <= 500),
  due_on date,
  done_at timestamptz,
  reminded_d1_at timestamptz,
  reminded_d0_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index personal_todos_person on personal_todos (person_id, done_at);
alter table personal_todos enable row level security;
revoke all on personal_todos from anon, authenticated;
create trigger trg_personal_todos_updated before update on personal_todos for each row execute function set_updated_at();
create trigger trg_audit after insert or delete or update on personal_todos for each row execute function audit_trigger();
