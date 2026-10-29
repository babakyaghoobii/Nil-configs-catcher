# NIL Config Catcher · نیل

<p align="center"><img src="public/branding/creator-logo-charcoal.png" alt="NIL — babakyaghoobii" width="240"></p>

**ایده‌پردازی، برنامه‌نویسی و ساخت توسط babakyaghoobii — رایگان برای استفادهٔ عموم.**

**Conceived, coded, and built by babakyaghoobii. Free for everyone to use.**

A mobile-first Persian RTL PWA that collects **up to 50 NEW unique, publicly shared VPN configuration URIs per run**. No fabricated entries, endpoint probing, remote code, paid APIs, or private subscriptions.

**Formats:** VLESS, VMess (base64 JSON v2), Trojan, Shadowsocks (SIP002 and legacy), Hysteria2 / hy2, and TUIC. Syntax validity does **not** imply that a server connects, is fast, or is trustworthy.

## Installation · نصب نسخهٔ دسکتاپ

نسخهٔ دسکتاپ یک برنامهٔ واقعی با رابطِ همراهِ خود برنامه است، نه میان‌بر مرورگر. در مک فایل `NIL Config Catcher.app` در **Applications** قرار می‌گیرد. در لینوکس فایل اجرایی، لانچر و ورودی منوی برنامه‌ها نصب می‌شود. برنامه با نام و نشان سازنده عرضه می‌شود و برای عموم رایگان است.

