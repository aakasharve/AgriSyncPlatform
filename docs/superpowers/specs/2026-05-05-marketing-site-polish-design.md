# Marketing Site Polish — Full Redesign Pass (Option C)

**Date:** 2026-05-05  
**Author:** Senior Design Critic (Claude, design mode active)  
**Scope:** `src/clients/marketing-web/`  
**Spec ID:** marketing-site-polish-c

---

## 1. Goals

1. Enforce a single, coherent visual theme — one green palette, one grain layer, one animation authority.
2. Eliminate the sluggish / broken scroll feel caused by competing CSS + GSAP animation systems.
3. Reduce page structure from 12 chapters to 9 — removing repetitive content, not removing value.
4. Add connective motion choreography so the scroll reads as one continuous story, not 12 slides.
5. Add a mobile sticky CTA bar for conversion lift on small screens.
6. No new dependencies. No layout system changes. Astro + GSAP + Tailwind stays as-is.

---

## 2. Color & Token Normalization

### 2.1 New tokens (add to `tokens.css`)

```css
--brand-fresh-10: rgba(22, 163, 74, 0.10);
--brand-fresh-15: rgba(22, 163, 74, 0.15);
```

### 2.2 Replace all off-token greens

Every occurrence of the following is replaced with the canonical token equivalent:

| Raw value | Replace with |
|---|---|
| `#10B981` | `var(--brand-fresh)` |
| `#059669` | `var(--brand)` |
| `rgba(5, 150, 105, N)` | `rgba(22, 163, 74, N)` |
| `rgba(16, 185, 129, N)` | `rgba(22, 163, 74, N)` |
| `rgba(5, 150, 105, N)` borders | `var(--brand-fresh-10)` or `var(--brand-fresh-15)` |

**Files affected:**
- `src/styles/global.css` — `.mic-3d`, `.glow-green`, `card-hover-glow`, `.bento-card`, `#cursor-glow`, `#scroll-progress`, `crop-bar`, `input-glow`, `marquee-track`
- `src/components/islands/PloughNav.tsx` — active dot gradient, label bg, hover bg
- `src/components/sections/HeroSection.astro` — offline badge `#3B82F6` → `var(--farm-sky)`

### 2.3 Remove duplicate font load

`BaseLayout.astro` loads both `Instrument Serif` and `DM Serif Display`. The `--font-serif` token for `lang="en"` uses only `Instrument Serif`. Remove `DM Serif Display` from the Google Fonts URL to save ~12KB.

---

## 3. Animation Architecture — Single Authority

### 3.1 Remove CSS scroll-reveal transitions

Delete from `global.css`:
```css
/* Scene reveal animations */
.scene-hidden { ... }
.scene-visible { ... }
```

GSAP owns all scroll-triggered enter animations. CSS transitions are for hover states only.

**Important:** Any `section.classList.remove('scene-hidden')` / `classList.add('scene-visible')` calls in `scrollAnimations.ts` must also be removed. The `initSceneVisibility` function is deleted — its work is absorbed into `initBasicReveals` and `initSectionHandoff`.

### 3.2 Dead code deletion

Remove from `scrollAnimations.ts`:
- `initHeroPin()` — looks for `[data-hero-pin]` which does not exist in any markup
- `initSceneVisibility()` — replaced by section hand-off system

### 3.3 Scrub calibration

| Trigger | Current scrub | New scrub |
|---|---|---|
| `CinematicScrollHero` frame sequence | 1.2 | 1.2 (keep) |
| Parallax layers (`[data-parallax]`) | — | 0.8 |
| Zoom sections (`[data-zoom-section][data-zoom-scrub]`) | true | scrub: 0.8 |

### 3.4 New: `initSectionHandoff()` in `scrollAnimations.ts`

Adds connective tissue between every adjacent section pair. Runs once after all other inits.

```
For each [data-scene] section:

  Outgoing (section reaches bottom 40%):
    → gsap.to(section content, { opacity: 0.92, duration: 0.3, ease: 'none' })
    → soil-stratum divider animates scaleX 0 → 1 (0.4s, ease expo.out)

  Incoming (section enters top 75%):
    → starts: { scale: 0.985, opacity: 0 }
    → animates: { scale: 1, opacity: 1, duration: 0.7, ease: 'expo.out' }
    → headline split fires 0.15s delay after section enter
```

Implementation note: use a single `ScrollTrigger.create` per section pair with `onEnter` / `onLeaveBack` callbacks. Do not use scrub for hand-off — it must be `once: false` so back-scrolling reverses correctly.

