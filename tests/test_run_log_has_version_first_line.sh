#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
source tests/common.sh

cleanup_port 49731
registry="$TMP_TEST_DIR/registry_ok.logcheck.json"
make_registry_file "$registry"

before_list="$TMP_TEST_DIR/logs_before.txt"
after_list="$TMP_TEST_DIR/logs_after.txt"
ls -1 logs/*.log 2>/dev/null | sort > "$before_list" || true

RUN_NO_PROMPT=1 RUN_SKIP_BUILD=1 PORT_REGISTRY_PATH_OVERRIDE="$registry" PORT_REGISTRY_STRICT=1 ./run.sh > "$TMP_TEST_DIR/test_run_log.out" 2>&1 &
run_pid=$!

if ! wait_for_port_listen 49731 10; then
  kill "$run_pid" 2>/dev/null || true
  echo "서버가 49731에서 기동하지 않음"
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

ls -1 logs/*.log 2>/dev/null | sort > "$after_list" || true
new_log="$(comm -13 "$before_list" "$after_list" | tail -n 1)"

if [ -z "$new_log" ]; then
  new_log="$(ls -1t logs/*.log 2>/dev/null | head -n 1 || true)"
fi

first_line="$(head -n 1 "$new_log")"
expected="VERSION=$(tr -d ' \t\r\n' < VERSION)"

if [ "$first_line" != "$expected" ]; then
  echo "로그 첫 줄 VERSION 불일치"
  echo "file: $new_log"
  echo "got : $first_line"
  echo "want: $expected"
  exit 1
fi

echo "PASS: 실행 로그 첫 줄 VERSION 확인 ($new_log)"
