ایده‌پردازی، برنامه‌نویسی و ساخت توسط **babakyaghoobii** — رایگان برای استفادهٔ عموم.

Conceived, coded, and built by **babakyaghoobii**. Free for everyone to use.

Native macOS application bundles and Linux AppImage/Debian packages, with the interface and an initial data snapshot included. These are native desktop applications, not browser shortcuts. Fresh public configuration data is read from this repository; cached data is labelled offline. VPN server connectivity is not tested.

Choose `macos-arm64` for Apple Silicon or `macos-x64` for Intel. Linux `x64` targets Ubuntu 22.04-era glibc; Linux `arm64` targets Ubuntu 24.04-era glibc. The AppImage launcher uses extraction mode and does not require FUSE. System WebKit/GTK compatibility still depends on the distribution.

All files have SHA-256 digests in `SHA256SUMS`. Follow the README's verified-download instructions; do not pipe a fetched script straight into a shell.

**macOS:** bundles are ad-hoc signed for integrity, not Apple Developer ID signed or Apple-notarized. Gatekeeper may require an explicit first-open approval in System Settings. No security controls are disabled by the installer.
