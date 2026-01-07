#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${SCRIPT_DIR}/daily-work-log"
BACKEND_DIR="${SCRIPT_DIR}/daily-work-log-go-backend"

FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-5000}"

FRONTEND_URL="${FRONTEND_URL:-http://localhost:${FRONTEND_PORT}}"
BACKEND_URL="${BACKEND_URL:-http://localhost:${BACKEND_PORT}}"
AUTO_OPEN_BROWSER="${AUTO_OPEN_BROWSER:-1}"

if [[ ! -d "${FRONTEND_DIR}" ]]; then
  echo "找不到前端資料夾: ${FRONTEND_DIR}" >&2
  exit 1
fi

if [[ ! -d "${BACKEND_DIR}" ]]; then
  echo "找不到後端資料夾: ${BACKEND_DIR}" >&2
  exit 1
fi

cleanup() {
  echo
  echo "停止服務中..."
  if [[ "${FRONTEND_STARTED_BY_SCRIPT:-0}" == "1" ]] && [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
  if [[ "${BACKEND_STARTED_BY_SCRIPT:-0}" == "1" ]] && [[ -n "${BACKEND_PID:-}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  echo "已停止。"
}

trap cleanup INT TERM EXIT

open_url() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${url}" >/dev/null 2>&1 || true
    return 0
  fi
  if command -v gio >/dev/null 2>&1; then
    gio open "${url}" >/dev/null 2>&1 || true
    return 0
  fi
  if command -v open >/dev/null 2>&1; then
    open "${url}" >/dev/null 2>&1 || true
    return 0
  fi
  return 1
}

wait_for_url() {
  local url="$1"
  local max_seconds="${2:-60}"

  if command -v curl >/dev/null 2>&1; then
    local end=$((SECONDS + max_seconds))
    while ((SECONDS < end)); do
      if curl -fsS "${url}" >/dev/null 2>&1; then
        return 0
      fi
      sleep 0.5
    done
    return 1
  fi

  # 沒有 curl 就不做等待，直接視為可用
  return 0
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :${port} )" 2>/dev/null | tail -n +2 | grep -q .
    return $?
  fi
  return 1
}

first_listener_pid() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true
    return 0
  fi
  return 0
}

echo "啟動後端 (Go/Gin)..."
BACKEND_STARTED_BY_SCRIPT=0
if port_in_use "${BACKEND_PORT}"; then
  pid="$(first_listener_pid "${BACKEND_PORT}")"
  if [[ -n "${pid}" ]]; then
    echo "偵測到 ${BACKEND_URL} 已有程序在跑 (pid ${pid})，將沿用既有後端，不再重複啟動。"
  else
    echo "偵測到 ${BACKEND_URL} 已被占用，將沿用既有服務，不再重複啟動。" >&2
  fi
else
  (
    cd "${BACKEND_DIR}"
    PORT="${BACKEND_PORT}" go run main.go
  ) &
  BACKEND_PID=$!
  BACKEND_STARTED_BY_SCRIPT=1
  echo "後端 PID: ${BACKEND_PID} (${BACKEND_URL})"
fi

FRONTEND_STARTED_BY_SCRIPT=0
if port_in_use "${FRONTEND_PORT}"; then
  pid="$(first_listener_pid "${FRONTEND_PORT}")"
  if [[ -n "${pid}" ]]; then
    echo "偵測到 ${FRONTEND_URL} 已有程序在跑 (pid ${pid})，將沿用既有前端，不再重複啟動。"
  else
    echo "偵測到 ${FRONTEND_URL} 已被占用，將沿用既有服務，不再重複啟動。" >&2
  fi
else
  echo "啟動前端 (React)..."
  (
    cd "${FRONTEND_DIR}"
    PORT="${FRONTEND_PORT}" npm start
  ) &
  FRONTEND_PID=$!
  FRONTEND_STARTED_BY_SCRIPT=1
  echo "前端 PID: ${FRONTEND_PID} (${FRONTEND_URL})"
fi

if [[ "${AUTO_OPEN_BROWSER}" == "1" ]]; then
  (
    if wait_for_url "${FRONTEND_URL}" 90; then
      open_url "${FRONTEND_URL}" || {
        echo "找不到可用的開啟瀏覽器指令，請手動開啟: ${FRONTEND_URL}" >&2
      }
    else
      echo "前端啟動較久，請手動開啟: ${FRONTEND_URL}" >&2
    fi
  ) &
fi

echo
echo "服務已啟動。按 Ctrl+C 會停止此腳本啟動的程序（若前端原本就已在跑，將不會被關掉）。"

PIDS=()
if [[ "${BACKEND_STARTED_BY_SCRIPT}" == "1" ]] && [[ -n "${BACKEND_PID:-}" ]]; then
  PIDS+=("${BACKEND_PID}")
fi
if [[ "${FRONTEND_STARTED_BY_SCRIPT}" == "1" ]] && [[ -n "${FRONTEND_PID:-}" ]]; then
  PIDS+=("${FRONTEND_PID}")
fi

if [[ "${#PIDS[@]}" -eq 0 ]]; then
  echo "前後端都已在執行中；此腳本將保持運行（不會停止既有服務），按 Ctrl+C 結束。"
  while true; do
    sleep 3600
  done
fi

# 等待任一子程序結束，若其中一個掛了，trap 會負責清理
wait -n "${PIDS[@]}"
