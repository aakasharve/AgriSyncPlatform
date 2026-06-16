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

# --- Release signing keystore warning (non-blocking) ---
# The release keystore is a sensitive credential. PRODUCTION signing uses the
# GitHub secret KEYSTORE_BASE64 (android-release.yml overwrites the committed
# file at build time). Changing the signing key incorrectly can break Play
# Store updates. Warn loudly so a keystore change is never committed silently.
KEYSTORE_CHANGED=$(git diff --cached --name-only | grep -E '\.(keystore|jks)$')
if [ -n "$KEYSTORE_CHANGED" ]; then
  echo "" >&2
  echo "  ============================================================" >&2
  echo "  WARNING: you are committing a SIGNING KEYSTORE change:" >&2
  echo "$KEYSTORE_CHANGED" | sed 's/^/       /' >&2
  echo "  ------------------------------------------------------------" >&2
  echo "  The app's release signing key must stay consistent or Play" >&2
  echo "  Store updates can break. Production signing uses the GitHub" >&2
  echo "  secret KEYSTORE_BASE64 - if this change is intentional, also" >&2
  echo "  update that secret to match. (This is a warning, not a block.)" >&2
  echo "  ============================================================" >&2
  echo "" >&2
fi

exit 0
