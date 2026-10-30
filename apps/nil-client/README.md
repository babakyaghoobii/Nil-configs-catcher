# NIL client integration · babakyaghoobii

This directory contains the NIL-authored public-config synchronization module and its host integration. The existing **NIL Config Catcher desktop release is a configuration index, not a VPN tunnel client**.

`lib/nil_catcher_service.dart` is a dependency-free Dart module. It fetches only the configured NIL HTTPS service, validates coherent batches, preserves prior data after failure, coalesces duplicate requests, and updates a stable NIL subscription through the host application's profile repository. It never uploads private profiles or executes configuration content. The host integration requests a two-hour subscription interval and synchronizes while the app is active and on resume; mobile operating systems can suspend background work.

`integration/nil_catcher_feature.dart.in` is the Flutter host integration template. It adds the catcher inside the main client and calls the real profile repository's `upsertRemote`; it is not a browser VPN implementation. Its final native build/integration is not yet verified.

## Tests

With Dart 3.10.4 or compatible:

```sh
dart --suppress-analytics format --output=none --set-exit-if-changed lib test
dart --suppress-analytics analyze lib test
dart test/bridge_test.dart
```

The 14 bridge tests exercise validation, stable subscription updates, changed datasets, failures, manual collection, concurrent taps, queued work and lifecycle polling. They **do not test a VPN tunnel, actual latency, platform permissions or installation**. Local Dart execution and formatting passed; the cloud workspace's read-only home directory blocks the analysis server's state directory. CI must complete static analysis on a writable runner before release.

## Main client prerequisite

The reviewed full-featured base is Hiddify App **v4.1.1**, commit `abbd671bf6bf05195acd4158c714bff267cada8f`. Its [license](https://github.com/hiddify/hiddify-app/blob/abbd671bf6bf05195acd4158c714bff267cada8f/LICENSE.md) requires an actual GitHub fork and preserving the source and upstream attribution. The intended independent NIL edition must preserve those notices, use the original NIL logo and its own interface, and identify babakyaghoobii as the NIL edition's creator. This repository does not claim ownership of the upstream engine.

The GitHub integration's fork-creation request returned **403 Resource not accessible by integration**. The owner has been asked to create `babakyaghoobii/Nil-Proxy` as an actual fork and add it to the installed connector's allowed repositories. No fork or finished NIL VPN binary has been fabricated.

After that prerequisite, integrate this module, complete the NIL native interface and branding, audit upstream networking/telemetry, build the real Windows/macOS/Android applications through GitHub Actions, and verify native imports, tunnel lifecycle, routing, DNS, URL tests and profile updates before publishing. Native installation packages must identify their actual signing status. The existing catcher packages must never be relabelled as completed VPN clients.

The owner currently has no Apple Developer membership. An installable signed iOS VPN requires the owner's Apple signing and Network Extension entitlements; no iOS VPN installation or App Store publication is claimed. Freshness alone does not prove the lowest ping: only actual per-device proxy tests can choose the best measured reachable server.

Builds use the trusted public `NIL_API_ORIGIN` Dart define to point at the deployed service. No API token, private subscription, keystore or Apple signing key belongs in this public directory.
