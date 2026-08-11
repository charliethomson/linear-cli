#!/bin/sh
# Derive the build version and print it on stdout.
#
#   VERSION = <tag MAJOR>.<tag MINOR>.<total commit count>
#
# See standards/docs/versioning.md. This is the shell equivalent of the
# canonical standards/templates/rust/build.rs, and resolves in the same order:
#
#   1. RELEASE_VERSION from the environment (set by CI) — authoritative, so the
#      whole pipeline agrees on one value computed once per run.
#   2. Derived from git.
#   3. 0.0.0 when there is no git at all — an install from a packed tarball.
#
# The version in package.json is a static placeholder and is deliberately NOT
# consulted: manifests are not the source of truth.
set -eu

if [ -n "${RELEASE_VERSION:-}" ]; then
  printf '%s' "$RELEASE_VERSION"
  exit 0
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  printf '0.0.0'
  exit 0
fi

# Total commits on the branch: globally monotonic, never resets, so a higher
# version always means a later commit. Needs full history — a shallow clone
# undercounts, which is why CI checks out with fetch-depth: 0.
COUNT="$(git rev-list --count HEAD 2>/dev/null || echo 0)"

# MAJOR.MINOR from the most recent v-tag; the tag's patch component is ignored.
TAG="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
MM="$(printf '%s' "${TAG#v}" | awk -F. '{ if ($1 != "" && $2 != "") print $1"."$2 }')"
[ -n "$MM" ] || MM="0.0"

printf '%s.%s' "$MM" "$COUNT"
