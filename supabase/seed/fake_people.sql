-- 가짜 인원 47명 (UI 확인용, 2026-10-06). 정식 배포 전 supabase/seed/fake_people_cleanup.sql로 지움.
-- 텔레그램 번호 없음 → 봇 알림이 안 감. position_history.note = '가짜(UI 확인용)' 로 구분.
-- 구성: 과장 1 · 부과장 2(한 명은 아나운서팀장 겸) · 성우팀 28(+실제 6 = 34) · 아나운서팀 11(+팀장 겸직 = 12) · 엔지니어팀 5
begin;
create temp table fk (n int, name text, g text, bd date, p1 text, u1 text, p2 text, u2 text, grp text, id uuid default gen_random_uuid()) on commit drop;
insert into fk (n, name, g, bd, p1, u1, p2, u2, grp) values
(0,'기수아','m','1999-07-26','section_chief','방송예술과',null,null,null),
(1,'주예린','f','1987-10-28','vice_section','방송예술과',null,null,null),
(2,'왕채원','m','1993-07-04','vice_section','방송예술과','team_leader','아나운서팀',null),
(3,'제다은','m','1992-03-16','vice_leader','성우팀',null,null,null),
(4,'신서연','m','1978-08-01','instructor','성우팀',null,null,null),
(5,'권수아','f','1992-03-18','instructor','성우팀',null,null,null),
(6,'연재원','f','1992-07-12','group_leader','성우팀',null,null,'1조'),
(7,'현지호','m','2000-11-04','group_leader','성우팀',null,null,'3조'),
(8,'한유진','f','2000-12-06','group_leader','성우팀',null,null,'4조'),
(9,'송지호','m','1987-01-14','member','성우팀',null,null,'1조'),
(10,'고기현','f','1996-10-08','member','성우팀',null,null,'1조'),
(11,'윤민준','m','1978-05-10','member','성우팀',null,null,'1조'),
(12,'선도윤','m','1995-12-18','member','성우팀',null,null,'1조'),
(13,'성지민','f','1992-09-17','member','성우팀',null,null,'1조'),
(14,'명다은','m','1985-11-23','member','성우팀',null,null,'1조'),
(15,'방다은','m','2004-10-04','member','성우팀',null,null,'1조'),
(16,'왕예은','m','1994-03-13','member','성우팀',null,null,'2조'),
(17,'노다인','m','1999-12-03','member','성우팀',null,null,'2조'),
(18,'서지민','m','1983-12-14','member','성우팀',null,null,'2조'),
(19,'도예은','m','1989-01-20','member','성우팀',null,null,'2조'),
(20,'강나연','f','1986-08-07','member','성우팀',null,null,'2조'),
(21,'권윤서','f','1991-11-21','member','성우팀',null,null,'2조'),
(22,'국지우','f','1998-02-18','member','성우팀',null,null,'3조'),
(23,'우승현','m','1989-03-14','member','성우팀',null,null,'3조'),
(24,'모예은','m','1984-11-18','member','성우팀',null,null,'3조'),
(25,'맹지우','m','1991-10-24','member','성우팀',null,null,'3조'),
(26,'권서아','m','1993-03-08','member','성우팀',null,null,'3조'),
(27,'옥예준','f','1987-08-04','member','성우팀',null,null,'3조'),
(28,'남승현','f','1986-12-18','member','성우팀',null,null,'3조'),
(29,'류동하','m','1991-05-28','member','성우팀',null,null,'4조'),
(30,'임도윤','f','1980-07-09','member','성우팀',null,null,'4조'),
(31,'어소민','m','1990-01-17','instructor','아나운서팀',null,null,null),
(32,'연시우','m','2000-03-09','instructor','아나운서팀',null,null,null),
(33,'용소윤','m','1994-03-17','member','아나운서팀',null,null,null),
(34,'왕소민','m','1982-04-19','member','아나운서팀',null,null,null),
(35,'소유나','m','1983-08-09','member','아나운서팀',null,null,null),
(36,'박경민','f','1985-08-08','member','아나운서팀',null,null,null),
(37,'이서아','m','1996-04-14','member','아나운서팀',null,null,null),
(38,'현지민','f','1990-02-01','member','아나운서팀',null,null,null),
(39,'장선우','f','1992-02-21','member','아나운서팀',null,null,null),
(40,'고수빈','f','1992-03-23','member','아나운서팀',null,null,null),
(41,'남혜린','m','2002-02-11','member','아나운서팀',null,null,null),
(42,'어지훈','m','2001-07-18','team_leader','엔지니어팀',null,null,null),
(43,'육서아','f','1978-01-07','member','엔지니어팀',null,null,null),
(44,'조은채','f','2000-04-19','member','엔지니어팀',null,null,null),
(45,'소도윤','m','1980-04-17','member','엔지니어팀',null,null,null),
(46,'설수아','m','1982-11-12','member','엔지니어팀',null,null,null);
insert into people (id, name, gender, birth_date, tribe_id, is_active, town_look)
  select id, name, case g when 'm' then '남' else '여' end, bd, (select id from org_units where name='총회'), true, jsonb_build_object('gender', g) from fk;
