#!/bin/bash
set -eEuo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/.env"
ENV_SAMPLE_FILE="$DIR/.env.sample"
TMP_DIR="$DIR/.tmp"
RUN_JSON="$TMP_DIR/run.json"
DEFAULTS_FILE="$TMP_DIR/last_selection.env"
LOG_DIR="$DIR/logs"
VERSION_FILE="$DIR/VERSION"

APP_FIXED_PORT="49731"
PORT_REGISTRY_PROJECT_KEY="agent_game_trpg"
PORT_REGISTRY_PATHS=("/home/user/git_work/docs/port.json" "$HOME/git_work/docs/port.json")

REQUIRED_HOST_CANDIDATES="localhost,0.0.0.0,10.99.0.1,10.99.0.3,10.99.0.13,192.168.0.13"
REQUIRED_LLM_PORT_CANDIDATES="9000,9100,9200"

SERVER_PID=""
APP_HOST=""
APP_PORT=""
LOCAL_LLM_HOST=""
LOCAL_LLM_PORT=""
CLEANUP_DONE=0
PREV_APP_BIND_HOST=""
PREV_APP_BIND_PORT=""
PREV_LOCAL_LLM_HOST=""
PREV_LOCAL_LLM_PORT=""
VERSION=""
RUN_LOG=""

trim() {
  local s="$1"
  s="${s#${s%%[![:space:]]*}}"
  s="${s%${s##*[![:space:]]}}"
  printf '%s' "$s"
}

print_banner() {
  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  printf "║  Rise of Agents %-36s ║\n" "$VERSION"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""
}

print_runtime_panel() {
  local app_url="http://${APP_HOST}:${APP_PORT}"
  local local_url="http://127.0.0.1:${APP_PORT}"
  local log_short="$RUN_LOG"
  if [ "${#log_short}" -gt 42 ]; then
    log_short="...${log_short: -39}"
  fi

  echo "╔══════════════════════════════════════════════════════╗"
  printf "║  Rise of Agents %-23s ║\n" "${VERSION} - 실행 중"
  echo "╠══════════════════════════════════════════════════════╣"
  printf "║  APP IP:PORT %-41s║\n" "${APP_HOST}:${APP_PORT}"
  printf "║  WEB URL     %-41s║\n" "$app_url"
  if [ "$APP_HOST" = "0.0.0.0" ]; then
    printf "║  LOCAL URL   %-41s║\n" "$local_url"
  fi
  printf "║  Log       %-42s║\n" "$log_short"
  echo "║  종료      Ctrl+C                                    ║"
  echo "╚══════════════════════════════════════════════════════╝"
}

kill_tree() {
  local pid="$1" sig="${2:-TERM}"
  if [ -z "$pid" ] || [ "$pid" = "$$" ]; then
    return
  fi

  local children
  children="$(ps -o pid= --ppid "$pid" 2>/dev/null || true)"
  for child in $children; do
    kill_tree "$child" "$sig"
  done

  kill "-$sig" "$pid" 2>/dev/null || true
}

read_run_json_pids() {
  python3 - "$RUN_JSON" <<'PY'
import json
import os
import sys

path = sys.argv[1]
if not os.path.exists(path):
    sys.exit(0)

with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)

pids = []
pp = data.get('parent_pid')
if isinstance(pp, int):
    pids.append(pp)

for cp in data.get('child_pids', []):
    if isinstance(cp, int):
        pids.append(cp)

for pid in pids:
    print(pid)
PY
}

cleanup_previous_run() {
  if [ ! -f "$RUN_JSON" ]; then
    return
  fi

  echo "[cleanup] previous run metadata found: $RUN_JSON"
  mapfile -t old_pids < <(read_run_json_pids)

  for pid in "${old_pids[@]:-}"; do
    if [ -n "$pid" ] && [ "$pid" != "$$" ] && kill -0 "$pid" 2>/dev/null; then
      echo "[cleanup] stopping previous project process tree PID=$pid"
      kill_tree "$pid" TERM
      sleep 0.5
      if kill -0 "$pid" 2>/dev/null; then
        kill_tree "$pid" 9
      fi
    fi
  done

  rm -f "$RUN_JSON"
}

