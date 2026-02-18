# Agent Skills (skill-md/v1)

## 개요
- 스킬 파일 위치: `agent_skills/*.SKILL.md`
- 포맷: `skill-md/v1` (frontmatter + markdown 본문)
- 로더: `server/src/skills/agentSkills.ts`

## frontmatter 필드
- `format`: 반드시 `skill-md/v1`
- `id`: 스킬 식별자
- `title`: 표시 이름
- `summary`: 한 줄 설명
- `version`: 버전 문자열(예: `1`)
- `targets`: `[llm, dm, player]` 중 대상
- `tags`: 검색/분류 태그

## API
- `GET /v1/skills`
- `GET /v1/skills?target=llm&include_content=true`
- `GET /v1/skills/{skill_id}`

## 런타임 연동
- 오케스트레이터가 `target=llm` 스킬을 읽어 `dm_prompt`, `your_turn` payload의 `skills` 필드로 전달한다.
- 포맷 오류가 있는 스킬 파일은 서버 로그에 경고를 남기고 로딩에서 제외한다.
