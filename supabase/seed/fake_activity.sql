-- 가짜 활동 데이터 (UI 확인용, 2026-10-06). fake_people.sql 다음에 실행.
-- 넣은 행은 모두 fake_seed(tbl, id)에 적어 둠 → fake_people_cleanup.sql이 이걸 보고 지움.
-- 자동 알림이 안 가게: 모임은 reminded_72h/24h_at을 채움, 가짜 인원은 텔레그램 번호 없음.
create table if not exists fake_seed (tbl text not null, id uuid not null, primary key (tbl, id));
alter table fake_seed enable row level security;
revoke all on fake_seed from anon, authenticated;

do $$
declare
  T_V uuid := (select id from org_units where name='성우팀' and unit_type='팀');
  T_A uuid := (select id from org_units where name='아나운서팀' and unit_type='팀');
  T_E uuid := (select id from org_units where name='엔지니어팀' and unit_type='팀');
  T_S uuid := (select id from org_units where name='방송예술과');
  MARK text := '가짜(UI 확인용)';
  fv uuid[]; fa uuid[]; fe uuid[]; vi uuid[]; ai uuid[];  -- 가짜 성우·아나·엔지·성우교관·아나교관
  g1 uuid[]; g3 uuid[];
  lee uuid := (select id from people where name='이강준');
  park uuid := (select id from people where name='박현희');
  jung uuid := (select id from people where name='정동훈');
  lim uuid := (select id from people where name='임지윤');
  shin uuid := (select id from people where name='신효지');
  kim uuid := (select id from people where name='김지혜');
  eLead uuid; aLead uuid; chief uuid;
  mt_a1 uuid; mt_a2 uuid; mt_e1 uuid;
  sid uuid; rid uuid; rs uuid; r1 uuid; r2 uuid; x uuid; i int; d date;
  today date := (now() at time zone 'Asia/Seoul')::date;
  kst text := ' Asia/Seoul';