cleanup_current_run() {
  if [ "$CLEANUP_DONE" -eq 1 ]; then
    return
  fi
  CLEANUP_DONE=1

  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill_tree "$SERVER_PID" TERM
    sleep 0.5
    if kill -0 "$SERVER_PID" 2>/dev/null; then
      kill_tree "$SERVER_PID" 9
    fi
  fi

  if [ -f "$RUN_JSON" ]; then
    rm -f "$RUN_JSON"
  fi
}

write_run_json() {
  local started_at
  started_at="$(date '+%Y-%m-%dT%H:%M:%S%z')"

  cat > "$RUN_JSON" <<JSON
{
  "started_at": "${started_at}",
  "parent_pid": $$,
  "child_pids": [${SERVER_PID}],
  "ports": [${APP_PORT}]
}
JSON
}

validate_version() {
  if [ ! -f "$VERSION_FILE" ]; then
    echo "[ERROR] VERSION 파일이 없습니다." >&2
    echo "[ACTION] 프로젝트 루트에 VERSION 파일(v0.1.0.0 형식)을 생성하세요." >&2
    exit 1
  fi

  local version
  version="$(tr -d ' \t\r\n' < "$VERSION_FILE")"
  if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "[ERROR] VERSION 형식이 올바르지 않습니다: $version" >&2
    echo "[ACTION] VERSION 값을 v0.1.0.0 형식으로 수정하세요." >&2
    exit 1
  fi

  printf '%s' "$version"
}

csv_to_array() {
  local csv="$1"
  local -n out_arr="$2"
  out_arr=()

  IFS=',' read -r -a raw <<< "$csv"
  for item in "${raw[@]}"; do
    item="$(trim "$item")"
    if [ -n "$item" ]; then
      out_arr+=("$item")
    fi
  done
}

choose_value() {
  local label="$1"
  local csv="$2"
  local default_value="$3"
  local previous_value="${4:-}"
  local prompt_label="${5:-선택}"

  local options
  csv_to_array "$csv" options

  default_value="$(trim "${default_value:-}")"
  previous_value="$(trim "${previous_value:-}")"

  if [ "${#options[@]}" -eq 0 ]; then
    echo "[ERROR] $label 후보가 비어 있습니다." >&2
    echo "[ACTION] .env의 후보 리스트를 확인하세요." >&2
    exit 1
  fi

  # 기본값/이전값이 후보 목록에 없더라도 UI에서 재선택 가능하도록 목록에 추가한다.
  if [ -n "$default_value" ]; then
    local has_default=0
    local opt
    for opt in "${options[@]}"; do
      if [ "$opt" = "$default_value" ]; then
        has_default=1
        break
      fi
    done
    if [ "$has_default" -eq 0 ]; then
      options+=("$default_value")
    fi
  fi

  if [ -n "$previous_value" ]; then
    local has_previous=0
    local opt2
    for opt2 in "${options[@]}"; do
      if [ "$opt2" = "$previous_value" ]; then
        has_previous=1
        break
      fi
    done
    if [ "$has_previous" -eq 0 ]; then
      options+=("$previous_value")
    fi
  fi

  local default_choice="1"
  if [ -n "$default_value" ]; then
    default_choice=""
    local i
    for i in "${!options[@]}"; do
      if [ "${options[$i]}" = "$default_value" ]; then
        default_choice="$((i + 1))"
        break
      fi
    done
    if [ -z "$default_choice" ]; then
      default_choice="0"
    fi
  else
    default_value="${options[0]}"
    default_choice="1"
  fi

  if [ "${RUN_NO_PROMPT:-0}" = "1" ] || [ ! -t 0 ]; then
    printf '%s' "$default_value"
    return
  fi

  echo "" >&2
  echo "▶ $label" >&2
  echo "" >&2

  local i
  for i in "${!options[@]}"; do
    local option="${options[$i]}"
    local marker=""
    if [ "$option" = "$default_value" ]; then
      marker="${marker}  [기본값]"
    fi
    if [ -n "$previous_value" ] && [ "$option" = "$previous_value" ]; then
      marker="${marker}  ← 이전 선택"
    fi
    printf "    %d)  %s%s\n" "$((i + 1))" "$option" "$marker" >&2
  done
  echo "    0)  직접 입력" >&2
  echo "" >&2

  local choice
  read -r -p "    ${prompt_label} (Enter=${default_value}): " choice
  choice="$(trim "${choice:-}")"

  if [ -z "$choice" ]; then
    printf '%s' "$default_value"
    return
  fi

  if [ "$choice" = "0" ]; then
    local typed
    read -r -p "    ${label} 직접 입력 (Enter=${default_value}): " typed
    typed="${typed:-$default_value}"
    printf '%s' "$(trim "$typed")"
    return
  fi

  if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "${#options[@]}" ]; then
    printf '%s' "${options[$((choice - 1))]}"
    return
  fi

  echo "[ERROR] 잘못된 선택입니다: $choice" >&2
  echo "[ACTION] 번호를 다시 입력하세요." >&2
  exit 1
}

