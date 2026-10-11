# VALU: Abnahme fuer vier lokale Validatoren

Ziel: Vier echte CometBFT-v0.38.26-Validatoren mit getrennten Identitaeten, ABCI-Ports, App-Daten und Blockspeichern auf einem einzigen Testrechner betreiben.

Die vier Knoten verwenden eine gemeinsame CometBFT-Genesis mit vier Validatoren und dieselbe synthetische VALU-Genesis. Alle Schnittstellen bleiben an 127.0.0.1 gebunden; die Entwicklung erfolgt ausschliesslich mit Testwerten.

Abnahme:
1. Vier laufende CometBFT-Knoten mit mindestens zwei gegenseitigen P2P-Verbindungen pro Knoten.
2. Zahlung von 100 Test-VALU auf allen vier Knoten konsistent: 90 an die Empfaengeradresse, 10 in den Gemeinschaftstopf.
3. Uebereinstimmende Blockhashes und App-Hashes auf derselben Blockhoehe.
4. Nach Stoppen eines der vier Validatoren bestaetigen die restlichen drei weitere Bloecke und buchen 50 Test-VALU als 45/5 auf.
5. Der vierte Validator startet erneut, synchronisiert die fehlenden Bloecke, und eine bereits gebuchte Transaktion wird nicht doppelt verbucht.

Hinweis: Ein Test auf einem Rechner ist KEIN Beweis fuer vier unabhaengige physische Betreiber, Internetfaehigkeit, echte Vermoegenswerte oder ein fertiges Zahlungsnetz.

Der Hauptzweig `main`, die bisherige Wallet und die vier alten Modellbuchungen bleiben unveraendert. Die End-to-End-Abnahme ist erst nach einem vollstaendig erfolgreichen CI-Lauf bestanden.