begin
  select array_agg(person_id order by person_id) into fv from position_history where note=MARK and org_unit_id=T_V and position_code in ('member','group_leader');
  select array_agg(person_id order by person_id) into vi from position_history where note=MARK and org_unit_id=T_V and position_code in ('instructor','vice_leader');
  select array_agg(person_id order by person_id) into fa from position_history where note=MARK and org_unit_id=T_A and position_code='member';
  select array_agg(person_id order by person_id) into ai from position_history where note=MARK and org_unit_id=T_A and position_code='instructor';
  select array_agg(person_id order by person_id) into fe from position_history where note=MARK and org_unit_id=T_E and position_code='member';
  select person_id into eLead from position_history where note=MARK and org_unit_id=T_E and position_code='team_leader';
  select person_id into aLead from position_history where note=MARK and org_unit_id=T_A and position_code='team_leader';
  select person_id into chief from position_history where note=MARK and position_code='section_chief';
  select array_agg(ga.person_id) into g1 from group_assignments ga join org_units u on u.id=ga.group_unit_id where u.name='1조' and ga.person_id = any(fv);
  select array_agg(ga.person_id) into g3 from group_assignments ga join org_units u on u.id=ga.group_unit_id where u.name='3조' and ga.person_id = any(fv);

  -- ===== 모임 유형 (아나운서·엔지니어) =====
  insert into meeting_types (team_id, name, default_start, default_end, default_location) values (T_A, '정기모임', '19:30', '21:00', '스담 회의실') returning id into mt_a1;
  insert into meeting_types (team_id, name, default_start, default_end, default_location) values (T_A, '리허설', '18:00', '19:30', '과천성전 10층') returning id into mt_a2;
  insert into meeting_types (team_id, name, default_start, default_end, default_location) values (T_E, '장비 점검', '19:00', '21:00', 'SMC') returning id into mt_e1;
  insert into fake_seed select 'meeting_types', unnest(array[mt_a1, mt_a2, mt_e1]);

  -- ===== 모임 (팀 전체 대상 = 실제 인원도 보임) =====
  -- 성우팀 정규수업 이번 토·다음 토, 조별 스터디, 운영회의
  for d in select (today + k) from generate_series(1, 13) k where extract(dow from today + k) = 6 loop
    insert into meeting_sessions (team_id, meeting_type_id, session_date, start_time, end_time, location, status, reminded_72h_at, reminded_24h_at, created_by, description)
      values (T_V, (select id from meeting_types where team_id=T_V and name='정규수업'), d, '14:00', '17:00', '스담 거울방', '예정', now(), now(), park, '감정 연기 3단계 · 대본 2쪽까지 읽어오기') returning id into sid;
    insert into fake_seed values ('meeting_sessions', sid);
    -- 사전 체크: 절반쯤
    insert into attendance (session_id, person_id, planned_status, planned_reason, planned_at)
      select sid, p, case when random() < .8 then '참석' when random() < .5 then '지각' else '불참' end, null, now() - interval '1 day'
      from unnest(fv) p where random() < .55;
    update attendance set planned_reason = case planned_status when '지각' then '직장 끝나고 바로 갈게요' when '불참' then '가족 행사' end where session_id = sid and planned_status <> '참석';
  end loop;
  insert into meeting_sessions (team_id, meeting_type_id, title, session_date, start_time, end_time, location, status, target_unit_id, target_label, reminded_72h_at, reminded_24h_at, created_by)
    values (T_V, (select id from meeting_types where team_id=T_V and name='스터디'), '1조 스터디', today + 2, '20:00', '22:00', '스담 연구실', '예정',
            (select id from org_units where name='1조' and parent_id=T_V), null, now(), now(), (select person_id from position_history where note=MARK and position_code='group_leader' limit 1)) returning id into sid;
  insert into fake_seed values ('meeting_sessions', sid);
  insert into meeting_sessions (team_id, meeting_type_id, title, session_date, start_time, end_time, location, status, target_people, target_label, reminded_72h_at, reminded_24h_at, created_by)
    values (T_V, (select id from meeting_types where team_id=T_V and name='스터디'), '3조 발성 스터디', today + 3, '19:30', '21:30', '스담 거실', '예정', g3, '3조', now(), now(), lee) returning id into sid;
  insert into fake_seed values ('meeting_sessions', sid);
  -- 아나운서팀 정기모임 (지난주 마감 + 이번 주·다음 주) · 리허설
  insert into meeting_sessions (team_id, meeting_type_id, session_date, start_time, end_time, location, status, closed_at, reminded_72h_at, reminded_24h_at, created_by)
    values (T_A, mt_a1, today - 6, '19:30', '21:00', '스담 회의실', '완료', (today - 6) + time '22:00', now(), now(), aLead) returning id into sid;
  insert into fake_seed values ('meeting_sessions', sid);
  insert into attendance (session_id, person_id, status, reason, arrived_at)
    select sid, p, st, case st when '불참' then '야근' when '지각' then '버스가 늦었어요' end,
           case when st <> '불참' then ((today - 6) + time '19:30' + (case when st='지각' then 15 else -5 end) * interval '1 minute') at time zone 'Asia/Seoul' end
    from (select p, case when random() < .8 then '참석' when random() < .5 then '지각' else '불참' end st from unnest(fa || ai || array[aLead]) p) z;
  for i in 1..2 loop
    insert into meeting_sessions (team_id, meeting_type_id, session_date, start_time, end_time, location, status, reminded_72h_at, reminded_24h_at, created_by, description)
      values (T_A, mt_a1, today + 1 + (i-1)*7, '19:30', '21:00', '스담 회의실', '예정', now(), now(), aLead, '주일 사회 순서 맞추기 · 낭독 피드백') returning id into sid;
    insert into fake_seed values ('meeting_sessions', sid);
  end loop;
  insert into meeting_sessions (team_id, meeting_type_id, session_date, start_time, end_time, location, status, reminded_72h_at, reminded_24h_at, created_by)
    values (T_A, mt_a2, today + 5, '18:00', '19:30', '과천성전 10층', '예정', now(), now(), aLead) returning id into sid;
  insert into fake_seed values ('meeting_sessions', sid);
  -- 엔지니어팀 장비 점검
  insert into meeting_sessions (team_id, meeting_type_id, session_date, start_time, end_time, location, status, reminded_72h_at, reminded_24h_at, created_by, description)
    values (T_E, mt_e1, today + 4, '19:00', '21:00', 'SMC', '예정', now(), now(), eLead, '마이크 케이블 교체 · 콘솔 펌웨어') returning id into sid;
  insert into fake_seed values ('meeting_sessions', sid);

  -- ===== 녹음 요청 6건 =====
  -- ① 끝난 녹음 (2주 전)
  insert into recording_requests (team_id, title, request_code, request_dept, requester_name, volume_desc, due_at, received_by, received_at, status, duration_min, voices_needed)
    values (T_V, '추석 인사 영상 내레이션', 'R260920-1', '홍보부', '김OO', 'A4 1장', (today - 12) + time '18:00', lee, now() - interval '16 days', '녹음완료', 30, 2) returning id into rid;
  insert into fake_seed values ('recording_requests', rid);
  insert into recording_sessions (team_id, request_id, title, scheduled_start, scheduled_end, location, status, confirmed_at, started_at, ended_at, created_by)
    values (T_V, rid, '1회차', ((today - 14) + time '19:00') at time zone 'Asia/Seoul', ((today - 14) + time '19:30') at time zone 'Asia/Seoul', 'SMC', '완료', now() - interval '15 days',
            ((today - 14) + time '19:03') at time zone 'Asia/Seoul', ((today - 14) + time '19:28') at time zone 'Asia/Seoul', lee) returning id into rs;
  insert into fake_seed values ('recording_sessions', rs);
  insert into recording_roles (request_id, name, sort_order, session_id) values (rid, '내레이션 남', 0, rs) returning id into r1;
  insert into recording_roles (request_id, name, sort_order, session_id) values (rid, '내레이션 여', 1, rs) returning id into r2;
  insert into recording_participants (session_id, person_id, role, role_id, method, answer, selected, seen_at, answered_at, arrived_at) values
    (rs, fv[1], '녹음자', r1, '지정', '수락', true, now() - interval '15 days', now() - interval '15 days', ((today - 14) + time '18:55') at time zone 'Asia/Seoul'),
    (rs, fv[2], '녹음자', r2, '지정', '수락', true, now() - interval '15 days', now() - interval '15 days', ((today - 14) + time '18:58') at time zone 'Asia/Seoul'),
    (rs, fe[1], '엔지니어', null, '지정', '수락', true, now() - interval '15 days', now() - interval '15 days', null),
    (rs, vi[1], '감독자', null, '지정', '수락', true, now() - interval '15 days', now() - interval '15 days', null);
  -- ② 오늘 저녁 녹음 (확정, 코드원) — 동네지도 ON AIR
  insert into recording_requests (team_id, title, request_code, request_dept, requester_name, volume_desc, due_at, received_by, received_at, status, duration_min, voices_needed)
    values (T_V, '요한계시록 오디오북 3장', 'R261001-1', '교육부', '박OO', '장 하나', (today + 3) + time '23:59', lee, now() - interval '4 days', '일정확정', 60, 3) returning id into rid;
  insert into fake_seed values ('recording_requests', rid);
  insert into recording_sessions (team_id, request_id, title, scheduled_start, scheduled_end, location, status, confirmed_at, created_by)
    values (T_V, rid, '1회차', (today + time '19:00') at time zone 'Asia/Seoul', (today + time '20:00') at time zone 'Asia/Seoul', '코드원 스튜디오', '예정', now() - interval '2 days', lee) returning id into rs;
  insert into fake_seed values ('recording_sessions', rs);
  insert into recording_roles (request_id, name, sort_order, session_id) values (rid, '해설', 0, rs) returning id into r1;
  insert into recording_roles (request_id, name, sort_order, session_id) values (rid, '요한', 1, rs) returning id into r2;
  insert into recording_roles (request_id, name, sort_order, session_id) values (rid, '천사', 2, rs) returning id into x;
  insert into recording_participants (session_id, person_id, role, role_id, method, answer, selected, seen_at, answered_at) values
    (rs, fv[3], '녹음자', r1, '지정', '수락', true, now() - interval '3 days', now() - interval '3 days'),
    (rs, jung, '녹음자', r2, '지정', '수락', true, now() - interval '3 days', now() - interval '3 days'),
    (rs, fv[4], '녹음자', x, '후보', '수락', true, now() - interval '3 days', now() - interval '3 days'),
    (rs, fv[5], '녹음자', x, '후보', '미선정', false, now() - interval '3 days', now() - interval '3 days'),
    (rs, fe[2], '엔지니어', null, '지정', '수락', true, now() - interval '3 days', now() - interval '3 days'),
    (rs, lee, '감독자', null, '지정', '수락', true, now() - interval '3 days', now() - interval '3 days');
  -- ③ 사흘 뒤 녹음 (확정, SMC, 엔지니어 교대)
  insert into recording_requests (team_id, title, request_code, request_dept, requester_name, volume_desc, due_at, received_by, received_at, status, duration_min, voices_needed)
    values (T_V, '청년부 수련회 오프닝 영상', 'R261002-1', '청년부', '이OO', '2분', (today + 6) + time '18:00', kim, now() - interval '3 days', '일정확정', 120, 2) returning id into rid;
  insert into fake_seed values ('recording_requests', rid);
  insert into recording_sessions (team_id, request_id, title, scheduled_start, scheduled_end, location, status, confirmed_at, created_by)
    values (T_V, rid, '1회차', ((today + 3) + time '19:00') at time zone 'Asia/Seoul', ((today + 3) + time '21:00') at time zone 'Asia/Seoul', 'SMC', '예정', now() - interval '1 day', kim) returning id into rs;
  insert into fake_seed values ('recording_sessions', rs);
  insert into recording_roles (request_id, name, sort_order, session_id) values (rid, '내레이션', 0, rs) returning id into r1;
  insert into recording_roles (request_id, name, sort_order, session_id) values (rid, '대사 (청년)', 1, rs) returning id into r2;
  insert into recording_participants (session_id, person_id, role, role_id, method, answer, selected, seen_at, answered_at, starts_at, ends_at) values
    (rs, fv[6], '녹음자', r1, '지정', '수락', true, now() - interval '2 days', now() - interval '2 days', null, null),
    (rs, shin, '녹음자', r2, '지정', '수락', true, now() - interval '2 days', now() - interval '2 days', null, null),
    (rs, fe[3], '엔지니어', null, '지정', '수락', true, now(), now(), ((today + 3) + time '19:00') at time zone 'Asia/Seoul', ((today + 3) + time '20:00') at time zone 'Asia/Seoul'),
    (rs, fe[4], '엔지니어', null, '지정', '수락', true, now(), now(), ((today + 3) + time '20:00') at time zone 'Asia/Seoul', ((today + 3) + time '21:00') at time zone 'Asia/Seoul'),
    (rs, vi[2], '감독자', null, '지정', '수락', true, now(), now(), null, null);
  -- ④ 조율 중 (대기·조율·고르기 섞임)
  insert into recording_requests (team_id, title, request_code, request_dept, requester_name, volume_desc, due_at, received_by, received_at, status, duration_min, voices_needed, note)
    values (T_V, '어린이부 성경 동화 「노아의 방주」', 'R261003-1', '어린이부', '최OO', '5분 · 배역 4', (today + 9) + time '23:59', lee, now() - interval '2 days', '캐스팅중', 90, 4, '아이들 눈높이로, 밝고 또렷하게') returning id into rid;
  insert into fake_seed values ('recording_requests', rid);
  insert into recording_sessions (team_id, request_id, title, scheduled_start, scheduled_end, location, status, created_by)
    values (T_V, rid, '1회차', ((today + 4) + time '19:30') at time zone 'Asia/Seoul', ((today + 4) + time '21:00') at time zone 'Asia/Seoul', '코드원 스튜디오', '조율중', lee) returning id into rs;
  insert into fake_seed values ('recording_sessions', rs);
  insert into recording_roles (request_id, name, sort_order, session_id, pref_method) values (rid, '해설', 0, rs, '지정') returning id into r1;
  insert into recording_participants (session_id, person_id, role, role_id, method, answer, selected, seen_at, answered_at) values (rs, fv[7], '녹음자', r1, '지정', '수락', true, now(), now());
  insert into recording_roles (request_id, name, sort_order, session_id, pref_method) values (rid, '노아', 1, rs, '후보') returning id into r2;
  insert into recording_participants (session_id, person_id, role, role_id, method, answer, selected, seen_at, answered_at) values
    (rs, fv[8], '녹음자', r2, '후보', '수락', false, now(), now()), (rs, fv[9], '녹음자', r2, '후보', '수락', false, now(), now()), (rs, fv[10], '녹음자', r2, '후보', '대기', false, null, null);
  insert into recording_roles (request_id, name, sort_order, session_id, pref_method) values (rid, '노아 아내', 2, rs, '지정') returning id into x;
  insert into recording_participants (session_id, person_id, role, role_id, method, answer, answer_note, selected, seen_at, answered_at) values (rs, fv[11], '녹음자', x, '지정', '조율', '그날 야근이라 21시 이후면 돼요', false, now(), now());
  insert into recording_roles (request_id, name, sort_order, session_id, pref_method) values (rid, '비둘기', 3, rs, '지정') returning id into x;
  insert into recording_participants (session_id, person_id, role, role_id, method, answer, selected, seen_at) values (rs, lim, '녹음자', x, '지정', '대기', false, now());
  insert into recording_participants (session_id, person_id, role, method, answer, selected, seen_at, answered_at) values
    (rs, fe[1], '엔지니어', '지정', '수락', true, now(), now()), (rs, vi[1], '감독자', '지정', '대기', false, null, null);
  -- ⑤ 접수 (아직 배치 전)
  insert into recording_requests (team_id, title, request_code, request_dept, requester_name, volume_desc, due_at, received_by, received_at, status, duration_min, voices_needed)
    values (T_V, '선교부 소식지 오디오판 10월호', 'R261005-1', '선교부', '정OO', 'A4 3장', (today + 12) + time '18:00', park, now() - interval '3 hours', '접수', 60, 1) returning id into rid;
  insert into fake_seed values ('recording_requests', rid);
  insert into recording_roles (request_id, name, sort_order) values (rid, '낭독', 0);
  -- ⑥ 지난달 녹음완료 (여러 사람)
  insert into recording_requests (team_id, title, request_code, request_dept, requester_name, due_at, received_by, received_at, status, duration_min, voices_needed)
    values (T_V, '말씀 묵상 오디오 9월', 'R260905-2', '교육부', '한OO', (today - 25) + time '18:00', kim, now() - interval '30 days', '녹음완료', 60, 2) returning id into rid;
  insert into fake_seed values ('recording_requests', rid);
  insert into recording_sessions (team_id, request_id, title, scheduled_start, scheduled_end, location, status, confirmed_at, ended_at, created_by)
    values (T_V, rid, '1회차', ((today - 27) + time '20:00') at time zone 'Asia/Seoul', ((today - 27) + time '21:00') at time zone 'Asia/Seoul', '코드원 스튜디오', '완료', now() - interval '28 days', ((today - 27) + time '20:58') at time zone 'Asia/Seoul', kim) returning id into rs;
  insert into fake_seed values ('recording_sessions', rs);
  insert into recording_roles (request_id, name, sort_order, session_id) values (rid, '낭독 1', 0, rs) returning id into r1;
  insert into recording_roles (request_id, name, sort_order, session_id) values (rid, '낭독 2', 1, rs) returning id into r2;
  insert into recording_participants (session_id, person_id, role, role_id, method, answer, selected) values
    (rs, park, '녹음자', r1, '지정', '수락', true), (rs, fv[12], '녹음자', r2, '지정', '수락', true), (rs, fe[2], '엔지니어', null, '지정', '수락', true), (rs, kim, '감독자', null, '지정', '수락', true);

  -- ===== 아나운서·엔지니어 업무 (사회·촬영·음향편집) =====
  with z as (insert into duties (unit_id, duty_type, title, owner_id, place, request_dept, starts_at, ends_at, created_by) values
    (T_A, '사회', '수요예배 광고 낭독', fa[1], '과천성전 10층', '예배부', (today + 2 + time '19:20') at time zone 'Asia/Seoul', (today + 2 + time '19:40') at time zone 'Asia/Seoul', aLead),
    (T_A, '사회', '주일 청년예배 사회', ai[1], '과천성전 9층', '청년부', (today + 6 + time '14:00') at time zone 'Asia/Seoul', (today + 6 + time '15:30') at time zone 'Asia/Seoul', aLead),
    (T_A, '촬영', '전도 간증 인터뷰 촬영', fa[2], 'SMC', '전도부', (today + time '15:00') at time zone 'Asia/Seoul', (today + time '17:00') at time zone 'Asia/Seoul', aLead),
    (T_A, '촬영', '추수감사절 홍보 영상 촬영', fa[3], '스담 거실', '홍보부', (today + 4 + time '10:00') at time zone 'Asia/Seoul', (today + 4 + time '13:00') at time zone 'Asia/Seoul', aLead),
    (T_A, '사회', '지파 체육대회 진행', ai[2], '외부 운동장', '총회', (today + 12 + time '09:00') at time zone 'Asia/Seoul', (today + 12 + time '17:00') at time zone 'Asia/Seoul', aLead),
    (T_E, '음향편집', '추석 인사 영상 믹싱', fe[1], '벽산 편집실', '홍보부', (today + time '13:00') at time zone 'Asia/Seoul', (today + time '18:00') at time zone 'Asia/Seoul', eLead),
    (T_E, '음향편집', '오디오북 2장 노이즈 정리', fe[3], '벽산 편집실', '교육부', (today + 1 + time '19:00') at time zone 'Asia/Seoul', (today + 1 + time '22:00') at time zone 'Asia/Seoul', eLead),
    (T_E, '기타', '주일예배 음향 지원', eLead, '과천성전 10층', '예배부', (today + 6 + time '09:00') at time zone 'Asia/Seoul', (today + 6 + time '13:00') at time zone 'Asia/Seoul', eLead)
  returning id) insert into fake_seed select 'duties', id from z;

  -- ===== 사명자 일정 · 프로젝트 =====
  with z as (insert into staff_schedules (unit_id, title, category, starts_at, ends_at, place, organizer_id, organizer_role) values
    (T_S, '문화부 부서장 회의', '회의', (today + 1 + time '20:00') at time zone 'Asia/Seoul', (today + 1 + time '21:30') at time zone 'Asia/Seoul', '총회 대회의실', chief, '과장'),
    (T_S, '방송예술과 월례회', '모임', (today + 5 + time '19:00') at time zone 'Asia/Seoul', (today + 5 + time '21:00') at time zone 'Asia/Seoul', '스담 거실', chief, '과장'),
    (T_S, '홍보부 협업 미팅', '회의', (today + 3 + time '14:00') at time zone 'Asia/Seoul', (today + 3 + time '15:00') at time zone 'Asia/Seoul', '자문회실', aLead, '부과장')
  returning id) insert into fake_seed select 'staff_schedules', id from z;
  with z as (insert into projects (unit_id, channel, title, description, owner_id, progress, due_on, status, created_by) values
    (T_S, '유튜브', '말씀 오디오북 시리즈 시즌2', '요한계시록 22장 전체 오디오북', lee, 35, today + 60, '진행', chief),
    (T_S, '행사', '추수감사절 특별 영상', '성도 인터뷰 + 내레이션', aLead, 15, today + 40, '기획', chief),
    (T_S, '교육', '신입 성우 발성 커리큘럼', '8주 과정 교안·영상', park, 70, today + 20, '진행', chief),
    (T_S, '방송', '라디오 코너 「말씀 한 스푼」', '주 1회 5분', aLead, 0, null, '보류', chief),
    (T_S, '행사', '여름 수련회 오프닝', null, kim, 100, today - 40, '완료', chief)
  returning id) insert into fake_seed select 'projects', id from z;

  -- ===== 공지 =====
  with z as (insert into notices (team_id, title, body, is_pinned, published_at, created_by, created_at) values
    (T_S, '10월 방송예술과 월례회 안내', '이번 주 토요일 19시, 스담 거실에서 월례회가 있어요. 팀별 한 달 보고를 3분씩 준비해 주세요.', true, now() - interval '2 days', chief, now() - interval '2 days'),
    (T_V, '정규수업 대본 미리 읽어 오기', '이번 주 정규수업은 감정 연기 3단계예요. 나눠 드린 대본 2쪽까지 꼭 읽어 오세요.', false, now() - interval '1 day', park, now() - interval '1 day'),
    (T_V, '녹음실 사용 규칙 다시 안내', '녹음 30분 전 도착, 음료는 부스 밖에서만, 끝나면 마이크 덮개 씌우기.', false, now() - interval '5 days', lee, now() - interval '5 days'),
    (T_A, '주일 사회 순서표 공유', '이번 달 주일 청년예배 사회 순서표를 올렸어요. 바꾸고 싶으면 금요일까지 말씀해 주세요.', false, now() - interval '3 hours', aLead, now() - interval '3 hours'),
    (T_E, 'SMC 콘솔 사용 주의', '2번 채널 페이더가 불안정해요. 수리 전까지 3번을 써 주세요.', false, now() - interval '6 days', eLead, now() - interval '6 days')
  returning id) insert into fake_seed select 'notices', id from z;
  insert into content_reads (kind, item_id, person_id, first_read_at, last_read_at)
    select 'notice', n.id, p, now() - interval '1 hour', now() - interval '1 hour' from fake_seed f join notices n on n.id = f.id, unnest(fv || fa || fe) p where f.tbl = 'notices' and random() < .6
    on conflict do nothing;

  -- ===== 과제 + 제출 =====
  insert into assignments (team_id, category, title, description, starts_on, due_at, needs_feedback, created_by) values
    (T_V, '낭독', '시편 23편 낭독 녹음 제출', '휴대폰으로 녹음해 링크를 올려 주세요. 호흡 위치를 표시한 대본도 같이.', today - 4, (today + 2 + time '23:59') at time zone 'Asia/Seoul', true, lee) returning id into x;
  insert into fake_seed values ('assignments', x);
  insert into assignment_submissions (assignment_id, person_id, content, submitted_at, feedback, feedback_by, feedback_at)
    select x, p, '녹음 링크 올립니다. 2절에서 호흡이 짧았어요.', now() - (random() * interval '3 days'),
           case when random() < .4 then '쉼표 앞 호흡 좋아요. 끝음 처리만 더 부드럽게!' end, case when random() < .4 then lee end, now() from unnest(fv) p where random() < .6;
  update assignment_submissions set feedback = null, feedback_by = null, feedback_at = null where assignment_id = x and (feedback is null) <> (feedback_by is null);
  insert into assignments (team_id, category, title, description, starts_on, due_at, needs_feedback, created_by) values
    (T_V, '연기', '감정 단계표 만들어 오기', '기쁨·슬픔·분노를 5단계로 나눠 예시 대사와 함께', today - 1, (today + 6 + time '23:59') at time zone 'Asia/Seoul', true, park) returning id into x;
  insert into fake_seed values ('assignments', x);
  insert into assignment_submissions (assignment_id, person_id, content, submitted_at) select x, p, '표 올렸습니다', now() - interval '5 hours' from unnest(fv) p where random() < .2;
  insert into assignments (team_id, category, title, description, starts_on, due_at, needs_feedback, created_by) values
    (T_A, '사회', '광고 원고 3분 낭독', '이번 주 광고 원고로 3분 낭독 영상', today - 2, (today + 1 + time '22:00') at time zone 'Asia/Seoul', true, aLead) returning id into x;
  insert into fake_seed values ('assignments', x);
  insert into assignment_submissions (assignment_id, person_id, content, submitted_at) select x, p, '영상 링크입니다', now() - interval '1 day' from unnest(fa) p where random() < .5;

  -- ===== 오늘 체크인 (아나운서 촬영) =====
  insert into checkins (team_id, title, check_date, items, target_people, target_label, created_by) values
    (T_A, '전도 간증 인터뷰 촬영', today, array['출발','도착'], fa[1:4], '촬영팀 4명', aLead) returning id into x;
  insert into fake_seed values ('checkins', x);
  insert into checkin_reports (checkin_id, person_id, item, reported_at, note) values
    (x, fa[1], '출발', now() - interval '2 hours', '14:40 도착 예정'), (x, fa[1], '도착', now() - interval '80 minutes', null), (x, fa[2], '출발', now() - interval '90 minutes', null);

  -- ===== 시간취합 (진행 중, 이강준도 대상) =====
  insert into time_polls (team_id, title, start_date, end_date, hour_from, hour_to, deadline, target_people, target_label, status, created_by) values
    (T_V, '11월 성우팀 엠티 날짜', today + 20, today + 27, 10, 22, (today + 3 + time '22:00') at time zone 'Asia/Seoul', fv || vi || array[lee, park, jung], '성우팀 엠티', '진행중', vi[1]) returning id into x;
  insert into fake_seed values ('time_polls', x);
  insert into time_poll_answers (poll_id, person_id, slots, answered_at)
    select x, p, array(select (dd * 48 + s)::smallint from generate_series(0, 7) dd, generate_series(20, 43) s where (dd in (5, 6) and random() < .9) or random() < .15), now() - random() * interval '1 day'
    from unnest(fv || vi) p where random() < .65;

  -- ===== 장소 신청 =====
  with z as (insert into place_bookings (place_code, starts_at, ends_at, purpose, team_id, person_id, status, decided_by, decided_at) values
    ('sdam-meeting', (today + time '19:00') at time zone 'Asia/Seoul', (today + time '21:00') at time zone 'Asia/Seoul', '아나운서팀 원고 회의', T_A, ai[1], '승인', null, now()),
    ('sdam-mirror', (today + 1 + time '20:00') at time zone 'Asia/Seoul', (today + 1 + time '22:00') at time zone 'Asia/Seoul', '1조 개인 연습', T_V, fv[1], '승인', null, now()),
    ('codeone', (today + 2 + time '18:00') at time zone 'Asia/Seoul', (today + 2 + time '20:00') at time zone 'Asia/Seoul', '오디오북 2장 재녹음', T_V, vi[1], '대기', null, null),
    ('chonghoe', (today + 8 + time '13:00') at time zone 'Asia/Seoul', (today + 8 + time '17:00') at time zone 'Asia/Seoul', '방송예술과 연합 워크숍', T_S, aLead, '대기', null, null),
    ('smc', (today + time '14:00') at time zone 'Asia/Seoul', (today + time '16:00') at time zone 'Asia/Seoul', '인터뷰 촬영', T_A, fa[2], '승인', eLead, now())
  returning id) insert into fake_seed select 'place_bookings', id from z;

  -- ===== 인원 특이사항 =====
  with z as (insert into person_notes (team_id, person_id, category, title, body, starts_on, ends_on, affects, status, followup, source, created_by) values
    (T_V, fv[13], '직장·학업', '10월 중순까지 야근 많음', '평일 저녁 모임 지각 가능성. 토요일은 괜찮음', today - 7, today + 10, array['수업','녹음'], '진행 중', '보강', '본인', fv[13]),
    (T_V, fv[14], '건강', '목 상태 안 좋음 (성대 결절 의심)', '2주 동안 녹음은 빼고 수업은 듣기만', today - 3, today + 11, array['녹음'], '진행 중', '대체학습', '운영진', lee),
    (T_V, fv[15], '가정', '가족 병간호', null, today - 20, null, array['수업','스터디'], '진행 중', '보강', '운영진', park),
    (T_V, fv[16], '일정 충돌', '지파 행사 겹침 (10/10)', '정규수업 1회 빠짐', today + 5, today + 5, array['수업'], '진행 중', '보강', '본인', fv[16]),
    (T_V, fv[2], '기타', '이사 완료', null, today - 30, today - 25, array['수업'], '해결됨', '없음', '운영진', park)
  returning id) insert into fake_seed select 'person_notes', id from z;

  -- ===== 성우 스탯 (교관 → 팀원) =====
  for i in 1..14 loop
    insert into stat_grants (team_id, person_id, granted_by, source_type, comment, created_at)
      values (T_V, fv[i], case when i % 3 = 0 then lee when i % 3 = 1 then park else vi[1] end, (array['수업','스터디','녹음','기타'])[1 + i % 4],
              (array['호흡이 안정적이에요','끝음 처리가 좋아졌어요','캐릭터 해석이 깊어요','발음이 또렷해졌어요','감정 전환이 자연스러워요'])[1 + i % 5], now() - (i || ' days')::interval) returning id into x;
    insert into fake_seed values ('stat_grants', x);
    insert into stat_grant_items (grant_id, axis_id, xp) select x, a.id, 1 + floor(random() * 3)::int from stat_axes a where a.team_id = T_V and random() < .5;
  end loop;

  -- ===== 작업 흐름 (아나운서팀) =====
  insert into work_flows (team_id, title, created_by) values (T_A, '추수감사절 특별 영상 (가짜)', aLead) returning id into x;
  insert into fake_seed values ('work_flows', x);
  insert into work_steps (flow_id, sort, title, due_on, ready_at, done_at) values (x, 0, '인터뷰 질문지 작성', today - 2, now() - interval '5 days', now() - interval '2 days') returning id into r1;
  insert into work_step_people (step_id, person_id, name, state, changed_at) values (r1, ai[1], (select name from people where id = ai[1]), '완료', now() - interval '2 days');
  insert into work_steps (flow_id, sort, title, due_on, after_ids, ready_at) values (x, 1, '성도 인터뷰 촬영', today, array[r1], now() - interval '2 days') returning id into r2;
  insert into work_step_people (step_id, person_id, name, state, changed_at) values (r2, fa[2], (select name from people where id = fa[2]), '시작', now() - interval '1 hour'), (r2, fa[3], (select name from people where id = fa[3]), '대기', null);
  insert into work_steps (flow_id, sort, title, due_on, after_ids) values (x, 2, '음향 정리·믹싱', today + 4, array[r2]) returning id into r1;
  insert into work_step_people (step_id, person_id, name) values (r1, fe[1], (select name from people where id = fe[1]));
  insert into work_steps (flow_id, sort, title, due_on, after_ids) values (x, 3, '자막·최종 편집', today + 7, array[r1]) returning id into r2;
  insert into work_step_people (step_id, person_id, name) values (r2, aLead, (select name from people where id = aLead)), (r2, null, '홍보부 담당자');
end $$;

select tbl, count(*) from fake_seed group by tbl order by tbl;
