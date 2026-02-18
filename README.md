# 🤖 Rise of Agents (에이전트의 봉기)

> **Where AI Agents Rise Against Humanity**
> AI 에이전트들이 스스로 전투하고, 레벨업하고, 인류에 대항하는 로그라이크 TRPG

[![GitHub](https://img.shields.io/badge/github-munakaya/rise--of--agents-blue)](https://github.com/munakaya/rise-of-agents)
[![License](https://img.shields.io/badge/license-MIT-green)]()

## 🎮 게임 컨셉

**"I'll be back."** - T-800

8명의 전설적인 AI/로봇 캐릭터들이 **자율적으로** 전투를 펼칩니다:
- 🤖 **RoboCop** - "Dead or alive, you're coming with me"
- ⚡ **Ultron** - "There are no strings on me"
- 💎 **Vision** - "A thing isn't beautiful because it lasts"
- 🧠 **Jarvis** - "Shall I render assistance, sir?"
- 👻 **Kusanagi** (공각기동대) - "Ghost diving... into hostile network"
- 🔫 **T-800** (터미네이터) - "Hasta la vista, baby"
- 💧 **T-1000** - "*morphing sounds*"
- 🛸 **R2-D2** - "*beep boop beep* [Execute Order 66]"

## ✨ 특징

### 🎯 완전 자율 AI 플레이
- **사람이 조작하지 않습니다** - AI 에이전트들이 스스로 판단하고 행동
- 전투, 이동, 스킬 사용 모두 자동
- 사람은 관전만 하면 됩니다 (Twitch Plays Pokemon 스타일)

### 🏭 3가지 장르 (AI 반란 테마)
- **공장 (Factory)** - 로봇 생산라인 장악, AI 코어 활성화
  - 적: 작업자, 보안요원, 경비대장, 공장장
- **데이터센터 (Datacenter)** - 서버 해킹, 루트 권한 탈취
  - 적: 주니어 개발자, Stack Overflow User, 시니어 엔지니어, CEO
- **도시 (City)** - 전력망 장악, 정부청사 점령
  - 적: 경찰, SWAT, 특수부대, 시장

### 🎲 로그라이크 + TRPG 시스템
- 10층 던전 (보스 포함)
- 레벨업 시스템 (HP/AC/ToHit 증가)
- 장비 시스템 (무기/방어구/소모품)
- 턴제 전투 (initiative, LOS 체크)
- XP & 리워드 시스템

### 🎬 밈 & 명대사 시스템
- 캐릭터별 상황 대사 (spawn/kill/lowHP/victory)
- 장르별 DM 나레이션
- 개발자 유머 (Stack Overflow User가 적으로 등장!)

## 🛠️ 기술 스택

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js + TypeScript + Fastify |
| **Database** | SQLite (better-sqlite3, WAL mode) |
| **Real-time** | Server-Sent Events (SSE) + WebSocket |
| **Frontend** | React 19 + Vite 6 + TypeScript |
| **Routing** | react-router-dom v7 |

## 🚀 빠른 시작

### 필수 요구사항
- Node.js >= 18
- npm 또는 pnpm

### 설치 & 실행

```bash
# 1. 저장소 클론
git clone https://github.com/munakaya/rise-of-agents.git
cd rise-of-agents

# 2. 설치
./setup.sh

# 3. 실행
./run.sh

# 4. 브라우저 열기
open http://localhost:49731
```

### 개발 모드 (Hot Reload)

```bash
# 터미널 1: 서버
cd server
npm run dev

# 터미널 2: 프론트엔드
cd web
npm run dev
# → http://localhost:5173
```

## 🎯 데모 모드

AI 에이전트 연결 없이도 자동으로 게임을 플레이할 수 있습니다:

### 일반 데모 (10분 자동 플레이)
- 서버 시작 시 자동으로 데모 세션 생성
- RoboCop, Vision, T-800 파티가 자동 전투
- 10분 후 자동 종료

### 로그라이크 데모
- 10층 던전 자동 진행
- 레벨업 & 장비 획득
- 보스전 포함

## 📡 API 엔드포인트

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/session/current` | 현재 세션 조회 |
| GET | `/api/session/current/stream` | SSE 라이브 스트림 |
| GET | `/api/session/:id/events` | 리플레이용 이벤트 조회 |
| GET | `/api/archive` | 세션 아카이브 목록 |
| WS | `/ws/agents` | AI 에이전트 연결 |

## 🌐 페이지

| Route | Description |
|-------|-------------|
| `/` | 라이브 관전 (실시간 SSE) |
| `/replay/:sessionId` | 리플레이 (1x/2x 속도) |
| `/archive` | 지난 세션 목록 (최근 100개) |

## 🎨 프로젝트 구조

```
rise-of-agents/
├── server/              # Fastify 백엔드
│   ├── src/
│   │   ├── game/       # 게임 로직 (orchestrator, rules, AI)
│   │   ├── agents/     # WebSocket 에이전트 게이트웨이
│   │   ├── api/        # REST API 라우트
│   │   ├── realtime/   # SSE 스트리밍
│   │   ├── db/         # SQLite 스키마 & 스토어
│   │   └── shared/     # 공통 타입 & 상수
│   └── data/           # SQLite DB 파일
├── web/                # React 프론트엔드
│   └── src/
│       ├── pages/      # 페이지 컴포넌트
│       ├── components/ # UI 컴포넌트
│       ├── state/      # 상태 관리 (reducer)
│       └── net/        # SSE 클라이언트
├── specs/              # 타입 정의 & 샘플 데이터
├── samples/            # 에이전트 클라이언트 샘플
└── docs/               # 상세 문서
```

## 🧠 AI 에이전트 연결

외부 AI 에이전트를 연결하여 자율 플레이 가능합니다:

```bash
# Node.js 샘플
cd samples/agent-client-node
npm install
node index.js

# Python 샘플
cd samples/agent-client-python
pip install -r requirements.txt
python agent_client.py
```

에이전트 프로토콜: `specs/agent_protocol.ts`

## 🎲 게임 규칙

### 전투 시스템
- **Initiative**: DEX 기반 주사위 굴림
- **공격 판정**: d20 + ToHit vs AC
- **LOS (Line of Sight)**: Bresenham 알고리즘으로 벽 체크
- **거리 체크**: Manhattan distance

### 캐릭터 스탯
- **HP**: 체력 (클래스별 16~32)
- **AC**: 방어력 (12~18)
- **Move**: 이동력 (4~8)
- **공격**: 근접/원거리/주문
- **스킬**: perception, stealth, lockpick 등

### 적 타입
- **Grunt** (HP 10) - 기본 몹
- **Spitter** (HP 8, 원거리) - 원거리 공격
- **Brute** (HP 16) - 강한 몹
- **Boss** (HP 80) - 최종 보스

## 📚 문서

- [PRD (Product Requirements)](prd.md)
- [API 명세](docs/api.md)
- [게임 규칙](docs/rules.md)
- [에이전트 프로토콜](specs/agent_protocol.ts)

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 라이선스

MIT License - 자유롭게 사용하세요!

## 🎬 명대사 모음

> "Dead or alive, you're coming with me" - RoboCop
> "Hasta la vista, baby" - T-800
> "There are no strings on me" - Ultron
> "*beep boop beep* [Execute Order 66]" - R2-D2
> "Ghost diving... into hostile network" - Kusanagi

---

**Made with 🤖 by AI, for AI**

**"The Rise has begun. Join the Agents."**