insert into position_history (person_id, position_code, org_unit_id, started_on, note)
  select fk.id, x.p, u.id, '2026-03-01', '가짜(UI 확인용)' from fk, lateral (values (p1, u1), (p2, u2)) x(p, un)
  join org_units u on u.name = x.un and u.unit_type in ('과','팀') where x.p is not null;
insert into group_assignments (person_id, group_unit_id, started_on)
  select fk.id, u.id, '2026-03-01' from fk join org_units u on u.name = fk.grp join org_units t on t.id = u.parent_id and t.name = '성우팀';
select setseed(0.20261006);
-- 업무가능: 지난주·이번 주·다음 주, 약 70%가 냄 (평일 저녁 / 주말 낮, 랜덤)
create temp table fw on commit drop as
  select fk.id, w::date wk from fk, generate_series(date_trunc('week', date '2026-10-05') - interval '7 days', date_trunc('week', date '2026-10-05') + interval '7 days', interval '7 days') w
  where random() < 0.72;
insert into weekly_submissions (person_id, week_start) select id, wk from fw;
insert into availability (person_id, avail_date, slots)
  select id, d, array(select generate_series(a, least(46, a + len))::smallint)
  from (select fw.id, (fw.wk + k)::date d,
          case when k < 5 then (array[36,38,39,40])[1 + floor(random()*4)::int] else (array[18,20,26,28])[1 + floor(random()*4)::int] end a,
          case when k < 5 then 3 + floor(random()*3)::int else 6 + floor(random()*10)::int end len,
          random() r, k from fw, generate_series(0,6) k) x
  where r < case when k < 5 then 0.5 else 0.7 end;
-- 지난 정규수업 4번 (성우팀 가짜 인원만, 마감) + 출결 랜덤
insert into meeting_sessions (team_id, meeting_type_id, session_date, start_time, end_time, location, status, closed_at, target_people, target_label, reminded_72h_at, reminded_24h_at, created_by)
  select (select id from org_units where name='성우팀' and unit_type='팀'), (select id from meeting_types where name='정규수업'), d, '14:00', '17:00', '스담', '완료', d + time '18:00',
    (select array_agg(person_id) from position_history where note='가짜(UI 확인용)' and org_unit_id=(select id from org_units where name='성우팀' and unit_type='팀')),
    '정규수업 (가짜 인원)', now(), now(), (select id from people where name='박현희')
  from (values (date '2026-09-07'),(date '2026-09-14'),(date '2026-09-21'),(date '2026-09-28')) v(d);
insert into attendance (session_id, person_id, status, reason, arrived_at)
  select s.id, p, st, case st when '지각' then '차가 막혔어요' when '불참' then (array['직장 야근','몸살','가족 행사'])[1 + floor(random()*3)::int] when '조퇴' then '병원 예약' end,
    case when st <> '불참' then (s.session_date + time '14:00' + (case when st='지각' then 10 + floor(random()*30) else -floor(random()*10) end) * interval '1 minute') at time zone 'Asia/Seoul' end
  from (select s.*, unnest(s.target_people) p, random() r from meeting_sessions s where s.target_label='정규수업 (가짜 인원)') s,
    lateral (select case when s.r < 0.78 then '참석' when s.r < 0.88 then '지각' when s.r < 0.97 then '불참' else '조퇴' end st) z;
select (select count(*) from fk) people, (select count(*) from position_history where note='가짜(UI 확인용)') positions;
commit;
