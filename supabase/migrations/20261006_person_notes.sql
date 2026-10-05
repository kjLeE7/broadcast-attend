-- 인원 특이사항 (2026-10-06). 운영진(그 팀 교관 이상)만 보는 팀원별 특이사항 + 운영진 메모. 팀원은 '특이사항 알리기'로 자기 것만 쓰고 봄
create table person_notes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references org_units(id),
  person_id uuid not null references people(id),           -- 누구의 특이사항
  category text not null check (category in ('건강', '직장·학업', '일정 충돌', '가정', '기타')),
  title text not null check (length(btrim(title)) between 1 and 60),
  body text check (body is null or length(body) <= 1000),
  starts_on date not null,
  ends_on date,                                             -- 비면 '계속'
  affects text[] not null default '{}',                     -- 수업·스터디·녹음·업무
  status text not null default '진행 중' check (status in ('진행 중', '해결됨')),
  followup text not null default '없음' check (followup in ('없음', '보강', '대체학습')),
  followup_done_at timestamptz,
  source text not null check (source in ('운영진', '본인')),
  created_by uuid not null references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index person_notes_person on person_notes (person_id, starts_on desc);
create index person_notes_team on person_notes (team_id, status);

create table person_note_comments (                         -- 운영진 메모 (팀원은 못 봄)
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references person_notes(id) on delete cascade,
  author_id uuid not null references people(id),
  body text not null check (length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index person_note_comments_note on person_note_comments (note_id, created_at);

alter table person_notes enable row level security;
alter table person_note_comments enable row level security;
revoke all on person_notes, person_note_comments from anon, authenticated;
create trigger trg_person_notes_updated before update on person_notes for each row execute function set_updated_at();
create trigger trg_audit after insert or delete or update on person_notes for each row execute function audit_trigger();
create trigger trg_audit after insert or delete or update on person_note_comments for each row execute function audit_trigger();
