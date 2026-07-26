#!/bin/bash
set -euo pipefail

# Runs only in Claude Code on the web, where the container starts empty.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Project deps (postinstall pulls in server/ deps as well).
npm install

# Codex CLI, used as a second opinion on non-trivial diffs.
if ! command -v codex >/dev/null 2>&1; then
  npm install -g @openai/codex
fi
