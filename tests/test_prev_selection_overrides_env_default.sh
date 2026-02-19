#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
source tests/common.sh

cleanup_port 49731
registry="$TMP_TEST_DIR/registry_ok.prev_overrides_env.json"
make_registry_file "$registry"

cat > .tmp/last_selection.env <<'DEF'
APP_BIND_HOST=127.0.0.1
APP_BIND_PORT=49731
LOCAL_LLM_HOST=127.0.0.1
LOCAL_LLM_PORT=9000
DEF

RUN_NO_PROMPT=1 RUN_SKIP_BUILD=1 APP_BIND_HOST=0.0.0.0 APP_BIND_PORT=49731 PORT_REGISTRY_PATH_OVERRIDE="$registry" PORT_REGISTRY_STRICT=1 ./run.sh > "$TMP_TEST_DIR/test_prev_selection_overrides_env_default.out" 2>&1 &
run_pid=$!

if ! wait_for_port_listen 49731 10; then
  kill "$run_pid" 2>/dev/null || true
  echo "서버 기동 실패"
  exit 1
fi

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

rg -q "HOST: 127.0.0.1" "$TMP_TEST_DIR/test_prev_selection_overrides_env_default.out" || {
  echo "이전 선택 기본값 우선 적용 실패"
  cat "$TMP_TEST_DIR/test_prev_selection_overrides_env_default.out"
  exit 1
}

echo "PASS: 이전 선택값이 .env 기본값보다 우선 적용됨"
