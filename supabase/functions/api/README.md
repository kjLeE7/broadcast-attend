# 문지기(Edge Function `api`) 소스

- `main.ts`가 실제 코드예요. 비밀값(봇 토큰, 서버 키)은 코드에 없고 Supabase의 Secrets에만 있어요.
- 배포할 때는 `index.ts`(`import "./main.ts";` 한 줄)와 `main.ts`를 함께 Supabase에 직접 올려요.
  (저장소가 비공개라 GitHub 주소에서 불러오는 방식은 안 돼요. 자세한 건 저장소 루트 CLAUDE.md 3번)
