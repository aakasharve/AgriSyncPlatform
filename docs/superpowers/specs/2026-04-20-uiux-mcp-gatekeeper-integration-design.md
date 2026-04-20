# UI/UX MCP Gatekeeper Integration — Design Spec

> **Date**: 2026-04-20
> **Owner**: All agents (Claude, Gemini, Codex)
> **Status**: Design approved, implementation pending
> **Supersedes**: `UI_UX_DESIGN_ENGINE_PROTOCOL.md` v1.0 (2026-03-29)

---

## 1. Problem Statement

The current UI/UX Design Engine (v1.0) has a **5-layer stack** but six gaps:

1. **No design memory across sessions** — button heights, spacing values, chosen tokens drift. Every session re-derives decisions.
2. **No variation gallery before commit** — L1 picks one palette/typography; user only sees alternatives after rejecting and re-asking.
3. **No automated verification gate** — L5 has a manual checklist; nothing enforces contrast, viewport, or accessibility before a UI PR opens.
4. **Figma MCP not formally integrated** — it works via `claude.ai` remote MCP but has no status in the protocol.
5. **shadcn is CLI-only** — brittle `npx shadcn@latest` calls scattered in agent output; no structured queries.
6. **Playwright not used by Claude** — the clients have no Playwright setup, so visual verification happens manually.

This spec closes those gaps with **3 new skills, 2 new MCPs, 1 protocol rewrite, and 1 enforcement hook**.

---

## 2. Final Architecture — The 9-Layer Stack

Existing 5 layers (L1-L5) extended to 9 layers by prepending L0 (memory), inserting L1.5 (gallery), branching L2 into L2a/L2b (Stitch/Figma equal), and splitting L5 into L5a/L5b (manual/automated).

```
┌─────────────────────────────────────────────────────────────────┐
│  L0   interface-design         — Design Memory                  │
│       .interface-design/system.md (session-persistent decisions)│
├─────────────────────────────────────────────────────────────────┤
│  L1   ui-ux-pro-max v2.5.0     — Design System Generation       │
│       161 palettes · 99 UX rules · 25 charts · 12 reference docs│
├─────────────────────────────────────────────────────────────────┤
│  L1.5 ui-ux-pro-max/gallery    — Variation Gallery              │
│       3–5 candidate variants, rendered HTML grid, user picks    │
├─────────────────────────────────────────────────────────────────┤
│  L2a  Stitch MCP    L2b  Figma MCP   (EQUAL — pick exactly one) │
│       Text → mockup   Figma file → code                         │
├─────────────────────────────────────────────────────────────────┤
│  L3   21st.dev Magic MCP       — Component Discovery            │
├─────────────────────────────────────────────────────────────────┤
│  L4   shadcn MCP               — Component Primitives (NEW)     │
│       Structured component queries, install, adapt              │
├─────────────────────────────────────────────────────────────────┤
│  L5a  ui-styling               — Manual a11y / Polish Checklist │
├─────────────────────────────────────────────────────────────────┤
│  L5b  Playwright MCP + webapp-testing  — Automated Verification │
│       Real browser: 375/768/1280px screenshots, contrast assert │
│       On success writes .uiux-gate-passed                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                 PreToolUse hook blocks Write/Edit
                 on UI files unless token is valid
```

**Rules:**
- **L2 exclusive**: exactly one of Stitch or Figma runs per design task. Never both.
- **L5b is the gate writer**: only Playwright MCP success writes `.uiux-gate-passed`.
- **L5a still required**: the manual checklist captures judgment calls the automated layer cannot.

---

## 3. Skills — What Gets Added

### 3.1 New Skill: `interface-design` (L0)

| Aspect | Detail |
|---|---|
| Source | `interface-design-main.zip` |
| Target | `_COFOUNDER/OS/Skills/interface-design/` |
| Files | `SKILL.md`, `references/memory-format.md` |
| Memory file | `.interface-design/system.md` at repo root (gitignored) |
| Auto-load | `session-start-hook` reads it each session |
| Write rule | Append `# Decision YYYY-MM-DD-HHMM` blocks when user approves a design decision |