validate_port_number() {
  local port="$1"
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    echo "[ERROR] PORT가 숫자가 아닙니다: $port"
    echo "[ACTION] 1024~65535 범위의 숫자를 입력하세요."
    exit 1
  fi

  if [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ]; then
    echo "[ERROR] PORT 범위가 잘못되었습니다: $port"
    echo "[ACTION] 1024~65535 범위로 설정하세요."
    exit 1
  fi
}

validate_bindable() {
  local host="$1"
  local port="$2"

  python3 - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind((host, port))
except OSError:
    sys.exit(1)
finally:
    s.close()
PY
}

is_port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti :"$port" >/dev/null 2>&1
    return $?
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" | tail -n +2 | grep -q .
    return $?
  fi

  return 1
}

resolve_port_registry_path() {
  if [ -n "${PORT_REGISTRY_PATH_OVERRIDE:-}" ]; then
    printf '%s' "$PORT_REGISTRY_PATH_OVERRIDE"
    return
  fi

  local path
  for path in "${PORT_REGISTRY_PATHS[@]}"; do
    if [ -f "$path" ]; then
      printf '%s' "$path"
      return
    fi
  done

  printf '%s' ""
}

check_port_registry() {
  local port="$1"
  local registry_path
  registry_path="$(resolve_port_registry_path)"

  if [ -z "$registry_path" ]; then
    echo "[warn] port.json 경로를 찾지 못했습니다."
    echo "[warn] 경로 후보: ${PORT_REGISTRY_PATHS[*]}"
    return
  fi

  if ! python3 - "$registry_path" "$PORT_REGISTRY_PROJECT_KEY" "$port" <<'PY'
import json
import os
import sys

path = sys.argv[1]
project_key = sys.argv[2]
port = int(sys.argv[3])

if not os.path.exists(path):
    sys.exit(2)

with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)

projects = data.get('projects', {})
proj = projects.get(project_key)
if not isinstance(proj, dict):
    sys.exit(3)

if proj.get('port') == port:
    sys.exit(0)

ports = proj.get('ports')
if isinstance(ports, dict) and port in ports.values():
    sys.exit(0)

sys.exit(4)
PY
  then
    if [ "${PORT_REGISTRY_STRICT:-0}" = "1" ]; then
      echo "[ERROR] 고정 포트 $port 가 port.json(${registry_path})에 등록되지 않았습니다."
      echo "[ACTION] projects.${PORT_REGISTRY_PROJECT_KEY}에 port=$port 를 등록하세요."
      exit 1
    fi

    echo "[warn] 고정 포트 $port 가 port.json(${registry_path})에 등록되지 않았습니다."
    echo "[warn] projects.${PORT_REGISTRY_PROJECT_KEY}에 port=$port 를 등록하세요."
  fi
}

save_defaults() {
  cat > "$DEFAULTS_FILE" <<EOF_DEF
APP_BIND_HOST=${APP_HOST}
APP_BIND_PORT=${APP_PORT}
LOCAL_LLM_HOST=${LOCAL_LLM_HOST}
LOCAL_LLM_PORT=${LOCAL_LLM_PORT}
EOF_DEF
}

