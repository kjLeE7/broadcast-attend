-- 연말 결산 공개일 + 관리자 명단 (2026-10-05)
-- admins: 공개일 같은 운영 설정을 바꿀 수 있는 사람(people.id 목록). 관리자 페이지도 이 명단을 쓸 예정
insert into app_settings (key, value, description) values
  ('recap_open', '"12-22"', '연말 결산 공개일 (MM-DD, 해마다). 그 전에는 교관 이상만 미리보기'),
  ('admins', (select jsonb_build_array(id) from people where name = '이강준'), '관리자 명단 (people.id). 공개일 등 운영 설정을 바꿀 수 있음')
on conflict (key) do nothing;