### 3.2 New Skill: `webapp-testing` (L5b support)

| Aspect | Detail |
|---|---|
| Source | `awesome-claude-skills-master.zip → webapp-testing/` |
| Target | `_COFOUNDER/OS/Skills/webapp-testing/` |
| Files | `SKILL.md`, `scripts/with_server.py`, `scripts/screenshot_viewports.py` (NEW), `scripts/contrast_check.py` (NEW) |
| Role | Pairs with Playwright MCP — MCP drives browser, this skill teaches test authoring patterns |
| Gate writer | `screenshot_viewports.py --pass` writes `.uiux-gate-passed` on all-viewport success |

### 3.3 Reference Enrichment: 12 docs → existing `ui-ux-pro-max`

| Aspect | Detail |
|---|---|
| Source | `ui-ux-design-pro-skill-main.zip → skills/ui-ux-design-pro/references/` |
| Target | `_COFOUNDER/OS/Skills/ui-ux-pro-max/references/` |
| Files | 12 docs: `accessibility.md`, `animation-and-motion.md`, `cognitive-principles.md`, `color-system.md`, `component-patterns.md`, `critique-protocol.md`, `depth-and-elevation.md`, `design-directions.md`, `icon-patterns.md`, `real-world-patterns.md`, `spacing-and-layout.md`, `token-architecture.md`, `typography.md` |
| Rationale | Existing `ui-ux-pro-max` has CSV data (styles, palettes, fonts) but no reference prose. These 12 docs are the "why" behind the data. No new skill registered — these live under existing skill. |
| Key doc | `critique-protocol.md` — self-evaluation checklist feeding L5a |

### 3.4 Version Upgrade: `ui-ux-pro-max` → v2.5.0

| Aspect | Detail |
|---|---|
| Source | `ui-ux-pro-max-skill-extracted/` |
| Current | v1.x (96 palettes, 57 font pairings per INDEX.md) |
| New | v2.5.0 (161 palettes, 99 UX guidelines, 25 chart types per skill.json) |
| Action | CSV row-count diff. If `new > old` for any file: overwrite. If equal: no-op. |
| L1.5 addition | Add `scripts/gallery.py` to this skill's `scripts/` folder |

### 3.5 Rejected Skills (for record)

| Skill | Reason |
|---|---|
| `ui-ux-design-pro` SKILL.md | Overlaps `ui-ux-pro-max` — keep refs, drop skill |
| `brand-guidelines` | Anthropic's brand, not AgriSync's |
| `canvas-design` | PNG/PDF posters, not web UI |
| `theme-factory` | Slide deck themes, not app UI |
| `artifacts-builder` | claude.ai artifacts, not our stack |
| `mcp-builder` | YAGNI — add if/when we build a custom MCP |
| `skill-creator` | Existing `skill-template/SKILL.md` covers this |

---

## 4. MCPs — Config Changes

Two new MCPs added. No changes to existing three.

### 4.1 Updated `.mcp.json` (project root AND `src/clients/marketing-web/.mcp.json`)

Both files edited **in place**. Must remain identical.

```json
{
  "mcpServers": {
    "stitch":    { "command": "npx", "args": ["-y", "stitch-mcp"], "env": {} },
    "magic":     { "type": "stdio", "command": "npx", "args": ["-y", "@21st-dev/magic@latest"], "env": { "API_KEY": "..." } },
    "cavemem":   { /* unchanged */ },
    "playwright":{ "type": "stdio", "command": "npx", "args": ["-y", "@playwright/mcp@latest", "--browser", "chromium"], "env": {} },
    "shadcn":    { "type": "stdio", "command": "npx", "args": ["-y", "shadcn@latest", "mcp"], "env": {} }
  }
}
```

