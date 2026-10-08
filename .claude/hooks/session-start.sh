#!/bin/bash
set -euo pipefail

# Runs only in Claude Code on the web, where the container starts empty.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Project deps (postinstall pulls in server/ deps as well). ci, not install:
# install rewrites package-lock.json with whatever npm version the container
# has, which left a stray diff in every session.
npm ci

# The container ships its own Chromium build, which differs from the one our
# @playwright/test version expects, and browsers can't be downloaded here.
# playwright.config.js picks this path up; locally and in CI it stays unset.
if [ -x /opt/pw-browsers/chromium ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi
