-- 성우 스탯 (2026-10-05): 교관이 실무 뒤 팀원에게 축별 경험치(XP)를 줌. 레벨은 저장 안 하고 지급 내역에서 계산.
create table stat_axes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references org_units(id),
  key text not null,
  name text not null,
  description text,
  sort smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, key)
);

create table stat_grants (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references org_units(id),
  person_id uuid not null references people(id),
  granted_by uuid not null references people(id),
  source_type text not null check (source_type in ('녹음','수업','스터디','기타')),
  source_id uuid,
  comment text not null check (length(btrim(comment)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references people(id),
  check (person_id <> granted_by)
);
-- 같은 실무에서 같은 교관이 같은 사람에게는 1번만 (취소된 건 빼고)
create unique index stat_grants_once on stat_grants (granted_by, person_id, source_type, source_id)
  where source_id is not null and revoked_at is null;
create index stat_grants_person on stat_grants (person_id, created_at);

create table stat_grant_items (
  grant_id uuid not null references stat_grants(id) on delete cascade,
  axis_id uuid not null references stat_axes(id),
  xp smallint not null check (xp between 1 and 3),
  primary key (grant_id, axis_id)
);

-- 축별 XP 합계 (취소 안 된 지급만)
create view v_stat_xp with (security_invoker = true) as
select g.person_id, i.axis_id, sum(i.xp)::int as xp
from stat_grants g join stat_grant_items i on i.grant_id = g.id
where g.revoked_at is null
group by g.person_id, i.axis_id;

alter table stat_axes enable row level security;
alter table stat_grants enable row level security;
alter table stat_grant_items enable row level security;
revoke all on stat_axes, stat_grants, stat_grant_items, v_stat_xp from anon, authenticated;

create trigger trg_stat_axes_updated before update on stat_axes for each row execute function set_updated_at();
create trigger trg_stat_grants_updated before update on stat_grants for each row execute function set_updated_at();
create trigger trg_audit after insert or delete or update on stat_axes for each row execute function audit_trigger();
create trigger trg_audit after insert or delete or update on stat_grants for each row execute function audit_trigger();
create trigger trg_audit after insert or delete or update on stat_grant_items for each row execute function audit_trigger();

insert into stat_axes (team_id, key, name, description, sort)
select u.id, a.key, a.name, a.description, a.sort
from org_units u, (values
  ('natural', '자연스러움', '말하듯 자연스럽게 읽는 힘', 1),
  ('tone',    '톤',         '상황·배역에 맞는 톤', 2),
  ('diction', '발음',       '정확하고 또렷한 발음', 3),
  ('voice',   '발성',       '안정된 호흡과 소리', 4),
  ('change',  '변성',       '목소리를 바꿔 연기하는 폭', 5),
  ('script',  '대본분석',   '대본을 읽고 의도를 잡는 힘', 6)
) a(key, name, description, sort)
where u.name = '성우팀';

insert into app_settings (key, value, description) values
  ('stat_grant_min_level', '30', '성우 스탯: 주고 고칠 수 있는 최소 직책 서열 (30 = 교관)'),
  ('stat_max_xp_per_grant', '12', '성우 스탯: 한 번에 줄 수 있는 XP 합계 최대 (축당 1~3)'),
  ('stat_level', '{"factor":3,"max":10}', '성우 스탯 레벨 공식: 다음 레벨 필요 XP = 현재 레벨 × factor, 최대 레벨 max')
on conflict (key) do nothing;
