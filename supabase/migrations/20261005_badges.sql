-- 칭호·배지 (2026-10-05). 조건은 지금 데이터로 계산(연속 출석처럼 깨지는 조건은 없음). 판정은 award_badges(사람), 몇 번 돌려도 중복 없음
create table badges (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references org_units(id),
  key text not null,
  name text not null,
  description text not null,
  icon text not null,
  cond_type text not null check (cond_type in ('rec_count','axis_level','all_axes_level','meeting_count','grant_count')),
  cond_value jsonb not null,           -- {"n":10} / {"axis":"change","level":5} / {"level":3}
  sort smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, key)
);
create table person_badges (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id),
  badge_id uuid not null references badges(id),
  earned_at timestamptz not null default now(),
  source_type text,
  source_id uuid,
  is_title boolean not null default false,
  unique (person_id, badge_id)
);
create unique index person_badges_one_title on person_badges (person_id) where is_title;

alter table badges enable row level security;
alter table person_badges enable row level security;
revoke all on badges, person_badges from anon, authenticated;
create trigger trg_badges_updated before update on badges for each row execute function set_updated_at();
create trigger trg_audit after insert or delete or update on badges for each row execute function audit_trigger();
create trigger trg_audit after insert or delete or update on person_badges for each row execute function audit_trigger();

-- 스탯 레벨 N에 필요한 누적 XP (다음 레벨 필요 XP = 현재 레벨 × factor → factor × N(N-1)/2), 최대 레벨 넘으면 못 닿음
create or replace function stat_xp_for_level(p_level int) returns int
language sql stable set search_path = public as $$
  select case when p_level > coalesce((s.value->>'max')::int, 10) then 2147483647
              else coalesce((s.value->>'factor')::int, 3) * p_level * (p_level - 1) / 2 end
  from (select (select value from app_settings where key = 'stat_level') as value) s
$$;

-- 한 사람 배지 판정: 새로 딴 배지만 넣고 돌려줌 (이미 있으면 넘어감)
create or replace function award_badges(p_person uuid)
returns table (out_id uuid, out_name text, out_icon text)
language plpgsql security definer set search_path = public as $$
declare
  rec_n int; meet_n int; grant_n int;
begin
  select count(distinct rp.session_id) into rec_n
    from recording_participants rp join recording_sessions rs on rs.id = rp.session_id
   where rp.person_id = p_person and rp.role = '녹음자' and rp.selected and rs.status = '완료';
  select count(*) into meet_n
    from attendance a join meeting_sessions m on m.id = a.session_id
   where a.person_id = p_person and m.closed_at is not null and a.status in ('참석','지각','조퇴');
  select count(*) into grant_n from stat_grants where person_id = p_person and revoked_at is null;

  return query
  with ok as (
    select b.id, b.name, b.icon from badges b
     where b.is_active
       and effective_rank(p_person, b.team_id) > 0      -- 그 팀 사람만
       and not exists (select 1 from person_badges pb where pb.person_id = p_person and pb.badge_id = b.id)
       and case b.cond_type
         when 'rec_count' then rec_n >= (b.cond_value->>'n')::int
         when 'meeting_count' then meet_n >= (b.cond_value->>'n')::int
         when 'grant_count' then grant_n >= (b.cond_value->>'n')::int
         when 'axis_level' then coalesce((select v.xp from v_stat_xp v join stat_axes x on x.id = v.axis_id
              where v.person_id = p_person and x.team_id = b.team_id and x.key = b.cond_value->>'axis'), 0)
              >= stat_xp_for_level((b.cond_value->>'level')::int)
         when 'all_axes_level' then exists (select 1 from stat_axes x where x.team_id = b.team_id and x.is_active)
              and not exists (select 1 from stat_axes x left join v_stat_xp v on v.axis_id = x.id and v.person_id = p_person
                   where x.team_id = b.team_id and x.is_active and coalesce(v.xp, 0) < stat_xp_for_level((b.cond_value->>'level')::int))
         else false end
  ), ins as (
    insert into person_badges (person_id, badge_id, source_type)
    select p_person, ok.id, 'auto' from ok
    on conflict on constraint person_badges_person_id_badge_id_key do nothing
    returning person_badges.badge_id as bid
  )
  select ok.id, ok.name, ok.icon from ok join ins on ins.bid = ok.id;
end $$;

-- 소급: 활성 인원 모두 판정 (알림 없음). 새로 준 개수
create or replace function award_badges_all() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; p record;
begin
  for p in select id from people where is_active loop
    n := n + (select count(*) from award_badges(p.id));
  end loop;
  return n;
end $$;
revoke all on function stat_xp_for_level(int), award_badges(uuid), award_badges_all() from public, anon, authenticated;

insert into badges (team_id, key, name, description, icon, cond_type, cond_value, sort)
select u.id, b.key, b.name, b.description, b.icon, b.cond_type, b.cond_value::jsonb, b.sort
from org_units u, (values
  ('rec_first',  '첫 마이크',       '첫 녹음을 마쳤어요',                '🎙', 'rec_count',      '{"n":1}', 1),
  ('rec_10',     '녹음 10건',       '성우로 녹음 10건을 마쳤어요',       '📼', 'rec_count',      '{"n":10}', 2),
  ('rec_30',     '단골 목소리',     '성우로 녹음 30건을 마쳤어요',       '🏆', 'rec_count',      '{"n":30}', 3),
  ('change_5',   '백 개의 목소리',  '변성 Lv5에 올랐어요',               '🎭', 'axis_level',     '{"axis":"change","level":5}', 4),
  ('script_5',   '대본 해부학자',   '대본분석 Lv5에 올랐어요',           '🔍', 'axis_level',     '{"axis":"script","level":5}', 5),
  ('diction_5',  '또박또박 장인',   '발음 Lv5에 올랐어요',               '🗣', 'axis_level',     '{"axis":"diction","level":5}', 6),
  ('tone_5',     '톤 마스터',       '톤 Lv5에 올랐어요',                 '🎵', 'axis_level',     '{"axis":"tone","level":5}', 7),
  ('balance_3',  '균형 잡힌 성우',  '모든 스탯이 Lv3 이상이에요',        '⬡',  'all_axes_level', '{"level":3}', 8),
  ('meet_10',    '꾸준한 발걸음',   '모임에 10번 함께했어요',            '👣', 'meeting_count',  '{"n":10}', 9),
  ('meet_50',    '뿌리 깊은 나무',  '모임에 50번 함께했어요',            '🌳', 'meeting_count',  '{"n":50}', 10),
  ('grant_10',   '피드백 수집가',   '교관님께 스탯을 10번 받았어요',     '💌', 'grant_count',    '{"n":10}', 11)
) b(key, name, description, icon, cond_type, cond_value, sort)
where u.name = '성우팀';
