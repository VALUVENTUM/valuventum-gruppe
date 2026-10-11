# VALUVENTUM: lokale Test-Wallet mit Browser-Signatur

Stand: 11. Oktober 2026. **Nur kuenstliche Test-VALU, keine produktive Wallet, keine echten Guthaben.** Die Original-Wallet und der GitHub-Hauptzweig bleiben unberuehrt.

## Technische Funktionen

- Die lokale Weboberflaeche `http://127.0.0.1:8098/` zeigt **bestaetigte** Testkontostaende, Blockhoehe, Gemeinschaftstopf und Buchungsbelege von einem laufenden CometBFT-Knoten an.
- Der Nutzer waehlt das sendende Testkonto, ein empfangendes Testkonto, den Betrag und eine lokale PEM-Testdatei. Der Browser verwendet WebCrypto Ed25519, signiert die Transaktion lokal, verifiziert die Signatur gegen den oeffentlichen Schluessel und sendet nur das signierte JSON.
- Der lokale Server bindet nur an `127.0.0.1`. `POST /api/submit` verlangt gleiche Browser-Origin, einen speziellen Demo-Header und die gueltige Ed25519-Signatur. Es gibt keinen Passwort- oder Private-Key-Endpunkt.
- Der Server reicht den signierten Demoauftrag an `broadcast_tx_commit` des konfigurierten *lokalen* CometBFT-RPC weiter. Ein Auftrag gilt erst als bestaetigt, wenn sowohl der Validator die Zahlung annimmt als auch ein passender gebuchter Beleg im Testzustand gefunden wird. Unklarer Ausgang wird nicht als Erfolg bezeichnet.
- 100 Test-VALU brutto ergeben 90 Test-VALU Empfaenger und 10 Test-VALU Gemeinschaftstopf, ohne zusaetzliche Sendergebuehr. Das ist Modellbuchfuehrung, keine reale Waehrung.
- Keine CDN-, Supabase-, Ethereum- oder GitHub-Laufzeitpflicht.

## Lokal testen

Mit Node.js 22 und Go 1.23 sowie CometBFT v0.38.26:

```sh
node --test entwicklung/valu-konsens/tests/*.test.mjs
bash entwicklung/valu-konsens/ci/run-four-live.sh
```

Der zweite Befehl erzeugt temporaere Testkonten und startet vier CometBFT-Validatoren mit vier getrennten Datenordnern auf **einem** Rechner. Er prueft eine normale Zahlung, eine Browser-kompatibel signierte Zahlung via Test-Wallet, Fortsetzung mit drei Validatoren, Wiederbeitritt und Doppelbuchungsschutz. Alle Dienste binden an 127.0.0.1. Der Test startet und stoppt alle Prozesse selbst.

Zum manuellen Ausprobieren, bei bereits installierten Abhaengigkeiten:

```sh
bash entwicklung/valu-konsens/ci/run-four-live.sh --interactive
```

Dann die angezeigte lokale URL oeffnen und *ausschliesslich* die beim Teststart neu erzeugte `sender-demo.pem` im Dateifeld auswaehlen. Die PEM-Datei darf nie ins Internet, auf GitHub oder in eine produktive Wallet uebernommen werden. Mit Strg+C wird die lokale Testumgebung beendet. Die temporaeren Demo-Schluessel werden vom Skript **nicht** als sichere Geheimnisse behandelt; nach dem Test kann das angelegte Temp-Verzeichnis entfernt werden.

## Ehrliche Grenzen

- **Kein Browser-Passwortschutz, keine sichere Schluesselaufbewahrung, keine Wiederherstellung, keine Hardware-Wallet und keine unabhaengige Sicherheitspruefung.** Der Browser verarbeitet die PEM kurzfristig im Arbeitsspeicher. Fuer reale Werte ist dieser Testmechanismus nicht freigegeben.
- Die Demo-Genesis hat zwei kuenstliche Konten. Neue selbst erzeugte Adressen sind ohne registrierte Guthaben nicht zahlungsfaehig.
- Die Browseranzeige vertraut einem lokal konfigurierten CometBFT-Knoten; sie prueft keine kryptographischen Blocknachweise eigenstaendig. Bei Verbindungsabbruch bleibt der Status offen, nicht als bestaetigt.
- Vier Prozesse auf einem physischen Rechner belegen noch keine Unabhaengigkeit verschiedener Rechner oder Betreiber.
- Der bisherige VALUVENTUM-Hauptstand, die alte Wallet-Ansicht sowie deren vier Modellbuchungen bleiben unangetastet.

Erst nach erfolgreichem GitHub-Mehrknoten-Ende-zu-Ende-Lauf, Security-Review, Schluesselverwaltung und realen Mehrgeraete-Tests kann eine weitergehende Freigabe diskutiert werden.