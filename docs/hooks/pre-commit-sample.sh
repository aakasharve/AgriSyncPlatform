#!/bin/sh
# Parent-repo pre-commit hook — COFOUNDER_OS_V4 Private Provenance Model
# Rejects staging of any path that must stay private.

BLOCKED=$(git diff --cached --name-only | grep -E '^(_COFOUNDER/|\.obsidian/|\.claude/|\.cavemem/|\.mcp\.json|\.codex_build/|\.playwright-cli/|\.venv/|\.kiro/|\.superpowers/)')

if [ -n "$BLOCKED" ]; then
  echo "PRIVACY VIOLATION: refusing to stage ignored-by-design paths:"
  echo "$BLOCKED"
  echo ""
  echo "These are part of the Private Provenance Model (COFOUNDER_OS_V4 spec Section 5)."
  exit 1
fi

exit 0
