#!/bin/sh
# Entrypoint runs as root just long enough to fix ownership on the data
# volumes (which may have been created by an older root-running version of the
# image), then drops privileges to the unprivileged `skald` user.
#
# This is idempotent and cheap on every start, so it's safe to leave in.
set -e

# These are the same paths declared as VOLUME in the Dockerfile.
# Don't fail startup if chown can't fix one of them (e.g. read-only bind mount,
# NFS without root_squash, or volume already owned by skald) — but do log it so
# permission problems aren't silently hidden.
for dir in /app/data /app/static/avatars; do
	if ! chown -R skald:skald "$dir" 2>/dev/null; then
		echo "WARN: chown failed for $dir — continuing with existing ownership" >&2
	fi
done

exec gosu skald "$@"
