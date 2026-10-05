-- 장소 신청 (2026-10-06). 승인: 녹음실(코드원·SMC) = 녹음실 승인자(관리자 페이지, 기본 엔지니어팀장), 총회 대회의실·과천 성전 10층 = 과장·부과장(관리자 페이지에서 바꿈), 그 밖(스담 등) = 승인 없이 먼저 신청한 사람
alter table places add column approval text not null default 'none' check (approval in ('none', 'recording', 'external'));
update places set approval = 'recording' where can_record;
update places set approval = 'external' where code in ('chonghoe', 'seongjeon');

create table place_bookings (
  id uuid primary key default gen_random_uuid(),
  place_code text not null references places(code),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  purpose text not null check (length(btrim(purpose)) between 1 and 100),
  team_id uuid references org_units(id),
  person_id uuid not null references people(id),        -- 신청한 사람
  status text not null default '대기' check (status in ('대기', '승인', '반려', '취소')),
  decided_by uuid references people(id),
  decided_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index place_bookings_time on place_bookings (place_code, starts_at) where status in ('대기', '승인');
alter table place_bookings enable row level security;
revoke all on place_bookings from anon, authenticated;
create trigger trg_place_bookings_updated before update on place_bookings for each row execute function set_updated_at();
create trigger trg_audit after insert or delete or update on place_bookings for each row execute function audit_trigger();

-- 승인자 명단 (관리자 페이지에서 지정). 비어 있으면: 녹음실 = 엔지니어팀 팀장 이상, 외부 = 과 부과장 이상
insert into app_settings (key, value, description) values
  ('place_approvers', '{"recording": [], "external": []}', '장소 신청 승인자 (people.id). 비면 녹음실=엔지니어팀 팀장 이상, 총회·성전=부과장 이상')
on conflict (key) do nothing;