### 4.2 Figma MCP — no config change

Figma is already active via claude.ai remote MCP (tools visible as `mcp__claude_ai_Figma__*`). No local `.mcp.json` entry needed. Gets equal L2 status via protocol doc only.

### 4.3 First-run verification

```bash
npx -y @playwright/mcp@latest --help    # lists browser_navigate, browser_snapshot, etc.
npx -y shadcn@latest mcp --help         # lists component search/add tools
```

Both must succeed. No fallback — these are gate-critical.

### 4.4 Gate role per MCP

| MCP | Gate Role |
|---|---|
| Stitch | L2 entry — mockup exists before code |
| Figma | L2 entry — Figma design extracted before code |
| Magic | L3 discovery — existing component found before custom |
| shadcn | L4 exit — component installed via MCP, tokens adapted |
| Playwright | L5b exit — 3-viewport screenshots + a11y tree proves render |

---

## 5. Protocol Doc — Edited In Place

**One file, no parallel versions.** `_COFOUNDER/OS/Integrations/UI_UX_Design_Engine/UI_UX_DESIGN_ENGINE_PROTOCOL.md` is **edited in place** from v1.0 to v2.0. Old v1.0 content is gone — git history is the backup. No `_OLD`, `_BACKUP`, `_v1` suffix files anywhere.

### 5.1 Changes

- Version header: `v1.0 (2026-03-29)` → `v2.0 (2026-04-20)`
- New section: **L0 — interface-design** (~40 lines)
- Edited section: L1 — ui-ux-pro-max (upgrade note, 12 refs)
- New section: **L1.5 — Variation Gallery** (~40 lines)
- Edited section: **L2 — Stitch OR Figma** (split into L2a + L2b, ~30 lines added)
- Unchanged: L3 Magic
- New section: **L4 — shadcn MCP** (replaces CLI instructions, ~20 lines)
- Edited section: L5 split into **L5a (manual)** and **L5b (automated)** (~50 lines added)
- New section: **Gate Enforcement** (Tier 1 protocol + Tier 2 hook, ~20 lines)

### 5.2 New Layer Activation Matrix

| UI Task | L0 | L1 | L1.5 | L2a | L2b | L3 | L4 | L5a | L5b |
|---|---|---|---|---|---|---|---|---|---|
| New screen / page | **REQ** | **REQ** | **REQ** | REQ *or* | REQ *or* | REQ | REQ | **REQ** | **REQ** |
| New visual component | REQ | Rec | **REQ** | REQ *or* | REQ *or* | **REQ** | REQ | **REQ** | **REQ** |
| Redesign existing screen | **REQ** | **REQ** | **REQ** | REQ *or* | REQ *or* | Rec | Rec | **REQ** | **REQ** |
| Animation / micro-interaction | REQ | — | — | Rec | — | **REQ** | — | **REQ** | **REQ** |
| Design system / token change | **REQ** | **REQ** | **REQ** | Rec | Rec | — | — | **REQ** | Rec |
| Marketing website section | REQ | **REQ** | **REQ** | REQ *or* | REQ *or* | **REQ** | — | **REQ** | **REQ** |
| Add button / icon to screen | REQ | — | — | — | — | Rec | Rec | **REQ** | **REQ** |
| CSS bug fix | REQ | — | — | — | — | — | — | **REQ** | **REQ** |
| Accessibility audit | — | — | — | — | — | — | — | **REQ** | **REQ** |
| Copy / i18n only | — | — | — | — | — | — | — | — | — |

**L2 rule**: exactly one of Stitch or Figma per design task.

### 5.3 New trigger keywords

| Keywords | Auto-activate |
|---|---|
| `figma` `figma.com/design` | L2b + L5a + L5b |
| `test ui` `screenshot` `viewport` `e2e` | L5b |
| `design memory` `design decision` `token change` | L0 + L1 |
| `variation` `alternative` `options` | L1.5 |

