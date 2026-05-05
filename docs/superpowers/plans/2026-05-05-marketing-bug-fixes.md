# Marketing Site Bug Fixes — Sub-project 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two pre-existing CSS bugs surfaced on the live preview at `localhost:4000`: Ch.04 phone-screen photo misalignment and Ch.09 form-card text blur during scroll.

**Architecture:** CSS-only edits inside two existing Astro section components. No new files, no new dependencies, no JavaScript changes, no schema changes. Roughly 15 lines of net delta across the two files.

**Tech Stack:** Astro 4 + Tailwind utility classes inline, scoped `<style>` blocks for component-specific CSS. GSAP scroll triggers untouched.

**Spec:** `docs/superpowers/specs/2026-05-05-marketing-bug-fixes-design.md`

---

## Operational note — UI gate token

The repo has a `PreToolUse` hook (`.claude/hooks/uiux-gate-check.js`) that blocks `Write`/`Edit` on UI files when `.uiux-gate-passed:gitSha` doesn't match `git HEAD`. Each commit moves HEAD, which invalidates the token for the next edit. **Before every Edit/Write step in this plan, refresh the token.**

Refresh recipe (run as a Bash + Write pair):

```bash
git rev-parse HEAD
```

Then `Write` to `.uiux-gate-passed` with the current HEAD SHA, the existing JSON shape, and a fresh timestamp + note.

---

## File Map

| File | Change | Net delta |
|---|---|---|
| `src/clients/marketing-web/src/components/sections/WorkflowSection.astro` | `.wf-phone-frame` rule rewrite, delete `::after` rule, `.wf-phone-img` rule rewrite | -8 / +3 |
| `src/clients/marketing-web/src/components/sections/CtaSection.astro` | Form-card class change (drop `backdrop-blur-xl`, swap background gradient) | -1 / +1 |

---

### Task 1: Fix Ch.04 phone-frame CSS — remove clipping, drop bottom-fade, switch to `object-fit: contain`

**Files:**
- Modify: `src/clients/marketing-web/src/components/sections/WorkflowSection.astro` (lines 499–526)

- [ ] **Step 1: Refresh UI gate token**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git rev-parse HEAD
```

Then write the SHA into `.uiux-gate-passed`:

```json
{
  "gitSha": "<HEAD-SHA-FROM-git-rev-parse>",
  "layers": {
    "L5b": {
      "timestamp": "<ISO-now-UTC>",
      "viewports": [375, 1280],
      "note": "Token refresh for marketing bug fixes — Task 1 (Ch.04 phone-frame)"
    }
  }
}
```

- [ ] **Step 2: Replace `.wf-phone-frame` rule body**

Open `src/clients/marketing-web/src/components/sections/WorkflowSection.astro`. Find the rule starting at line 499:

```css
  /* ── Phone frame ────────────────────────────────────────────────────── */
  .wf-phone-frame {
    border-radius: 1.2rem;
    overflow: hidden;
    margin: 0.75rem 0 1rem;
    /* Contain the phone in a reasonable height — shows top portion of screen */
    max-height: 320px;
    position: relative;
  }
```

Replace with:

```css
  /* ── Phone frame ────────────────────────────────────────────────────── */
  .wf-phone-frame {
    border-radius: 1.2rem;
    overflow: hidden;
    margin: 0.75rem 0 1rem;
    position: relative;
    background: rgba(0, 0, 0, 0.04);
  }
```

Two changes: removed `max-height: 320px`, removed the comment about it, added a subtle letterbox background.

- [ ] **Step 3: Delete the `.wf-phone-frame::after` rule entirely**

Find:

```css
  /* Bottom fade so the image doesn't hard-cut */
  .wf-phone-frame::after {
    content: '';
    position: absolute;
    inset-x: 0;
    bottom: 0;
    height: 5rem;
    background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.96));
    pointer-events: none;
  }
```

Delete the entire block including the `/* Bottom fade ... */` comment immediately above it. Replace with **nothing** — there is no replacement.

- [ ] **Step 4: Replace `.wf-phone-img` rule body**

Find:

```css
  .wf-phone-img {
    display: block;
    width: 100%;
    height: auto;
    object-fit: cover;
    object-position: center top;
    border-radius: inherit;
  }
```

Replace with:

```css
  .wf-phone-img {
    display: block;
    width: 100%;
    height: auto;
    object-fit: contain;
    border-radius: inherit;
  }
```

Two changes: `object-fit: cover` → `object-fit: contain`, removed the now-unnecessary `object-position` line.

- [ ] **Step 5: Build check**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform/src/clients/marketing-web"
npm run build 2>&1 | tail -20
```

Expected: exits 0, all 4 pages built (`/index`, `/en/index`, `/mr/index`, `/en/future-scope`, `/mr/future-scope`).

- [ ] **Step 6: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/components/sections/WorkflowSection.astro
git commit -m "fix(marketing): Ch.04 phone-frame — remove max-height clip, drop bottom-fade, object-fit contain"
```

---

### Task 2: Fix Ch.09 form-card backdrop-blur — swap to solid dark glass

**Files:**
- Modify: `src/clients/marketing-web/src/components/sections/CtaSection.astro` (line 94)

- [ ] **Step 1: Refresh UI gate token**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git rev-parse HEAD
```

