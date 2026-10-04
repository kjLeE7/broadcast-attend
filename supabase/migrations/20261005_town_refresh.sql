-- 동네지도 새로 불러오는 간격 (초)
insert into app_settings (key, value, description)
values ('town_refresh_sec', '60', '동네지도: 문지기에서 새로 불러오는 간격(초). 화면이 안 보일 땐 멈춤')
on conflict (key) do nothing;
