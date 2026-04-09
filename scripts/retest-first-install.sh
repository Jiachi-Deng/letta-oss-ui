#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
app_root="$(cd "$script_dir/.." && pwd)"
workspace_root="$(cd "$app_root/../.." && pwd)"
dist_dir="$app_root/dist"
releases_dir="$workspace_root/releases"

home_dir="${HOME:?HOME is required}"
app_support_dir="$home_dir/Library/Application Support"
caches_dir="$home_dir/Library/Caches"
http_storages_dir="$home_dir/Library/HTTPStorages"
preferences_dir="$home_dir/Library/Preferences"
saved_state_dir="$home_dir/Library/Saved Application State"
logs_dir="$home_dir/Library/Logs"

cleanup_dirs=(
  "/Applications/Letta.app"
  "/Applications/CodeIsland.app"
  "$home_dir/.letta"
  "$home_dir/.codeisland"
  "$home_dir/Documents/.letta"
  "$app_support_dir/Letta"
  "$app_support_dir/Letta Code"
  "$app_support_dir/letta-cowork"
  "$caches_dir/com.codeisland.app"
  "$http_storages_dir/com.codeisland.app"
  "$saved_state_dir/com.jachi.letta.savedState"
  "$saved_state_dir/com.codeisland.app.savedState"
  "$logs_dir/Letta"
  "$logs_dir/CodeIsland"
)

cleanup_files=(
  "$preferences_dir/com.codeisland.app.plist"
  "$preferences_dir/com.jachi.letta.plist"
)

process_pattern='Letta.app/Contents/MacOS/Letta|CodeIsland.app/Contents/MacOS/CodeIsland|letta\.js --conversation|@letta-ai/letta-code/letta\.js'

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
staged_dmg="$releases_dir/$(basename "$latest_dmg")"
staged_zip="$releases_dir/$(basename "$latest_zip")"

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
for dir_path in "${cleanup_dirs[@]}"; do
  rm -rf "$dir_path"
done

for file_path in "${cleanup_files[@]}"; do
  rm -f "$file_path"
done

/usr/bin/defaults delete com.jachi.letta >/dev/null 2>&1 || true
/usr/bin/defaults delete com.codeisland.app >/dev/null 2>&1 || true

remaining_processes="$(
  ps -axo pid,command \
    | rg "$process_pattern" \
    | rg -v 'ps -axo pid,command|rg Letta\.app/Contents/MacOS/Letta\|CodeIsland\.app/Contents/MacOS/CodeIsland\|letta\\\.js --conversation\|@letta-ai/letta-code/letta\\\.js' \
    || true
)"
remaining_paths=()

for dir_path in "${cleanup_dirs[@]}"; do
  if [ -e "$dir_path" ]; then
    remaining_paths+=("$dir_path")
  fi
done

for file_path in "${cleanup_files[@]}"; do
  if [ -e "$file_path" ]; then
    remaining_paths+=("$file_path")
  fi
done

echo
echo "[first-install-retest] Cleanup standards:"
echo "  1. /Applications/Letta.app is absent"
echo "  2. Letta / CodeIsland user state directories are absent"
echo "  3. Letta / CodeIsland preferences and caches are absent"
echo "  4. No Letta / CodeIsland / letta.js runtime processes remain"
echo "  5. Latest DMG / ZIP are staged in $releases_dir"
echo
echo "[first-install-retest] Installers staged for manual first-run testing:"
echo "  $staged_dmg"
echo "  $staged_zip"
echo
echo "[first-install-retest] Manual next steps:"
echo "  1. Do NOT launch $app_root/dist/mac-arm64/Letta.app"
echo "  2. For DMG testing, open the DMG from $releases_dir, drag Letta.app to /Applications, eject the DMG, then open /Applications/Letta.app from Finder."
echo "  3. For ZIP testing, unzip from $releases_dir, move Letta.app to /Applications, then open /Applications/Letta.app from Finder."
echo "  4. Run only one installer flow per reset."
echo

if [ "${#remaining_paths[@]}" -gt 0 ]; then
  echo "[first-install-retest] WARNING: Some cleanup paths still exist:"
  printf '  %s\n' "${remaining_paths[@]}"
fi

if [ -n "$remaining_processes" ]; then
  echo "[first-install-retest] WARNING: Some related processes are still visible:"
  echo "$remaining_processes"
fi

if [ "${#remaining_paths[@]}" -eq 0 ] && [ -z "$remaining_processes" ]; then
  if [ ! -f "$staged_dmg" ] || [ ! -f "$staged_zip" ]; then
    echo "[first-install-retest] Cleanup complete: FAIL"
    echo "[first-install-retest] Expected staged installers were not found in $releases_dir."
    exit 1
  fi
  echo "[first-install-retest] Cleanup complete: PASS"
  echo "[first-install-retest] Safe to begin manual DMG / ZIP first-run testing."
else
  echo "[first-install-retest] Cleanup complete: FAIL"
  echo "[first-install-retest] Resolve the remaining paths/processes before manual first-run testing."
  exit 1
fi
