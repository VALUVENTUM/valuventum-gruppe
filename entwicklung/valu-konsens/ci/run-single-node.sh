#!/usr/bin/env bash
# One REAL CometBFT validator and the VALU JS state machine through Go ABCI socket.
# GitHub CI only: synthetic accounts, localhost only, one physical host.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${RUNNER_TEMP:-/tmp}/valu-comet-abci-$$"
mkdir -p "$DATA"
ABCI_PID=""
COMET_PID=""
cleanup() {
  set +e
  [[ -n "$COMET_PID" ]] && kill -TERM "$COMET_PID" 2>/dev/null
  [[ -n "$COMET_PID" ]] && wait "$COMET_PID" 2>/dev/null
  [[ -n "$ABCI_PID" ]] && kill -TERM "$ABCI_PID" 2>/dev/null
  [[ -n "$ABCI_PID" ]] && wait "$ABCI_PID" 2>/dev/null
  if [[ "${CI:-}" == "true" ]]; then
    echo '---- end of cometbft.log ----'
    tail -n 65 "$DATA/cometbft.log" 2>/dev/null
    echo '---- end of abci.log ----'
    tail -n 65 "$DATA/abci.log" 2>/dev/null
  fi
}
trap cleanup EXIT

node "$ROOT/tools/demo-genesis.mjs" "$DATA"
(
  cd "$ROOT/abci-go"
  # Resolve dependencies for both the adapter AND the full CometBFT CLI.
  go get github.com/cometbft/cometbft/cmd/cometbft@v0.38.26
  go mod tidy
  go build -o "$DATA/valu-abci" ./cmd/valu-abci
  go build -o "$DATA/cometbft" github.com/cometbft/cometbft/cmd/cometbft
)
"$DATA/cometbft" init --home "$DATA/comet-home"
node - "$DATA/comet-home/config/genesis.json" <<'JS'
const fs=require('node:fs');
const path=process.argv[2];
const data=JSON.parse(fs.readFileSync(path,'utf8'));
data.chain_id='VALUVENTUM-LOCAL-DEMO-7';
data.initial_height='1';
fs.writeFileSync(path,JSON.stringify(data,null,2));
JS
start_both() {
  "$DATA/valu-abci" \
    -worker "$ROOT/src/abci-worker.mjs" \
    -state-dir "$DATA/app-state" \
    -genesis "$DATA/demo-genesis.json" > "$DATA/abci.log" 2>&1 &
  ABCI_PID=$!
  sleep 1
  "$DATA/cometbft" start \
    --home "$DATA/comet-home" \
    --proxy_app tcp://127.0.0.1:26658 \
    --rpc.laddr tcp://127.0.0.1:26657 \
    --p2p.laddr tcp://127.0.0.1:26656 > "$DATA/cometbft.log" 2>&1 &
  COMET_PID=$!
  for i in $(seq 1 90);do
    if curl -fsS --max-time 1 http://127.0.0.1:26657/status >/dev/null 2>&1;then
      echo 'COMETBFT_RPC_READY'
      return 0
    fi
    if ! kill -0 "$COMET_PID" 2>/dev/null;then echo 'CometBFT exited unexpectedly';return 1;fi
    sleep 1
  done
  echo 'CometBFT RPC did not start in time';return 1
}
stop_both() {
  kill -TERM "$COMET_PID"; wait "$COMET_PID" || true; COMET_PID=""
  kill -TERM "$ABCI_PID"; wait "$ABCI_PID" || true; ABCI_PID=""
}
start_both
node "$ROOT/tools/demo-payment.mjs" "$DATA"
node "$ROOT/ci/verify-comet.mjs" "$DATA"
stop_both
start_both
node "$ROOT/ci/verify-comet.mjs" "$DATA"
node "$ROOT/tools/demo-payment.mjs" "$DATA" http://127.0.0.1:26657 --expect-rejected
printf '%s\n' 'VALU_COMETBFT_V03826_SINGLE_VALIDATOR_RESTART_TEST_OK'