بسته‌های آماده در [GitHub Releases](https://github.com/babakyaghoobii/Nil-configs-catcher/releases) منتشر می‌شوند. **دستورهای زیر فقط برای تگی کار می‌کنند که بسته‌هایش واقعاً در Releases منتشر شده باشند. وجود دستور، به‌تنهایی تأیید انتشار نیست.** تا قبل از انتشار، از ساخت از سورس یا خروجی آزمایشی Actions استفاده کنید. لوگوی واقعیِ ارائه‌شده توسط سازنده در رابط، آیکون‌های وب و بسته‌های بومی استفاده می‌شود؛ [اصل چهار فایل](assets/branding/README.md) بدون تغییر در مخزن نگهداری می‌شود.

### macOS — Apple Silicon و Intel

نیازمند macOS 13 یا جدیدتر. نصب‌کننده معماری را تشخیص می‌دهد و فایل ZIP صحیح را می‌گیرد، SHA-256 و هویت بسته را بررسی می‌کند و **خود فایل `.app`** را در `/Applications` قرار می‌دهد. مرورگر، Node یا Rust برای اجرای نسخهٔ نصب‌شده لازم نیست.

تگ را از نسخه‌های واقعاً موجود در Releases انتخاب کنید:

```bash
NIL_VERSION=v1.0.0
NIL_RELEASE="https://github.com/babakyaghoobii/Nil-configs-catcher/releases/download/$NIL_VERSION"
nil_setup_dir="$(mktemp -d)"
cd "$nil_setup_dir"
curl --fail --location --proto '=https' --tlsv1.2 "$NIL_RELEASE/install.sh" -o install.sh
curl --fail --location --proto '=https' --tlsv1.2 "$NIL_RELEASE/SHA256SUMS" -o SHA256SUMS
awk '$2 == "install.sh" { print }' SHA256SUMS | shasum -a 256 -c - \
  && bash install.sh --version "$NIL_VERSION"
```

اگر نوشتن در `/Applications` مجاز نیست، پس از بررسی همان فایل نصب‌کننده، `bash install.sh --version "$NIL_VERSION" --user` را اجرا کنید؛ یک بستهٔ واقعی در `~/Applications/NIL Config Catcher.app` نصب می‌شود. اسکریپت خودکار `sudo` اجرا نمی‌کند و تنظیمات امنیتی سیستم را تغییر نمی‌دهد.

```bash
open "/Applications/NIL Config Catcher.app"
# نصب در پوشهٔ شخصی:
open "$HOME/Applications/NIL Config Catcher.app"
```

**امضای مک:** بسته‌ها برای صحت محتوا ad-hoc signed هستند؛ این با گواهی Apple Developer ID و notarization اپل فرق دارد. ممکن است برای اولین اجرا لازم باشد در System Settings → Privacy & Security اجرای برنامه را صریحاً تأیید کنید. نصب‌کننده Gatekeeper یا quarantine را غیرفعال نمی‌کند. اجرای واقعی روی همهٔ نسخه‌های macOS یا سخت‌افزار فیزیکی، صرفاً از موفقیت ساخت در CI نتیجه‌گیری نمی‌شود.

### Linux — x64 و arm64

لانچر و ورودی برنامه در `~/.local` نصب می‌شوند؛ نیاز به دسترسی ریشه ندارند. لانچر AppImage از حالت استخراج استفاده می‌کند و به FUSE وابسته نیست. بستهٔ x64 روی محیط Ubuntu 22.04 و arm64 روی Ubuntu 24.04 ساخته می‌شود؛ سازگاری glibc و WebKit/GTK توزیع مقصد همچنان لازم است. این به معنای پشتیبانی تضمینی از همهٔ توزیع‌های لینوکس نیست.

```bash
NIL_VERSION=v1.0.0
NIL_RELEASE="https://github.com/babakyaghoobii/Nil-configs-catcher/releases/download/$NIL_VERSION"
nil_setup_dir="$(mktemp -d)"
cd "$nil_setup_dir"
curl --fail --location --proto '=https' --tlsv1.2 "$NIL_RELEASE/install.sh" -o install.sh
curl --fail --location --proto '=https' --tlsv1.2 "$NIL_RELEASE/SHA256SUMS" -o SHA256SUMS
awk '$2 == "install.sh" { print }' SHA256SUMS | sha256sum -c - \
  && bash install.sh --version "$NIL_VERSION"
```

سپس **NIL Config Catcher** را از منوی برنامه‌ها باز کنید، یا اجرا کنید:

```bash
"$HOME/.local/bin/nil-config-catcher"
```

فایل اجرایی در `~/.local/lib/nil-config-catcher/` و ورودی منو در `~/.local/share/applications/io.github.babakyaghoobii.nil-config-catcher.desktop` قرار می‌گیرد. نصب در مسیر سفارشی با `--prefix /absolute/path` پشتیبانی می‌شود. همچنین بسته‌های `.deb` همان معماری در Releases ارائه می‌شوند؛ فایل DEB را نیز قبل از نصب با `SHA256SUMS` بررسی کنید و برای نصب وابستگی‌ها از `sudo apt install ./NIL-Config-Catcher-linux-x64.deb` یا فایل arm64 استفاده کنید. نصب DEB و AppImage دو روش جایگزین‌اند؛ لازم نیست هر دو را نصب کنید.

### به‌روزرسانی و حذف

برای ارتقا، برنامه را ببندید و همان روش دانلودِ بررسی‌شده را با تگ نسخهٔ جدید تکرار کنید. نصب‌کننده فقط فایل‌های برنامهٔ دارای هویت NIL را جایگزین می‌کند و نشان‌ها/داده‌های شخصی را حذف نمی‌کند.

```bash
# با نسخهٔ بررسی‌شدهٔ install.sh:
bash install.sh --uninstall
# اگر در ~/Applications نصب کرده‌اید:
bash install.sh --uninstall --user
# اگر در لینوکس مسیر سفارشی انتخاب کرده‌اید:
bash install.sh --uninstall --prefix /absolute/path
```

فایل‌های دانلودشده فقط از همین مخزن و از HTTPS گرفته می‌شوند؛ `latest` یک‌بار به تگ معتبر حل می‌شود تا فایل و checksum از نسخه‌های مختلف مخلوط نشوند. checksum صحت انتقال را بررسی می‌کند و جایگزین اعتماد به حساب منتشرکننده یا notarization اپل نیست. هیچ دستور `curl | bash`، حذف quarantine، اجرای URIهای VPN یا دریافت URL دلخواه در نصب‌کننده وجود ندارد.

### ساخت نسخهٔ دسکتاپ از سورس

Node.js 22+، Python 3.12+ و Rust **1.99.1** لازم‌اند. روی مک Xcode Command Line Tools و روی لینوکس وابستگی‌های [رسمی Tauri](https://v2.tauri.app/start/prerequisites/) نیز لازم است. فایل قفل Cargo و npm در مخزن نگهداری می‌شوند.

```bash
git clone https://github.com/babakyaghoobii/Nil-configs-catcher.git
cd Nil-configs-catcher
npm ci --ignore-scripts
rustup toolchain install 1.99.1 --profile minimal
npm run desktop:icons

# macOS:
npm run desktop:build -- --bundles app -- --locked
# Linux:
npm run desktop:build -- --bundles appimage,deb -- --locked
```

خروجی‌های واقعی در پوشهٔ `src-tauri/target/.../release/bundle/` قرار می‌گیرند. `npm run desktop:dev` برای توسعهٔ محلی است. `npm run test:desktop-ui` مسیرهای رابط و فراخوانی clipboard/ذخیرهٔ بومی را با IPC آزمایشی بررسی می‌کند؛ این با تست اجرای GUI روی سخت‌افزار واقعی یکی نیست. ورک‌فلوی [native desktop](.github/workflows/desktop-release.yml) چهار معماری را می‌سازد، نصب/حذف بسته‌های واقعی را در مسیر آزمایشی بررسی می‌کند، بستهٔ macOS و امضای ad-hoc را کنترل می‌کند و فقط پس از تکمیل همهٔ خروجی‌ها و تطبیق digestهای آپلودشده، release را منتشر می‌کند. ساخت موفق به‌تنهایی تأیید اجرای GUI روی همهٔ سیستم‌های مقصد نیست.

رابط دسکتاپ در بسته قرار دارد. دریافت دادهٔ تازه فقط از سه فایل JSON همین مخزن روی `raw.githubusercontent.com` انجام می‌شود؛ هنگام نبود شبکه، دادهٔ معتبر ذخیره‌شده یا snapshot همراه برنامه با برچسب آفلاین نمایش داده می‌شود. clipboard بومی فقط نوشتن متن دارد؛ خروجی با دیالوگ انتخاب فایل ذخیره می‌شود. هیچ مجوز shell، اجرای کانفیگ، خواندن clipboard یا دسترسی به مبدأهای وبِ دلخواه اعطا نشده است.

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

PNG and native icons are committed. Run `npm run icons` to regenerate all of them from the creator's supplied logo using the pinned Tauri CLI. No Pillow or external image service is required. Full-size originals remain in `assets/branding/`; only the smaller application assets are included in offline installation.

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
