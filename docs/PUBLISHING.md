# Veröffentlichung in ioBroker Latest

Stand: 17.11.2026. Vorbereitete Version: 0.10.109.

## Vorbereitet

- Autor: Thomas H., GitHub: helfi9999.
- Geplantes Repository: https://github.com/helfi9999/ioBroker.ecovacs-deebot2
- GPL-3.0-only für die neue Veröffentlichung, vollständiger Lizenztext,
  erhaltene MIT-Hinweise, Quellenherkunft und eigenes Icon.
- Englische README, Changelog und Links zum Hersteller.
- Globales `info.connection` für die Cloud-Verbindung; Geräteverbindungen
  bleiben als separate Angaben bestehen.
- Start ohne Zugangsdaten wartet auf die Konfiguration und ruft die Cloud
  nicht auf.
- `encryptedNative` und `protectedNative` stehen auf der Wurzelebene der
  io-package.json; `common.licenseInformation` entspricht dem aktuellen Schema.
- Paketprüfung mit @iobroker/testing: 50 Prüfungen bestanden.
- Bestehende TypeScript-/Funktionstests: 43 bestanden.
- Installations-/Starttests mit echtem js-controller und GitHub-Workflow für
  Node.js 22 und 24 vorbereitet.

## Noch vor der Einreichung nötig

1. Öffentliches Repository prüfen bzw. Projektdateien hochladen. Die bisherige
   Adresse lieferte am 17.11.2026 über die GitHub-API HTTP 404. Damit wurde
   weder das öffentliche Repository noch ein Upload bestätigt.
2. GitHub Actions vollständig ausführen lassen. Der lokale Integrationstest
   scheitert bereits während der Controller-Installation an einer Einschränkung
   dieser Arbeitsumgebung: `os.networkInterfaces()` / `uv_interface_addresses`.
   Der neue Starttest ist damit noch nicht als bestanden nachgewiesen.
3. 0.10.109 auf einer echten ioBroker-Installation prüfen, insbesondere
   Anmeldung, Speicherung der Zugangsdaten, Cloud-Verbindungsanzeige und Neustart.
4. Den öffentlichen Adapter-Checker für das hochgeladene Repository ausführen
   und alle Befunde bearbeiten: https://adapter-check.iobroker.in/
5. GitHub-Topics setzen, z. B. `iobroker`, `ecovacs`, `deebot`, `vacuum`.
6. npm-Veröffentlichung über das Konto des Projektinhabers vorbereiten und
   ioBroker gemäß den aktuellen Vorgaben als Mitbetreuer hinzufügen. Niemals
   Passwörter oder Tokens in Projektdateien oder Chatnachrichten einfügen.
7. Nach erfolgreichen Prüfungen das Paket auf npm veröffentlichen und einen
   passenden GitHub-Release erstellen.
8. Aufnahme in Latest über https://www.iobroker.dev/ oder per Pull Request bei
   ioBroker.repositories beantragen. Die Aufnahme wird vom ioBroker-Team geprüft.
9. Testthema im Forum pflegen; Stable erst nach weiteren erfolgreichen Tests.

Noch keine öffentliche Veröffentlichung, npm-Übertragung oder Latest-Aufnahme
im Rahmen dieser Vorbereitung durchgeführt. Frühere Rückmeldungen zu 0.10.107
ersetzen keinen Praxistest der neuen Konfigurationsänderungen in 0.10.109.

## Quellen

- https://github.com/ioBroker/ioBroker.repositories
- https://github.com/ioBroker/testing
- https://adapter-check.iobroker.in/
