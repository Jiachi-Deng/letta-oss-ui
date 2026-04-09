#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
app_root="$(cd "$script_dir/.." && pwd)"
workspace_root="$(cd "$app_root/../.." && pwd)"
dist_dir="$app_root/dist"
releases_dir="$workspace_root/releases"

home_dir="${HOME:?HOME is required}"

shopt -s nullglob
dmg_candidates=("$dist_dir"/Letta-*-arm64.dmg)
zip_candidates=("$dist_dir"/Letta-*-arm64-mac.zip)
shopt -u nullglob

if [ "${#dmg_candidates[@]}" -eq 0 ] || [ "${#zip_candidates[@]}" -eq 0 ]; then
  echo "[first-install-retest] Missing build artifacts in $dist_dir"
  echo "[first-install-retest] Run ./scripts/build-release.sh first."
  exit 1
fi

latest_dmg="$(ls -t "${dmg_candidates[@]}" | head -n 1)"
latest_zip="$(ls -t "${zip_candidates[@]}" | head -n 1)"

mkdir -p "$releases_dir"

echo "[first-install-retest] Using artifacts:"
echo "  DMG: $latest_dmg"
echo "  ZIP: $latest_zip"

echo "[first-install-retest] Copying current installers to $releases_dir"
cp -f "$latest_dmg" "$releases_dir/"
cp -f "$latest_zip" "$releases_dir/"
[ -f "${latest_dmg}.blockmap" ] && cp -f "${latest_dmg}.blockmap" "$releases_dir/" || true
[ -f "${latest_zip}.blockmap" ] && cp -f "${latest_zip}.blockmap" "$releases_dir/" || true

echo "[first-install-retest] Stopping Letta / CodeIsland processes"
osascript -e 'tell application "Letta" to quit' >/dev/null 2>&1 || true
osascript -e 'tell application "CodeIsland" to quit' >/dev/null 2>&1 || true
pkill -f '/Applications/Letta.app/Contents/MacOS/Letta' >/dev/null 2>&1 || true
pkill -f "$app_root/dist/mac-arm64/Letta.app/Contents/MacOS/Letta" >/dev/null 2>&1 || true
pkill -f 'CodeIsland.app/Contents/MacOS/CodeIsland' >/dev/null 2>&1 || true
pkill -f 'letta\.js --conversation' >/dev/null 2>&1 || true
pkill -f '@letta-ai/letta-code/letta\.js' >/dev/null 2>&1 || true
sleep 1

echo "[first-install-retest] Removing installed app state"
rm -rf /Applications/Letta.app
rm -rf /Applications/CodeIsland.app
rm -rf "$home_dir/.letta"
rm -rf "$home_dir/.codeisland"
rm -rf "$home_dir/Documents/.letta"
rm -rf "$home_dir/Library/Application Support/Letta"
rm -rf "$home_dir/Library/Application Support/Letta Code"
rm -rf "$home_dir/Library/Application Support/letta-cowork"
rm -rf "$home_dir/Library/Caches/com.codeisland.app"
rm -rf "$home_dir/Library/HTTPStorages/com.codeisland.app"
rm -f "$home_dir/Library/Preferences/com.codeisland.app.plist"
rm -f "$home_dir/Library/Preferences/com.jachi.letta.plist"

remaining_processes="$(ps -axo pid,command | rg 'Letta.app/Contents/MacOS/Letta|CodeIsland.app/Contents/MacOS/CodeIsland|letta\.js --conversation' || true)"

echo
echo "[first-install-retest] Environment reset complete."
echo
echo "[first-install-retest] Installers staged for manual first-run testing:"
echo "  $releases_dir/$(basename "$latest_dmg")"
echo "  $releases_dir/$(basename "$latest_zip")"
echo
echo "[first-install-retest] Manual next steps:"
echo "  1. Do NOT launch $app_root/dist/mac-arm64/Letta.app"
echo "  2. For DMG testing, open the DMG from $releases_dir, drag Letta.app to /Applications, eject the DMG, then open /Applications/Letta.app from Finder."
echo "  3. For ZIP testing, unzip from $releases_dir, move Letta.app to /Applications, then open /Applications/Letta.app from Finder."
echo "  4. Run only one installer flow per reset."
echo

if [ -n "$remaining_processes" ]; then
  echo "[first-install-retest] WARNING: Some related processes are still visible:"
  echo "$remaining_processes"
else
  echo "[first-install-retest] No Letta / CodeIsland runtime processes remain."
fi
