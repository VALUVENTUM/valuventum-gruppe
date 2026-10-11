# VALUVENTUM – echte lokale Test-Wallet (nur Lesen)

Stand 11. Oktober 2026. **Keine produktive Wallet und kein echtes Geld.** Dieses Zusatzmodul wird ausschließlich im vorhandenen GitHub-Entwicklungszweig gepflegt. Die ursprüngliche `05_Wallet.html`, das originale Offline-Modellkonto und der Hauptzweig `main` bleiben unverändert.

## Umfang

- Eine lokale HTML-Seite (`http://127.0.0.1:8098/`) zeigt ausschließlich **tatsächlich gespeicherte künstliche Testsalden** der laufenden CometBFT-ABCI-Anwendung.
- Datenquelle: lokaler CometBFT-JSON-RPC (`http://127.0.0.1:28057` im Vier-Validatoren-Test). API: `GET /api/state`.
- Angezeigt: Testkette, Blockhöhe, zwei synthetische Konten, Gemeinschaftstopf, Anwendungs-Prüfhash und bis zu 20 bestätigte Belege.
- Keine ausgedachten Kontostände, keine Schreib- oder Zahlungsbefehle, keine Anmeldung, kein Import von Original-Walletdaten und keine privaten Schlüssel im Webserver.
- Die Oberfläche ist ohne CDN, Supabase, Ethereum oder Cloud-Laufzeitdienste selbst hostbar. Die Browseroberfläche und der Server binden ausschließlich an `127.0.0.1`; CometBFT muss parallel laufen.
- Eine nicht erreichbare oder falsche Kette ergibt einen klaren Offline-Status statt gespeicherter oder erfundener Guthaben.

## Test und Start

```sh
node --test entwicklung/valu-konsens/tests/*.test.mjs
```

Wenn der CometBFT-Einzelknoten oder Vier-Validatoren-Test auf dem **gleichen** Rechner läuft, kann die Oberfläche mit folgendem Befehl im GitHub-Repository gestartet werden:

```sh
node entwicklung/valu-konsens/wallet-test/server.mjs --rpc http://127.0.0.1:28057 --port 8098
```

Der Vier-Knoten-Ende-zu-Ende-Test startet sie selbst auf Port 28999 und prüft echte Live-Salden nach erster Buchung, nach Ausfall eines Validators und nach dessen Wiederbeitritt.

## Sicherheit und offene Arbeiten

Die Anzeige vertraut dem angesprochenen **lokalen Knoten** und prüft keine unabhängigen Blockbeweise. Auch die Test-Genesis ist künstlich, auf zwei Testkonten begrenzt, und die Schlüssel sind ausdrücklich nur für die temporäre GitHub-Testumgebung erzeugt.

Diese Version besitzt **keine** Benutzeranmeldung, keine Schlüsselsicherung oder -wiederherstellung und keine freigegebene Browser-Signatur. Vor echten Transaktionen folgen Wallet-Identität, sichere lokale Signatur, geräteübergreifende Netzanbindung und unabhängige Sicherheitsprüfung. Die ursprünglichen modellierten Guthaben bilden **keine** Kontodeckung.

GitHub dient nur der Entwicklung und den vorübergehenden automatischen Tests; beim selbst betriebenen Betrieb benötigt die Anwendung keinen GitHub-Dienst.