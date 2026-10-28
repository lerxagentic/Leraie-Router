#!/bin/sh
# Cartethyia container entrypoint
# Fixes the data directory's ownership, then executes the application as the
# unprivileged runtime identity.

set -e

APP_UID=10001
APP_GID=10001

DATA_DIR="${CARTETHYIA_TELEMETRY_PAYLOAD_DIR:-/app/data}"
case "$DATA_DIR" in /*) ;; *) DATA_DIR="/app/data" ;; esac

# A mounted volume arrives owned by root, while the application runs as 10001.
# The image deliberately does not set USER, so the entrypoint starts as root,
# repairs the ownership of the data directory, and then drops privileges —
# otherwise every telemetry payload capture fails while the console still
# reports capture as enabled.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" 2>/dev/null || true
  mkdir -p "/tmp/opencode-home" 2>/dev/null || true
  chown -R "$APP_UID:$APP_GID" "$DATA_DIR" "/tmp/opencode-home" 2>/dev/null || true
  exec setpriv --reuid="$APP_UID" --regid="$APP_GID" --init-groups "$@"
fi

# Started unprivileged (the operator pinned a user, or the platform forbids
# root): nothing can be repaired from here, so report the exact ownership the
# host directory needs.
if [ ! -w "$DATA_DIR" ]; then
  echo "cartethyia: $DATA_DIR is not writable by uid $(id -u); telemetry payload capture will fail." >&2
  echo "cartethyia: chown it to $APP_UID:$APP_GID on the host, or let the entrypoint start as root so it can fix the mount." >&2
fi

exec "$@"
