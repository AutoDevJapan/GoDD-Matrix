#!/usr/bin/env bash

_browser_stream_tee() {
  local stream="$1" filename="$2"
  if [[ "${CAPTURE_HOLD_STREAM-}" == "$stream" ]]; then
    printf 'ready\n' > "$CAPTURE_READY_FIFO"
    IFS= read -r _ < "$CAPTURE_RELEASE_FIFO"
  fi
  exec tee -- "$filename"
}

capture_browser_command() {
  local stdout_path="$1" stderr_path="$2"
  shift 2
  local stdout_fd stderr_fd stdout_pid stderr_pid
  CAPTURE_COMMAND_STATUS=125
  CAPTURE_STDOUT_STATUS=125
  CAPTURE_STDERR_STATUS=125
  CAPTURE_STDOUT_PID=0
  CAPTURE_STDERR_PID=0
  exec {stdout_fd}> >(_browser_stream_tee stdout "$stdout_path") || return 1
  stdout_pid=$!
  exec {stderr_fd}> >(_browser_stream_tee stderr "$stderr_path" {stdout_fd}>&-) || return 1
  stderr_pid=$!
  ( "$@" ) 1>&"$stdout_fd" 2>&"$stderr_fd" {stdout_fd}>&- {stderr_fd}>&-
  CAPTURE_COMMAND_STATUS=$?
  exec {stdout_fd}>&- {stderr_fd}>&-
  if [[ -n "${CAPTURE_WAIT_FIFO-}" ]]; then
    printf 'waiting\n' > "$CAPTURE_WAIT_FIFO"
  fi
  wait "$stdout_pid"
  CAPTURE_STDOUT_STATUS=$?
  wait "$stderr_pid"
  CAPTURE_STDERR_STATUS=$?
  CAPTURE_STDOUT_PID=$stdout_pid
  CAPTURE_STDERR_PID=$stderr_pid
  printf 'command=%s stdout[%s]=%s stderr[%s]=%s\n' \
    "$CAPTURE_COMMAND_STATUS" "$stdout_pid" "$CAPTURE_STDOUT_STATUS" \
    "$stderr_pid" "$CAPTURE_STDERR_STATUS"
  [[ "$CAPTURE_STDOUT_STATUS" -eq 0 && "$CAPTURE_STDERR_STATUS" -eq 0 \
    && -f "$stdout_path" && ! -L "$stdout_path" \
    && -f "$stderr_path" && ! -L "$stderr_path" ]]
}

_browser_capture_cleanup() {
  local status="$1" cleanup_status=0
  if [[ -n "${BROWSER_CAPTURE_RELEASE_FD-}" ]]; then
    printf 'release\n' >&"$BROWSER_CAPTURE_RELEASE_FD" || cleanup_status=1
  fi
  if [[ -n "${BROWSER_CAPTURE_PROBE_PID-}" ]]; then
    wait "$BROWSER_CAPTURE_PROBE_PID" || cleanup_status=1
  fi
  if [[ "${BROWSER_CAPTURE_PROBE_ROOT-}" == "${RUNNER_TEMP%/}"/matrix-stream-probes.* ]]; then
    rm -rf -- "$BROWSER_CAPTURE_PROBE_ROOT" || cleanup_status=1
  else
    cleanup_status=1
  fi
  if [[ "$status" -eq 0 && "$cleanup_status" -ne 0 ]]; then status=1; fi
  exit "$status"
}

_browser_capture_self_test() {
  local tmp
  tmp=$(mktemp -d "${RUNNER_TEMP:?}/matrix-stream-probes.XXXXXX") || return 1
  [[ "$tmp" == "${RUNNER_TEMP%/}"/matrix-stream-probes.* ]] || return 1
  BROWSER_CAPTURE_PROBE_ROOT=$tmp
  BROWSER_CAPTURE_PROBE_PID=""
  BROWSER_CAPTURE_RELEASE_FD=""
  trap '_browser_capture_cleanup "$?"' EXIT
  mkdir "$tmp/directory" || return 1
  if ! capture_browser_command "$tmp/out" "$tmp/err" \
    bash -c 'printf "out\n"; printf "err\n" >&2'; then return 1; fi
  [[ "$CAPTURE_COMMAND_STATUS" -eq 0 && $(cat "$tmp/out") == out \
    && $(cat "$tmp/err") == err ]] || return 1
  local side kind out err result
  for side in stdout stderr; do
    for kind in open write; do
      out="$tmp/$side-$kind.out"
      err="$tmp/$side-$kind.err"
      if [[ "$side" == stdout ]]; then
        if [[ "$kind" == open ]]; then out="$tmp/directory"; else out=/dev/full; fi
      else
        if [[ "$kind" == open ]]; then err="$tmp/directory"; else err=/dev/full; fi
      fi
      if capture_browser_command "$out" "$err" \
        bash -c 'printf "out\n"; printf "err\n" >&2'; then return 1; fi
      [[ "$CAPTURE_COMMAND_STATUS" -eq 0 ]] || return 1
      if [[ "$side" == stdout ]]; then
        [[ "$CAPTURE_STDOUT_STATUS" -ne 0 && "$CAPTURE_STDERR_STATUS" -eq 0 ]] || return 1
      else
        [[ "$CAPTURE_STDERR_STATUS" -ne 0 && "$CAPTURE_STDOUT_STATUS" -eq 0 ]] || return 1
      fi
    done
  done
  local ready_fd release_fd wait_fd pid
  for side in stdout stderr; do
    mkfifo "$tmp/$side.ready" "$tmp/$side.release" "$tmp/$side.wait" || return 1
    exec {ready_fd}<> "$tmp/$side.ready"
    exec {release_fd}<> "$tmp/$side.release"
    exec {wait_fd}<> "$tmp/$side.wait"
    BROWSER_CAPTURE_RELEASE_FD=$release_fd
    (
      CAPTURE_HOLD_STREAM=$side
      CAPTURE_READY_FIFO="$tmp/$side.ready"
      CAPTURE_RELEASE_FIFO="$tmp/$side.release"
      CAPTURE_WAIT_FIFO="$tmp/$side.wait"
      if capture_browser_command "$tmp/$side.delayed.out" "$tmp/$side.delayed.err" \
        bash -c 'printf "out\n"; printf "err\n" >&2'; then result=0; else result=1; fi
      printf '%s\n' "$result" > "$tmp/$side.result"
    ) &
    pid=$!
    BROWSER_CAPTURE_PROBE_PID=$pid
    IFS= read -r -t 5 _ <&"$ready_fd" || return 1
    IFS= read -r -t 5 _ <&"$wait_fd" || return 1
    printf 'release\n' >&"$release_fd"
    wait "$pid" || return 1
    [[ $(cat "$tmp/$side.result") == 0 \
      && $(cat "$tmp/$side.delayed.out") == out \
      && $(cat "$tmp/$side.delayed.err") == err ]] || return 1
    exec {ready_fd}>&- {release_fd}>&- {wait_fd}>&-
    BROWSER_CAPTURE_PROBE_PID=""
    BROWSER_CAPTURE_RELEASE_FD=""
  done
  printf 'Stream controls passed: normal, stdout/stderr open/write failure, held stdout/stderr.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  [[ "${1-}" == --self-test ]] || exit 2
  _browser_capture_self_test
fi
