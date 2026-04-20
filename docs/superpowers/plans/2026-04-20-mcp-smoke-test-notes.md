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

## Gate Acceptance Matrix — pending Task 14

Filled in after Task 13 (shadow-mode) and Task 14 (enforce) run.
