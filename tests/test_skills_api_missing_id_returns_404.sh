#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
source tests/common.sh

cleanup_port 49731
registry="$TMP_TEST_DIR/registry_ok.skills_404.json"
make_registry_file "$registry"

cat > .tmp/last_selection.env <<'DEF'
APP_BIND_HOST=127.0.0.1
APP_BIND_PORT=49731
LOCAL_LLM_HOST=127.0.0.1
LOCAL_LLM_PORT=9000
DEF

RUN_NO_PROMPT=1 RUN_SKIP_BUILD=1 PORT_REGISTRY_PATH_OVERRIDE="$registry" PORT_REGISTRY_STRICT=1 ./run.sh > "$TMP_TEST_DIR/test_skills_api_404.out" 2>&1 &
run_pid=$!

cleanup() {
  kill -INT "$run_pid" 2>/dev/null || true
  for _ in $(seq 1 5); do
    if ! kill -0 "$run_pid" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if kill -0 "$run_pid" 2>/dev/null; then
    kill -TERM "$run_pid" 2>/dev/null || true
    sleep 1
  fi
  if kill -0 "$run_pid" 2>/dev/null; then
    kill -KILL "$run_pid" 2>/dev/null || true
  fi
  wait "$run_pid" 2>/dev/null || true
}
trap cleanup EXIT

if ! wait_for_port_listen 49731 10; then
  echo "서버 기동 실패"
  cat "$TMP_TEST_DIR/test_skills_api_404.out" || true
  exit 1
fi

resp_file="$TMP_TEST_DIR/skills_404_response.json"
http_code="$(curl -sS -o "$resp_file" -w "%{http_code}" "http://127.0.0.1:49731/v1/skills/not_existing_skill")"

if [ "$http_code" != "404" ]; then
  echo "스킬 미존재 조회가 404가 아님: $http_code"
  cat "$resp_file"
  exit 1
fi

rg -q "skill not found" "$resp_file" || {
  echo "404 에러 메시지 누락"
  cat "$resp_file"
  exit 1
}

echo "PASS: /v1/skills/{id} 미존재 조회 404 확인"
