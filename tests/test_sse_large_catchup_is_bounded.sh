#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
source tests/common.sh

cleanup_port 49731
registry="$TMP_TEST_DIR/registry_ok.sse_large.json"
make_registry_file "$registry"

cat > .tmp/last_selection.env <<'DEF'
APP_BIND_HOST=127.0.0.1
APP_BIND_PORT=49731
LOCAL_LLM_HOST=127.0.0.1
LOCAL_LLM_PORT=9000
DEF

RUN_NO_PROMPT=1 RUN_SKIP_BUILD=1 PORT_REGISTRY_PATH_OVERRIDE="$registry" PORT_REGISTRY_STRICT=1 ./run.sh > "$TMP_TEST_DIR/test_sse_large_run.out" 2>&1 &
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
  cat "$TMP_TEST_DIR/test_sse_large_run.out" || true
  exit 1
fi

session_id="$(python3 <<'PY'
import json
import time
import urllib.request

url = 'http://127.0.0.1:49731/api/session/current/stream?fromSeq=1'
req = urllib.request.Request(url, headers={'Accept': 'text/event-stream'})

with urllib.request.urlopen(req, timeout=5) as resp:
    deadline = time.time() + 3.0
    while time.time() < deadline:
        line = resp.readline()
        if not line:
            continue
        text = line.decode('utf-8', errors='ignore').strip()
        if text.startswith('data:'):
            payload = json.loads(text[5:].strip())
            sid = payload.get('sessionId')
            if sid:
                print(sid)
                break
PY
)"
if [ -z "$session_id" ]; then
  echo "SSE bootstrap에서 sessionId를 찾지 못했습니다."
  exit 1
fi

python3 - "$session_id" <<'PY'
import json
import sqlite3
import sys
import time

sid = sys.argv[1]
db = sqlite3.connect('server/data/trpg.db')
cur = db.cursor()
cur.execute('SELECT COALESCE(MAX(seq), 0) FROM session_events WHERE session_id = ?', (sid,))
base = cur.fetchone()[0]
now = int(time.time() * 1000)

rows = []
for i in range(1, 901):
    seq = base + i
    payload = {
        "messageId": f"bulk-{seq}",
        "speaker": {"type": "DM", "name": "DM"},
        "text": f"bulk-{i}"
    }
    rows.append((sid, seq, 'chat_message', json.dumps(payload, ensure_ascii=False), now + i))

cur.executemany(
    'INSERT INTO session_events (session_id, seq, type, payload_json, t) VALUES (?, ?, ?, ?, ?)',
    rows
)
db.commit()
db.close()
print(base + 900)
PY

ids_file="$TMP_TEST_DIR/sse_large_ids.txt"
python3 - "$ids_file" <<'PY'
import sys
import time
import urllib.request

out = sys.argv[1]
url = 'http://127.0.0.1:49731/api/session/current/stream?fromSeq=1'
ids = []

try:
    req = urllib.request.Request(url, headers={'Accept': 'text/event-stream'})
    with urllib.request.urlopen(req, timeout=5) as resp:
        deadline = time.time() + 2.5
        while time.time() < deadline and len(ids) < 1000:
            line = resp.readline()
            if not line:
                continue
            text = line.decode('utf-8', errors='ignore').strip()
            if text.startswith('id:'):
                try:
                    ids.append(int(text.split(':', 1)[1].strip()))
                except ValueError:
                    pass
except Exception:
    pass

with open(out, 'w', encoding='utf-8') as f:
    for i in ids:
        f.write(f'{i}\n')
PY

count="$(wc -l < "$ids_file" | tr -d ' ')"
if [ "$count" -eq 0 ]; then
  echo "SSE catch-up id를 수집하지 못했습니다."
  cat "$TMP_TEST_DIR/test_sse_large_run.out" || true
  exit 1
fi

if [ "$count" -gt 220 ]; then
  echo "SSE 대량 catch-up이 과도합니다: $count events"
  head -n 20 "$ids_file" || true
  exit 1
fi

echo "PASS: 대량 SSE catch-up 압축 확인 (sent=$count)"
