# Older changelog entries

### 0.10.110

- Retain legacy MQTT/XML and XMPP/XML support through included protocol sources with preserved licenses and documented local changes.
- Replace vulnerable HTTP/XML/WebSocket dependencies with updated versions; replace request with the maintained Cypress fork.
- Remove the unused native-canvas dependency; adapter maps continue to use the SVG renderer.
- Verify dependencies in a fresh consumer installation and add protocol compatibility/security checks.

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
