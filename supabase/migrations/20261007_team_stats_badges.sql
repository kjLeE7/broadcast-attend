-- 아나운서·엔지니어 육각형 스탯 + 팀별 칭호 (2026-10-07)
insert into stat_axes (team_id, key, name, description, sort)
select u.id, a.key, a.name, a.description, a.sort from org_units u, (values
  ('voice',    '발성',     '흔들림 없이 멀리 가는 소리', 1),
  ('diction',  '발음',     '또박또박 정확한 전달', 2),
  ('delivery', '전달력',   '원고의 뜻을 듣는 사람에게 쉽게', 3),
  ('adlib',    '임기응변', '돌발 상황에서 자연스럽게 이어가기', 4),
  ('hosting',  '진행력',   '순서·시간·분위기를 이끄는 힘', 5),
  ('selfcare', '자기관리', '목 관리·컨디션·준비성', 6)
) a(key, name, description, sort) where u.name = '아나운서팀' and u.unit_type = '팀'
on conflict do nothing;
insert into stat_axes (team_id, key, name, description, sort)
select u.id, a.key, a.name, a.description, a.sort from org_units u, (values
  ('setup',    '장비 세팅',   '녹음 전에 미리 와서 마이크·콘솔·레벨 준비', 1),
  ('speed',    '작업 속도',   '감독 요구에 빠르게 맞추는 손', 2),
  ('feedback', '피드백',      '성우에게 정확하고 따뜻한 디렉션', 3),
  ('editing',  '편집 디테일', '퍼즈 길이·호흡·잡음 정리', 4),
  ('sound',    '사운드 감각', '이펙트·믹싱으로 완성도 높이기', 5),
  ('teamwork', '소통·협업',   '감독·성우와 호흡 맞추기', 6)
) a(key, name, description, sort) where u.name = '엔지니어팀' and u.unit_type = '팀'
on conflict do nothing;

-- 새 조건: duty_count(사회·촬영 업무를 맡아 끝낸 횟수, 아나운서) / eng_count(엔지니어로 녹음 완료 회차, 엔지니어)
alter table badges drop constraint if exists badges_cond_type_check;
alter table badges add constraint badges_cond_type_check check (cond_type in ('rec_count','axis_level','all_axes_level','meeting_count','grant_count','duty_count','eng_count'));

create or replace function award_badges(p_person uuid)
returns table (out_id uuid, out_name text, out_icon text)
language plpgsql security definer set search_path = public as $$
declare
  rec_n int; meet_n int; grant_n int; duty_n int; eng_n int;
