-- 녹음 진행 흐름 (2026-10-05): 요청 확인(읽음) · 녹음실 도착(성우 본인·봇 '도착'·엔지니어 확인) · 엔지니어 시작/종료 보고
alter table recording_participants
  add column seen_at timestamptz,          -- 받은 사람이 요청 화면을 처음 연 때
  add column arrived_at timestamptz,       -- 녹음실 도착
  add column arrived_by uuid references people(id);   -- 누가 도착을 눌렀는지 (본인 또는 엔지니어 등)
alter table recording_sessions
  add column started_at timestamptz,       -- 엔지니어 '시작 보고'
  add column started_by uuid references people(id),
  add column ended_at timestamptz,         -- 엔지니어 '녹음 마쳤습니다' (→ 회차 완료)
  add column ended_by uuid references people(id);

-- 체크인 시간 고치기 (2026-10-05): 잘못 눌렀을 때 본인이 실제 시각으로 고침
alter table checkin_reports add column fixed_at timestamptz;
