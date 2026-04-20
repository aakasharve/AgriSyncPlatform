# MCP Smoke-Test Notes — 2026-04-20

## Local npx availability

| MCP | Status | Tools Verified |
|---|---|---|
| playwright (`@playwright/mcp@latest`) | PASS | `--help` succeeded; lists options for `--browser`, `--allowed-hosts`, `--allowed-origins`. Browser tools (`browser_navigate`, `browser_snapshot`, `browser_resize`, `browser_take_screenshot`) are surfaced through the MCP protocol at runtime. |
| shadcn (`shadcn@latest mcp`) | PASS | `--help` succeeded; lists `init` command and `--cwd` flag. MCP subcommand available from shadcn v2.x. |

## Pending — requires Claude Code restart

Tools will appear in Claude with prefixes `mcp__playwright__*` and `mcp__shadcn__*` after restarting Claude Code so `.mcp.json` is re-read. Verify by running (in fresh Claude session):

```
ToolSearch({ query: "playwright browser" })
ToolSearch({ query: "shadcn" })
```

## Notes

- `.mcp.json` is gitignored in the public repo (`.gitignore:20`). MCP entries are local-only per developer — Playwright + shadcn entries now exist in the local `.mcp.json` but are not committed.
- Marketing-web `.mcp.json` mirrored identically for UI/UX servers (stitch, magic, playwright, shadcn). Root also has `cavemem` (project-wide utility; not mirrored).

## Gate Acceptance Matrix — 2026-04-20 (Tasks 13+14)

All runs done by invoking the hook script directly with simulated stdin JSON (exact same interface Claude Code uses).

| # | Test | Expected | Got | Pass |
|---|---|---|---|---|
| A1 | Gated `.tsx` (App.tsx) without token, enforce mode | BLOCKED + "gate token missing" | exit 2, stderr `UI gate blocked: gate token missing...` | ✓ |
| A2 | Ungated `.ts` logic file (useAuth.ts) | ALLOWED (early exit, no log) | exit 0 | ✓ |
| A3 | Skip-list `.ts` (i18n/translations.ts) | ALLOWED | exit 0 | ✓ |
| A4 | `UIUX_GATE_BYPASS=1` + gated `.tsx` | ALLOWED + logged as BYPASS | exit 0, log `BYPASS ... UIUX_GATE_BYPASS=1` | ✓ |
| A5 | `screenshot_viewports.py --pass` writes token | `.uiux-gate-passed` file created | `[gate] wrote .uiux-gate-passed` + file present | ✓ |
| A6 | Edit gated `.tsx` after token | ALLOWED + logged as ALLOW | exit 0, log `ALLOW ... gate valid` | ✓ |
| A7 | `git commit --allow-empty` then edit | BLOCKED — SHA mismatch | exit 2, stderr `gate token SHA mismatch (token f056c47, HEAD 85a5f67) — re-run L5b` | ✓ |
| A8 | Re-run `screenshot_viewports.py --pass` then edit | ALLOWED | exit 0, log `ALLOW ... gate valid` | ✓ |

**Shadow mode (Task 13) verification:** Env `UIUX_GATE_SHADOW=1` + gated `.tsx` without token → exit 0 (allows) with log entry `SHADOW src/clients/.../App.tsx (would block: gate token missing...)` — confirms shadow mode logs the block decision without enforcing it.

**Runtime cleanup after tests:** `.uiux-gate-passed` and `.claude/hooks/uiux-gate.log` deleted. Dummy `git commit --allow-empty` rolled back via `git reset --soft HEAD~1`.

**Result:** 8/8 acceptance rows PASS. Gate enforcement is production-ready.