### 3.5 WindCanvas — pause when tab hidden

Wrap the `requestAnimationFrame` loop in a `document.addEventListener('visibilitychange', ...)` guard. When `document.hidden === true`, cancel the RAF. Resume when visible again. Zero user-visible change; eliminates background GPU burn.

---

## 4. Page Structure — 12 → 9 Sections

### 4.1 Sections removed

| Removed section | Content disposition |
|---|---|
| `ClaritySection` | Key insight (2 sentences) becomes a pull-quote callout inside `WorkflowSection` |
| `IdentityShiftSection` | Emotional headline + body become a pull-quote inside `LegacySection` |
| `FAQSection` (standalone) | 4 essential Q&As become an accordion inside `CtaSection`, above the waitlist form |

### 4.2 New page order (index.astro)

```
CinematicScrollHero   (Ch.01 · The Field)
HeroSection           (Ch.01 cont — copy + phone)
ProblemHitSection     (Ch.02 · The Pain)
BeforeAfterSection    (Ch.03 · The Shift)
WorkflowSection       (Ch.04 · Speak and We Sort)
  └─ ClaritySection pull-quote embedded here
ValueLadderSection    (Ch.05 · The 90-Day Return)
TrustSection          (Ch.06 · Trust)
LegacySection         (Ch.07 · Legacy)
  └─ IdentityShift content embedded here
ParticipationSection  (Ch.08 · Your Part)
CtaSection            (Ch.09 · Begin)
  └─ 4-item FAQ accordion embedded here
```

### 4.3 Section dividers — consistent rule

**Remove:** All 4 `<div class="section-divider">` bag SVG blocks from `index.astro`.  
**Add:** A `<div class="soil-stratum" aria-hidden="true">` between every section pair. The CSS for `.soil-stratum` is already defined in `global.css`.

The bag SVGs were decorative but inconsistent (only between some chapters). The soil stratum is architectural — it marks every chapter boundary the same way.

### 4.4 PloughNav — update section list

Remove `clarity` from the section list (it was item 05 — it existed in the nav but not in the new page). `identity-shift` was already absent from the PloughNav. Renumber remaining items 01–09. The new order:

```
01 hero  02 problem-hit  03 before-after  04 workflow
05 value-ladder  06 trust  07 legacy  08 participation  09 cta
```

Match `data-scene` attribute values to the remaining sections.

---

## 5. Hero Simplification

### 5.1 CTAs — 3 → 2

**Remove:** `hero__cta-ghost` for APK download from `HeroSection.astro`.  
**Move:** APK download link to `CtaSection` as a secondary option below the waitlist form.  
**Result:**

```
[Join Waitlist →]   [See how it works ↓]
```

### 5.2 Remove floating badges

Remove the three `hero__badge` divs (`hero__badge--voice`, `hero__badge--cost`, `hero__badge--offline`) and all associated CSS from `HeroSection.astro`. The feature pills already communicate the same information more cleanly.

Remove associated CSS: `.hero__badge`, `.hero__badge--voice`, `.hero__badge--cost`, `.hero__badge--offline`, `@keyframes badge-drift-a`, `@keyframes badge-drift-b`.

### 5.3 Hero glow — remove GPU blur

Replace `.hero__glow--green` and `.hero__glow--gold` `filter: blur(72px)` with pre-composed radial gradients using larger spread (same visual, zero compositor layer):

```css
.hero__glow--green {
  background: radial-gradient(ellipse 60% 60% at 46% 52%,
    rgba(22,163,74,0.13) 0%, rgba(22,163,74,0.05) 45%, transparent 72%);
  /* Remove: filter: blur(72px); */
}
.hero__glow--gold {
  background: radial-gradient(ellipse 50% 50% at 92% 95%,
    rgba(217,119,6,0.10) 0%, rgba(217,119,6,0.03) 50%, transparent 72%);
  /* Remove: filter: blur(72px); */
}
```

### 5.4 Remove hero grain duplication

Delete the `<div class="hero__grain" aria-hidden="true">` element and its CSS from `HeroSection.astro`. The body `grain::after` pseudo-element covers this.

### 5.5 Trim `will-change`

Remove `will-change` from `.hero__ring--outer`, `.hero__ring--inner`, `.hero__glow`. Keep only on `.hero__phone-wrap` (the only element with a continuous transform animation).

---

## 6. Mobile Sticky CTA Bar (new component)

