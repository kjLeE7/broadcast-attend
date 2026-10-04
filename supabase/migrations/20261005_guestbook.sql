-- 하늘방송국 사무실 방명록 (2026-10-05). 쓴 사람과 사무실 주인만 봄
create table guestbook (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references people(id),     -- 사무실 주인
  author_id uuid not null references people(id),    -- 쓴 사람
  text text not null check (length(btrim(text)) between 1 and 200),
  created_at timestamptz not null default now(),
  check (owner_id <> author_id)
);
create index guestbook_owner on guestbook (owner_id, created_at desc);
alter table guestbook enable row level security;
revoke all on guestbook from anon, authenticated;
create trigger trg_audit after insert or delete or update on guestbook for each row execute function audit_trigger();
