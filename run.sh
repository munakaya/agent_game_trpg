#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/.env"
PID_FILE="$DIR/.tmp/trpg-server.pid"
DEFAULT_PORT="49731"
FALLBACK_PORTS=("53117" "59243")

port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti :"$port" 2>/dev/null || true
  else
    echo ""
  fi
}

port_in_use() {
  local port="$1"
  local pids
  pids="$(port_pids "$port")"
  [ -n "$pids" ]
}

save_port_to_env() {
  local new_port="$1"
  if [ -f "$ENV_FILE" ]; then
    if grep -q '^PORT=' "$ENV_FILE"; then
      sed -i "s/^PORT=.*/PORT=$new_port/" "$ENV_FILE"
    else
      printf "\nPORT=%s\n" "$new_port" >> "$ENV_FILE"
    fi
  fi
}

# ── .env 로드 / 없으면 대화형 생성 ──
if [ -f "$ENV_FILE" ]; then
  set -a; source "$ENV_FILE"; set +a
else
  echo "=== .env 파일이 없습니다. 설정을 선택하세요. ==="
  echo ""

  # HOST 선택
  echo "서버 바인드 주소:"
  echo "  1) 0.0.0.0       (모든 인터페이스 — 기본)"
  echo "  2) 127.0.0.1     (로컬만)"
  echo "  3) 192.168.0.13  (LAN)"
  echo "  4) 직접 입력"
  printf "선택 [1]: "
  read -r HOST_CHOICE
  HOST_CHOICE="${HOST_CHOICE:-1}"
  case "$HOST_CHOICE" in
    1) HOST="0.0.0.0" ;;
    2) HOST="127.0.0.1" ;;
    3) HOST="192.168.0.13" ;;
    4) printf "HOST: "; read -r HOST ;;
    *) HOST="0.0.0.0" ;;
  esac

  # PORT 선택
  echo ""
  echo "서버 포트:"
  echo "  1) $DEFAULT_PORT (기본)"
  echo "  2) 직접 입력"
  printf "선택 [1]: "
  read -r PORT_CHOICE
  PORT_CHOICE="${PORT_CHOICE:-1}"
  case "$PORT_CHOICE" in
    1) PORT="$DEFAULT_PORT" ;;
    2) printf "PORT: "; read -r PORT ;;
    *) PORT="$DEFAULT_PORT" ;;
  esac

  # .env 저장
  cat > "$ENV_FILE" <<ENVEOF
# TRPG Server 설정 (자동 생성)
HOST=$HOST
PORT=$PORT
ENVEOF

  echo ""
  echo ".env 저장 완료 → $ENV_FILE"
  echo "다음 실행부터는 엔터만 치면 됩니다."
  echo ""
fi

# 기본값 보장
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-$DEFAULT_PORT}"

# 레거시 기본 포트 자동 마이그레이션
if [ "$PORT" = "41920" ]; then
  echo "[config] Legacy default port 41920 detected -> switching to $DEFAULT_PORT"
  PORT="$DEFAULT_PORT"
  save_port_to_env "$PORT"
fi

# ── 프로세스 트리 전체 종료 헬퍼 ──
kill_tree() {
  local pid=$1 sig=${2:-TERM}
  # 자식 프로세스 먼저 재귀 종료
  local children
  children=$(ps -o pid= --ppid "$pid" 2>/dev/null || true)
  for child in $children; do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

# ── 이전 TRPG 프로세스 정리 (PID 파일 기반) ──
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[cleanup] Stopping previous TRPG server (PID $OLD_PID)..."
    kill_tree "$OLD_PID" TERM
    for i in $(seq 1 10); do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$OLD_PID" 2>/dev/null; then
      kill_tree "$OLD_PID" 9
    fi
    echo "[cleanup] Done."
  fi
  rm -f "$PID_FILE"
fi

# ── 포트 점유 프로세스 정리 (PID 파일 없이 실행된 경우 대비) ──
PORT_PID="$(port_pids "$PORT")"
if [ -n "$PORT_PID" ]; then
  echo "[cleanup] Port $PORT is in use by PID $PORT_PID — killing..."
  for pid in $PORT_PID; do
    kill_tree "$pid" TERM
  done
  for i in $(seq 1 10); do
    port_in_use "$PORT" || break
    sleep 0.5
  done
  # 강제 종료
  PORT_PID="$(port_pids "$PORT")"
  if [ -n "$PORT_PID" ]; then
    for pid in $PORT_PID; do
      kill -9 "$pid" 2>/dev/null || true
    done
    sleep 1
  fi
  echo "[cleanup] Port $PORT freed."
fi

# 포트를 비우지 못한 경우 희소 포트로 자동 전환
if port_in_use "$PORT"; then
  echo "[warn] Port $PORT is still busy. Trying rare fallback ports..."
  for candidate in "${FALLBACK_PORTS[@]}"; do
    if ! port_in_use "$candidate"; then
      PORT="$candidate"
      save_port_to_env "$PORT"
      echo "[config] Switched PORT to rare fallback: $PORT"
      break
    fi
  done
fi

echo "=== TRPG Run ==="
echo "  HOST: $HOST"
echo "  PORT: $PORT"
echo ""

# .tmp 디렉토리 보장
mkdir -p "$DIR/.tmp"

# Web 빌드
echo "[1/2] Building web..."
cd "$DIR/web"
npx vite build 2>&1

# 서버 시작 — fallback 이후에도 충돌 시 에러
echo "[2/2] Starting server..."
cd "$DIR/server"
HOST="$HOST" PORT="$PORT" npx tsx src/index.ts &
SERVER_PID=$!

echo "$SERVER_PID" > "$PID_FILE"

sleep 2
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo ""
  echo "[ERROR] Server failed to start."
  echo "  포트 $PORT 가 이미 사용 중이거나 다른 문제가 있습니다."
  echo "  로그를 확인하세요."
  rm -f "$PID_FILE"
  exit 1
fi

echo ""
echo "=== TRPG server running ==="
echo "  PID  : $SERVER_PID"
echo "  URL  : http://$HOST:$PORT"
if [ "$HOST" = "0.0.0.0" ]; then
  echo "  Local: http://localhost:$PORT"
fi
echo "  Stop : kill $SERVER_PID  (or re-run this script)"
echo ""

# 포그라운드 대기 — Ctrl+C 시 서버 트리 전체 종료
trap "echo ''; echo '[shutdown] Stopping server...'; kill_tree $SERVER_PID TERM; rm -f '$PID_FILE'; exit 0" INT TERM
wait "$SERVER_PID" 2>/dev/null
rm -f "$PID_FILE"
