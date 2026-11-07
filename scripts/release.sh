#!/bin/sh
# Bumps the version (patch by default, or the npm version argument given: minor, major, 1.2.3),
# builds the mac zip and dmg and publishes them as GitHub release v<version>.
# electron-builder only builds: its own publisher uploads each file in parallel, and
# when the release doesn't exist yet every upload tries to create it and all but one fail.
set -e

# npm version commits package.json + package-lock.json and tags v<version>; it refuses a dirty tree.
npm version "${1:-patch}"
version=$(node -p "require('./package.json').version")

electron-vite build
electron-builder --mac zip dmg --arm64 --publish never
git push --follow-tags
gh release create "v$version" --title "v$version" --generate-notes \
  "dist/Soundplayer-$version-arm64-mac.zip" "dist/Soundplayer-$version-arm64.dmg"
