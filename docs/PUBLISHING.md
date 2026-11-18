# Veröffentlichung in ioBroker Latest

Stand: 17.11.2026. Vorbereiteter Testkandidat: 0.10.110.

## Vorhanden

- Öffentliches Repository: https://github.com/helfi9999/ioBroker.ecovacs-deebot2
- Autor: Thomas H., GitHub: helfi9999.
- Version 0.10.109: 43 Funktionstests, 50 Paketprüfungen und vollständiger
  GitHub-Workflow mit Node.js 22/24 erfolgreich (Commit 678fd72).
- Checker-Metadaten, Übersetzungen, Mindestversion des Controllers, eigenes Icon
  und npm-Installationsmodus korrigiert. npm-Veröffentlichung noch ausstehend.
- GPL-3.0-only, erhaltene MIT-Hinweise und dokumentierte Herkunft der Quellen.

## Neuer Stand 0.10.110

Die alten Ecovacs-/XMPP-Protokolle sind als Quellen unter vendor enthalten.
Ihre tatsächlichen Laufzeitabhängigkeiten werden vom Adapter direkt deklariert,
mit aktualisiertem HTTP/XML/WebSocket-Unterbau und erhaltener Modellzuordnung.
Der ungenutzte native Rasterrenderer ist deaktiviert. Details, Audit-Ergebnisse
und Grenzen: DEPENDENCY_SECURITY.md und vendor/README.md.

50 lokale Funktions-/Protokolltests und 50 Paketprüfungen bestanden. Die neue
Version muss noch praktisch auf den Robotern und erneut auf GitHub geprüft
werden; der alte grüne Workflow ist dafür kein Ersatz.

## Nächste Schritte

1. 0.10.110 auf einer echten ioBroker-Installation prüfen: Anmeldung, Neustart,
   Luna/Sky, Karten, Raum-/Custom-Area-Reinigung und Stationsmeldungen.
2. Die aktualisierten Quellen einschließlich vendor, package.json,
   package-lock.json und .github/workflows/test.yml auf GitHub übertragen.
3. Den neuen Workflow vollständig ausführen lassen. Er enthält auch
   npm run test:security:all und den Controller-Integrationstest.
4. Öffentlichen Adapter-Checker erneut ausführen; verbleibende Befunde beheben.
   Der zuvor gemeldete 404 beim Laden von repo.iobroker.live ist ein externer
   Prüfpfad und wird nicht durch Metadatenänderungen im Adapter behoben.
5. npm-Konto/2FA einrichten bzw. anmelden, Paketumfang per npm pack prüfen,
   anschließend erst die erfolgreich geprüfte Version veröffentlichen.
6. Die von ioBroker verlangten npm-Mitbetreuerrechte einrichten. Keine
   Passwörter oder Tokens in GitHub-Projektdateien oder Chatnachrichten speichern.
7. GitHub-Release erstellen, Repository-Topics setzen und Testthema pflegen.
8. Aufnahme in Latest über https://www.iobroker.dev/ oder Pull Request bei
   ioBroker.repositories beantragen. Die Aufnahme prüft das ioBroker-Team.

Im Rahmen dieser Vorbereitung wurde noch keine npm-Veröffentlichung oder
Latest-Aufnahme durchgeführt. Stable folgt erst nach weiteren Tests.

## Quellen

- https://github.com/ioBroker/ioBroker.repositories
- https://github.com/ioBroker/testing
- https://adapter-check.iobroker.in/
