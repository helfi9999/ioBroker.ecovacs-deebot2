# Ecovacs Deebot 2

An ioBroker adapter for controlling multiple Ecovacs DEEBOT robots through one cloud account, with maps and room controls in the same adapter. Manufacturer: [Ecovacs](https://www.ecovacs.com/).

## Release status

Version 0.10.107 has been tested by the project owner, including custom-area interaction and cleaning history. This does not establish compatibility with every model. Additional testers are welcome. The project is being prepared for public distribution; inclusion in the ioBroker Latest repository is not yet confirmed.

## Features

- Separate device trees and connections for multiple robots in one instance.
- Whole-home, room, room-group and custom-area cleaning, with pause, resume, stop and return-to-station commands where supported.
- Cleaning settings such as suction, water and cleaning mode, depending on model feedback.
- SVG and HTML maps with rooms, robot and station positions, map rotation and cleaning trails.
- Clickable room selection and movable/resizable custom-area rectangles in compatible VIS environments.
- Writable local room names and room groups.
- Multiple stored floor maps when supplied by the robot.
- Combined live report and persistent cleaning history.
- Model-dependent battery, consumables, cleaning statistics, device and station information, water warnings and other settings.
- Ecovacs e-mail verification and session renewal after rejected authentication tokens.

Only data supplied by a model can be displayed. Station activity, cleaning phases and history may require additional validation on other models. Water warnings are status/error reports, not a measured tank percentage.

## Requirements and setup

The current package requires Node.js 20 or later, js-controller 5 or later and Admin 6 or later. The prepared CI workflow targets Node.js 22 and 24.

Configure the Ecovacs account, two-letter country code and continent in the instance settings. If `auth.status` reports `verificationRequired`, enter the Ecovacs e-mail code in the adapter settings and save. Keep the configured or automatically derived client ID unchanged after verification.

The adapter communicates through the Ecovacs cloud using the `ecovacs-deebot` library. An internet connection and a working Ecovacs account are required.

## Objects and maps

Each robot has its own tree under `devices.<robot-name>`:

| Channel | Purpose |
| --- | --- |
| `info` | Device details and model-dependent telemetry |
| `status` | Detection and compatibility information |
| `control` | Cleaning commands and settings |
| `rooms` | Rooms of the displayed map, names, groups and selection |
| `customArea` | Custom-area coordinates, display and start command |
| `map` | SVG/HTML map and floor selection |
| `history` | Current report and stored events |
| `appearance` | Map appearance settings |

Use `devices.<robot>.map.html` for the interactive HTML map in a compatible VIS HTML widget. Select rooms on the map or through their `selected` states, then use the appropriate cleaning control. Custom-area editing uses `customArea.active` and `customArea.values`.

Use `map.multiFloor.selectedId` to select the map **displayed by the adapter**. An empty value follows the latest map automatically. `map.multiFloor.list` lists known maps. The selected ID does not issue a physical floor-switch, restore or overwrite command to the robot. Move the robot to the desired floor and let it localize as required by its model. The expert `map.floors` objects retain individual map snapshots; ordinary room controls are under `rooms`.

`history.current` contains the current live report; `history.events` contains the stored event list. History describes reported or inferred transitions, with availability and accuracy depending on the robot's telemetry.

## Testing and feedback

For reports, include the adapter version, robot model, cleaning mode, whether the command came from ioBroker or the Ecovacs app, and the event sequence annotated with actual behavior. Remove account credentials, tokens and personal information before sharing exports.

## Development

```bash
npm ci
npm test
npm run pack:adapter
```

`npm test` compiles TypeScript and runs the Node.js test suite. `npm run test:package` validates package metadata and Admin configuration against ioBroker schemas. `npm run test:integration` installs the adapter with a real js-controller and checks startup without credentials. The GitHub workflow runs these checks on Linux with Node.js 22 and 24. Hardware and model-specific behavior still require practical testing.

See [publication preparation](docs/PUBLISHING.md) for the remaining release requirements.

## Changelog

### 0.10.109

- Restore the adapter-level cloud connection indicator required by ioBroker, alongside individual robot connections.
- Wait for account configuration on fresh installations without contacting the cloud.
- Correct the placement of encrypted/protected configuration fields and update license metadata to the current schema.
- Add ioBroker package validation, installation/startup tests and CI commands.


### 0.10.108

- Catch MQTT disconnect failures, including upstream rejection with `false`, even when initiated internally by the library after an authentication error.
- Close remaining MQTT sockets and report robot-specific warnings instead of leaving the rejection unhandled.
- Include the publication license notices, source files and original project icon prepared after 0.10.107.


### 0.10.107

- Prevent vacuum-only station feedback and installed mop hardware from being interpreted as a water cycle or a switch to mopping.
- Preserve explicit dust-emptying reports.
- Project owner subsequently confirmed custom-area operation and history appear to work in practice.

Earlier development versions introduced multi-robot control, map rendering, room and custom-area controls, multi-floor display and cloud-session recovery.

## License and acknowledgements

Copyright (c) 2026 Thomas H. (helfi9999). Distributed under **GPL-3.0-only**;
see [LICENSE](LICENSE). Original MIT notices for the earlier map project and
the Ecovacs adapter reference are preserved in [licenses](licenses).

This adapter uses Sascha Hölzel's GPL-licensed `ecovacs-deebot.js` library.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for component origins,
retained notices, source availability and the original project icon.

This is an independent community project, not an official Ecovacs product.
