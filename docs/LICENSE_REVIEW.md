# Herkunfts- und Lizenzprüfung

Datum: 21.10.2026. Grundlage: lokaler Projektstand 0.10.107 und die hier
vorliegenden Referenzkopien. Keine verbindliche rechtliche Freigabe.

## Vorgehen und Befunde

- Alle TypeScript-Dateien unter src wurden gegen JavaScript-Dateien der
  lokalen Referenzen ioBroker.ecovacs-deebot 1.4.16-alpha.7 und
  ioBroker.ecovacs-map 0.8.0 verglichen. Kommentare wurden ausgefiltert,
  anschließend exakte Fenster von 24 Tokens gesucht.
- Beim ursprünglichen Ecovacs-Adapter wurden keine identischen Fenster
  gefunden. Das schließt kürzere oder umgeschriebene Übernahmen nicht aus.
- Beim Kartenadapter gab es 100 übereinstimmende Fenster mit SvgRenderer.ts
  und 54 mit StateProjector.ts. Fenster überlappen; dies sind keine 154
  getrennten Übernahmen. Als konservative Zuordnung werden die betreffenden
  Kartenbestandteile mit dem ursprünglichen MIT-Hinweis versehen.
- Zusätzlich wurden 32-Token-Fenster gegen index.js und library/*.js der
  installierten ecovacs-deebot-Bibliothek geprüft. Keine Treffer. Die
  Bibliothek wird jedoch direkt per require eingebunden und ausgeführt;
  fehlende Textgleichheit hebt Lizenzpflichten nicht auf.
- Die Metadaten und Lizenztexte der drei konkreten lokalen Versionen wurden
  gelesen. Zwei MIT-Referenzen, Bibliothek GPL-3.0 mit vollständigem GPLv3-Text.
- Das bisherige externe Adapter-Icon wurde nur referenziert, nicht als lokale
  Datei mitgeliefert. Der Verweis ist durch ein eigenes Icon ersetzt worden.

## Umgesetzte Maßnahmen

- Eigene Projektveröffentlichung auf GPL-3.0-only ausgerichtet. Die MIT-
  Lizenztexte fremder bzw. früherer Bestandteile bleiben separat erhalten.
- GPL-Lizenztext unverändert aus LICENSE.txt der installierten Bibliothek
  übernommen. SHA-256 dieses Textes: 8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903.
- Eigene Quelldateien und Tests mit SPDX-/Copyright-Hinweisen versehen;
  ursprüngliche Kartenherkunft in den zwei betroffenen Dateien dokumentiert.
- THIRD_PARTY_NOTICES.md ergänzt, einschließlich Autor, konkreter Versionen,
  Upstream-Links und Abgrenzung von eigenem und fremdem Code.
- Vollständige eigene TypeScript-Quellen, Tests, Build-Konfiguration und
  Lizenzdateien für das npm-Paket vorgesehen. Das vollständige Repository-
  Archiv enthält zusätzlich die Sperrdatei und den Test-Workflow.
- Eigenes PNG-Icon aus geometrischen Formen erstellt; kein Herstellerlogo
  und keine Bildvorlage eines anderen Adapters verwendet.

## Grenzen und verbleibende Veröffentlichungsschritte

Dies ist eine gezielte technische Herkunftsprüfung. Sie beweist weder die
vollständige ursprüngliche Entstehungsgeschichte noch prüft sie sämtliche
transitiven npm-Abhängigkeiten, Markenrechte oder Ecovacs-Vertragsbedingungen.
Von der Cloud gelieferte Gerätebilder sind externe Herstellerinhalte.

Vor dem öffentlichen Release: Repository mit Quellen bereitstellen,
Adapter-Checker und Integrationstests abschließen. Die getestete 0.10.107-tgz
bleibt unverändert; für ein späteres Installationspaket mit diesen Änderungen
ist eine neue Versionsnummer vorzusehen. Das vorbereitete Quellenarchiv
enthält noch die Basisversionsnummer 0.10.107 und ist kein neues Testrelease.

## Primärquellen

- MIT: https://opensource.org/license/mit
- GPLv3: https://www.gnu.org/licenses/gpl-3.0.html
- GPL-FAQ: https://www.gnu.org/licenses/gpl-faq.html#IfLibraryIsGPL
- https://github.com/mrbungle64/ioBroker.ecovacs-deebot
- https://github.com/helfi9999/ioBroker.ecovacs-map
- https://github.com/mrbungle64/ecovacs-deebot.js
