# Copyright, licensing and upstream acknowledgements

## This project

ioBroker.ecovacs-deebot2: Copyright (c) 2026 Thomas H. (GitHub: helfi9999).
The project is distributed under the GNU General Public License version 3 only
(SPDX: GPL-3.0-only). The complete text is in LICENSE. This applies to this
project's implementation and its original geometric robot icon; it does not
replace the original notices or licenses of third-party components.

Before public release, local development versions declared MIT. The original
notice for that development code is retained in
licenses/PROJECT-MIT-before-publication.txt. This release preparation does not
revoke permissions already granted for previous copies.

## ioBroker.ecovacs-map

Source: https://github.com/helfi9999/ioBroker.ecovacs-map
Reviewed local version: 0.8.0.
Copyright (c) 2026 Helfi9999 <helfi9999@gmail.com>.
Original license: MIT; complete notice retained in
licenses/ioBroker.ecovacs-map-MIT.txt.

The new adapter integrates map functionality from this earlier project.
The comparison found shared code sequences in src/map/SvgRenderer.ts and
src/ioBroker/StateProjector.ts. Preserve the original MIT notice for those
portions when redistributing, alongside the GPL terms for this project.

## ioBroker.ecovacs-deebot

Source: https://github.com/mrbungle64/ioBroker.ecovacs-deebot
Reviewed local version: 1.4.16-alpha.7.
Copyright (c) 2024 Sascha Hölzel <mrb1232@posteo.de>.
Original license: MIT; complete notice retained in
licenses/ioBroker.ecovacs-deebot-MIT.txt.

This adapter was consulted as a reference for device support and functionality.
The automated comparison did not establish direct source copying. Its MIT
notice is retained conservatively for any adapted portions; this does not
claim authorship of its code or assert that its complete implementation is
included. Its icon is not included or referenced by this project anymore.

## ecovacs-deebot.js library

Source: https://github.com/mrbungle64/ecovacs-deebot.js
npm package: ecovacs-deebot, pinned version 0.9.6-beta.12.
Copyright (c) 2025 Sascha Hölzel <mrb1232@posteo.de>, as stated in that
version's README. Package metadata declares GPL-3.0; LICENSE.txt contains GPLv3.

The adapter imports and calls this library directly, including its model
catalogue. The dependency is installed separately by npm; its files and
original notices must remain intact. This project does not relicense it as MIT.
Protocol research is credited upstream to wpietri:
https://github.com/wpietri/sucks/blob/master/protocol.md.

Other npm dependencies retain their own licenses and notices in their packages.
This file is a targeted provenance record, not a certification of all
transitive dependencies or rights in cloud-served content.

## Source availability and assets

The npm package includes src, tests and tsconfig.json. The repository and
source archive also include package-lock.json; build with
npm ci followed by npm run build from the complete repository. The prepared
public source location is https://github.com/helfi9999/ioBroker.ecovacs-deebot2.
Do not publish binary-only builds without the corresponding source and build
instructions required by GPLv3.

admin/ecovacs-deebot2.png was drawn for this project using simple geometric
shapes. It does not use an Ecovacs logo or the original adapter icon.
Robot images supplied by the Ecovacs cloud remain external manufacturer
content, not assets licensed by this project. This is an independent community
project and does not imply endorsement by Ecovacs or upstream maintainers.
