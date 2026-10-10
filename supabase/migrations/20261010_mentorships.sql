-- 멘토·멘티 (2026-10-10): 인원 탭에서 교관 이상이 '내가 피드백 해주기로 한 사람'을 정함. 한 팀에서 멘티 한 명당 멘토 한 명
create table mentorships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references org_units(id),
  mentor_id uuid not null references people(id) on delete cascade,
  mentee_id uuid not null references people(id) on delete cascade,
  set_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, mentee_id),
  check (mentor_id <> mentee_id)
);
create index mentorships_mentor on mentorships (team_id, mentor_id);
alter table mentorships enable row level security;
revoke all on mentorships from anon, authenticated;
create trigger trg_audit after insert or delete or update on mentorships for each row execute function audit_trigger();