### 6.1 New island: `StickyCta.tsx`

Location: `src/components/islands/StickyCta.tsx`

**Behavior:**
- Hidden by default (translate-y: 100%)
- Appears when `[data-scene="hero"]` leaves the viewport (IntersectionObserver)
- Disappears when `[data-scene="cta"]` enters the viewport
- Slide-up animation: `transform: translateY(0)`, 0.3s, `ease-out`
- Mobile only (`max-width: 767px`) — returns `null` on desktop

**Markup:**
```html
<div id="sticky-cta" role="complementary" aria-label="Quick join">
  <a href="#cta">Join the waitlist — free →</a>
</div>
```

**Styles (inline):**
```css
position: fixed; bottom: 0; left: 0; right: 0; z-index: 50;
height: 52px; background: var(--brand); color: #fff;
display: flex; align-items: center; justify-content: center;
font-family: var(--font-sans); font-weight: 800; font-size: 0.95rem;
text-decoration: none; letter-spacing: 0.01em;
transition: transform 0.3s ease-out;
transform: translateY(100%); /* hidden initial state */
```

### 6.2 Wire into `BaseLayout.astro`

Add `<StickyCta client:idle />` just before `</body>`. Use `client:idle` so it doesn't block the hero frame sequence load.

---

## 7. Dead Code Cleanup

Remove from `src/components/islands/`:
- `AppScreen3D.tsx` — not imported anywhere
- `RangoliLoader.tsx` — not imported anywhere
- `AudioSystem.tsx` — not imported anywhere (audio toggle button still exists in CSS but the system is unused)
- `ChulhaSmoke.tsx` — not imported anywhere
- `WellIndicator.tsx` — not imported anywhere

Remove from `global.css`:
- `.bento-grid`, `.bento-card` — not used in any `.astro` file
- `#audio-toggle` CSS block — `AudioSystem.tsx` removed
- `#bullock-wheel` CSS block — no `bullock-wheel` element in any page
- `.section-page`, `.section-page-edge` — almanac page-turn CSS, not used anywhere
- `body[data-festival]` overrides — festival system not wired

---

## 8. Files Changed Summary

| File | Change type |
|---|---|
| `src/styles/tokens.css` | Add 2 tokens |
| `src/styles/global.css` | Remove 6 dead blocks, fix all off-token greens, remove `.scene-hidden/.scene-visible` |
| `src/layouts/BaseLayout.astro` | Remove DM Serif Display font, add `<StickyCta>` |
| `src/scripts/scrollAnimations.ts` | Delete 2 dead functions, add `initSectionHandoff`, scrub calibration |
| `src/components/islands/PloughNav.tsx` | Token-align colors, update section list 10→9 |
| `src/components/islands/WindCanvas.tsx` | Add Page Visibility API guard |
| `src/components/islands/StickyCta.tsx` | **New file** |
| `src/components/sections/HeroSection.astro` | Remove badges, reduce CTAs, fix glow, remove grain div |
| `src/components/sections/WorkflowSection.astro` | Embed ClaritySection pull-quote |
| `src/components/sections/LegacySection.astro` | Embed IdentityShift content |
| `src/components/sections/CtaSection.astro` | Embed 4-item FAQ accordion, add APK download link |
| `src/pages/en/index.astro` | Remove 3 section imports, replace bag dividers with soil-stratum |
| `src/pages/mr/index.astro` | Same as en/index.astro |
| Dead island files (5) | Delete |

---

## 9. Definition of Done

- [ ] `tokens.css` has the 2 new tokens and no off-token greens remain in any file
- [ ] `global.css` has no `.scene-hidden/.scene-visible` block
- [ ] `scrollAnimations.ts` has no `initHeroPin`, no `initSceneVisibility`; has `initSectionHandoff`
- [ ] Page has 9 sections, PloughNav has 9 items
- [ ] Hero has 2 CTAs, 0 floating badges, 0 hero__grain div
- [ ] `StickyCta.tsx` exists, renders on mobile only, slides in after hero exits
- [ ] 5 dead island files deleted
- [ ] WindCanvas pauses on `visibilitychange`
- [ ] `npm run build` exits 0 with no TypeScript errors
- [ ] Visual smoke test: scroll from top to CTA, all sections enter cleanly, no stutter

---

## 10. Out of Scope

- Content copy changes (headlines, body text)
- Marathi translation updates
- New photography or illustration assets
- Sarvam STT or voice pipeline changes
- Backend / API changes
- Dark mode
