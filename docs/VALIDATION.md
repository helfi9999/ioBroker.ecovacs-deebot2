# Local validation

Date: 2026-10-21

- `npm test`: 41 tests passed, zero failures (includes TypeScript compilation).
- `npm pack --dry-run --json`: passed; required TypeScript sources, retained MIT notices, full GPLv3 text, build configuration and original icon are present.
- License metadata matches across package.json, io-package.json and package-lock.json. Preserved license texts match their local upstream copies byte for byte.
- License/provenance details and limitations: LICENSE_REVIEW.md.
- Robot control behavior and base package version remain unchanged from 0.10.107; source headers and publication metadata were updated.
- Hardware behavior was reported working by the project owner; it was not independently retested during this preparation.
- GitHub Actions, public adapter checker and ioBroker installation/startup integration checks have not yet been run.

Do not interpret this local result as approval for the Latest repository. See PUBLISHING.md for remaining prerequisites.

## 0.10.108 – 2026-11-15

- TypeScript build and 43 tests passed.
- Reproduced upstream fire-and-forget `disconnect()` rejecting with `false`;
  the scoped transport guard handles it and forces the remaining MQTT client closed.
- Successful disconnect results and ordinary Error failures are also tested.
- This reproduces a matching library failure path; the supplied production log
  has no stack, so the original incident cannot be attributed with certainty.
- Robot hardware and production authentication recovery require a user retest.

## 0.10.109 – 2026-11-17

- Existing TypeScript and behavior suite: 43 tests passed.
- @iobroker/testing package/schema checks: 50 passed.
- Native encryption/protection lists are at the schema-required root level;
  licenseInformation replaces the older common.license declaration.
- ioBroker installation/startup test and CI commands added. Its local run is
  BLOCKED before adapter startup: the controller setup fails while reading
  network interfaces (`uv_interface_addresses` / `os.networkInterfaces`).
  An earlier missing database module was a consequence of that failed setup,
  not a verified adapter dependency defect. No integration success is claimed.
- GitHub API returned 404 for the proposed public repository. Public checker,
  GitHub Actions and npm publication are still pending.

## Checker metadata corrections – 2026-11-17

- Added common.keywords and raised the controller minimum to 5.0.19.
- Added recommended translations for titleLang, desc and all existing news entries.
- Declared common.nogit because the npm package contains compiled JavaScript
  under build, while GitHub holds the TypeScript source. The public checker
  supports this distribution mode. No missing entry point was substituted.
- npm publication and Latest inclusion remain pending; the checker’s external
  repository-list 404 cannot be repaired through this adapter’s metadata.

## 0.10.110 – dependency hardening, 2026-11-17

- Retained legacy sources; direct updated runtime dependencies and license/hash
  provenance added. No dependency override is needed by the installed consumer.
- Development npm audit: zero vulnerabilities.
- Fresh packed consumer npm audit: zero vulnerabilities.
- 50 behavior/protocol checks and 50 package checks passed locally.
- Consumer tests exercise packaged files; controller startup and real robot
  behavior on this version remain pending. See DEPENDENCY_SECURITY.md.
