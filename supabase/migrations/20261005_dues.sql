-- 회비·후원 (2026-10-05). 과원 모두 매달 회비. 본인이 입금 후 '확인 요청' → 회계담당자가 확인/반려. 후원물품도 같은 표(kind)
-- 계좌번호는 앱·DB에 두지 않음 (사용자 결정)
create table dues_entries (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references org_units(id),
  person_id uuid not null references people(id),
  kind text not null check (kind in ('회비', '물품')),
  months text[] not null default '{}',          -- 회비: 몇 월 회비인지 ('2026-10'), 여러 달 가능
  amount int check (amount is null or amount between 1 and 10000000),   -- 회비: 입금한 금액 (기본 회비 × 달 수를 넘는 만큼은 후원금)
  depositor text,                               -- 회비: 입금자명
  item text,                                    -- 물품: 이름
  qty text,                                     -- 물품: 수량 (자유 글자: '2상자')
  memo text,
  status text not null default '대기' check (status in ('대기', '확인', '반려', '취소')),
  reviewed_by uuid references people(id),
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = '회비' and amount is not null and cardinality(months) > 0) or (kind = '물품' and item is not null))
);
create index dues_entries_person on dues_entries (person_id, created_at);
create index dues_entries_section on dues_entries (section_id, status);

-- 매달 미납 자동 알림 기록 (달마다 한 줄)
create table dues_nags (
  month text primary key,                       -- '2026-10'
  sent_at timestamptz not null default now(),
  result jsonb
);

alter table dues_entries enable row level security;
alter table dues_nags enable row level security;
revoke all on dues_entries, dues_nags from anon, authenticated;
create trigger trg_dues_entries_updated before update on dues_entries for each row execute function set_updated_at();
create trigger trg_audit after insert or delete or update on dues_entries for each row execute function audit_trigger();

insert into app_settings (key, value, description) values
  ('treasurers', '[]', '회계담당자 명단 (people.id). 관리자가 앱에서 지정'),
  ('dues_monthly', '10000', '한 달 회비 (원)'),
  ('dues_start', '"2026-10"', '회비를 받기 시작한 달 (YYYY-MM). 이 달부터 미납을 셈'),
  ('dues_nag_day', '25', '매달 이 날 미납자에게 자동 알림 (0이면 안 보냄)')
on conflict (key) do nothing;
