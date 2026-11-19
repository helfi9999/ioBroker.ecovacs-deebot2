# Included legacy protocol sources

These are modified, private source copies, not new releases by their upstream
maintainers. PROVENANCE.json records the original and distributed SHA-256
hashes of every included upstream file. The original npm archives used for
comparison were ecovacs-deebot 0.9.6-beta.12, simple-xmpp 2.3.1 and
node-xmpp-client 3.2.0.

- ecovacs-deebot: GPLv3, Copyright (c) 2025 Sascha Hölzel; original README,
  LICENSE.txt, model catalogue, countries and public protocol certificate retained.
- simple-xmpp: MIT, Copyright (c) 2011 Arunoda Susiripala; original source notice
  also reproduced as LICENSE.
- node-xmpp-client: MIT as declared upstream. Package metadata and source notices
  retained. Its npm archive has no standalone copyright notice; LICENSE
  reproduces the declared MIT terms without assigning a new individual owner.

Local changes:

1. The Ecovacs XML transport imports the included simple-xmpp source.
2. simple-xmpp imports the included node-xmpp-client source.
3. The client's BOSH implementation uses @cypress/request instead of request.
4. Package metadata reflects the updated dependencies, is marked private and
   omits upstream development/publish scripts.
5. The SDK's optional native-canvas raster renderer is disabled. This adapter
   uses its own SVG renderer; raw room geometry and map data remain available.

No protocol stack has been removed. The code for MQTT/XML, XMPP/XML and
MQTT/JSON remains included. The model catalogue retains the original model
information; retaining a catalogue entry is not a hardware compatibility claim.

The adapter's root package.json declares the actual, updated dependencies.
Runtime corrections do not depend on root-only npm overrides or edits to a
user's node_modules. Browser bundles, examples and unused upstream logo assets
are not included. See ../THIRD_PARTY_NOTICES.md and ../docs/DEPENDENCY_SECURITY.md.

## Node.js built-in module imports

On 2026-11-18, imports of Node.js built-in modules in 10 included
vendor JavaScript files were updated to use explicit `node:` prefixes.

Affected modules include crypto, fs, events, path, url, tls,
child_process and buffer.

This change does not intentionally alter the Ecovacs or XMPP
protocol logic. The original upstream SHA-256 values remain
unchanged in PROVENANCE.json; the distributed SHA-256 values
were updated for the affected files.

Compatibility must be verified through the adapter's automated
tests and subsequent hardware testing.