validate_ai_mode() {
  local mode
  mode="${AI_CALL_MODE:-NONE}"

  case "$mode" in
    NONE|none|'')
      return
      ;;
    LOCAL_LLM|local_llm)
      if ! LOCAL_LLM_HOST="$(choose_value "로컬 LLM 서버 호스트" "${LOCAL_LLM_HOST_CANDIDATES:-$REQUIRED_HOST_CANDIDATES}" "${LOCAL_LLM_HOST:-127.0.0.1}" "${PREV_LOCAL_LLM_HOST}" "LLM 호스트")"; then
        exit 1
      fi
      if ! LOCAL_LLM_PORT="$(choose_value "로컬 LLM 서버 포트" "${LOCAL_LLM_PORT_CANDIDATES:-$REQUIRED_LLM_PORT_CANDIDATES}" "${LOCAL_LLM_PORT:-9000}" "${PREV_LOCAL_LLM_PORT}" "LLM 포트")"; then
        exit 1
      fi
      validate_port_number "$LOCAL_LLM_PORT"

      if ! curl -fsS --max-time 3 "http://${LOCAL_LLM_HOST}:${LOCAL_LLM_PORT}/v1/model" >/dev/null 2>&1; then
        echo "[ERROR] 로컬 LLM 연결 실패: ${LOCAL_LLM_HOST}:${LOCAL_LLM_PORT}"
        echo "[ACTION] .env 후보/선택값을 확인하고 LLM 서버를 먼저 실행하세요."
        exit 1
      fi
      ;;
    CLI_WRAPPER|cli_wrapper)
      echo "[ERROR] CLI 래핑 호출은 TBD(미구현) 입니다."
      echo "[ACTION] AI_CALL_MODE를 LOCAL_LLM 또는 API_KEY로 변경하세요."
      exit 1
      ;;
    API_KEY|api_key)
      local key
      key="${AI_API_KEY:-${OPENAI_API_KEY:-}}"
      if [ -z "$key" ]; then
        echo "[ERROR] API Key 방식 선택 상태에서 키가 비어 있습니다."
        echo "[ACTION] .env에 AI_API_KEY 또는 OPENAI_API_KEY를 설정하세요."
        exit 1
      fi
      ;;
    *)
      echo "[ERROR] 알 수 없는 AI_CALL_MODE: $mode"
      echo "[ACTION] NONE, LOCAL_LLM, CLI_WRAPPER, API_KEY 중 하나를 사용하세요."
      exit 1
      ;;
  esac
}

handle_signal() {
  echo "[shutdown] 종료 신호를 받았습니다. 정리 후 종료합니다."
  exit 130
}

handle_unexpected_error() {
  trap - ERR
  echo "[ERROR] 예기치 못한 오류로 종료됩니다."
  echo "[ACTION] logs 파일과 .env 설정을 확인하세요."
  exit 2
}

on_exit() {
  local code="$?"
  set +e
  cleanup_current_run

  if [[ "${APP_HOST:-}" =~ ^[^[:space:]]+$ ]] && [[ "${APP_PORT:-}" =~ ^[0-9]+$ ]]; then
    echo "APP IP:PORT=${APP_HOST}:${APP_PORT}"
    echo "SERVER IP:PORT=${APP_HOST}:${APP_PORT}"
  fi

  trap - EXIT
  exit "$code"
}

mkdir -p "$TMP_DIR" "$LOG_DIR"

VERSION="$(validate_version)"
RUN_LOG="$LOG_DIR/$(date '+%Y-%m-%d_%H%M%S').log"
exec > >(tee -a "$RUN_LOG") 2>&1

echo "VERSION=$VERSION"
print_banner

trap handle_signal INT TERM
trap handle_unexpected_error ERR
trap on_exit EXIT

