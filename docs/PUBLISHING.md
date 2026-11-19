# Veröffentlichung in ioBroker Latest

Stand: 18.11.2026
Aktuell veröffentlichte Version: 0.10.112
Nächste geplante Version: 0.10.113 (noch nicht erstellt)

## Erfolgreich abgeschlossen

- GitHub: https://github.com/helfi9999/ioBroker.ecovacs-deebot2
- npm: https://www.npmjs.com/package/iobroker.ecovacs-deebot2
- Version 0.10.112 auf GitHub und npm veröffentlicht.
- GitHub Actions erfolgreich.
- 60 automatisierte Adaptertests bestanden.
- 50 ioBroker-Paketprüfungen bestanden.
- Praxistest mit Luna und Sky erfolgreich: Verbindung und
  aktualisierte Statusdaten bestätigt.
- Vendor-Bibliotheken und Lizenzhinweise dokumentiert.
- 48 Vendor-Dateien anhand dokumentierter SHA-256-Werte geprüft.

## Korrekturen für die nächste Version

- common.news auf tatsächlich veröffentlichte Versionen reduziert.
- 14 feste Abhängigkeitsversionen auf kompatible Versionsbereiche
  umgestellt.
- package-lock.json aktualisiert.
- 62 automatische Adaptertests bestanden, einschließlich zweier
  zusätzlicher MQTT-Sicherheitstests.
- Timerverwaltung im produktiven TypeScript-Code auf die
  ioBroker-Timerfunktionen umgestellt.
- TypeScript-Build erfolgreich.
- Die neue Versionsnummer wird erst nach Abschluss aller
  Vorbereitungen vergeben.

## Noch offene Aufgaben

1. npm-Einladung an bluefox: Annahme noch nicht bestätigt.
2. Verbleibende Befunde des offiziellen Adapter-Checkers prüfen.
3. Dokumentation und Changelog für die nächste Version ergänzen.
4. GitHub Actions nach den Korrekturen erneut ausführen.
5. Erst danach eine neue Version erstellen und auf npm veröffentlichen.
6. Öffentlichen Test im ioBroker-Forum vorbereiten.
7. Aufnahme in das offizielle ioBroker-Latest-Repository beantragen.
8. Stable erst nach weiteren Tests und Rückmeldungen anstreben.

## Bekannte Einschränkungen

- Der bisherige Praxistest ersetzt keinen Langzeit- oder Neustarttest.
- E999 des Online-Checkers betraf einen HTTP-404 beim Abruf
  einer externen ioBroker-Repository-Adresse.
- W401 bleibt bis zur Aufnahme in das Latest-Repository offen.
- Eine npm-Veröffentlichung bedeutet noch keine offizielle
  Aufnahme in die ioBroker-Adapterverwaltung.

## Quellen

- https://github.com/ioBroker/ioBroker.repositories
- https://adapter-check.iobroker.in/
- https://www.iobroker.dev/

## npm Trusted Publishing

- GitHub Actions als Trusted Publisher bei npm registriert.
- Repository: helfi9999/ioBroker.ecovacs-deebot2
- Workflow: test-and-release.yml
- Berechtigung: npm publish
- Status am 18.11.2026: Pending validation.
- Validierung erfolgt erst durch eine erfolgreiche Veröffentlichung
  über den registrierten GitHub-Workflow.
- bluefox ist als npm-Maintainer mit Schreibrechten eingetragen.
- Keine Veröffentlichung auslösen, bevor die Release-Prüfungen
  abgeschlossen und Version 0.10.113 vorbereitet sind.
