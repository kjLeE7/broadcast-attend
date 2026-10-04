-- 공지·과제 첨부 대본 (2026-10-06). 우리 교회 대본이 아닐 때만 올림 (교회 대본은 NAS). 비공개 보관함, 받는 사람만 문지기 거쳐 잠깐 열림, 14일 뒤 자동 삭제
insert into storage.buckets (id, name, public, file_size_limit)
values ('scripts', 'scripts', false, 20971520)       -- 20MB
on conflict (id) do nothing;

create table content_files (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('notice', 'assignment')),
  item_id uuid not null,
  path text not null unique,           -- 보관함 안 경로 (kind/item_id/랜덤)
  name text not null,                  -- 원래 파일 이름 (내려받을 때 이 이름)
  size int not null check (size > 0 and size <= 20971520),
  uploaded_by uuid not null references people(id),
  uploaded boolean not null default false,   -- 실제로 올라갔는지 (files.done)
  expires_at timestamptz not null,     -- 이때 지나면 cron이 지움 (과제: 마감+14일, 공지·마감 없음: 올린 날+14일)
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index content_files_item on content_files (kind, item_id) where deleted_at is null;
alter table content_files enable row level security;
revoke all on content_files from anon, authenticated;
create trigger trg_audit after insert or delete or update on content_files for each row execute function audit_trigger();

insert into app_settings (key, value, description) values ('file_keep_days', '14', '첨부 대본 보관 일수 (과제 마감 또는 올린 날부터)')
on conflict (key) do nothing;

-- 모임에도 첨부 (2026-10-06)
alter table content_files drop constraint content_files_kind_check;
alter table content_files add constraint content_files_kind_check check (kind in ('notice', 'assignment', 'session'));
