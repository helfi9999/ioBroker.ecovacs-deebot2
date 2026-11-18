# Dependency security: 0.10.110

Review date: 2026-11-17. This version is a test candidate, not a completed
hardware validation or an ioBroker repository approval.

## Changes

The old SDK version is retained as included source because the current upstream
1.0 alpha removes the XML protocols required by older robots. A direct upgrade
would remove model support. Original licenses and source attribution are
preserved under vendor and THIRD_PARTY_NOTICES.md.

The adapter now declares its actual dependencies directly, including:

| Component | Selected version |
| --- | --- |
| Axios | 1.21.1 |
| @xmldom/xmldom | 0.9.12 |
| @cypress/request, replacing request | 4.0.1 |
| ws | 8.23.0 |
| Mocha, development only | 12.0.3 |

The native-canvas raster renderer is not used by this adapter and has been
disabled in the included source. The adapter's SVG renderer and raw map/room
geometry are retained. This removes the old optional native canvas installer
and its archive dependency from this adapter's runtime installation.

A development-only override pins updated glob/minimatch/node-forge versions for
the test tools. Runtime fixes do not depend on these overrides. A prototype
using overrides and npm-shrinkwrap was rejected after a clean consumer
installation selected the old dependencies again. No shrinkwrap is distributed.

## Evidence

- Original runtime audit: 15 affected package entries, including 3 rated critical.
  These counts include indirect/aggregated entries and are not 15 demonstrated
  exploits in the adapter.
- Updated development tree: npm audit reports zero vulnerabilities.
- Fresh consumer installation from the packed adapter, without dev dependencies
  and without consumer overrides: npm audit reports zero vulnerabilities.
- Updated runtime modules resolve inside the consumer installation, not from
  the development workspace.
- 50 behavior/protocol tests pass, including real XML conversion, local BOSH
  POSTs, WebSocket stanzas, CDATA injection rejection and HTTP redirect handling.
- Model routing test retains DEEBOT 900, legacy XMPP/N79 and modern T30 routes.
  The host identifier is synthetic in that offline test; it proves module
  availability and routing, not robot/cloud connectivity.
- Package validation: 50 checks passed. Local schema-download timeouts were
  transient; the official schema was also validated independently.

## Remaining checks before publication

Run the new GitHub workflow against 0.10.110, including the real controller
startup test and transport-construction test. Confirm account login, maps,
room/custom-area commands and station reports on actual robots, especially
Luna and Sky. The older green workflow covered 0.10.109, not these changes.

The consumer test installs with npm --ignore-scripts to inspect and exercise the
JavaScript package without unrelated host installation scripts. Actual ioBroker
installation/startup remains covered separately by the GitHub integration test.

Audit results depend on the registry's advisory data at the review date. They
are not a proof of absence of vulnerabilities, a penetration test, or a claim
about dependencies of other adapters on an existing ioBroker server. Some
retained XMPP support packages are deprecated despite having no reported audit
findings in the checked tree; replacement with a new protocol implementation
would require separate development and hardware tests.
