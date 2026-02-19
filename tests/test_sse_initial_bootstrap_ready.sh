#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
source tests/common.sh

cleanup_port 49731
registry="$TMP_TEST_DIR/registry_ok.sse_initial_bootstrap.json"
make_registry_file "$registry"

cat > .tmp/last_selection.env <<'DEF'
APP_BIND_HOST=127.0.0.1
APP_BIND_PORT=49731
LOCAL_LLM_HOST=127.0.0.1
LOCAL_LLM_PORT=9000
DEF

RUN_NO_PROMPT=1 RUN_SKIP_BUILD=1 PORT_REGISTRY_PATH_OVERRIDE="$registry" PORT_REGISTRY_STRICT=1 ./run.sh > "$TMP_TEST_DIR/test_sse_initial_bootstrap_run.out" 2>&1 &
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
  cat "$TMP_TEST_DIR/test_sse_initial_bootstrap_run.out" || true
  exit 1
fi

probe_file="$TMP_TEST_DIR/sse_initial_bootstrap_probe.txt"
python3 - "$probe_file" <<'PY'
import json
import sys
import time
import urllib.request

out = sys.argv[1]
url = 'http://127.0.0.1:49731/api/session/current/stream?fromSeq=1'
req = urllib.request.Request(url, headers={'Accept': 'text/event-stream'})

t0 = time.perf_counter()
first_id = None
types = []

try:
    with urllib.request.urlopen(req, timeout=5) as resp:
        deadline = time.time() + 3.0
        while time.time() < deadline and len(types) < 2:
            raw = resp.readline()
            if not raw:
                continue
            line = raw.decode('utf-8', errors='ignore').strip()
            if line.startswith('id:') and first_id is None:
                first_id = line.split(':', 1)[1].strip()
            elif line.startswith('data:'):
                payload = json.loads(line[5:].strip())
                etype = payload.get('type')
                if isinstance(etype, str):
                    types.append(etype)
except Exception:
    pass

elapsed_ms = (time.perf_counter() - t0) * 1000

with open(out, 'w', encoding='utf-8') as f:
    f.write(f'first_id={first_id or ""}\n')
    f.write(f'elapsed_ms={elapsed_ms:.1f}\n')
    f.write('types=' + ','.join(types) + '\n')
PY

first_id="$(rg '^first_id=' "$probe_file" | sed 's/^first_id=//')"
elapsed_ms_raw="$(rg '^elapsed_ms=' "$probe_file" | sed 's/^elapsed_ms=//')"
types_line="$(rg '^types=' "$probe_file" | sed 's/^types=//')"

if [ -z "$first_id" ]; then
  echo "SSE 최초 이벤트(id)를 받지 못했습니다."
  cat "$probe_file" || true
  cat "$TMP_TEST_DIR/test_sse_initial_bootstrap_run.out" || true
  exit 1
fi

if ! python3 - "$elapsed_ms_raw" <<'PY'
import sys
value = float(sys.argv[1])
sys.exit(0 if value <= 3000.0 else 1)
PY
then
  echo "SSE 최초 이벤트 수신이 너무 느립니다: ${elapsed_ms_raw}ms"
  cat "$probe_file" || true
  exit 1
fi

if ! printf '%s' "$types_line" | rg -q 'session_created'; then
  echo "SSE 초기 bootstrap에 session_created 이벤트가 없습니다."
  cat "$probe_file" || true
  exit 1
fi

echo "PASS: SSE 초기 bootstrap이 3초 내 준비되고 session_created를 포함함 (${elapsed_ms_raw}ms)"
