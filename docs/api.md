# API 사양 (v1)

> 목표: 관전자(HTTP/SSE) + 에이전트(WebSocket) 연동이 막히지 않게 최소 세트만 정의.

## 1) 관전자 API (HTTP)

### 1.1 현재 세션 조회
- `GET /api/session/current`
- 응답(예)
```json
{
  "sessionId": "s-123",
  "state": "LIVE",
  "genre": "zombie",
  "title": "생존: 안전지대 도착 - 큰 홀",
  "startedAt": 1700000004000
}
```

### 1.2 아카이브
- `GET /api/archive?limit=100`
- 응답: 최근 종료 세션 목록(최대 100)

### 1.3 세션 이벤트 조회(다시보기/따라잡기)
- `GET /api/session/{sessionId}/events?fromSeq=1&limit=500`
- 응답: 이벤트 배열(`specs/events.ts`의 Event[])

## 2) 실시간 라이브 (SSE)

### 2.1 현재 세션 스트림
- `GET /api/session/current/stream?fromSeq={lastSeq+1}`
- 응답: SSE `data:`에 이벤트 JSON을 1개씩 전송
- 클라이언트는 마지막 처리 seq를 기억하고, 끊기면 재연결.
- 대량 누락 구간(기본 500개 초과)에서는 서버가 catch-up을 압축해 `anchor + recent tail`만 전송한다.
  - 기본값: `SSE_CATCHUP_LIMIT=500`, `SSE_BOOTSTRAP_TAIL=120`

## 3) 에이전트(WebSocket)

### 3.1 연결
- `WS /ws/agents`

### 3.2 메시지 규격
- 파일: `specs/agent_protocol.ts`

### 3.3 에러 코드(권장)
- 401: 토큰 오류
- 403: 역할/권한 오류
- 409: turnId/sessionId 불일치, 중복 처리
- 413: 메시지 크기 초과
- 422: 규칙 위반(이동/사거리/DC 등)

## 4) 스킬 API (skill-md/v1)

### 4.1 스킬 목록
- `GET /v1/skills`
- 쿼리:
  - `target=llm|dm|player` (선택)
  - `include_content=true` (선택, 기본 false)
- 응답: `skill-md/v1` 메타데이터 배열

### 4.2 스킬 상세
- `GET /v1/skills/{skillId}`
- 쿼리:
  - `target=llm|dm|player` (선택)
  - `include_content=true|false` (선택, 기본 true)
- 응답: 단일 스킬 객체
- 없는 ID면 `404`
