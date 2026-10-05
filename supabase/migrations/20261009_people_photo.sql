-- 프로필 사진 (2026-10-09): 텔레그램 프로필 사진을 봇으로 가져와 작은 것(160px, 몇 KB)만 avatars 보관함에 둠
-- 앱을 켤 때(me) 사흘에 한 번 확인. 텔레그램에서 사진을 숨긴 사람은 없음(이름 두 글자로 보임)
alter table people add column if not exists photo_url text, add column if not exists photo_checked_at timestamptz;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 204800, array['image/jpeg']) on conflict (id) do nothing;
