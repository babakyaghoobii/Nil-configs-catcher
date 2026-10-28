#!/usr/bin/env bash
# First-party release installer. Downloads only this repository's HTTPS assets.
# No curl|bash, sudo, quarantine removal, shell evaluation, or VPN URI execution.
set -euo pipefail

REPOSITORY="babakyaghoobii/Nil-configs-catcher"
APP_ID="io.github.babakyaghoobii.nil-config-catcher"
APP_NAME="NIL Config Catcher.app"
VERSION="latest"
USER_INSTALL=0
REMOVE=0
PREFIX="${HOME}/.local"
APP_DIRECTORY="/Applications"
STAGE=""

fail() { printf 'NIL: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'USAGE'
NIL Config Catcher — babakyaghoobii · Free for everyone
Usage: bash install.sh [--version v1.0.0] [--user] [--uninstall]
  macOS: installs a real .app in /Applications (--user: ~/Applications).
  Linux: installs an AppImage, launcher and application-menu entry in ~/.local.
  --prefix DIR     Linux installation prefix (absolute path).
  --app-dir DIR    macOS Applications directory (absolute path).
  --uninstall      Remove managed application files; keep personal app data.
  --help           Show this help.
USAGE
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) [ "$#" -ge 2 ] || fail '--version needs a value'; VERSION="$2"; shift 2 ;;
    --user) USER_INSTALL=1; shift ;;
    --prefix) [ "$#" -ge 2 ] || fail '--prefix needs a directory'; PREFIX="$2"; shift 2 ;;
    --app-dir) [ "$#" -ge 2 ] || fail '--app-dir needs a directory'; APP_DIRECTORY="$2"; shift 2 ;;
    --uninstall) REMOVE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done

valid_version() { [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; }
[ "$VERSION" = latest ] || valid_version "$VERSION" || fail 'Use a release tag such as v1.0.0'
OS="$(uname -s)"
CPU="$(uname -m)"
case "$CPU" in arm64|aarch64) ARCH=arm64 ;; x86_64|amd64) ARCH=x64 ;; *) fail "Unsupported architecture: $CPU" ;; esac
case "$OS" in
  Darwin)
    [ "$USER_INSTALL" -eq 0 ] || APP_DIRECTORY="${HOME}/Applications"
    TARGET="${APP_DIRECTORY}/${APP_NAME}"
    ASSET="NIL-Config-Catcher-macos-${ARCH}.zip"
    ;;
  Linux)
    TARGET="${PREFIX}/lib/nil-config-catcher"
    ASSET="NIL-Config-Catcher-linux-${ARCH}.AppImage"
    ;;
  *) fail 'Only macOS and Linux are supported' ;;
