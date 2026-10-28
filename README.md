# NIL Config Catcher · نیل

A mobile-first Persian RTL PWA that collects **up to 50 NEW unique, publicly shared VPN configuration URIs per run**. No fabricated entries, endpoint probing, remote code, paid APIs, or private subscriptions.

**Formats:** VLESS, VMess (base64 JSON v2), Trojan, Shadowsocks (SIP002 and legacy), Hysteria2 / hy2, and TUIC. Syntax validity does **not** imply that a server connects, is fast, or is trustworthy.

## Local development and verification

Requires Node.js 22+ and Python 3.12+. The collector has **no third-party Python dependencies**.

```bash
npm ci --ignore-scripts
npm run dev
```

```bash
npm test                  # Parsing, collection, retention and security tests
npm run collect           # Actually fetch configured public source files
npm run build             # Typecheck, production assets and offline worker
npx playwright install --with-deps chromium webkit
npm run test:e2e           # Desktop Chromium + iPhone 16-size WebKit
```

Production preview, mounted at the Pages subpath:

```bash
node scripts/serve.mjs
# http://localhost:4173/Nil-configs-catcher/
```

PNG icons are committed. Optional regeneration: install Pillow in your development environment, then run `python3 scripts/generate-icons.py`. Pillow is not required for collection, testing, build or deployment.

## Dashboard

- Locally bundled Persian typography, RTL layout, mobile bottom navigation, safe-area support and 44px primary mobile touch targets. Tested at 393×852 (iPhone 16 viewport) in WebKit and on desktop Chromium.
- All six protocol filters, host/name/source search, sorting, and incremental rendering of the latest **1,000** configs.
- Copy the original URI, native sharing with clipboard fallback, and UTF-8 plain-text export of **all filtered results**, including those not yet rendered.
- Browser-local bookmarks, source reports, last refresh outcome, a stale-data notice after 4.5 hours, and 120 recent run reports.
- PWA manifest, Apple touch/maskable icons, Safari installation instructions, versioned local asset caching, and network-first data with explicit offline indicators.

**Browser refresh downloads published JSON; it does not start collection or trigger Actions.** Installation happens through the browser. Bookmarks do not sync; a record outside the latest 1,000-record window disappears from the dashboard but remains in the repository archive.

## Configurable sources

Edit [`sources.json`](sources.json), commit, and run the collection workflow or wait for its schedule. Sources are GitHub file references, **never arbitrary fetch URLs**:

```json
{
  "id": "my-public-source",
  "name": "Public source name",
  "owner": "github-owner",
  "repo": "public-repository",
  "ref": "main",
  "path": "subscriptions/configs.txt",
  "enabled": true
}
```

Configure 1–20 sources with unique IDs and at least one enabled entry. Identity fields accept ASCII letters, digits, `_`, `-`, and `.` and cannot start with `.`. Path segments use those same characters; `.` / `..` segments, URL schemes, percent escapes, queries, backslashes and arbitrary hosts are rejected. Use a simple branch/tag name or full commit SHA for `ref`; branches containing `/` are intentionally unsupported. A SHA pins source contents.

Default public sources are files in `mahdibland/V2RayAggregator` and `peasoft/NoMoreWalls`. Disappearing, blocked or stale sources are reported without replacing their data with invented entries. Plaintext/Markdown URI lists and whole-file base64 subscriptions are accepted. Remote includes and Clash YAML are not followed or executed.

### Collection and retention rules

1. Fetch **HTTPS raw.githubusercontent.com** only, with verified TLS, inherited proxy settings and **no redirects**, including redirects to another GitHub URL.
2. Bound each response to 4 MiB, each socket operation to 20 seconds and each source to a 30-second wall-clock budget checked between reads (an in-progress socket read may add up to its timeout). Limit each source to 20,000 candidates and bound URI/base64 lengths. Compressed responses are refused.
3. Validate protocol credentials/UUIDs, authorities, ports, hostname/IPv4/IPv6 syntax and encoding. Reject malformed base64/percent encoding, control characters, duplicate JSON keys, ambiguous duplicate query parameters and unsupported formats.
4. Hash canonical data using SHA-256. Ignore labels/VMess `ps`, query ordering, host casing and supported base64/SS representation variations. Credentials and transport parameters remain part of identity. This is syntactic canonicalization, not universal semantic equivalence across VPN clients.
5. Interleave sources and accept at most 50 IDs absent from the **permanent** seen registry. Excess new entries are deferred. A run with two new entries writes two; a run with none writes zero.
6. Store UTC `firstSeenAt`, protocol and source provenance; append monthly archives, publish the newest 1,000 configs and retain 120 run reports. Git history retains earlier reports.

