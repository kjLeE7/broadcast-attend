-- 가짜 인원(UI 확인용) 지우기. 정식 배포 전 실행 (사용자 승인 뒤)
begin;
create temp table fk on commit drop as select distinct person_id id from position_history where note = '가짜(UI 확인용)';
delete from attendance where person_id in (select id from fk) or session_id in (select id from meeting_sessions where target_label = '정규수업 (가짜 인원)');
delete from meeting_sessions where target_label = '정규수업 (가짜 인원)';
delete from availability where person_id in (select id from fk);
delete from weekly_submissions where person_id in (select id from fk);
delete from group_assignments where person_id in (select id from fk);
delete from position_history where person_id in (select id from fk);
delete from people where id in (select id from fk);
commit;
