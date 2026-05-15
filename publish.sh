#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('./package.json').version")
  echo "No version given — using package.json: $VERSION"
fi

# Strip leading 'v' for package files, keep bare semver
VERSION="${VERSION#v}"
TAG="v${VERSION}"

echo "Publishing $TAG..."

# Bump package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" package.json

# Bump tauri.conf.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" src-tauri/tauri.conf.json

# Bump Cargo.toml (first occurrence = package version)
sed -i '' "0,/^version = \".*\"/s/^version = \".*\"/version = \"${VERSION}\"/" src-tauri/Cargo.toml

# Verify clean tree (only version bumps should be dirty)
if ! git diff --quiet -- package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml 2>/dev/null; then
  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
  git commit -m "chore: bump version to ${VERSION}"
fi

git tag "$TAG"
git push origin HEAD "$TAG"

echo "Done — $TAG pushed. GitHub Action will build and draft the release."
