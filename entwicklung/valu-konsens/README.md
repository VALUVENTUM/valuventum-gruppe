# VALUVENTUM: isolierter VALU-Zahlungskern (Entwicklungsstand)

**Stand:** 11. Oktober 2026. **Kein echtes Guthaben, kein Produktionsnetz, keine fertige CometBFT-Anbindung.**

Dies ist ein *zusätzlicher* Entwicklungsbereich. Der bestehende Website-Code in `main`, die bisherige Offline-Modellkontokopie und die ursprünglichen Kontodaten werden nicht verändert.

## Herkunft und Abgrenzung

- `src/core.mjs` und `tests/core.test.mjs`: unveränderte Dateien aus der lokalen VALUVENTUM-Gesamtplattform **Phase 8.2.2**, Unterordner `dezentrales-netz/`.
- `src/deterministic-state.mjs`: neue reine Übergangsfunktion als Vorbereitung einer verteilten Zustandsmaschine.
- `tests/deterministic-state.test.mjs`: zusätzliche Prüfungen für dieselben Blöcke auf unabhängigen *simulierten* Replikas, exakte 90/10-Aufteilung, Dubletten, Signatur und Mengeninvariante.
- Die alten `validator.mjs`- und `run-local.mjs`-Prozesse werden hier absichtlich **nicht** als echter Konsens oder als öffentliche Blockchain ausgegeben.

**Ausführen:** `node --test entwicklung/valu-konsens/tests/*.test.mjs` (Node.js 20+; keine npm-Abhängigkeiten).

## Rechnungsregeln

- 100 VALU brutto vom Sender → 90 VALU an den Empfänger, 10 VALU in den Gemeinschaftstopf; **keine zusätzliche** Netzwerkgebühr.
- Beträge werden als ganze Tausendstel VALU verarbeitet, ohne Fließkomma.
- Der Testfall zu 1.500 VALU brutto zeigt 1.350 VALU netto und 150 VALU Rückfluss. Er ist **keine** Grundeinkommensauszahlung und erzeugt kein neues Guthaben.
- Bruttoguthaben und Gemeinschaftstopf unterliegen derselben Mengenerhaltung im Test; anfängliche Testbestände sind künstlich.
- Die vier Modellbuchungen aus `04_Wallet.html` sind **keine Kontendeckung** für diese Tests.

## Vorbereitung auf CometBFT – ausdrücklich NOCH NICHT angeschlossen

`executeBlock(state, transactions, {height, blockTime})` verarbeitet die vorgegebene, bereits konsensgeordnete Transaktionsliste. `blockTime` kommt aus dem vereinbarten Blockheader, nicht aus der lokalen Rechneruhr. Damit erreichen replizierte Anwendungen bei gleichen Eingaben denselben `appHash`.

Für eine echte ABCI++-Anbindung an CometBFT fehlen noch: geordnetes Block-Commit mit dauerhaftem Speicher und Wiederaufnahme, deterministische Fehlerbehandlung pro Transaktion, Transaktionskodierung, feste Genesis-Datei und Validator-Mitgliedschaft, Synchronisation über verschiedene Rechner, Peer-Verbindungen mit sicherem Transport, Migration und Rollback-Prüfung sowie eine eigenständige Datenschutz-/Sicherheitsprüfung.

CometBFT ist ein *selbst betreibbarer Konsensmotor*, kein Ersatz für VALU-Konto- und Zahlungsregeln und keine Garantie für völlige Dezentralität. Wer Validator werden darf und wie die Regeln geändert werden, muss gemeinschaftlich und nachvollziehbar festgelegt werden.

## Sicherheitsgrenzen

- Keinerlei private Schlüssel, Recovery-Wörter, reale Mitgliederkonten, E-Mail-Adressen oder Guthaben aus der bisherigen Wallet in dieses Testnetz übertragen.
- Die momentanen Demo-Signaturen und der Demo-Genesiszustand sind **nicht** für echte VALU-Werte zugelassen.
- Die Vorbedingung der Netzwerk- und Browser-Ebene ist getrennt zu prüfen: erfolgreiche lokale Node-Tests sagen noch nichts über den Betrieb auf mehreren unabhängigen Computern aus.
- GitHub ist lediglich Quellcodeverwaltung, kein notwendiger Transaktionsdienst.

**Nächster überprüfbarer Meilenstein:** eine Zahlung über zwei verschiedene, eigenständig betriebene Rechner, später vier unabhängige Validatoren mit nachgewiesenem Konsens, Neustart- und Trennungstest. Bis zu diesem Nachweis keine produktiven Geldtransfers versprechen.