### 5.4 New anti-patterns

| Don't | Do |
|---|---|
| Skip L5b before opening UI PR | Run Playwright MCP viewport checks first |
| Commit UI changes without gate token | Token MUST exist at commit time |
| Use Stitch AND Figma for same screen | Pick ONE at L2, document which |
| Write raw `npx shadcn` in new work | Use shadcn MCP queries |
| Pick ONE palette at L1 without gallery | Generate L1.5 variants, let user pick |

---

## 6. L1.5 Variation Gallery — Detail

### 6.1 Purpose

Before committing to one design system, render 3–5 candidate variants side-by-side so the user picks visually instead of iterating by rejection.

### 6.2 Flow

```
L1 returns candidate pool (from ui-ux-pro-max CSVs):
  - 5 palettes
  - 5 typography pairs
  - 5 style names (e.g. "Organic Biophilic", "Neo-Brutalist")
         ↓
L1.5 gallery.py picks top 3–5 combinations and renders:
  .uiux-gallery/<YYYY-MM-DD>-<topic>/
  ├── index.html     ← grid of variants, open in browser
  ├── variants.json  ← { palette, typography, style, tokens } × N
  └── chosen.json    ← written after user picks (feeds L0 memory)

Each variant card shows:
  - Primary + accent + surface color swatches
  - Heading + body font specimen
  - Sample button + sample card (shadcn primitives, styled with variant)
  - Style name label
         ↓
User picks ONE → gallery.py writes chosen.json + appends to L0 system.md
         ↓
L2 (Stitch or Figma) uses chosen variant for full mockup
```

### 6.3 Implementation

Owned by **existing `ui-ux-pro-max` skill** (not a new skill). New file:
`_COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/gallery.py` (~200 lines).

### 6.4 Gitignore

`.uiux-gallery/` — ephemeral, per design task.

---

## 7. Hook-Level Enforcement (Tier 2 Gate)

### 7.1 Hook config in `.claude/settings.json`