if [ ! -f "$ENV_FILE" ] && [ -f "$ENV_SAMPLE_FILE" ]; then
  cp "$ENV_SAMPLE_FILE" "$ENV_FILE"
  echo "[config] .env 파일이 없어 .env.sample을 복사했습니다: $ENV_FILE"
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ -f "$DEFAULTS_FILE" ]; then
  # shellcheck disable=SC1090
  source "$DEFAULTS_FILE"
  PREV_APP_BIND_HOST="${APP_BIND_HOST:-}"
  PREV_APP_BIND_PORT="${APP_BIND_PORT:-}"
  PREV_LOCAL_LLM_HOST="${LOCAL_LLM_HOST:-}"
  PREV_LOCAL_LLM_PORT="${LOCAL_LLM_PORT:-}"
fi

APP_FIXED_PORT="${APP_BIND_PORT_FIXED:-$APP_FIXED_PORT}"
validate_port_number "$APP_FIXED_PORT"

cleanup_previous_run

if ! APP_HOST="$(choose_value "호스트 선택 (Web/App 고정 포트: ${APP_FIXED_PORT})" "${APP_BIND_HOST_CANDIDATES:-$REQUIRED_HOST_CANDIDATES}" "${APP_BIND_HOST:-0.0.0.0}" "${PREV_APP_BIND_HOST}" "호스트 선택")"; then
  exit 1
fi
if ! APP_PORT="$(choose_value "앱 포트 선택 (고정 포트 정책)" "${APP_BIND_PORT_CANDIDATES:-$APP_FIXED_PORT}" "${APP_BIND_PORT:-$APP_FIXED_PORT}" "${PREV_APP_BIND_PORT}" "앱 포트")"; then
  exit 1
fi
validate_port_number "$APP_PORT"

if [ "$APP_PORT" != "$APP_FIXED_PORT" ]; then
  echo "[ERROR] 이 프로젝트의 고정 포트는 $APP_FIXED_PORT 입니다. 입력값: $APP_PORT"
  echo "[ACTION] APP 바인딩 PORT를 $APP_FIXED_PORT 로 설정하세요."
  exit 1
fi

check_port_registry "$APP_PORT"

if is_port_in_use "$APP_PORT"; then
  echo "[ERROR] 고정 포트 $APP_PORT 가 이미 사용 중입니다."
  echo "[ACTION] 점유 프로세스를 종료한 뒤 다시 실행하세요."
  exit 1
fi

if ! validate_bindable "$APP_HOST" "$APP_PORT"; then
  echo "[ERROR] 바인딩 불가능한 IP/PORT 입니다: ${APP_HOST}:${APP_PORT}"
  echo "[ACTION] 유효한 바인딩 IP를 선택하거나 네트워크 설정을 확인하세요."
  exit 1
fi

validate_ai_mode
save_defaults

echo ""
echo "    ✔  호스트:   ${APP_HOST}"
echo "    ✔  Web App:  http://${APP_HOST}:${APP_PORT}"
if [ "$APP_HOST" = "0.0.0.0" ]; then
  echo "    ✔  Local:    http://127.0.0.1:${APP_PORT}"
fi
echo ""

echo "=== TRPG Run ==="
echo "  HOST: $APP_HOST"
echo "  PORT: $APP_PORT"
echo "  LOG : $RUN_LOG"
echo ""

if [ "${RUN_SKIP_BUILD:-0}" = "1" ]; then
  echo "[1/2] Building web... (skip)"
else
  echo "[1/2] Building web..."
  cd "$DIR/web"
  npx vite build
fi

echo "[2/2] Starting server..."
cd "$DIR/server"
HOST="$APP_HOST" PORT="$APP_PORT" npx tsx src/index.ts &
SERVER_PID="$!"
write_run_json

sleep 2
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "[ERROR] 서버 시작에 실패했습니다."
  echo "[ACTION] logs를 확인하고 포트/환경설정을 점검하세요."
  exit 1
fi

echo ""
echo "=== TRPG server running ==="
echo "  PID  : $SERVER_PID"
echo "  URL  : http://$APP_HOST:$APP_PORT"
if [ "$APP_HOST" = "0.0.0.0" ]; then
  echo "  Local: http://127.0.0.1:$APP_PORT"
fi
echo "  Stop : Ctrl+C"
echo ""
print_runtime_panel
echo ""

wait "$SERVER_PID"
SERVER_PID=""
