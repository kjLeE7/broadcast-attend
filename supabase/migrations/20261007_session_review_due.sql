-- 모임 후기 (2026-10-07): 마감(기본 = 모임 날 자정, 만든 사람이 바꿀 수 있음) + 한 사람 한 후기
alter table meeting_sessions add column if not exists review_due timestamptz;
alter table meeting_sessions add column if not exists review_reminded_at timestamptz;
create unique index if not exists session_reviews_one on session_reviews (session_id, author_id);
alter table session_reviews add constraint session_reviews_body_len check (body is null or char_length(body) <= 3000) not valid;
