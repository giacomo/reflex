#!/usr/bin/env bash
# Releases the current package.json version: npm publish, then a matching
# git tag + GitHub release. Publish runs first (it already re-runs
# typecheck/test/build via the prepublishOnly hook) so a tag is never
# created for a version that failed to publish.
#
# Usage:
#   scripts/release.sh --otp=123456
#   scripts/release.sh --otp=123456 --notes-file=CHANGELOG-0.2.0.md
#   scripts/release.sh --otp=123456 --branch=release/0.2 --dry-run
set -euo pipefail

OTP=""
NOTES_FILE=""
BRANCH="main"
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: scripts/release.sh --otp=XXXXXX [options]

Required:
  --otp=XXXXXX          npm 2FA one-time password for this publish

Options:
  --notes-file=PATH     use this file's contents as the GitHub release notes
                         (default: gh's --generate-notes, from commits since the last tag)
  --branch=NAME         branch the release must be cut from (default: main)
  --dry-run             print what would happen; don't publish, tag, or push
  -h, --help            show this help
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --) ;; # pnpm/npm forward a literal "--" separator; ignore it
    --otp=*) OTP="${arg#--otp=}" ;;
    --notes-file=*) NOTES_FILE="${arg#--notes-file=}" ;;
    --branch=*) BRANCH="${arg#--branch=}" ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -z "$OTP" && "$DRY_RUN" -eq 0 ]]; then
  echo "error: --otp=XXXXXX is required (see npm's EOTP prompt for a fresh one)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"
PKG_NAME="$(node -p "require('./package.json').name")"
TAG="v$VERSION"

echo "==> Releasing $PKG_NAME@$VERSION as tag $TAG"

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  echo "error: on branch '$current_branch', expected '$BRANCH' (override with --branch=$current_branch)" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean; commit or stash changes first" >&2
  git status --short >&2
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "error: tag $TAG already exists locally. Bump the version in package.json first." >&2
  exit 1
fi

if npm view "$PKG_NAME@$VERSION" version >/dev/null 2>&1; then
  echo "error: $PKG_NAME@$VERSION is already published on npm. Bump the version first." >&2
  exit 1
fi

if [[ -n "$NOTES_FILE" && ! -f "$NOTES_FILE" ]]; then
  echo "error: --notes-file '$NOTES_FILE' does not exist" >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "==> --dry-run: would run:"
  echo "    npm publish --otp=****"
  echo "    git tag -a $TAG -m $TAG"
  echo "    git push origin $TAG"
  if [[ -n "$NOTES_FILE" ]]; then
    echo "    gh release create $TAG --title $TAG --notes-file $NOTES_FILE"
  else
    echo "    gh release create $TAG --title $TAG --generate-notes"
  fi
  exit 0
fi

echo "==> npm publish"
npm publish --otp="$OTP"

echo "==> tagging $TAG"
git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"

echo "==> creating GitHub release"
if [[ -n "$NOTES_FILE" ]]; then
  gh release create "$TAG" --title "$TAG" --notes-file "$NOTES_FILE"
else
  gh release create "$TAG" --title "$TAG" --generate-notes
fi

echo "==> done"
echo "    npm:    https://www.npmjs.com/package/$PKG_NAME/v/$VERSION"
echo "    GitHub: $(gh release view "$TAG" --json url -q .url)"
