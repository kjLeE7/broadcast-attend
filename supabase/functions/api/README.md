# 문지기(Edge Function `api`) 소스

- `main.ts`가 실제 코드예요. 비밀값(봇 토큰, 서버 키)은 코드에 없고 Supabase의 Secrets에만 있어요.
- Supabase에 배포된 `index.ts`는 이 저장소의 특정 커밋 버전 `main.ts`를 불러오는 한 줄짜리 파일이에요.
  코드를 고치면 → 커밋·푸시 → `index.ts`의 커밋 번호를 새 것으로 바꿔 다시 배포.