Added (not replacing existing hooks):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "node .claude/hooks/uiux-gate-check.js" }
        ]
      }
    ]
  }
}
```

### 7.2 Hook script — `.claude/hooks/uiux-gate-check.js`

Logic (~80 lines):
1. Read `file_path` from tool input
2. Is path under `src/clients/{mobile-web,marketing-web}/src/`? → no: exit 0
3. Is extension in `{.tsx, .astro, .css, .scss, .module.css}` OR is path under `src/*/styles/` or `src/*/theme/`? → no: exit 0
4. Is path in `.uiux-gate.config.json` skipPaths? → yes: exit 0
5. Is `UIUX_GATE_BYPASS=1` set? → yes: log BYPASS, exit 0
6. Does `.uiux-gate-passed` exist AND `gitSha` matches HEAD AND `L5b.timestamp` within 24h? → no: exit 2 with clear blocking message
7. yes: log ALLOW, exit 0

### 7.3 Scope of gated files

**Gated** (blocks when token invalid):
- `src/clients/mobile-web/src/**/*.{tsx,astro,css,scss,module.css}`
- `src/clients/marketing-web/src/**/*.{tsx,astro,css,scss,module.css}`
- `src/clients/*/src/styles/**/*.ts` (token files)
- `src/clients/*/src/theme/**/*.ts` (theme files)

**Not gated**:
- `.ts` files outside styles/theme folders
- `.json`, `.md`, config files
- Test files (`*.test.ts`, `*.spec.tsx`)
- i18n translations (`src/i18n/**`)

### 7.4 Skip list — `.uiux-gate.config.json`

```json
{
  "skipPaths": [
    "src/clients/*/src/i18n/**",
    "src/clients/*/src/types/**",
    "src/clients/*/src/**/*.test.tsx",
    "src/clients/*/src/**/*.spec.tsx"
  ]
}
```

### 7.5 Gate token format — `.uiux-gate-passed`

```json
{
  "gitSha": "32ed0c2...",
  "layers": {
    "L0":   { "timestamp": "2026-04-20T10:15:00Z" },
    "L1":   { "timestamp": "...", "style": "Organic Biophilic" },
    "L1.5": { "timestamp": "...", "chosenVariant": "v3" },
    "L2":   { "timestamp": "...", "tool": "figma", "mockup": "path/to/mockup.png" },
    "L4":   { "timestamp": "...", "components": ["button", "sheet"] },
    "L5a":  { "timestamp": "...", "checklistPassed": true },
    "L5b":  {
      "timestamp": "2026-04-20T11:02:00Z",
      "viewports": [375, 768, 1280],
      "screenshotsPath": ".uiux-gallery/verify/",
      "contrastPassed": true,
      "a11yTreeCaptured": true
    }
  },
  "scope": "all",
  "targetFiles": ["src/clients/mobile-web/src/screens/LogScreen.tsx"]
}
```

### 7.6 Bypass mechanism — `UIUX_GATE_BYPASS=1`

Env-var only, per-shell, never saved to shell config. Every bypass logged to `.claude/hooks/uiux-gate.log` with file path + timestamp + git SHA.

### 7.7 Reset policy

Token invalidates on:
- New git commit (SHA mismatch) → re-run L5b
- Timestamp > 24h → re-run L5b
- L2 mockup file change → re-run L5b

Manual: `rm .uiux-gate-passed`

### 7.8 Gemini / Codex

They do not honor Claude hooks. For them, gate is protocol-only (Tier 1). Documented explicitly in protocol doc.

### 7.9 Logging

`.claude/hooks/uiux-gate.log` — ALLOW / BLOCK / BYPASS decisions with path, timestamp, reason.

---

## 8. Future-Proof — Zip-In Skill & MCP Pipeline

Future additions follow this exact flow. **No manual copy-paste.**

### 8.1 Adding a future skill

```bash
# Single-skill zip (one SKILL.md at any depth)
python _COFOUNDER/OS/Skills/_Packages/install_skill.py <path-to-skill.zip>

# Multi-skill zip (cherry-pick one subfolder, e.g. awesome-claude-skills-master)
python _COFOUNDER/OS/Skills/_Packages/install_skill.py <path-to-skill.zip> --skill <subfolder-name>
```

Script logic (`install_skill.py`, ~150 lines):
1. Extract zip to `_COFOUNDER/OS/Skills/_Packages/_staging/`
2. If `--skill <name>` given: narrow scope to that subfolder only
3. Walk extracted tree (or narrowed subfolder), find `SKILL.md` files
4. For each SKILL.md found, parse frontmatter (`name`, `description`)
5. If `_COFOUNDER/OS/Skills/<name>/` exists: prompt `overwrite? [y/N]`
6. Copy skill folder to `_COFOUNDER/OS/Skills/<name>/`
7. Append/update row in `INDEX.md` from parsed frontmatter
8. Delete `_staging/`

Idempotent. Running twice is safe.

### 8.2 Adding a future MCP

```bash
python _COFOUNDER/OS/Integrations/_add_mcp.py <name> <npx-package> [--env KEY=value]
```

Script logic:
1. Read both `.mcp.json` files (root + marketing-web)
2. Insert new `mcpServers.<name>` entry
3. Write both files in place (must remain identical)
4. Print verification command: `npx -y <package> --help`

### 8.3 Rationale

User provides skills as zip files (matching today's workflow). Process stays one-command, idempotent, with no manual file shuffling.

---

## 9. Migration, Rollback, Verification

### 9.1 Migration order (mandatory sequence)

```
Step 1 — Skills (inert, no runtime impact)
  1a. Run install_skill.py on interface-design-main.zip
  1b. Run install_skill.py on awesome-claude-skills-master.zip --skill webapp-testing
      (flag extracts only the named subfolder; other 29 skills ignored)
  1c. Copy 12 reference docs into ui-ux-pro-max/references/
  1d. Version-check + upgrade ui-ux-pro-max to v2.5.0
  1e. Add gallery.py to ui-ux-pro-max/scripts/
  1f. Update INDEX.md

