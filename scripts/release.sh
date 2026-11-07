#!/bin/sh
# Builds the mac zip and dmg and publishes them as GitHub release v<version>.
# electron-builder only builds: its own publisher uploads each file in parallel, and
# when the release doesn't exist yet every upload tries to create it and all but one fail.
set -e
version=$(node -p "require('./package.json').version")

electron-vite build
electron-builder --mac zip dmg --arm64 --publish never
gh release create "v$version" --title "v$version" --generate-notes \
  "dist/Soundplayer-$version-arm64-mac.zip" "dist/Soundplayer-$version-arm64.dmg"
