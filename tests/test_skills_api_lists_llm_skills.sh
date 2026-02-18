#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
source tests/common.sh

cleanup_port 49731
registry="$TMP_TEST_DIR/registry_ok.skills_list.json"
make_registry_file "$registry"

cat > .tmp/last_selection.env <<'DEF'
APP_BIND_HOST=127.0.0.1
APP_BIND_PORT=49731
LOCAL_LLM_HOST=127.0.0.1
LOCAL_LLM_PORT=9000
DEF

RUN_NO_PROMPT=1 RUN_SKIP_BUILD=1 PORT_REGISTRY_PATH_OVERRIDE="$registry" PORT_REGISTRY_STRICT=1 ./run.sh > "$TMP_TEST_DIR/test_skills_api_list.out" 2>&1 &
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
  cat "$TMP_TEST_DIR/test_skills_api_list.out" || true
  exit 1
fi

resp_file="$TMP_TEST_DIR/skills_list_response.json"
curl -fsS "http://127.0.0.1:49731/v1/skills?target=llm&include_content=true" > "$resp_file"

python3 - "$resp_file" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

if data.get("format") != "skill-md/v1":
    raise SystemExit("format mismatch")

skills = data.get("skills", [])
ids = {s.get("id") for s in skills}
required = {"core_survival", "world_objective_flow", "combat_engage_policy"}
missing = required - ids
if missing:
    raise SystemExit(f"missing skills: {sorted(missing)}")

for s in skills:
    if not s.get("content"):
        raise SystemExit(f"content missing for skill: {s.get('id')}")
PY

echo "PASS: /v1/skills 목록에서 llm 스킬 조회 성공"