begin
  select count(distinct rp.session_id) into rec_n
    from recording_participants rp join recording_sessions rs on rs.id = rp.session_id
   where rp.person_id = p_person and rp.role = '녹음자' and rp.selected and rs.status = '완료';
  select count(distinct rp.session_id) into eng_n
    from recording_participants rp join recording_sessions rs on rs.id = rp.session_id
   where rp.person_id = p_person and rp.role = '엔지니어' and rp.selected and rs.status = '완료';
  select count(*) into duty_n from duties
   where owner_id = p_person and duty_type in ('사회','촬영') and coalesce(ends_at, starts_at) < now();
  select count(*) into meet_n
    from attendance a join meeting_sessions m on m.id = a.session_id
   where a.person_id = p_person and m.closed_at is not null and a.status in ('참석','지각','조퇴');
  select count(*) into grant_n from stat_grants where person_id = p_person and revoked_at is null;

  return query
  with ok as (
    select b.id, b.name, b.icon from badges b
     where b.is_active
       and effective_rank(p_person, b.team_id) > 0
       and not exists (select 1 from person_badges pb where pb.person_id = p_person and pb.badge_id = b.id)
       and case b.cond_type
         when 'rec_count' then rec_n >= (b.cond_value->>'n')::int
         when 'eng_count' then eng_n >= (b.cond_value->>'n')::int
         when 'duty_count' then duty_n >= (b.cond_value->>'n')::int
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
revoke all on function award_badges(uuid) from public, anon, authenticated;

insert into badges (team_id, key, name, description, icon, cond_type, cond_value, sort)
select u.id, b.key, b.name, b.description, b.icon, b.cond_type, b.cond_value::jsonb, b.sort
from org_units u, (values
  ('stage_first', '첫 마이크 온',     '사회·촬영을 처음 맡아 마쳤어요',       '🎤', 'duty_count',     '{"n":1}', 1),
  ('stage_10',    '무대의 얼굴',      '사회·촬영을 10번 맡아 마쳤어요',       '📺', 'duty_count',     '{"n":10}', 2),
  ('stage_30',    '믿고 맡기는 MC',   '사회·촬영을 30번 맡아 마쳤어요',       '🏆', 'duty_count',     '{"n":30}', 3),
  ('diction_5',   '또랑또랑',         '발음 Lv5에 올랐어요',                  '🗣', 'axis_level',     '{"axis":"diction","level":5}', 4),
  ('voice_5',     '단단한 목소리',    '발성 Lv5에 올랐어요',                  '📣', 'axis_level',     '{"axis":"voice","level":5}', 5),
  ('adlib_5',     '순발력 왕',        '임기응변 Lv5에 올랐어요',              '⚡', 'axis_level',     '{"axis":"adlib","level":5}', 6),
  ('hosting_5',   '분위기 메이커',    '진행력 Lv5에 올랐어요',                '🎙', 'axis_level',     '{"axis":"hosting","level":5}', 7),
  ('balance_3',   '균형 잡힌 아나운서', '모든 스탯이 Lv3 이상이에요',         '⬡',  'all_axes_level', '{"level":3}', 8),
  ('meet_10',     '꾸준한 발걸음',    '모임에 10번 함께했어요',               '👣', 'meeting_count',  '{"n":10}', 9),
  ('meet_50',     '뿌리 깊은 나무',   '모임에 50번 함께했어요',               '🌳', 'meeting_count',  '{"n":50}', 10),
  ('grant_10',    '피드백 수집가',    '교관님께 스탯을 10번 받았어요',        '💌', 'grant_count',    '{"n":10}', 11)
) b(key, name, description, icon, cond_type, cond_value, sort)
where u.name = '아나운서팀' and u.unit_type = '팀'
on conflict do nothing;

insert into badges (team_id, key, name, description, icon, cond_type, cond_value, sort)
select u.id, b.key, b.name, b.description, b.icon, b.cond_type, b.cond_value::jsonb, b.sort
from org_units u, (values
  ('cue_first',   '첫 큐 사인',       '엔지니어로 첫 녹음을 마쳤어요',        '🎚', 'eng_count',      '{"n":1}', 1),
  ('cue_10',      '콘솔 지킴이',      '엔지니어로 녹음 10건을 마쳤어요',      '🎛', 'eng_count',      '{"n":10}', 2),
  ('cue_30',      '소리의 장인',      '엔지니어로 녹음 30건을 마쳤어요',      '🏆', 'eng_count',      '{"n":30}', 3),
  ('setup_5',     '먼저 와 있는 사람', '장비 세팅 Lv5에 올랐어요',            '🔌', 'axis_level',     '{"axis":"setup","level":5}', 4),
  ('speed_5',     '번개 손',          '작업 속도 Lv5에 올랐어요',             '⚡', 'axis_level',     '{"axis":"speed","level":5}', 5),
  ('feedback_5',  '귀가 밝은 디렉터', '피드백 Lv5에 올랐어요',                '👂', 'axis_level',     '{"axis":"feedback","level":5}', 6),
  ('editing_5',   '숨소리 조각가',    '편집 디테일 Lv5에 올랐어요',           '✂️', 'axis_level',     '{"axis":"editing","level":5}', 7),
  ('sound_5',     '사운드 마법사',    '사운드 감각 Lv5에 올랐어요',           '🎧', 'axis_level',     '{"axis":"sound","level":5}', 8),
  ('balance_3',   '균형 잡힌 엔지니어', '모든 스탯이 Lv3 이상이에요',         '⬡',  'all_axes_level', '{"level":3}', 9),
  ('meet_10',     '꾸준한 발걸음',    '모임에 10번 함께했어요',               '👣', 'meeting_count',  '{"n":10}', 10),
  ('grant_10',    '피드백 수집가',    '교관님께 스탯을 10번 받았어요',        '💌', 'grant_count',    '{"n":10}', 11)
) b(key, name, description, icon, cond_type, cond_value, sort)
where u.name = '엔지니어팀' and u.unit_type = '팀'
on conflict do nothing;
