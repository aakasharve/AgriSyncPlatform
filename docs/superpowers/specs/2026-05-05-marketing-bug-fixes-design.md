# Marketing Site Bug Fixes — Sub-project 1 Design

**Date:** 2026-05-05
**Branch:** `akash_edits`
**Parent track:** Marketing-site visual overhaul (Sub-projects 1 → 2 → 3 → 4)
**Predecessor spec:** `docs/superpowers/specs/2026-05-05-marketing-site-polish-design.md` (Option C, shipped)

---

## Goal

Fix two pre-existing rendering bugs the user surfaced on the live preview at
`http://localhost:4000`:

1. **Ch.04 (WorkflowSection)** — phone-screen screenshot is misaligned/clipped.
2. **Ch.09 (CtaSection)** — text inside the form card renders blurry during scroll.

Both are CSS-only changes, no new dependencies, no new components. This sub-project
clears the visible defects so Sub-project 2 (typography/color foundation) and
Sub-project 3 (motion redesign) can be reviewed against a clean baseline.

---

## Bug A — Ch.04 phone-screen photo alignment

### Symptom

The screenshot of the AgriSync `screen-crop-activity.png` inside the workflow
result card looks visually clipped and out-of-place. The bottom of the image is
abruptly cut, and the bottom-fade overlay that's supposed to soften the cut does
not render correctly across browsers.

### Root cause

[`src/clients/marketing-web/src/components/sections/WorkflowSection.astro`](src/clients/marketing-web/src/components/sections/WorkflowSection.astro), lines 499–526:

```css
.wf-phone-frame {
  border-radius: 1.2rem;
  overflow: hidden;
  margin: 0.75rem 0 1rem;
  max-height: 320px;          /* hard ceiling */
  position: relative;
}

.wf-phone-frame::after {
  content: '';
  position: absolute;
  inset-x: 0;                 /* invalid CSS shorthand */
  bottom: 0;
  height: 5rem;
  background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.96));
  pointer-events: none;
}

.wf-phone-img {
  display: block;
  width: 100%;
  height: auto;
  object-fit: cover;
  object-position: center top; /* shows only top sliver */
  border-radius: inherit;
}
```

Three problems compound:

1. **`inset-x: 0` is not valid CSS.** Only the long-form `inset-inline: 0` or the
   pair `left: 0; right: 0;` is correct. With this typo the bottom-fade gradient
   is positioned arbitrarily (or absent), so the frame edge looks raw.
2. **`max-height: 320px` clips the image below its natural height.** The
   screenshot is taller than 320px at the rendered width.
3. **`object-fit: cover` + `object-position: center top`** combined with the
   `max-height` forces the image to crop everything below the visual top portion,
   leaving an "incomplete app screen" feel rather than a confident product shot.

### Fix

Drop the artificial height ceiling and let the image render at its natural
aspect ratio inside the frame. Remove the bottom-fade pseudo-element entirely —
the screenshot was designed to be shown in full, the fade was hiding intentional
content.

**Result CSS:**

```css
.wf-phone-frame {
  border-radius: 1.2rem;
  overflow: hidden;
  margin: 0.75rem 0 1rem;
  position: relative;
  background: rgba(0, 0, 0, 0.04);
}

.wf-phone-img {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
  border-radius: inherit;
}
```

- `max-height: 320px` removed.
- `.wf-phone-frame::after` block deleted.
- `object-fit: cover` → `object-fit: contain` (no cropping).
- `object-position` removed (no longer needed).
- A subtle `background` added so the frame still reads as a contained card if
  the image's aspect ratio leaves any letterbox.

---

## Bug B — Ch.09 form-card text blur

### Symptom

Headings and form labels inside the early-access form card (right column of the
CTA section) appear softly blurred while the user scrolls. Scrolling stops, the
text remains soft. Reload, scroll again, blur returns. Worse on Chromium-family
browsers.

### Root cause

[`src/clients/marketing-web/src/components/sections/CtaSection.astro`](src/clients/marketing-web/src/components/sections/CtaSection.astro), lines 92–94:

