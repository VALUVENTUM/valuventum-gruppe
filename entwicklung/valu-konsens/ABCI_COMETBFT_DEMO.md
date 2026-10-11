# VALUVENTUM® – CometBFT-Schnittstelle (getrenntes Entwicklungslabor)

**Stand 11.10.2026 – Entwicklungszweig, keinesfalls Produktivbetrieb.**

## Technisch neu

- Go-ABCI-Socketserver über die **offizielle CometBFT v0.38.26 API**: `Info`, `InitChain`, `CheckTx`, `PrepareProposal`, `ProcessProposal`, `FinalizeBlock`, `Commit` und eine rein synthetische `Query`.
- `ExtendVote` gibt leere Erweiterungen zurück; `VerifyVoteExtension` lehnt unerwartete nichtleere Erweiterungen ab.
- Node.js-Worker nutzt den bisherigen `core.mjs` und `persistent-state.mjs` – **keine neue Guthabenquelle**, keine externe Datenbank, keine gehostete Drittanbieter-Wallet.
- Die Kommunikation zwischen Go und Node erfolgt über stdin/stdout mit sequenzieller Anfragekennung; die öffentliche ABCI-Socketbindung ist auf **127.0.0.1:26658** begrenzt.
- Konsensgültige Blöcke verarbeiten auch ungültige Aufträge deterministisch: jede Transaktion hat ihr individuelles Ergebnis (`code=0` oder `code=1`), nur gültige Aufträge verändern die VALU-Salden, und `FinalizeBlock` ändert nicht den persistierten Zustand. Erst CometBFTs `Commit` persistiert den neuen Zustand.
- Rein lokale Testdaten werden unter einem getrennten Datenverzeichnis erzeugt. **Es werden keinerlei originale Kontostände, Mitglieder- oder Wiederherstellungsdaten eingespielt.**

## Reproduzierbare Prüfungen

Im Repository-Hauptverzeichnis:

```sh
node --test entwicklung/valu-konsens/tests/*.test.mjs
```

Go-Adapter bauen (Internet einmalig für die offiziellen Open-Source-Go-Module erforderlich):

```sh
cd entwicklung/valu-konsens/abci-go
# GO: 1.23 oder neuer; Node.js: 22
go mod tidy
go build ./cmd/valu-abci
```

Die automatische GitHub-Prüfung `.github/workflows/valu-cometbft-e2e.yml` führt zusätzlich `ci/run-single-node.sh` aus: einen echten CometBFT-Einzelvalidator mit Go-Socketadapter und JS-Zahlungskern starten, 100 synthetische VALU verbuchen, gespeicherten Zustand über ABCI prüfen, beide Prozesse neu starten, Guthaben prüfen und wiederholten Auftrag ablehnen.

Go/Node/CometBFT sind **auf dem eigenen Rechner** ausführbar. GitHub wird nur für die Entwicklungsprüfungen genutzt, nicht für die Überweisung selbst. Das Projekt wurde nicht in die öffentliche Hauptversion `main` eingebaut.

## Der noch fehlende Nachweis

- Ein einzelner CometBFT-Validator ist **kein** unabhängiges, byzantinisch fehlertolerantes Mehrknotennetz.
- Für die nächste lokale Phase werden mehrere voneinander getrennte Knoten auf einem PC mit separaten CometBFT-Konfigurationen und Speichern benötigt. Ein Test auf zwei physischen Rechnern bleibt danach erforderlich.
- Es fehlen Schlüsselverwaltung/Wiederherstellung, Betriebsverwaltung für unabhängige Validatoren, Transaktionshistorie mit langfristigem Prüfnachweis, Zustandssynchronisierung, Snapshot-Rotation, Schutz vor öffentlichen Abfragen, komplette Sicherheitsprüfungen, rechtliche Prüfung und Freigabe für reale wirtschaftliche Werte.
- Keine Produktivzahlungen, keine realen Guthaben. Die bisherige Offline-Wallet `VALU-E8A2F9-3F7DF0` bleibt eine getrennte Lesekopie mit vier Modellbuchungen.

## Offizielle Quellen

- [CometBFT v0.38.26](https://github.com/cometbft/cometbft/releases/tag/v0.38.26)
- [Offizielle ABCI++-Anforderungen](https://github.com/cometbft/cometbft/blob/main/spec/abci/abci%2B%2B_app_requirements.md)
- [CometBFT-ABCI-Go-Interface v0.38.26](https://github.com/cometbft/cometbft/blob/v0.38.26/abci/types/application.go)