esac
for destination in "$PREFIX" "$APP_DIRECTORY"; do
  [[ "$destination" = /* && "$destination" != / && "$destination" != *$'\n'* && "$destination" != *$'\r'* ]] || fail 'Installation directories must be non-root absolute paths without newlines'
done

verify_owner() {
  if [ "$OS" = Darwin ]; then
    [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TARGET/Contents/Info.plist" 2>/dev/null)" = "$APP_ID" ] || fail "Refusing to replace or remove a different app: $TARGET"
  else
    [ ! -L "$TARGET" ] && [ -f "$TARGET/.nil-owned" ] && [ "$(cat "$TARGET/.nil-owned")" = "$APP_ID" ] || fail "Refusing to replace or remove an unmanaged directory: $TARGET"
  fi
}

if [ "$REMOVE" -eq 1 ]; then
  [ -e "$TARGET" ] || { printf 'NIL is not installed at %s\n' "$TARGET"; exit 0; }
  verify_owner
  rm -rf -- "$TARGET"
  if [ "$OS" = Linux ]; then
    for managed in "$PREFIX/bin/nil-config-catcher" "$PREFIX/share/applications/${APP_ID}.desktop"; do
      if [ -f "$managed" ] && grep -Fq "$APP_ID" "$managed"; then rm -f -- "$managed"; fi
    done
  fi
  printf 'Removed %s. Personal application data was preserved.\n' "$TARGET"
  exit 0
fi

for tool in curl mktemp awk od cp mv; do command -v "$tool" >/dev/null 2>&1 || fail "Required utility not found: $tool"; done
if command -v sha256sum >/dev/null 2>&1; then
  digest() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  digest() { shasum -a 256 "$1" | awk '{print $1}'; }
else fail 'SHA-256 verification requires sha256sum or shasum'; fi

TEMP="$(mktemp -d "${TMPDIR:-/tmp}/nil-install.XXXXXXXX")"
cleanup() {
  rm -rf -- "$TEMP"
  if [ -n "$STAGE" ]; then rm -rf -- "$STAGE"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fetch() {
  curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' --tlsv1.2 --max-redirs 5 --connect-timeout 15 --max-time 600 --output "$2" "$1"
}
if [ "$VERSION" = latest ]; then
  # Resolve once so a concurrent new release cannot mix checksums and binaries.
  resolved="$(curl --fail --head --location --silent --show-error --proto '=https' --proto-redir '=https' --tlsv1.2 --max-redirs 5 --max-time 30 --output /dev/null --write-out '%{url_effective}' "https://github.com/${REPOSITORY}/releases/latest")"
  release_prefix="https://github.com/${REPOSITORY}/releases/tag/"
  [[ "$resolved" = "$release_prefix"* ]] || fail 'Unexpected release destination'
  VERSION="${resolved#"$release_prefix"}"
  valid_version "$VERSION" || fail 'Unexpected release tag'
fi
BASE="https://github.com/${REPOSITORY}/releases/download/${VERSION}"
printf 'Downloading NIL %s for %s/%s…\n' "$VERSION" "$OS" "$ARCH"
fetch "$BASE/SHA256SUMS" "$TEMP/SHA256SUMS"
fetch "$BASE/$ASSET" "$TEMP/$ASSET"
verify_download() {
  local name="$1" expected actual
  expected="$(awk -v wanted="$name" 'NF == 2 && $2 == wanted && length($1) == 64 && $1 ~ /^[0-9a-f]+$/ {print $1}' "$TEMP/SHA256SUMS")"
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail "Missing or ambiguous checksum for $name"
  actual="$(digest "$TEMP/$name")"
  [ "$actual" = "$expected" ] || fail "SHA-256 mismatch for $name; nothing was installed"
}
verify_download "$ASSET"

if [ "$OS" = Darwin ]; then
  for tool in ditto unzip codesign; do command -v "$tool" >/dev/null 2>&1 || fail "Required macOS utility not found: $tool"; done
  unzip -Z1 "$TEMP/$ASSET" > "$TEMP/entries"
  while IFS= read -r entry; do
    case "/$entry/" in */../*|*/./*) fail 'Unsafe archive path' ;; esac
    case "$entry" in "$APP_NAME"|"$APP_NAME/"*|__MACOSX/|__MACOSX/*) ;; *) fail "Unexpected archive entry: $entry" ;; esac
  done < "$TEMP/entries"
  ditto -x -k "$TEMP/$ASSET" "$TEMP/unpacked"
  SOURCE="$TEMP/unpacked/$APP_NAME"
  [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$SOURCE/Contents/Info.plist")" = "$APP_ID" ] || fail 'Incorrect application identity'
  codesign --verify --deep --strict "$SOURCE" || fail 'The app signature is damaged'
  mkdir -p "$APP_DIRECTORY" 2>/dev/null || fail 'Applications is not writable; rerun with --user for ~/Applications'
  [ -w "$APP_DIRECTORY" ] || fail 'Applications is not writable; rerun with --user for ~/Applications'
  [ ! -e "$TARGET" ] || verify_owner
  STAGE="$(mktemp -d "$APP_DIRECTORY/.nil-install.XXXXXXXX")"
  ditto "$SOURCE" "$STAGE/$APP_NAME"
  if [ -e "$TARGET" ]; then mv "$TARGET" "$STAGE/previous.app"; fi
  if ! mv "$STAGE/$APP_NAME" "$TARGET"; then
    if [ -e "$STAGE/previous.app" ]; then
      if ! mv "$STAGE/previous.app" "$TARGET"; then
        printf 'Previous app preserved at %s/previous.app\n' "$STAGE" >&2
        STAGE=""
      fi
    fi
    fail 'Could not move the application into Applications'
  fi
  printf 'Installed real application bundle: %s\nOpen it from Finder or run: open "%s"\n' "$TARGET" "$TARGET"
  printf 'This release is ad-hoc signed, not Apple-notarized. macOS may require your explicit first-open approval.\n'
else
  [ "$(od -An -tx1 -N4 "$TEMP/$ASSET" | tr -d ' \n')" = 7f454c46 ] || fail 'The release is not an ELF AppImage'
  fetch "$BASE/nil-icon.png" "$TEMP/nil-icon.png"
  verify_download nil-icon.png
  [ ! -e "$TARGET" ] || verify_owner
  for managed in "$PREFIX/bin/nil-config-catcher" "$PREFIX/share/applications/${APP_ID}.desktop"; do
    [ ! -e "$managed" ] || grep -Fq "$APP_ID" "$managed" || fail "Refusing to overwrite unmanaged file: $managed"
  done
  mkdir -p "$PREFIX/lib" "$PREFIX/bin" "$PREFIX/share/applications"
  STAGE="$(mktemp -d "$PREFIX/lib/.nil-install.XXXXXXXX")"
  mkdir "$STAGE/app"
  cp "$TEMP/$ASSET" "$STAGE/app/NIL-Config-Catcher.AppImage"
  cp "$TEMP/nil-icon.png" "$STAGE/app/icon.png"
  printf '%s\n' "$APP_ID" > "$STAGE/app/.nil-owned"
  chmod 755 "$STAGE/app/NIL-Config-Catcher.AppImage"
  if [ -e "$TARGET" ]; then mv "$TARGET" "$STAGE/previous"; fi
  if ! mv "$STAGE/app" "$TARGET"; then
    if [ -e "$STAGE/previous" ] && ! mv "$STAGE/previous" "$TARGET"; then
      printf 'Previous app preserved at %s/previous\n' "$STAGE" >&2; STAGE=""
    fi
    fail 'Could not install application files'
  fi
  launcher="$PREFIX/bin/nil-config-catcher"
  printf '#!/usr/bin/env bash\n# %s\nexec env APPIMAGE_EXTRACT_AND_RUN=1 %q "$@"\n' "$APP_ID" "$TARGET/NIL-Config-Catcher.AppImage" > "$STAGE/launcher"
  chmod 755 "$STAGE/launcher"
  mv "$STAGE/launcher" "$launcher"
  # Desktop Entry Exec uses its own quoting rules; it is not a shell command.
  desktop_exec="${launcher//\\/\\\\}"
  desktop_exec="${desktop_exec//\"/\\\"}"
  desktop_exec="${desktop_exec//\$/\\\$}"
  desktop_exec="${desktop_exec//\`/\\\`}"
  desktop_exec="${desktop_exec//%/%%}"
  cat > "$STAGE/app.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=NIL Config Catcher
Name[fa]=نیل — babakyaghoobii
Comment=Created by babakyaghoobii. Free for everyone.
Exec="$desktop_exec"
TryExec=$launcher
Icon=$TARGET/icon.png
Terminal=false
Categories=Network;Utility;
Keywords=VPN;NIL;Config;
StartupWMClass=$APP_ID
X-NIL-Managed=$APP_ID
DESKTOP
  chmod 644 "$STAGE/app.desktop"
  mv "$STAGE/app.desktop" "$PREFIX/share/applications/${APP_ID}.desktop"
  if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true; fi
  printf 'Installed native app: %s\nApplication menu: NIL Config Catcher\nLaunch: "%s"\n' "$TARGET" "$launcher"
  printf 'The launcher uses extraction mode and does not require FUSE.\n'
fi
