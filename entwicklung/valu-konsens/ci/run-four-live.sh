#!/usr/bin/env bash
# 4 real CometBFT validators; all synthetic data; all services on loopback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$(mktemp -d "${RUNNER_TEMP:-/tmp}/valu-4local-XXXXXXXX")"
chmod 700 "$DATA"
declare -a CPID BPID
log_tail() {
  echo 'FOUR_VALIDATOR_DEBUG_LOGS:'
  for i in 0 1 2 3; do
    for service in abci comet; do
      tail -n 28 "$DATA/node${i}-${service}.log" 2>/dev/null || true
    done
  done
}
stop_node() {
  local i="$1"; local pid
  pid="${CPID[$i]:-}"; if [[ -n "$pid" ]];then kill -TERM "$pid" 2>/dev/null || true;wait "$pid" 2>/dev/null || true;CPID[$i]='';fi
  pid="${BPID[$i]:-}"; if [[ -n "$pid" ]];then kill -TERM "$pid" 2>/dev/null || true;wait "$pid" 2>/dev/null || true;BPID[$i]='';fi
}
cleanup() { local status=$?; trap - EXIT;for i in 0 1 2 3;do stop_node "$i";done; if [[ "$status" -ne 0 ]];then log_tail;fi;exit "$status"; }
trap cleanup EXIT
node "$ROOT/tools/demo-genesis.mjs" "$DATA"
(
 cd "$ROOT/abci-go"
 go mod tidy
 go get github.com/cometbft/cometbft/cmd/cometbft/commands@v0.38.26
 go build -o "$DATA/valu-abci" ./cmd/valu-abci
 go build -o "$DATA/cometbft" github.com/cometbft/cometbft/cmd/cometbft
)
node "$ROOT/ci/prepare-four.mjs" "$DATA"
start_node() {
  local i="$1"
  local rpc=$((28057 + 10*i))
  local p2p=$((28056 + 10*i))
  local abci=$((28058 + 10*i))
  "$DATA/valu-abci" -listen "tcp://127.0.0.1:$abci" \
    -worker "$ROOT/src/abci-worker.mjs" -state-dir "$DATA/app$i" \
    -genesis "$DATA/demo-genesis.json" >"$DATA/node${i}-abci.log" 2>&1 &
  BPID[$i]=$!
  "$DATA/cometbft" start --home "$DATA/validator$i" \
    --proxy_app "tcp://127.0.0.1:$abci" \
    --rpc.laddr "tcp://127.0.0.1:$rpc" --p2p.laddr "tcp://127.0.0.1:$p2p" \
    >"$DATA/node${i}-comet.log" 2>&1 &
  CPID[$i]=$!
}
for i in 0 1 2 3;do start_node "$i";done
node "$ROOT/ci/check-four.mjs" "$DATA" ready
node "$ROOT/ci/check-four.mjs" "$DATA" pay1
stop_node 3
node "$ROOT/ci/check-four.mjs" "$DATA" continue3
start_node 3
node "$ROOT/ci/check-four.mjs" "$DATA" catchup