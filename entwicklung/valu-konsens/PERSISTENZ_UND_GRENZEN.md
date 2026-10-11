# VALU: dauerhafte lokale Testbuchungen (Forschungsstand 2026-10-11)

Dieser Entwicklungsbaustein ist **keine produktive VALU-Blockchain** und **keine CometBFT-Anbindung**. Er ist bewusst vom bestehenden VALUVENTUM-Hauptzweig und von der alten Wallet getrennt. Ausschliesslich synthetische Testwerte verwenden.

## Implementierter Lebenszyklus

- `ValuLifecycle.open(dir, genesis)` laedt einen gebundenen Testzustand. Existiert kein gespeicherter Zustand, wird nur die uebergebene Test-Genesis als Ausgangsstand verwendet.
- `info()` meldet die zuletzt dauerhaft gespeicherte Blockhoehe und ihren Hash.
- `checkTx(tx, blockTime)` prueft eine synthetische Transaktion ohne Speicherung. Dies ist **nur** eine Testvorpruefung, nicht der echte CometBFT-Mempool.
- `processProposal(transactions, {height, blockTime})` probiert einen Block ohne Aenderung am Datentraeger. Der aktuelle Algorithmus verwirft den gesamten Block, sobald eine Transaktion ungueltig ist.
- `finalizeBlock(transactions, {height, blockTime})` berechnet den Folgezustand **ohne** Schreibzugriff.
- `commit()` schreibt ihn mit SHA-256-Zustandshash, Genesisbindung, exklusiver lokaler Sperre, `fsync` einer temporaeren Datei, atomarem `rename` und Verzeichnissynchronisation.
- Erneutes Oeffnen prueft Kettenkennung, initialen Genesis-Hash, gespeicherten Hash und die Gesamtmenge.

Der Zustand wird nur nach erfolgreichem Commit uebernommen. Eine unterbrochene Kandidatenberechnung aendert den letzten persistierten Zustand nicht. Ein zweiter Schreibversuch auf Basis eines veralteten Zustands wird abgelehnt. Bei einer unklaren Commit-Rueckmeldung gilt **nicht** automatisch Erfolg; der gespeicherte Stand muss erneut gelesen werden.

## So kann die lokale Entwicklung geprueft werden

```sh
node --test entwicklung/valu-konsens/tests/*.test.mjs
```

Node.js 22, Standardbibliothek, kein npm, kein CometBFT- oder Cloud-Dienst erforderlich. Die automatischen GitHub-Tests verwenden denselben Befehl. `persistent-state.mjs` schreibt nur in den explizit konfigurierten Testordner.

## Wichtige technische Grenzen

- Diese Dateiablage ist nur ein **lokaler Einzelschreiber**, kein verteiltes Journal und kein unabhaengiger Konsens. Zwei Replikate im Test sind getrennte lokale Verzeichnisse auf demselben Rechner, keine zwei Netzwerk-Knoten.
- Die Pruefsumme erkennt zufaellige Beschaedigung, ist aber ohne extern vertrauenswuerdig verankerten Zustand kein Nachweis gegen gezielte Manipulation.
- Bei unklarer Dateisperre wird die Sperre absichtlich **nicht automatisch geloescht**. Vor manueller Reparatur sind die Prozesse und die gespeicherten Daten zu pruefen.
- Die aktuelle Zustandsdatei hat weder Journal-/Snapshot-Rotation noch Begrenzung der Historie. Das Prototypdesign ist nicht fuer Dauerbetrieb freigegeben.
- `processProposal`/`finalizeBlock` sind noch nicht an ABCI++ mit echten serialisierten Nachrichten angeschlossen. Die aktuelle Alles-oder-nichts-Blockausfuehrung ist noch nicht fuer beliebige fehlerhafte Transaktionen in Konsensblöcken geeignet; hier fehlt eine pro-Transaktion-Fehlerbehandlung.
- Kein realer Mehrgeraete-Test, kein Schutz vor feindlichen Validatoren, kein sicherer Schluessel-Wiederherstellungsprozess, keine unabhaengige Sicherheitspruefung, keine produktiven Guthaben.
- Die alte Kontoanzeige `VALU-E8A2F9-3F7DF0` und ihre Modellbuchungen werden **nicht** importiert oder neu ausgegeben.

## Naechste Abnahme

1. ABCI++-Adapter und getestete Protobuf/Socketschnittstelle auf eine festgelegte CometBFT-Version ausrichten, einschliesslich `Info`, `InitChain`, `CheckTx`, `PrepareProposal`, `ProcessProposal`, `FinalizeBlock` und `Commit`.
2. Deterministische Fehlerbehandlung pro Transaktion und feste, verifizierbare Genesis sowie gemeinsame Kettenparameter implementieren.
3. Vollstaendigen Konsens zwischen zwei unabhaengigen physischen Rechnern pruefen; fuer byzantinische Fehlertoleranz und Quorum anschliessend einen ausreichend grossen, unabhaengig betriebenen Validatorensatz aufbauen.
4. Neustart-, Netzwerkunterbrechungs-, doppelte-Transaktion-, Datenwiederherstellungs- und Sicherheitspruefungen dokumentieren.

Die 90/10-Regel bleibt verbindlich: 100 VALU Bruttozahlungsauftrag = 90 VALU Empfaenger + 10 VALU Gemeinschaftstopf. 1.500 VALU Grundeinkommen brutto sind lediglich eine Modellrechnung, kein Testnetzguthaben.