Step 2 — Protocol doc (inert)
  2a. Edit UI_UX_DESIGN_ENGINE_PROTOCOL.md in place → v2.0
  2b. No parallel file. Git history is backup.

Step 3 — MCPs (runtime-activating, not gating)
  3a. Edit root .mcp.json in place — add playwright + shadcn
  3b. Edit marketing-web .mcp.json in place — same additions
  3c. Smoke test: npx -y @playwright/mcp@latest --help
  3d. Smoke test: npx -y shadcn@latest mcp --help

Step 4 — Hook (runtime-gating, ship LAST)
  4a. Write .claude/hooks/uiux-gate-check.js
  4b. Write .uiux-gate.config.json
  4c. Update .gitignore (.uiux-gate-passed, .uiux-gallery/, .interface-design/, .claude/hooks/uiux-gate.log)
  4d. Add PreToolUse hook entry to .claude/settings.json
  4e. Shadow-mode for 1 session (UIUX_GATE_SHADOW=1 → log but never block)
  4f. Full enforce after shadow log reviewed
```

### 9.2 Shadow-mode (first 24h)

`uiux-gate-check.js` checks `UIUX_GATE_SHADOW=1`:

```js
const SHADOW_MODE = process.env.UIUX_GATE_SHADOW === '1';
if (shouldBlock && SHADOW_MODE) {
  console.error("[SHADOW] Would have blocked:", file_path);
  process.exit(0);  // allow despite block decision
}
```

Read log after session. Confirm right files blocked. Unset env var. Ship.

### 9.3 Rollback plan

Each step independently reversible:

| Step | Rollback | Blast radius |
|---|---|---|
| Skills | `git revert` skill-add commits | None — skills inert until invoked |
| Protocol doc | `git revert` the v2.0 bump | None — doc is reference |
| MCPs | Remove new entries from both `.mcp.json`, restart Claude | Low — others unaffected |
| Hook | Set `UIUX_GATE_BYPASS=1` permanently, or delete hook entry | Low — other hooks unaffected |

**Full nuclear rollback:**

```bash
git revert <spec-commit>..<last-commit>
rm .uiux-gate-passed .claude/hooks/uiux-gate-check.js
# Remove 4 .gitignore lines manually
```

### 9.4 Verification checklist (acceptance criteria)

**Skills layer:**
- [ ] `_COFOUNDER/OS/Skills/interface-design/SKILL.md` exists
- [ ] `_COFOUNDER/OS/Skills/webapp-testing/SKILL.md` exists + scripts executable
- [ ] `_COFOUNDER/OS/Skills/ui-ux-pro-max/references/` has all 12 docs
- [ ] `_COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/gallery.py` exists
- [ ] `_COFOUNDER/OS/Skills/INDEX.md` updated with new rows

**Protocol layer:**
- [ ] `UI_UX_DESIGN_ENGINE_PROTOCOL.md` version header says 2.0
- [ ] L0, L1.5, L2b, L5b sections all present
- [ ] Activation matrix has 9 layer columns (L0, L1, L1.5, L2a, L2b, L3, L4, L5a, L5b)
- [ ] Figma + Playwright + shadcn all show REQ in "New screen" row

**MCP layer:**
- [ ] Both `.mcp.json` files have 5 servers (stitch, magic, cavemem, playwright, shadcn)
- [ ] Root and marketing-web `.mcp.json` diff = 0
- [ ] After Claude restart: `mcp__playwright__*` and `mcp__shadcn__*` tools appear
- [ ] Figma MCP still works via claude.ai remote

**Hook layer:**
- [ ] Edit `.tsx` without token → **blocked** with clear stderr message
- [ ] Edit `.ts` logic file → **allowed**
- [ ] Edit `.tsx` in skip list → **allowed**
- [ ] `UIUX_GATE_BYPASS=1` + edit `.tsx` → **allowed**, logged as BYPASS
- [ ] Run Playwright MCP viewport check → writes `.uiux-gate-passed`
- [ ] Edit same `.tsx` → **allowed**, logged as ALLOW
- [ ] Commit → git SHA changes → gate re-blocks next edit

### 9.5 Success criteria

Integration is successful when:
1. New screen tasks automatically route L0 → L1 → L1.5 → L2 → L3 → L4 → L5a → L5b
2. User sees 3–5 design variants at L1.5 before committing
3. Claude cannot write `.tsx` under `src/clients/` without valid gate token
4. Figma URLs accepted as L2 input with equal weight to Stitch prompts
5. Playwright MCP runs produce viewport screenshots automatically
6. shadcn adds use MCP queries, not raw `npx` calls
7. Future skills install via one command on a zip
8. Future MCPs install via one command

---

## 10. Out of Scope (Explicit Non-Goals)

- Building a custom MCP server (future: use `mcp-builder` skill if needed)
- Storybook integration (clients don't use Storybook)
- Visual regression baseline snapshots (L5b writes fresh per commit; no diffing)
- Replacing the `ui-ux-pro-max` CSV data (only enriching with reference prose)
- Gemini/Codex hook enforcement (they don't honor Claude hooks; protocol-only for them)
- Marketing site Storybook or component library (YAGNI)

---

## 11. File Inventory

**New files created:**
- `_COFOUNDER/OS/Skills/interface-design/` (entire folder)
- `_COFOUNDER/OS/Skills/webapp-testing/` (entire folder)
- `_COFOUNDER/OS/Skills/ui-ux-pro-max/references/` (12 docs)
- `_COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/gallery.py`
- `_COFOUNDER/OS/Skills/_Packages/install_skill.py`
- `_COFOUNDER/OS/Integrations/_add_mcp.py`
- `.claude/hooks/uiux-gate-check.js`
- `.uiux-gate.config.json`

**Files edited in place (no parallel versions):**
- `_COFOUNDER/OS/Integrations/UI_UX_Design_Engine/UI_UX_DESIGN_ENGINE_PROTOCOL.md` (v1.0 → v2.0)
- `_COFOUNDER/OS/Skills/INDEX.md` (new rows, updated counts)
- `_COFOUNDER/OS/Skills/ui-ux-pro-max/SKILL.md` (if v2.5.0 upgrade)
- `_COFOUNDER/OS/Skills/ui-ux-pro-max/data/*.csv` (if v2.5.0 upgrade)
- `.mcp.json` (root) — +2 servers
- `src/clients/marketing-web/.mcp.json` — +2 servers
- `.claude/settings.json` — +1 PreToolUse hook entry
- `.gitignore` — +4 patterns

**Runtime files (gitignored):**
- `.uiux-gate-passed`
- `.uiux-gallery/`
- `.interface-design/`
- `.claude/hooks/uiux-gate.log`

---

## 12. Appendix — Source Zip Inventory

| Zip | Skills Extracted | Reason |
|---|---|---|
| `interface-design-main.zip` | 1: `interface-design` | L0 memory — fills unique gap |
| `ui-ux-design-pro-skill-main.zip` | 0 skills + 12 reference docs | Refs enrich `ui-ux-pro-max`; SKILL itself rejected (overlap) |
| `ui-ux-pro-max-skill-extracted` | 1: `ui-ux-pro-max` v2.5.0 | Version upgrade of existing skill |
| `awesome-claude-skills-master.zip` | 1: `webapp-testing` | L5b support; 29 other skills rejected (wrong scope or YAGNI) |
| **Total kept** | **3 skills + 1 upgrade + 12 docs** | From 33+ scanned |