```html
<div class="relative xl:pt-8" data-zoom-section
     data-zoom-from-scale="0.92" data-zoom-from-y="40">
  <div class="absolute -inset-4 rounded-[2rem] pointer-events-none"
       style="background:radial-gradient(...);filter:blur(24px);" aria-hidden="true"></div>
  <div class="relative rounded-[2rem] border border-white/10
              bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))]
              backdrop-blur-xl
              p-5 md:p-6 shadow-[0_28px_80px_rgba(0,0,0,0.35)]">
    <!-- form card content with text -->
```

Two interacting features:

1. **`backdrop-blur-xl`** on the inner card → `backdrop-filter: blur(24px)`.
2. **`data-zoom-section`** on the outer wrapper → consumed by `initZoomSections`
   in `scrollAnimations.ts` with `scrub: 0.8`, applying a continuously-changing
   `transform: scale()` and `translateY()` during scroll.

Chromium re-rasterizes text inside a `backdrop-filter` element on every
sub-pixel transform change. Combined with `scrub: 0.8`, the form card receives a
new transform value every scroll frame, and the text inside it never gets a
clean rasterization pass — leaving a permanent soft-edge blur.

This is a known browser interaction — not a one-off glitch, not fixable by
tuning timings.

### Fix (Option 1 — recommended, user-approved)

Remove `backdrop-blur-xl` from the form card and keep the rest of the card's
visual treatment. The blur added very little perceived depth on top of the
existing dark night gradient, the radial green wash behind the card, the
border, and the heavy drop shadow — but it cost text legibility.

**Edit:**

```html
<div class="relative rounded-[2rem] border border-white/10
            bg-[linear-gradient(180deg,rgba(20,12,5,0.55),rgba(10,6,0,0.45))]
            p-5 md:p-6 shadow-[0_28px_80px_rgba(0,0,0,0.35)]">
```

Changes:

- `backdrop-blur-xl` class removed.
- Background gradient changed from white-on-white (`rgba(255,255,255,0.08)` →
  `rgba(255,255,255,0.03)`) to a solid dark glass
  (`rgba(20,12,5,0.55)` → `rgba(10,6,0,0.45)`). This preserves the "card lifted
  off the page" feel without depending on backdrop-filter.
- Border, padding, shadow unchanged.
- The decorative `filter:blur(24px)` div on the radial green wash above stays —
  it has no text inside and is not affected by the same Chromium issue.

### Considered alternatives (rejected)

- **Option 2 — keep blur, drop scroll animation:** Removes the `data-zoom-section`
  attribute. Sharp text, but loses the scale-in entrance that ties this section
  to the rest of the cinematic flow.
- **Option 3 — restructure to non-transformed sibling:** Wraps the backdrop-blur
  in a separate non-transformed layer behind the card. Most engineering,
  preserves both effects, but adds a div, an extra positioning context, and
  z-index complexity for marginal visual gain.

---

## Files touched

| File | Change |
|---|---|
| `src/clients/marketing-web/src/components/sections/WorkflowSection.astro` | `.wf-phone-frame` + `.wf-phone-img` CSS rewrite, delete `.wf-phone-frame::after` rule |
| `src/clients/marketing-web/src/components/sections/CtaSection.astro` | Form-card class change (drop `backdrop-blur-xl`, swap background gradient) |

Two files, ~15 lines net delta.

---

## Verification

### Pre-merge checks

- `npm run build` exits 0.
- `npx tsc --noEmit` exits 0.

### Manual visual check (in `localhost:4000`)

- **Ch.04** — full app-screen screenshot visible, no hard bottom edge, no white
  fade overlay. Image proportions look natural inside the result card.
- **Ch.09** — the form heading (`t.waitlist.title`), the "Coming soon" pill,
  the "Early access" eyebrow, and all input labels render sharp during AND after
  a scrub-into-section scroll. No softening at any zoom level (100%, 125%,
  150%).

---

## Out of scope

These are explicitly NOT addressed in Sub-project 1 (they belong to later
sub-projects):

- English typography weight pass (Sub-project 2).
- Color/motion token sweep across the 13 out-of-scope files (Sub-project 2).
- Ch.06 TrustSection interactivity rework (Sub-project 3).
- Sitewide vivid-motion / interactive-image pass (Sub-project 3).
- New professional sections (Sub-project 4 — deferred until 1–3 reviewed).
- Visual smoke test of the full Option C polish (existing pending task
  `T-MARKETING-POLISH-SMOKE`, owner Akash).
