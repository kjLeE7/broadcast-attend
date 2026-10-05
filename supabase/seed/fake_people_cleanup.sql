-- 가짜 인원·활동(UI 확인용) 지우기. 정식 배포 전 실행 (사용자 승인 뒤)
-- fake_activity.sql이 넣은 행은 fake_seed(tbl, id)에 적혀 있음. 딸린 행(출결·제출·배역·참여자 등)을 먼저 지움.
begin;
-- 1) 활동 (fake_seed)
delete from recording_participants where session_id in (select id from fake_seed where tbl = 'recording_sessions');
delete from recording_roles where request_id in (select id from fake_seed where tbl = 'recording_requests');
delete from recording_sessions where id in (select id from fake_seed where tbl = 'recording_sessions');
delete from recording_requests where id in (select id from fake_seed where tbl = 'recording_requests');
delete from attendance where session_id in (select id from fake_seed where tbl = 'meeting_sessions');
delete from meeting_sessions where id in (select id from fake_seed where tbl = 'meeting_sessions');
delete from meeting_types where id in (select id from fake_seed where tbl = 'meeting_types');
delete from content_reads where item_id in (select id from fake_seed where tbl in ('notices', 'assignments'));
delete from notices where id in (select id from fake_seed where tbl = 'notices');
delete from assignment_submissions where assignment_id in (select id from fake_seed where tbl = 'assignments');
delete from assignments where id in (select id from fake_seed where tbl = 'assignments');
delete from checkin_reports where checkin_id in (select id from fake_seed where tbl = 'checkins');
delete from checkins where id in (select id from fake_seed where tbl = 'checkins');
delete from time_poll_answers where poll_id in (select id from fake_seed where tbl = 'time_polls');
delete from time_polls where id in (select id from fake_seed where tbl = 'time_polls');
delete from stat_grant_items where grant_id in (select id from fake_seed where tbl = 'stat_grants');
delete from stat_grants where id in (select id from fake_seed where tbl = 'stat_grants');
delete from work_flows where id in (select id from fake_seed where tbl = 'work_flows');   -- 단계·담당은 cascade
delete from duties where id in (select id from fake_seed where tbl = 'duties');
delete from staff_schedules where id in (select id from fake_seed where tbl = 'staff_schedules');
delete from projects where id in (select id from fake_seed where tbl = 'projects');
delete from place_bookings where id in (select id from fake_seed where tbl = 'place_bookings');
delete from person_notes where id in (select id from fake_seed where tbl = 'person_notes');   -- 메모는 cascade
-- 2) 가짜 인원 (fake_people.sql)
create temp table fk on commit drop as select distinct person_id id from position_history where note = '가짜(UI 확인용)';
delete from attendance where person_id in (select id from fk) or session_id in (select id from meeting_sessions where target_label = '정규수업 (가짜 인원)');
delete from meeting_sessions where target_label = '정규수업 (가짜 인원)';
delete from availability where person_id in (select id from fk);
delete from weekly_submissions where person_id in (select id from fk);
delete from person_badges where person_id in (select id from fk);
delete from group_assignments where person_id in (select id from fk);
delete from position_history where person_id in (select id from fk);
delete from people where id in (select id from fk);
drop table fake_seed;
commit;