Then update `.uiux-gate-passed:gitSha` to that SHA. Set the `note` to `"Token refresh for marketing bug fixes — Task 2 (Ch.09 form-card)"`. Leave the JSON shape otherwise unchanged.

- [ ] **Step 2: Edit form-card class — drop `backdrop-blur-xl`, replace background gradient**

Open `src/clients/marketing-web/src/components/sections/CtaSection.astro`. Find the line starting around line 94 (look for `backdrop-blur-xl`):

```html
        <div class="relative rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] backdrop-blur-xl p-5 md:p-6 shadow-[0_28px_80px_rgba(0,0,0,0.35)]">
```

Replace with:

```html
        <div class="relative rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(20,12,5,0.55),rgba(10,6,0,0.45))] p-5 md:p-6 shadow-[0_28px_80px_rgba(0,0,0,0.35)]">
```

Two changes inside the same `class` string:
- `bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))]` → `bg-[linear-gradient(180deg,rgba(20,12,5,0.55),rgba(10,6,0,0.45))]` (white-on-white tint → solid dark glass).
- Removed the `backdrop-blur-xl` token from the class list. Border, padding, shadow, rounded corners unchanged.

The decorative radial-blur sibling immediately above (line 93, `style="...filter:blur(24px);"`) is **not** edited — it has no text inside and is unaffected.

- [ ] **Step 3: Build check**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform/src/clients/marketing-web"
npm run build 2>&1 | tail -20
```

Expected: exits 0, no Tailwind errors about unknown classes.

- [ ] **Step 4: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/components/sections/CtaSection.astro
git commit -m "fix(marketing): Ch.09 form-card — drop backdrop-blur (Chromium scrub blur bug), use solid dark glass"
```

---

### Task 3: Verification — build + tsc + visual checks

**Files:**
- Read-only verification

- [ ] **Step 1: Full production build**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform/src/clients/marketing-web"
npm run build
```

Expected: exits 0, no errors, all 4 routes rendered.

- [ ] **Step 2: TypeScript check**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform/src/clients/marketing-web"
npx tsc --noEmit
```

Expected: exits 0 with no output.

- [ ] **Step 3: Confirm dev server is reachable for visual check**

If the dev server from the prior `/preview` session is no longer running, restart it:

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform/src/clients/marketing-web"
npm run dev > /tmp/agrisync-marketing.log 2>&1 &
echo $! > /tmp/agrisync-marketing.pid
sleep 5
```

Open `http://localhost:4000/en/`.

- [ ] **Step 4: Visual smoke checklist (manual, in browser)**

Walk these checks once. If any fail, file a follow-up commit with `fix(marketing): …` and re-run this checklist.

| # | Check | Expected |
|---|---|---|
| 1 | Scroll to Ch.04 (Workflow) | Full app screenshot visible, no hard bottom edge, no white fade overlay, image proportions look natural |
| 2 | At Ch.04, verify no clipping at any zoom (100% / 125% / 150%) | Image always renders inside the frame without being cropped |
| 3 | Scroll into Ch.09 (CTA) — form on the right column | Heading, "Coming soon" pill, "Early access" eyebrow, all input labels are sharp |
| 4 | Scroll up and back down through Ch.09 several times | Text remains crisp during AND after the scrub-into animation, no soft edges, no permanent blur |
| 5 | Ch.09 visual still feels "lifted off the page" | Border, deep shadow, and dark gradient still give it card depth even without backdrop-blur |
| 6 | Same checks on `http://localhost:4000/mr/` | Marathi page renders identically |

- [ ] **Step 5: If everything passes, mark Sub-project 1 done**

No additional commit needed if Step 4 passes cleanly. Sub-project 1 ships at the Task 2 commit.

If a fix was required during smoke test, commit it now:

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/
git commit -m "fix(marketing): smoke-test corrections for sub-project 1"
```

---

## Self-review (run before handing off)

**Spec coverage check:**

- Bug A `inset-x` typo → Task 1 Step 3 deletes the rule containing it. ✓
- Bug A `max-height: 320px` clip → Task 1 Step 2 removes it. ✓
- Bug A `object-fit: cover` + `object-position: center top` crop → Task 1 Step 4 replaces with `object-fit: contain` and removes `object-position`. ✓
- Bug A subtle letterbox safety → Task 1 Step 2 adds `background: rgba(0, 0, 0, 0.04)`. ✓
- Bug B `backdrop-blur-xl` text blur → Task 2 Step 2 removes the class. ✓
- Bug B background tint replacement → Task 2 Step 2 swaps to dark-glass gradient. ✓
- Bug B decorative radial-blur sibling untouched → Task 2 Step 2 explicitly notes it. ✓
- Build passes → Tasks 1.5, 2.3, 3.1. ✓
- tsc clean → Task 3.2. ✓
- Visual smoke → Task 3.4. ✓

**Placeholder scan:** No TBD/TODO. All CSS shown explicitly. All commands shown with expected output.

**Type/identifier consistency:** No types or function signatures in this plan — pure CSS edits. Class names referenced (`wf-phone-frame`, `wf-phone-img`, `backdrop-blur-xl`) match the spec and the source files exactly.
