-- 개인연습 기록 (2026-10-08): 날짜·무엇·몇 분·한 줄 메모. 본인만 씀·봄 (팀 교관 보기는 나중에)
create table practice_logs (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  practiced_on date not null,
  kinds text[] not null default '{}',
  minutes smallint not null check (minutes between 1 and 600),
  memo text check (char_length(memo) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index practice_logs_person on practice_logs (person_id, practiced_on desc);
alter table practice_logs enable row level security;
revoke all on practice_logs from anon, authenticated;
create trigger trg_practice_logs_updated before update on practice_logs for each row execute function set_updated_at();
create trigger trg_audit after insert or delete or update on practice_logs for each row execute function audit_trigger();
