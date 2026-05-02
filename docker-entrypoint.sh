#!/bin/sh
# Entrypoint runs as root just long enough to fix ownership on the data
# volumes (which may have been created by an older root-running version of the
# image), then drops privileges to the unprivileged `skald` user.
#
# This is idempotent and cheap on every start, so it's safe to leave in.
set -e

# These are the same paths declared as VOLUME in the Dockerfile.
chown -R skald:skald /app/data /app/static/avatars 2>/dev/null || true

exec gosu skald "$@"
