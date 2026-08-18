#!/bin/sh
# Tier 2a — build the solver container image, the artifact `wrangler deploy` ships.
#
# The build context is the REPO ROOT, not `services/solver`: `app.py` anchors the wire contract at
# `parents[4]`, so the image must keep `/app/services/solver/src/…` beside `/app/contracts/`. That is
# also why this script self-locates before building — invoked from the wrong directory, `docker build
# … .` would produce a silently wrong context, and the resulting image fails OPEN (`/health` green,
# every solve 500s). `image-smoke.sh` is what tells the two apart.
#
#   mise run solver:image:build     # needs Docker Desktop running
#
# See README § Tier 2 — the container image, and CLAUDE.md § Solver package.
set -eu

cd "$(dirname "$0")/../.." || exit 1

. scripts/solver/common.sh

docker build --platform linux/amd64 -f services/solver/Dockerfile -t ib-solver:local .

# `wrangler containers push` rejects a non-amd64 image outright, and an arm64 build on this machine
# is the easy accident — so the assertion belongs here, not in a reviewer's head.
arch=$(docker image inspect ib-solver:local --format '{{.Architecture}}')
if [ "$arch" != "amd64" ]; then
  echo "ib-solver:local is $arch, not amd64 — 'wrangler containers push' would reject it" >&2
  exit 1
fi
size=$(docker image inspect ib-solver:local --format '{{.Size}}' | awk '{printf "%.0f MB", $1/1000000}')
echo "ib-solver:local  arch=$arch  size=$size"
