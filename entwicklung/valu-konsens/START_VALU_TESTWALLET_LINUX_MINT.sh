#!/usr/bin/env bash
# VALUVENTUM: local synthetic test network and browser wallet.
# Intended for Linux Mint / Ubuntu. Never touches the old VALUVENTUM wallet.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
URL='http://127.0.0.1:28999/'
OPEN_PID=''

heading() {
  printf '\n%s\n' '==============================================='
  printf '%s\n' ' VALUVENTUM - LOKALE TEST-WALLET (NUR TEST-VALU)'
  printf '%s\n' '==============================================='
}

instructions() {
  cat <<'TEXT'
Diese Version erzeugt frische kuenstliche Testkonten und startet
vier CometBFT-Validatoren auf DIESEM einen Rechner.

Es werden keine echten Guthaben und keine bisherigen Wallets
uebernommen oder veraendert. Alles bindet an 127.0.0.1.

Der erste Start laedt Go-Abhaengigkeiten aus dem Internet und baut
CometBFT. Dies kann mehrere Minuten dauern. Ein GitHub-Zugang ist
zum Betrieb des fertigen lokalen Testnetzes nicht erforderlich.

Nach dem Start:
  * Firefox oeffnet die Test-Wallet automatisch, falls verfuegbar.
  * Fuer eine Zahlung die im Terminal angezeigte TEST-PEM-Datei
    im Browser auswaehlen. NIEMALS einen echten privaten Schluessel.
  * 100 TEST-VALU => 90 an Empfaenger, 10 Gemeinschaft.
  * Das Terminal offen lassen. Mit Strg+C beendest du das Testnetz.

Wichtig: Ein neuer Start erzeugt NEUE Testkonten und eine neue
Testkette. Es ist KEIN dauerhaftes, produktives VALU-Konto.
TEXT
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '\nFEHLT: %s. Es wurde nichts installiert.\n' "$1" >&2
    return 1
  fi
}

check_tools() {
  local bad=0 major go_version go_major go_minor
  for tool in bash node go curl; do need "$tool" || bad=1; done
  if ((bad)); then
    echo 'Bitte installiere zuerst die genannten Programme; schreibe mir,' >&2
    echo 'welche fehlen, dann gehen wir den passenden Mint-Schritt durch.' >&2
    return 1
  fi
  major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
  if [[ ! "$major" =~ ^[0-9]+$ ]] || ((major<22)); then
    printf 'Node.js 22 oder neuer erforderlich. Vorhanden: %s\n' "$(node --version)" >&2
    return 1
  fi
  go_version="$(go env GOVERSION 2>/dev/null || true)"
  if [[ "$go_version" =~ ^go([0-9]+)\.([0-9]+) ]]; then
    go_major="${BASH_REMATCH[1]}"; go_minor="${BASH_REMATCH[2]}"
    if ((go_major<1 || (go_major==1 && go_minor<23))); then
      printf 'Go 1.23 oder neuer erforderlich. Vorhanden: %s\n' "$go_version" >&2
      return 1
    fi
  else
    printf 'Die Go-Version konnte nicht gelesen werden: %s\n' "$go_version" >&2
    return 1
  fi
  for path in "$ROOT/ci/run-four-live.sh" "$ROOT/wallet-test/server.mjs" "$ROOT/tools/demo-genesis.mjs" "$ROOT/abci-go/go.mod"; do
    if [[ ! -f "$path" ]]; then
      echo 'Projektdatei fehlt:' "$path" >&2
      echo 'Bitte den GANZEN GitHub-Entwicklungszweig herunterladen,' >&2
      echo 'nicht das alte Teilpaket mit der .patch-Datei.' >&2
      return 1
    fi
  done
  echo "Node.js $(node --version) und $go_version gefunden."
  echo 'Alle benoetigten Projektdateien sind vorhanden.'
}

check_ports() {
  # The CI demo uses fixed ports. Refuse to touch an unrelated listener.
  node --input-type=module - <<'JS'
import {createServer} from 'node:net';
const ports = [28999, ...Array.from({length: 4}, (_,i)=>[28056+i*10,28057+i*10,28058+i*10]).flat()];
let busy = [];
for (const port of ports) {
  const available = await new Promise(resolve => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port,'127.0.0.1', () => s.close(() => resolve(true)));
  });
  if (!available) busy.push(port);
}
if (busy.length) {
  console.error('Mindestens ein Testnetz-Port ist bereits belegt: ' + busy.join(', '));
  console.error('Bitte das zuvor gestartete Testnetz zuerst beenden.');
  process.exitCode = 2;
} else {
  console.log('Alle 13 lokalen Testnetz-Ports sind frei.');
}
JS
}

auto_open_browser() {
  if ! command -v xdg-open >/dev/null 2>&1; then
    return 0
  fi
  # Do not open a misleading empty page: only open once the ABCI query works.
  for ((i=0;i<900;i++)); do
    if curl -fsS --max-time 2 'http://127.0.0.1:28999/api/state' >/dev/null 2>&1; then
      printf '\nTestnetz erreichbar. Browser wird geoeffnet: %s\n' "$URL"
      xdg-open "$URL" >/dev/null 2>&1 || true
      return 0
    fi
    sleep 1
  done
  echo 'Automatisches Browseroeffnen ist nicht gelungen.'
  echo "Bitte die Adresse selbst in Firefox eingeben: $URL"
}

cleanup() {
  if [[ -n "$OPEN_PID" ]]; then
    kill "$OPEN_PID" 2>/dev/null || true
    wait "$OPEN_PID" 2>/dev/null || true
  fi
}

heading
case "${1:-}" in
  --help|-h) instructions; exit 0;;
  --check) check_tools; check_ports; echo 'Vorpruefung bestanden; es wurde noch nichts gestartet.'; exit 0;;
  '') ;;
  *) echo "Unbekannte Option: $1" >&2; exit 2;;
esac
instructions
check_tools
check_ports
printf '\nStarte vier Knoten und die Test-Wallet; das Terminal offen lassen.\n'
auto_open_browser &
OPEN_PID=$!
trap cleanup EXIT
bash "$ROOT/ci/run-four-live.sh" --interactive