Atomic local file replacements are committed together by a single scheduled writer. A total fetch failure preserves previous configs and the last successful timestamp, records failure and exits nonzero. Partial failures retain successful-source data and explicitly report `partial`. A successful zero-entry run is distinct from a failure.

| Path | Purpose |
| --- | --- |
| `sources.json` | Editable source allowlist |
| `data/seen.json` | Permanent canonical SHA-256 registry |
| `data/archive/YYYY-MM.json` | All accepted configs, grouped by first-seen month |
| `public/data/configs.json` | Latest 1,000 records for the dashboard |
| `public/data/status.json` | Actual latest outcome, counters, timestamps and source reports |
| `public/data/history.json` | Latest 120 run reports |

Archives/registry grow over time; monitor repository size for long-running installations. Deleting the registry permits historical entries to be accepted again. Public VPN URIs include credentials **already published upstream**. Never add private subscriptions, API tokens, `.env` files, or personal credentials.

## GitHub Actions and Pages

[`ci-pages.yml`](.github/workflows/ci-pages.yml) runs Python tests, TypeScript checking, production build and desktop/WebKit browser tests. Pull requests only verify. Pushes to `main` and manual runs also upload and deploy the verified Pages artifact. Permissions are scoped: contents read for verification, Pages write and OIDC only for deployment.

[`collect.yml`](.github/workflows/collect.yml) runs at **minute 17 every two hours, UTC** (`17 */2 * * *`) and supports manual dispatch with a 1–50 limit. GitHub scheduling is best effort, may be delayed and can be disabled after prolonged public-repository inactivity. Actions must be enabled and `GITHUB_TOKEN` needs contents write permission. Branch protection may require adapting the commit step.

Collection commits with `GITHUB_TOKEN`, rebases and pushes **without force**. Those token pushes **do not trigger another push workflow**, so collection explicitly calls the reusable verification/deployment workflow at the exact collected commit. It also attempts to publish written failure status while preserving a failed collection check. A concurrency group prevents overlapping collectors.

Choose **Settings → Pages → Build and deployment → Source → GitHub Actions**. The workflow also attempts enablement where its token permits it. No PAT or repository secret is needed. If automatic enablement is forbidden, an administrator must select that source once. Organization policy and environment protection can block deployment.

The conventional destination is `https://babakyaghoobii.github.io/Nil-configs-catcher/`. **An expected address is not evidence of deployment.** Verify a successful deployment job and HTTP response before calling it live. See [actual Actions runs](https://github.com/babakyaghoobii/Nil-configs-catcher/actions).

## Security and limits

- Config endpoint addresses are never contacted, resolved, imported, evaluated or passed to a shell. The dashboard has no arbitrary URL fetch feature. Upstream content is parsed as data only.
- Same-origin CSP, no CDN scripts/fonts, no analytics, escaped dynamic text, protocol-restricted data, restricted GitHub links and no embedded access token. Clipboard/share failures are surfaced.
- Cached data is identified as offline; it is not claimed to be fresh. The service worker is scoped to this repository path.
- Synthetic `example.com` fixtures are confined to test code. Published configs come only from actual source retrieval.
- WebKit tests emulate iPhone 16 viewport/touch behavior; they do not replace physical-device checks of installation, clipboard permissions or native share sheets.
- This is a public configuration index, not a VPN client. It does not test availability, latency or server privacy, or evaluate upstream publication rights.

## Layout

`src/`: TypeScript UI. `collector/`: standard-library Python pipeline. `scripts/`: cache generation, optional icon generation and local preview. `tests/`: parsing, security boundaries, retention and browser flows. No paid service or third-party account is required at runtime.
