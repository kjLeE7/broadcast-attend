-- 프로젝트 (2026-10-10): 여러 회차에 걸친 큰 작업(웹드라마·오디오드라마·정기 방송 등)
-- 업무 탭 = 실무 · 작업(예전 '프로젝트' = 작업 흐름) · 프로젝트(이것). 명단(project_members)에 있는 사람만 방에 들어감
-- 과원은 목록에서 제목·종류·진행률만 봄(🔒), 과장 이상·관리자는 다 봄

-- 종류 = 색: 영상(웹드라마·홍보영상) · 오디오(오디오드라마) · 방송(정기 방송) · 행사(공연·행사) · 기타
alter table projects add column kind text not null default '기타' check (kind in ('영상', '오디오', '방송', '행사', '기타'));
alter table projects add column starts_on date;

create table project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  person_id uuid not null references people(id),
  role text not null check (role in ('PD', '제작진', '출연')),   -- PD: 고치기·명단, 제작진: 다 봄(대본 포함)·작업 만들기, 출연: 개요·사람·내 작업
  part text,                                                     -- 맡은 일·배역 (예: 촬영, 주연 지수 역)
  added_by uuid references people(id),
  created_at timestamptz not null default now(),
  unique (project_id, person_id)
);
create index project_members_person on project_members (person_id);
alter table project_members enable row level security;
revoke all on project_members from anon, authenticated;
create trigger trg_audit after insert or delete or update on project_members for each row execute function audit_trigger();

-- 프로젝트 안 작업 흐름: 일반 '작업' 목록에는 안 나옴
alter table work_flows add column project_id uuid references projects(id) on delete cascade;
create index work_flows_project on work_flows (project_id) where project_id is not null;

-- 프로젝트 대본·자료: 같은 비공개 보관함 'scripts', 지우기 전까지 보관(expires_at = infinity), 열기는 PD·제작진·과장 이상·관리자
alter table content_files drop constraint content_files_kind_check;
alter table content_files add constraint content_files_kind_check check (kind in ('notice', 'assignment', 'session', 'project'));
alter table content_files add column folder text check (folder in ('대본', '자료'));
alter table content_files add column label text;   -- 예: 1화 2고, 촬영 콘티

-- (적용할 땐 drop constraint가 섞이면 취소돼서 위 content_files kind 두 줄은 따로 실행함)
-- 예전 홈 '프로젝트'(전부 가짜 데이터)에 종류 붙이기 + 담당자를 PD로
update projects set kind = case
  when title like '%오디오%' then '오디오' when title like '%영상%' then '영상' when title like '%라디오%' then '방송'
  when channel = '행사' then '행사' else '기타' end
where id in (select id from fake_seed);
insert into project_members (project_id, person_id, role)
select id, owner_id, 'PD' from projects where owner_id is not null on conflict do nothing;
